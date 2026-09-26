import { describe, expect, it } from "vitest";
import { assessEntry, assessShowingBooking } from "@/lib/policy/entry";
import { zonedInstant } from "@/lib/time";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => zonedInstant(y, mo, d, h, mi);
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

describe("s.26(3) showing to a prospective tenant", () => {
  const start = at(2026, 10, 6, 14);
  const base = {
    basis: "showing_s26_3" as const,
    terminationBasis: "tenant_notice" as const,
    entryStart: start,
    entryEnd: plus(start, 30),
    informAttemptAt: at(2026, 10, 5, 10),
  };

  it("is eligible with a notice of termination, inside 8 to 8, with an earlier attempt to inform", () => {
    const d = assessEntry(base);
    expect(d.outcome).toBe("eligible");
    expect(d.notDecidedHere).toContain("Whether the attempt to inform was a reasonable effort in the circumstances.");
  });

  it("accepts an agreement to terminate and a landlord's notice as the basis", () => {
    expect(assessEntry({ ...base, terminationBasis: "agreement" }).outcome).toBe("eligible");
    expect(assessEntry({ ...base, terminationBasis: "landlord_notice" }).outcome).toBe("eligible");
  });

  it("never treats an approaching lease end date as permission to show", () => {
    const d = assessEntry({ ...base, terminationBasis: null, leaseEnd: "2026-10-31" });
    expect(d.outcome).toBe("not_eligible");
    expect(d.reasons[0]).toBe(
      "No notice of termination or agreement to terminate is recorded. The lease end date (2026-10-31) does not by itself allow showings.",
    );
  });

  it("does not require 24 hours of written notice (that is s.27)", () => {
    const d = assessEntry({ ...base, informAttemptAt: plus(start, -60) });
    expect(d.outcome).toBe("eligible");
  });

  it("requires the attempt to inform to come before the showing", () => {
    expect(assessEntry({ ...base, informAttemptAt: null }).outcome).toBe("not_eligible");
    expect(assessEntry({ ...base, informAttemptAt: start }).outcome).toBe("not_eligible");
  });

  it.each([
    ["starts 7:59 a.m.", at(2026, 10, 6, 7, 59), 30, "not_eligible"],
    ["starts 8:00 a.m.", at(2026, 10, 6, 8, 0), 30, "eligible"],
    ["ends 8:00 p.m.", at(2026, 10, 6, 19, 30), 30, "eligible"],
    ["ends 8:01 p.m.", at(2026, 10, 6, 19, 31), 30, "not_eligible"],
    ["starts 9:00 p.m.", at(2026, 10, 6, 21, 0), 30, "not_eligible"],
  ])("window boundary: %s", (_label, entryStart, minutes, outcome) => {
    expect(assessEntry({ ...base, entryStart, entryEnd: plus(entryStart, minutes), informAttemptAt: plus(entryStart, -600) }).outcome).toBe(outcome);
  });
});

