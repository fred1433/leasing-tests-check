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
      /** When the application attempted to inform the tenant, if it did. */
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
  return {
    outcome: reasons.length ? "not_eligible" : "eligible",
    reasons,
    notDecidedHere:
      notice.method === "email_with_written_consent"
        ? ["Rule 3.9 deems email served on the day it is sent; this sample counts from the send time, an assumption to confirm."]
        : [],
  };
}
