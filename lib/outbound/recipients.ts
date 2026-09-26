import { normalizeEmail, normalizePhone, type Recipient } from "./allowlist";
import type { OutboundMessage } from "./messages";

/** Recipient-bearing fields, named per provider. Senders count: a spoofed "from" is still a person. */
export function declaredRecipients(message: OutboundMessage): Recipient[] {
  const email = (value: string): Recipient => ({ kind: "email", value: normalizeEmail(value) });
  const sms = (value: string): Recipient => ({ kind: "sms", value: normalizePhone(value) });
  switch (message.channel) {
    case "twilio.sms":
      return [sms(message.request.to), sms(message.request.from)];
    case "sendgrid.mail": {
      const r = message.request;
      return [
        ...r.personalizations.flatMap((p) => [...p.to, ...(p.cc ?? []), ...(p.bcc ?? [])].map((x) => email(x.email))),
        email(r.from.email),
        ...(r.reply_to ? [email(r.reply_to.email)] : []),
      ];
    }
    case "graph.sendMail": {
      const m = message.request.message;
      return [...m.toRecipients, ...(m.ccRecipients ?? []), ...(m.bccRecipients ?? []), ...(m.replyTo ?? [])].map((x) =>
        email(x.emailAddress.address),
      );
    }
    case "graph.createEvent":
      return message.request.attendees.map((a) => email(a.emailAddress.address));
    case "clerk.invitation":
      return [email(message.request.emailAddress)];
    case "clerk.phoneCode":
      return [sms(message.request.phoneNumber)];
  }
}

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Every address or phone number anywhere in the final payload, bodies included.
 * A field this module does not know about yet (a new provider option, a pasted
 * number in a template) is still seen.
 */
export function scannedRecipients(payload: unknown): Recipient[] {
  const found: Recipient[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      for (const m of value.match(EMAIL_IN_TEXT) ?? []) found.push({ kind: "email", value: normalizeEmail(m) });
      for (const m of value.match(PHONE_IN_TEXT) ?? []) {
        const digits = m.replace(/\D/g, "");
        if (digits.length >= 10 && digits.length <= 15) found.push({ kind: "sms", value: normalizePhone(m) });
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(payload);
  return found;
}