describe("s.27 entry on written notice", () => {
  const start = at(2026, 10, 14, 10);
  const base = {
    basis: "written_notice_s27" as const,
    reason: "repair_or_work",
    entryStart: start,
    entryEnd: plus(start, 60),
    notice: {
      servedAt: plus(start, -24 * 60),
      method: "hand" as const,
      statesReason: true,
      statesDate: true,
      statesTimeOfEntry: true,
    },
  };

  it("is eligible at exactly 24 hours, with reason, date and time stated, served by hand", () => {
    expect(assessEntry(base).outcome).toBe("eligible");
  });

  it("is not eligible one minute short of 24 hours", () => {
    const d = assessEntry({ ...base, notice: { ...base.notice, servedAt: plus(start, -24 * 60 + 1) } });
    expect(d.reasons).toEqual(["Written notice must be served at least 24 hours before entry."]);
  });

  it("does not let 24 hours of notice authorise an entry without a written-notice ground", () => {
    const d = assessEntry({ ...base, reason: "show the unit to a buyer's friend" });
    expect(d.outcome).toBe("not_eligible");
  });

  it("requires the notice to state reason, date and time of entry", () => {
    expect(assessEntry({ ...base, notice: { ...base.notice, statesTimeOfEntry: false } }).outcome).toBe("not_eligible");
  });

  it("keeps communicating and serving apart: a text message is not service", () => {
    const d = assessEntry({ ...base, notice: { ...base.notice, method: "sms" } });
    expect(d.reasons).toContain("A text message is not a service method listed in LTB Rule 3.1.");
  });

  it("accepts email only with written consent, and says what it assumed", () => {
    expect(assessEntry({ ...base, notice: { ...base.notice, method: "email_without_consent" } }).outcome).toBe("not_eligible");
    const d = assessEntry({ ...base, notice: { ...base.notice, method: "email_with_written_consent" } });
    expect(d.outcome).toBe("eligible");
    expect(d.notDecidedHere[0]).toMatch(/Rule 3.9/);
  });

  it("accepts posting on the unit door (Rule 3.2)", () => {
    expect(assessEntry({ ...base, notice: { ...base.notice, method: "door_posting" } }).outcome).toBe("eligible");
  });

  it.each(["mail", "courier", "fax"] as const)("reports %s as excluded rather than guessing its deemed-service date", (method) => {
    expect(assessEntry({ ...base, notice: { ...base.notice, method } }).outcome).toBe("excluded");
  });

  describe("daylight saving time (America/Toronto)", () => {
    it("autumn: 8:30 a.m. the day after 9:00 a.m. notice is 24.5 hours, not 23.5", () => {
      // Clocks fall back on Sunday 2026-11-01 at 2:00 a.m.
      const entryStart = at(2026, 11, 1, 8, 30);
      const d = assessEntry({ ...base, entryStart, entryEnd: plus(entryStart, 60), notice: { ...base.notice, servedAt: at(2026, 10, 31, 9, 0) } });
      expect(d.outcome).toBe("eligible");
    });

    it("spring: 9:30 a.m. the day after 9:00 a.m. notice is only 23.5 hours", () => {
      // Clocks spring forward on Sunday 2027-03-14 at 2:00 a.m.
      const entryStart = at(2027, 3, 14, 9, 30);
      const d = assessEntry({ ...base, entryStart, entryEnd: plus(entryStart, 60), notice: { ...base.notice, servedAt: at(2027, 3, 13, 9, 0) } });
      expect(d.reasons).toEqual(["Written notice must be served at least 24 hours before entry."]);
    });

    it("the 8 a.m. to 8 p.m. window is office time on both sides of the change", () => {
      const early = at(2026, 11, 1, 7, 30); // 12:30 UTC, would look like 8:30 a.m. under the old offset
      expect(assessEntry({ ...base, entryStart: early, entryEnd: plus(early, 30), notice: { ...base.notice, servedAt: plus(early, -48 * 60) } }).outcome).toBe(
        "not_eligible",
      );
    });
  });
});

describe("declared exclusions", () => {
  it.each(["emergency", "consent_at_entry"] as const)("%s is excluded, not judged", (basis) => {
    expect(assessEntry({ basis }).outcome).toBe("excluded");
  });
});

describe("booking a showing is not entry", () => {
  const start = at(2026, 10, 6, 14);
  const base = { terminationBasis: "tenant_notice" as const, entryStart: start, entryEnd: plus(start, 30), plannedNoticeAt: at(2026, 10, 5, 10) };

  it("is bookable with the notice still pending, never 'tenant informed'", () => {
    expect(assessShowingBooking(base)).toEqual({
      outcome: "bookable_notice_pending",
      reasons: [],
      pending: ["Tenant not informed yet: an attempt must be recorded before the entry is eligible."],
    });
  });

  it("a planned notice does not make the entry eligible: only a recorded attempt does", () => {
    const entry = { basis: "showing_s26_3" as const, terminationBasis: "tenant_notice" as const, entryStart: start, entryEnd: plus(start, 30) };
    expect(assessEntry({ ...entry, informAttemptAt: null }).outcome).toBe("not_eligible");
    expect(assessEntry({ ...entry, informAttemptAt: at(2026, 10, 5, 10) }).outcome).toBe("eligible");
  });

  it("refuses when the notice could only go out at or after the start", () => {
    expect(assessShowingBooking({ ...base, plannedNoticeAt: start }).reasons).toEqual(["There is no time left to inform the tenant before the showing."]);
  });

  it("refuses without a termination basis, whatever the lease end date", () => {
    expect(assessShowingBooking({ ...base, terminationBasis: null, leaseEnd: "2026-10-31" }).outcome).toBe("not_bookable");
  });
});

describe("what the software leaves to a person", () => {
  const start = at(2026, 10, 14, 10);
  const request = (reason: string) => ({
    basis: "written_notice_s27" as const,
    reason,
    entryStart: start,
    entryEnd: plus(start, 60),
    notice: { servedAt: plus(start, -25 * 60), method: "hand" as const, statesReason: true, statesDate: true, statesTimeOfEntry: true },
  });
  it.each([
    ["inspection", /inspection is of the kind the Act allows/],
    ["reason_in_tenancy_agreement", /reason written in the tenancy agreement is reasonable/],
  ])("a %s label alone does not establish reasonableness", (reason, pattern) => {
    const d = assessEntry(request(reason));
    expect(d.outcome).toBe("eligible");
    expect(d.notDecidedHere.join(" ")).toMatch(pattern);
  });
});
