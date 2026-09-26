import { jobsFor, setTestClock } from "../support/data";
import { zonedInstant } from "@/lib/time";
import { expect, test } from "./fixtures";

/** Regression test for docs/BUG_REPORT.md: a double click on "Book showing" booked twice. */
test("double-clicking Book showing books one showing and queues one set of notices", async ({ page, portfolio }) => {
  await setTestClock(zonedInstant(2026, 10, 1, 9));
  await portfolio.open();
  const form = page.getByRole("form", { name: "Book a showing for Unit B" });
  await form.getByLabel("Prospect", { exact: true }).fill("Jordan Lee");
  await form.getByLabel("Prospect email").fill("jordan.lee@prospects.example.test");
  await form.getByLabel("Date").fill("2026-10-06");
  await form.getByLabel("Time").fill("14:00");
  await form.getByRole("button", { name: "Book showing" }).dblclick();

  await expect(page.getByTestId("unit-Unit B").locator("div.showing")).toHaveCount(1);
  await expect.poll(async () => (await jobsFor(portfolio.runId)).map((j) => j.kind)).toEqual(["tenant_sms", "tenant_email", "calendar_event"]);
  await page.reload();
  await expect(page.getByTestId("unit-Unit B").locator("div.showing")).toHaveCount(1);
});
