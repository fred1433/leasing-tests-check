import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

const STATE = "playwright/.auth/user.json";

/** A real sign-in through Clerk's own form, on a Clerk development instance. The state file stays out of git. */
setup("sign in as the leasing test user", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await page.getByLabel(/email address/i).fill(process.env.E2E_CLERK_USER_EMAIL!);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(/^password/i).fill(process.env.E2E_CLERK_USER_PASSWORD!);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // A new device may be asked for an email code ("client trust"). For a +clerk_test address Clerk sends no email
  // and accepts the fixed test code 424242.
  const checkEmail = page.getByRole("heading", { name: "Check your email" });
  await Promise.race([page.waitForURL(/\/showings/, { timeout: 20_000 }), checkEmail.waitFor({ timeout: 20_000 })]).catch(() => undefined);
  if (await checkEmail.isVisible()) {
    if (await page.getByText("You need to send a verification code").isVisible()) {
      await page.getByRole("button", { name: /Resend/ }).click();
    }
    await page.getByRole("textbox", { name: "Enter verification code" }).pressSequentially("424242");
  }

  await page.waitForURL(/\/showings/);
  await expect(page.getByTestId("signed-in-as")).toContainText(process.env.E2E_CLERK_USER_EMAIL!);
  await page.context().storageState({ path: STATE });
});
