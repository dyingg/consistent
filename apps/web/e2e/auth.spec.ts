import { test, expect } from "@playwright/test";

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = "testpassword123";
const TEST_NAME = "Test User";

test.describe("Auth flow", () => {
  test("sign up → sign in → access /v1/me → sign out → 401", async ({
    page,
    request,
  }) => {
    // 1. Sign up
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill(TEST_NAME);
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign Up" }).click();

    // Should redirect to home and show email
    await expect(page.getByText(TEST_EMAIL)).toBeVisible({ timeout: 10000 });

    // 2. Sign out
    await page.getByRole("button", { name: "Sign Out" }).click();

    // Should show welcome / sign-in links
    await expect(
      page.getByRole("button", { name: "Sign In" }),
    ).toBeVisible({ timeout: 5000 });

    // 3. Sign in
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should redirect to home and show email
    await expect(page.getByText(TEST_EMAIL)).toBeVisible({ timeout: 10000 });

    // 4. Access /v1/me via API (using the browser's cookies)
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const meResponse = await request.get("http://localhost:3001/v1/me", {
      headers: { cookie: cookieHeader },
    });
    expect(meResponse.status()).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.email).toBe(TEST_EMAIL);

    // 5. Sign out
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(
      page.getByRole("button", { name: "Sign In" }),
    ).toBeVisible({ timeout: 5000 });

    // 6. Verify /v1/me returns 401 without session
    const meAfterSignOut = await request.get("http://localhost:3001/v1/me");
    expect(meAfterSignOut.status()).toBe(401);
  });
});
