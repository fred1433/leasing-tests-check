import { expect, type Page } from "@playwright/test";

export async function bookShowing(page: Page, unit: string, p: { prospect: string; email: string; date: string; time: string }) {
  const form = page.getByRole("form", { name: `Book a showing for ${unit}` });
  await form.getByLabel("Prospect", { exact: true }).fill(p.prospect);
  await form.getByLabel("Prospect email").fill(p.email);
  await form.getByLabel("Date").fill(p.date);
  await form.getByLabel("Time").fill(p.time);
  await form.getByRole("button", { name: "Book showing" }).click();
  await page.waitForLoadState("networkidle");
}

export async function onlyShowingId(page: Page): Promise<number> {
  const showing = page.locator("[data-testid^='showing-']").first();
  await expect(showing).toBeVisible();
  return Number((await showing.getAttribute("data-testid"))!.replace("showing-", ""));
}

export async function reschedule(page: Page, showingId: number, date: string, time: string) {
  const form = page.getByTestId(`showing-${showingId}`).getByRole("form", { name: "Reschedule" });
  await form.getByLabel("New date").fill(date);
  await form.getByLabel("New time").fill(time);
  await form.getByRole("button", { name: "Reschedule" }).click();
  await page.waitForLoadState("networkidle");
}
