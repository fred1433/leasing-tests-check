import { capturesFor, injectTransportFault, jobsFor, refusalsFor, setTestClock, waitForWorker } from "../support/data";
import { zonedInstant } from "@/lib/time";
import { expect, test } from "./fixtures";
import { bookShowing, onlyShowingId } from "./steps";

test.describe("acceptance matrix", () => {
  test("a valid booking produces the expected notices", async ({ page, portfolio }) => {
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await portfolio.open();
    await bookShowing(page, "Unit B", { prospect: "Jordan Lee", email: "jordan.lee@prospects.example.test", date: "2026-10-06", time: "14:00" });
    const showingId = await onlyShowingId(page);

    await waitForWorker(portfolio.runId);
    expect(await capturesFor(portfolio.runId, showingId)).toEqual([
      {
        channel: "graph.createEvent",
        recipients: ["agent@office.example.test", "jordan.lee@prospects.example.test"],
        text: "Showing: 41 Hollow Crescent, Unit B 2026-10-06T14:00:00",
      },
    ]);

    await setTestClock(zonedInstant(2026, 10, 5, 10, 1));
    await waitForWorker(portfolio.runId);
    const texts = (await capturesFor(portfolio.runId, showingId)).map((c) => `${c.channel}: ${c.text}`);
    expect(texts.slice(1)).toEqual([
      expect.stringMatching(/^twilio\.sms: .*on Tuesday, October 6, 2:00 p\.m\. to 2:30 p\.m\. Eastern time\./),
      expect.stringMatching(/^sendgrid\.mail: .*on Tuesday, October 6, 2:00 p\.m\. to 2:30 p\.m\. Eastern time\./),
    ]);
  });

  test("a cancelled showing's notice does not send when its failed attempt retries", async ({ page, portfolio }) => {
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await portfolio.open();
    await bookShowing(page, "Unit B", { prospect: "Jordan Lee", email: "jordan.lee@prospects.example.test", date: "2026-10-06", time: "14:00" });
    const showingId = await onlyShowingId(page);
    await injectTransportFault(portfolio.runId, "tenant_sms", 1);

    await setTestClock(zonedInstant(2026, 10, 5, 10, 1)); // first attempt fails, retry queued for 10:03
    await waitForWorker(portfolio.runId);
    await page.reload();
    await page.getByTestId(`showing-${showingId}`).getByRole("button", { name: "Cancel showing" }).click();
    await expect(page.getByTestId(`showing-${showingId}`)).toHaveAttribute("data-status", "cancelled");

    await setTestClock(zonedInstant(2026, 10, 5, 10, 10));
    await waitForWorker(portfolio.runId);
    const sms = (await jobsFor(portfolio.runId)).filter((j) => j.kind === "tenant_sms");
    expect(sms).toEqual([expect.objectContaining({ status: "superseded", attempts: 2, last_error: "showing was cancelled" })]);
    expect((await capturesFor(portfolio.runId, showingId)).map((c) => c.channel)).not.toContain("twilio.sms");
  });

  test("a calendar invite to an address off the allowlist is stopped before Graph", async ({ page, portfolio }) => {
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await portfolio.open();
    await bookShowing(page, "Unit B", { prospect: "Riley Park", email: "riley.park@outside.invalid", date: "2026-10-06", time: "14:00" });
    const showingId = await onlyShowingId(page);
    await waitForWorker(portfolio.runId);

    expect(await refusalsFor(portfolio.runId)).toEqual([
      { channel: "graph.createEvent", reason: "graph.createEvent: recipient not on the allowlist: ri***@outside.invalid" },
    ]);
    expect(await capturesFor(portfolio.runId, showingId)).toEqual([]);
    await page.reload();
    await expect(page.getByTestId(`showing-${showingId}`).getByTestId("notice-calendar_event-v1")).toContainText(
      "Blocked: graph.createEvent: recipient not on the allowlist",
    );
  });

  test("a showing without a termination basis is refused, whatever the lease end date", async ({ page, portfolio }) => {
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await portfolio.open();
    await bookShowing(page, "Unit A", { prospect: "Jordan Lee", email: "jordan.lee@prospects.example.test", date: "2026-10-06", time: "14:00" });
    await expect(page.getByTestId("error")).toHaveText(
      "No notice of termination or agreement to terminate is recorded. The lease end date (2026-10-31) does not by itself allow showings.",
    );
    await expect(page.getByTestId("unit-Unit A").locator("[data-testid^='showing-']")).toHaveCount(0);
    expect(await jobsFor(portfolio.runId)).toEqual([]);
  });

  test("a showing after 8 p.m. is refused", async ({ page, portfolio }) => {
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await portfolio.open();
    await bookShowing(page, "Unit B", { prospect: "Jordan Lee", email: "jordan.lee@prospects.example.test", date: "2026-10-06", time: "19:45" });
    await expect(page.getByTestId("error")).toHaveText("Showings must fall between 8 a.m. and 8 p.m., office time.");
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the showings page is not reachable without signing in", async ({ page }) => {
    await page.goto("/showings?portfolio=anything");
    await expect(page).not.toHaveURL(/\/showings/);
    await expect(page.getByTestId("signed-in-as")).toHaveCount(0);
  });
});
