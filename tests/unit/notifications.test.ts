import { describe, expect, it } from "vitest";
import { renderNotice, resolveNotice, tenantNoticeText, type NoticeFacts, type QueuedJob } from "@/lib/notifications";
import { noticeTime } from "@/lib/showings";
import { zonedInstant } from "@/lib/time";

const facts: NoticeFacts = {
  showingId: 1,
  version: 1,
  status: "booked",
  unitLabel: "Unit B",
  address: "41 Hollow Crescent",
  tenantName: "Maya Chen",
  tenantEmail: "maya.chen@tenants.example.test",
  tenantPhone: "+15550100141",
  prospectName: "Jordan Lee",
  prospectEmail: "jordan.lee@prospects.example.test",
  agentEmail: "agent@office.example.test",
  startsAt: zonedInstant(2026, 10, 6, 14).toISOString(),
  durationMinutes: 30,
};
const job: QueuedJob = { id: 10, kind: "tenant_sms", showingVersion: 1, payload: facts };

describe("worker decision at execution time", () => {
  it("sends a job that still describes the showing", () => {
    expect(resolveNotice(job, { version: 1, status: "booked" })).toEqual({ send: true, facts });
  });

  it("drops a job written for an earlier version of the showing", () => {
    expect(resolveNotice(job, { version: 2, status: "booked" })).toEqual({
      send: false,
      reason: "showing was moved (job for version 1, showing now at version 2)",
    });
  });

  it("drops a job for a cancelled showing, even at the same version", () => {
    expect(resolveNotice(job, { version: 1, status: "cancelled" })).toMatchObject({ send: false, reason: "showing was cancelled" });
  });

  it("drops a job whose showing is gone", () => {
    expect(resolveNotice(job, null)).toMatchObject({ send: false });
  });
});

describe("notice content", () => {
  it("states the showing window in office time", () => {
    expect(tenantNoticeText(facts)).toBe(
      "Hi Maya, this is the leasing office. We would like to show 41 Hollow Crescent, Unit B, to a prospective tenant on Tuesday, October 6, 2:00 p.m. to 2:30 p.m. Eastern time. Reply to this message if that time is a problem.",
    );
  });

  it("invites the agent and the prospect to the calendar event", () => {
    const m = renderNotice("calendar_event", facts);
    expect(m.channel).toBe("graph.createEvent");
    if (m.channel === "graph.createEvent") {
      expect(m.request.attendees.map((a) => a.emailAddress.address)).toEqual(["agent@office.example.test", "jordan.lee@prospects.example.test"]);
      expect(m.request.start).toEqual({ dateTime: "2026-10-06T14:00:00", timeZone: "Eastern Standard Time" });
    }
  });

  it("plans the tenant notice for 10 a.m. the day before, or now if that has passed", () => {
    const start = zonedInstant(2026, 10, 6, 14);
    expect(noticeTime(start, zonedInstant(2026, 10, 1, 9))).toEqual(zonedInstant(2026, 10, 5, 10));
    const late = zonedInstant(2026, 10, 5, 15);
    expect(noticeTime(start, late)).toEqual(late);
  });

  it("plans 10 a.m. office time across the autumn clock change", () => {
    expect(noticeTime(zonedInstant(2026, 11, 2, 14), zonedInstant(2026, 10, 1, 9)).toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });
});
