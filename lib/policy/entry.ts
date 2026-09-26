import { localMinutes, localParts } from "../time";

/**
 * Selected Ontario entry-policy scenarios. Not a compliance engine and not legal advice.
 *
 * Sources, read on 2026-09-26:
 * - LTB Interpretation Guideline 19, "The Landlord's Right of Entry into a Rental Unit"
 *   (effective 2018-12-15, updated 2026-07-01), summarising RTA ss. 25 to 27.
 * - LTB Rules of Procedure (updated 2026-09-21): Rule 3.1 (service methods; email only
 *   with written consent), Rule 3.2 (a s.27 notice may be posted on the unit door),
 *   Rule 3.9 (when service is deemed made).
 *
 * Deliberately out of scope, and reported as "excluded" rather than guessed:
 * entry in an emergency, entry with the tenant's consent at the time of entry,
 * deemed-service dates for mail, courier and fax, alternative service ordered by the Board.
 */

export type TerminationBasis = "tenant_notice" | "landlord_notice" | "agreement";

export type ServiceMethod =
  | "hand"
  | "under_door_or_mail_slot"
  | "door_posting"
  | "email_with_written_consent"
  | "email_without_consent"
  | "sms"
  | "mail"
  | "courier"
  | "fax";

export type S27Reason = "repair_or_work" | "mortgagee_or_insurer_viewing" | "inspection" | "reason_in_tenancy_agreement";

export type EntryRequest =
  | {
      basis: "showing_s26_3";
      terminationBasis: TerminationBasis | null;
      /** Informational only. A lease end date never stands in for a termination basis. */
      leaseEnd?: string | null;
      entryStart: Date;
      entryEnd: Date;
      /**
       * When an attempt to inform the tenant was actually made and recorded (a notice handed to the
       * sending boundary), if one was. A planned or queued notice is not an attempt: see assessShowingBooking.
       */
      informAttemptAt: Date | null;
    }
  | {
      basis: "written_notice_s27";
      reason: S27Reason | string;
      entryStart: Date;
      entryEnd: Date;
      notice: {
        servedAt: Date;
        method: ServiceMethod;
        statesReason: boolean;
        statesDate: boolean;
        statesTimeOfEntry: boolean;
      };
    }
  | { basis: "emergency" }
  | { basis: "consent_at_entry" };

export interface EntryDecision {
  outcome: "eligible" | "not_eligible" | "excluded";
  reasons: string[];
  /** Facts the software cannot establish and a person must still judge. */
  notDecidedHere: string[];
}

