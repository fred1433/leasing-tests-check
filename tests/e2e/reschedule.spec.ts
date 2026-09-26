import { capturesFor, setTestClock, waitForWorker } from "../support/data";
import { zonedInstant } from "@/lib/time";
import { expect, test } from "./fixtures";
import { bookShowing, onlyShowingId, reschedule } from "./steps";

/**
 * The flow this sample protects end to end:
 * a showing is booked, the tenant's notice is queued for 10 a.m. the day before,
 * the showing is moved, and the old queued notice comes due anyway.
 * Only the notice for the new time may reach the sending boundary.
 */
test("rescheduling a showing: the old notice must not send", async ({ page, portfolio }) => {
  await setTestClock(zonedInstant(2026, 10, 1, 9)); // Thursday, October 1, 9:00 a.m.
  await portfolio.open();

  await bookShowing(page, "Unit B", { prospect: "Jordan Lee", email: "jordan.lee@prospects.example.test", date: "2026-10-06", time: "14:00" });
  const showingId = await onlyShowingId(page);
  await expect(page.getByTestId(`showing-${showingId}`).getByTestId("when")).toHaveText("Tuesday, October 6, 2:00 p.m. to 2:30 p.m.");

  await reschedule(page, showingId, "2026-10-08", "16:00");
  await expect(page.getByTestId(`showing-${showingId}`).getByTestId("when")).toHaveText("Thursday, October 8, 4:00 p.m. to 4:30 p.m.");

  // Monday 10:05 a.m.: the notices written for Tuesday come due.
  await setTestClock(zonedInstant(2026, 10, 5, 10, 5));
  await waitForWorker(portfolio.runId);
  // Wednesday 10:05 a.m.: the notices for Thursday come due.
  await setTestClock(zonedInstant(2026, 10, 7, 10, 5));
  await waitForWorker(portfolio.runId);

  const tenantNotices = (await capturesFor(portfolio.runId, showingId)).filter((c) => c.channel !== "graph.createEvent");
  expect(tenantNotices, "every notice the tenant would have received").toEqual([
    {
      channel: "twilio.sms",
      recipients: ["+15550100141", "+15550100100"],
      text: "Hi Maya, this is the leasing office. We would like to show 41 Hollow Crescent, Unit B, to a prospective tenant on Thursday, October 8, 4:00 p.m. to 4:30 p.m. Eastern time. Reply to this message if that time is a problem.",
    },
    {
      channel: "sendgrid.mail",
      recipients: ["maya.chen@tenants.example.test", "leasing@office.example.test"],
      text: "Hi Maya, this is the leasing office. We would like to show 41 Hollow Crescent, Unit B, to a prospective tenant on Thursday, October 8, 4:00 p.m. to 4:30 p.m. Eastern time. Reply to this message if that time is a problem.",
    },
  ]);

  // What the leasing staff see: the old notices are withdrawn, not sent.
  await page.reload();
  const showing = page.getByTestId(`showing-${showingId}`);
  await expect(showing.getByTestId("notice-tenant_sms-v1")).toHaveText(
    "Text to tenant for Tuesday, October 6, 2:00 p.m. to 2:30 p.m.: Not sent: showing was moved (job for version 1, showing now at version 2)",
  );
  await expect(showing.getByTestId("notice-tenant_sms-v2")).toHaveText("Text to tenant for Thursday, October 8, 4:00 p.m. to 4:30 p.m.: Sent");
});
