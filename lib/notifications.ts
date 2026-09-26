import type { OutboundMessage } from "./outbound/messages";
import { formatShowingWindow, graphDateTime } from "./time";

export const OFFICE_SMS_NUMBER = "+15550100100";
export const OFFICE_EMAIL = "leasing@office.example.test";

export type JobKind = "tenant_sms" | "tenant_email" | "calendar_event";

/** Everything a notice says. Stored on the job at enqueue time as a snapshot. */
export interface NoticeFacts {
  showingId: number;
  version: number;
  status: "booked" | "cancelled";
  unitLabel: string;
  address: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  prospectName: string;
  prospectEmail: string;
  agentEmail: string;
  startsAt: string;
  durationMinutes: number;
}

export interface QueuedJob {
  id: number;
  kind: JobKind;
  showingVersion: number;
  payload: NoticeFacts;
}

export type Resolution = { send: true; facts: NoticeFacts } | { send: false; reason: string };

/**
 * Decides, at execution time, whether a queued notice is still true.
 * A job is an intent captured when the showing was booked or moved; by the time it runs
 * (or retries) the showing may have been moved again or cancelled.
 */
export function resolveNotice(job: QueuedJob, current: Pick<NoticeFacts, "version" | "status"> | null): Resolution {
  if (!current) return { send: false, reason: "showing no longer exists" };
  if (current.status === "cancelled") return { send: false, reason: "showing was cancelled" };
  if (current.version !== job.showingVersion) {
    return { send: false, reason: `showing was moved (job for version ${job.showingVersion}, showing now at version ${current.version})` };
  }
  return { send: true, facts: job.payload };
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

export function tenantNoticeText(f: NoticeFacts): string {
  const window = formatShowingWindow(new Date(f.startsAt), f.durationMinutes);
  return (
    `Hi ${firstName(f.tenantName)}, this is the leasing office. ` +
    `We would like to show ${f.address}, ${f.unitLabel}, to a prospective tenant on ${window} Eastern time. ` +
    `Reply to this message if that time is a problem.`
  );
}

export function renderNotice(kind: JobKind, f: NoticeFacts): OutboundMessage {
  const text = tenantNoticeText(f);
  if (kind === "tenant_sms") {
    return { channel: "twilio.sms", request: { to: f.tenantPhone, from: OFFICE_SMS_NUMBER, body: text } };
  }
  if (kind === "tenant_email") {
    return {
      channel: "sendgrid.mail",
      request: {
        personalizations: [{ to: [{ email: f.tenantEmail, name: f.tenantName }] }],
        from: { email: OFFICE_EMAIL, name: "Leasing office" },
        subject: `Showing at ${f.address}, ${f.unitLabel}`,
        content: [{ type: "text/plain", value: text }],
      },
    };
  }
  const start = new Date(f.startsAt);
  const end = new Date(start.getTime() + f.durationMinutes * 60_000);
  return {
    channel: "graph.createEvent",
    request: {
      subject: `Showing: ${f.address}, ${f.unitLabel}`,
      body: { contentType: "Text", content: `Showing for ${f.prospectName}.` },
      start: graphDateTime(start),
      end: graphDateTime(end),
      location: { displayName: `${f.address}, ${f.unitLabel}` },
      attendees: [
        { emailAddress: { address: f.agentEmail }, type: "required" },
        { emailAddress: { address: f.prospectEmail, name: f.prospectName }, type: "required" },
      ],
    },
  };
}
