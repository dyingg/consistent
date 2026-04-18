import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Boots the built API on a dedicated port and exercises the real auth flow
 * against the local Postgres. Designed to catch wiring bugs that unit tests
 * with mocked DBs cannot — for example, body-parser middleware ordering on
 * the Better Auth route. Requires `pnpm build` (handled by the npm script)
 * and a running Postgres + Redis (docker compose up).
 */

const PORT = 3010;
const BASE_URL = `http://localhost:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DIST_MAIN = path.resolve(__dirname, "../dist/main.js");
const ENV_FILE = path.join(REPO_ROOT, ".env");

let server: ChildProcess | null = null;

async function waitForHealthy(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/v1/health`);
      if (res.ok) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`API at ${BASE_URL} not healthy after ${timeoutMs}ms: ${String(lastErr)}`);
}

beforeAll(async () => {
  if (!existsSync(DIST_MAIN)) {
    throw new Error(`Missing build output at ${DIST_MAIN}. Run 'pnpm build' first.`);
  }
  if (!existsSync(ENV_FILE)) {
    throw new Error(`Missing .env at ${ENV_FILE}.`);
  }

  server = spawn(
    process.execPath,
    [`--env-file=${ENV_FILE}`, DIST_MAIN],
    {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );

  server.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      // Surface unexpected crashes — Jest will report this in the failing test
      console.error(`API subprocess exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });

  await waitForHealthy();
}, 60_000);

afterAll(async () => {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    server!.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

describe("Auth integration (real DB)", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `integration-${uniq}@example.com`;
  const password = "integration-test-pw-1234";
  const name = "Integration Test User";

  let sessionCookie = "";

  it("sign-in for nonexistent user returns 401 — proves Better Auth received a parsed body", async () => {
    // This is the regression test for the body-parser ordering bug.
    // If req.body is undefined when the auth route runs, Better Auth's Zod
    // validator returns 400 "[body] Invalid input: expected object, received
    // undefined" instead of the credential-mismatch 401.
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "x" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("sign-up creates a new user and issues a session cookie", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    sessionCookie = setCookie!;
  });

  it("sign-in with the new credentials returns 200 and a session cookie", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    sessionCookie = setCookie!;
  });

  it("sign-in with wrong password returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "definitely-wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("/v1/me with the session cookie returns the authenticated user", async () => {
    const res = await fetch(`${BASE_URL}/v1/me`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; name: string };
    expect(body.email).toBe(email);
    expect(body.name).toBe(name);
  });

  it("/v1/me without a session cookie returns 401", async () => {
    const res = await fetch(`${BASE_URL}/v1/me`);
    expect(res.status).toBe(401);
  });

  it("sign-out invalidates the session — /v1/me with the same cookie now returns 401", async () => {
    const signOutRes = await fetch(`${BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
    });
    expect(signOutRes.status).toBe(200);

    const meRes = await fetch(`${BASE_URL}/v1/me`, {
      headers: { cookie: sessionCookie },
    });
    expect(meRes.status).toBe(401);
  });
});
