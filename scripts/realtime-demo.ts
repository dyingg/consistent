/**
 * Realtime demo: sign up a test user, connect Socket.IO, send ping, assert pong.
 *
 * Usage: pnpm realtime:demo
 * Requires: API running on localhost:3001, Docker (Postgres + Redis) up.
 */

const API_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
const email = `realtime-test-${Date.now()}@example.com`;
const password = "testpassword123";

async function main() {
  console.log("1. Signing up test user...");

  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const signUpRes = await fetch(`${API_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ name: "Realtime Test", email, password }),
  });

  if (!signUpRes.ok) {
    const body = await signUpRes.text();
    throw new Error(`Sign-up failed: ${signUpRes.status} ${body}`);
  }

  // Extract session cookie from Set-Cookie header
  const setCookie = signUpRes.headers.getSetCookie();
  const sessionCookie = setCookie
    .map((c) => c.split(";")[0])
    .join("; ");

  if (!sessionCookie) {
    throw new Error("No session cookie returned from sign-up");
  }

  console.log("   Signed up and got session cookie");

  // Verify /v1/me works
  const meRes = await fetch(`${API_URL}/v1/me`, {
    headers: { cookie: sessionCookie },
  });
  if (!meRes.ok) throw new Error(`/v1/me failed: ${meRes.status}`);
  const me = await meRes.json();
  console.log(`   Verified: /v1/me returns ${me.email}`);

  // Connect Socket.IO
  console.log("2. Connecting Socket.IO...");
  const { io } = await import("socket.io-client");

  const socket = io(API_URL, {
    extraHeaders: { cookie: sessionCookie },
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Socket.IO connection timeout")),
      5000,
    );

    socket.on("connect", () => {
      clearTimeout(timeout);
      console.log(`   Connected: ${socket.id}`);
      resolve();
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Socket.IO connection error: ${err.message}`));
    });
  });

  // Send ping, expect pong
  console.log("3. Sending ping...");
  const pong = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Pong timeout")),
      5000,
    );

    socket.emit("ping", {}, (response: any) => {
      clearTimeout(timeout);
      resolve(response);
    });

    socket.on("pong", (data: any) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });

  console.log(`   Received pong: ${JSON.stringify(pong)}`);

  socket.disconnect();
  console.log("\nRealtime demo passed!");
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nRealtime demo FAILED: ${err.message}`);
  process.exit(1);
});