const EIGHT_AM = 8 * 60;
const EIGHT_PM = 20 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function sameLocalDay(a: Date, b: Date): boolean {
  const pa = localParts(a);
  const pb = localParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/**
 * The Act speaks of entering between 8 a.m. and 8 p.m. Requiring the whole visit, start to end,
 * to fit in that window (so 7:45 p.m. for 30 minutes is refused) is this sample's conservative
 * scheduling rule, not a statutory test.
 */
function withinEightToEight(start: Date, end: Date): boolean {
  return end > start && sameLocalDay(start, end) && localMinutes(start) >= EIGHT_AM && localMinutes(end) <= EIGHT_PM && localMinutes(end) > 0;
}

const S27_REASONS: ReadonlySet<string> = new Set<S27Reason>([
  "repair_or_work",
  "mortgagee_or_insurer_viewing",
  "inspection",
  "reason_in_tenancy_agreement",
]);

export function assessEntry(request: EntryRequest): EntryDecision {
  if (request.basis === "emergency" || request.basis === "consent_at_entry") {
    return {
      outcome: "excluded",
      reasons: [`Entry by ${request.basis === "emergency" ? "emergency" : "consent at the time of entry"} is outside this sample.`],
      notDecidedHere: [],
    };
  }

  if (request.basis === "showing_s26_3") {
    const reasons: string[] = [];
    if (!request.terminationBasis) {
      reasons.push(
        request.leaseEnd
          ? `No notice of termination or agreement to terminate is recorded. The lease end date (${request.leaseEnd}) does not by itself allow showings.`
          : "No notice of termination or agreement to terminate is recorded.",
      );
    }
    if (!withinEightToEight(request.entryStart, request.entryEnd)) {
      reasons.push("Showings must fall between 8 a.m. and 8 p.m., office time.");
    }
    if (!request.informAttemptAt || request.informAttemptAt >= request.entryStart) {
      reasons.push("No attempt to inform the tenant is recorded before the showing.");
    }
    return {
      outcome: reasons.length ? "not_eligible" : "eligible",
      reasons,
      notDecidedHere: ["Whether the attempt to inform was a reasonable effort in the circumstances."],
    };
  }

  return assessWrittenNotice(request);
}

export interface BookingDecision {
  outcome: "bookable_notice_pending" | "not_bookable";
  reasons: string[];
  /** What must still happen before the entry itself is eligible. */
  pending: string[];
}

/**
 * Whether a showing may be put in the calendar. This is a different question from whether the
 * entry is eligible: at booking time the tenant has not been informed yet, and the planned notice
 * may still be blocked, fail or be superseded. So the booking checks the prerequisites that exist
 * now, and leaves "tenant informed" pending until an attempt is recorded (assessEntry).
 */
export function assessShowingBooking(request: {
  terminationBasis: TerminationBasis | null;
  leaseEnd?: string | null;
  entryStart: Date;
  entryEnd: Date;
  plannedNoticeAt: Date;
}): BookingDecision {
  const reasons: string[] = [];
  if (!request.terminationBasis) {
    reasons.push(
      request.leaseEnd
        ? `No notice of termination or agreement to terminate is recorded. The lease end date (${request.leaseEnd}) does not by itself allow showings.`
        : "No notice of termination or agreement to terminate is recorded.",
    );
  }
  if (!withinEightToEight(request.entryStart, request.entryEnd)) {
    reasons.push("Showings must fall between 8 a.m. and 8 p.m., office time.");
  }
  if (request.plannedNoticeAt >= request.entryStart) {
    reasons.push("There is no time left to inform the tenant before the showing.");
  }
  return {
    outcome: reasons.length ? "not_bookable" : "bookable_notice_pending",
    reasons,
    pending: reasons.length ? [] : ["Tenant not informed yet: an attempt must be recorded before the entry is eligible."],
  };
}

function assessWrittenNotice(request: Extract<EntryRequest, { basis: "written_notice_s27" }>): EntryDecision {
  const { notice } = request;
  const reasons: string[] = [];
  if (notice.method === "mail" || notice.method === "courier" || notice.method === "fax") {
    return {
      outcome: "excluded",
      reasons: [`Deemed-service dates for ${notice.method} (Rule 3.9) are not modelled in this sample.`],
      notDecidedHere: [],
    };
  }
  if (!S27_REASONS.has(request.reason)) reasons.push(`"${request.reason}" is not a written-notice ground in this sample.`);
  if (notice.method === "sms") reasons.push("A text message is not a service method listed in LTB Rule 3.1.");
  if (notice.method === "email_without_consent") reasons.push("Email counts as service only with the tenant's written consent (Rule 3.1).");
  if (!notice.statesReason || !notice.statesDate || !notice.statesTimeOfEntry) {
    reasons.push("The notice must state the reason, the date, and the time of entry.");
  }
  if (!withinEightToEight(request.entryStart, request.entryEnd)) {
    reasons.push("Entry must fall between 8 a.m. and 8 p.m., office time.");
  }
  // Elapsed time, not wall-clock arithmetic: across a DST change "same time tomorrow" is 23 or 25 hours.
  if (request.entryStart.getTime() - notice.servedAt.getTime() < DAY_MS) {
    reasons.push("Written notice must be served at least 24 hours before entry.");
  }
  const notDecidedHere: string[] = [];
  if (notice.method === "email_with_written_consent") {
    notDecidedHere.push("Rule 3.9 deems email served on the day it is sent; this sample counts from the send time, an assumption to confirm.");
  }
  if (request.reason === "inspection") {
    notDecidedHere.push("Whether the inspection is of the kind the Act allows and is reasonable in the circumstances.");
  }
  if (request.reason === "reason_in_tenancy_agreement") {
    notDecidedHere.push("Whether the reason written in the tenancy agreement is reasonable.");
  }
  return { outcome: reasons.length ? "not_eligible" : "eligible", reasons, notDecidedHere };
}
