import { describe, expect, it } from "vitest";
import { checkRecipients, OutboundRefused } from "@/lib/outbound/boundary";
import type { OutboundMessage } from "@/lib/outbound/messages";

const ALLOW = "email:*@tenants.example.test,email:*@office.example.test,email:*@prospects.example.test,sms:+1555010*";

const event = (attendees: string[]): OutboundMessage => ({
  channel: "graph.createEvent",
  request: {
    subject: "Showing",
    body: { contentType: "Text", content: "Showing." },
    start: { dateTime: "2026-10-06T14:00:00", timeZone: "Eastern Standard Time" },
    end: { dateTime: "2026-10-06T14:30:00", timeZone: "Eastern Standard Time" },
    attendees: attendees.map((address) => ({ emailAddress: { address }, type: "required" as const })),
  },
});

describe("sending boundary: recipients", () => {
  it("passes a message whose every recipient is allowlisted", () => {
    const r = checkRecipients(event(["agent@office.example.test", "jordan@prospects.example.test"]), ALLOW);
    expect(r.map((x) => x.value)).toEqual(["agent@office.example.test", "jordan@prospects.example.test"]);
  });

  it("treats a calendar attendee as a recipient: Exchange emails the invitation", () => {
    expect(() => checkRecipients(event(["agent@office.example.test", "jordan@outside.invalid"]), ALLOW)).toThrow(
      /graph.createEvent: recipient not on the allowlist: jo\*\*\*@outside.invalid/,
    );
  });

  it("checks bcc and reply-to on SendGrid, not only 'to'", () => {
    const mail: OutboundMessage = {
      channel: "sendgrid.mail",
      request: {
        personalizations: [{ to: [{ email: "maya@tenants.example.test" }], bcc: [{ email: "owner@realdomain.example.com" }] }],
        from: { email: "leasing@office.example.test" },
        subject: "Showing",
        content: [{ type: "text/plain", value: "Hello" }],
      },
    };
    expect(() => checkRecipients(mail, ALLOW)).toThrow(OutboundRefused);
  });

  it("checks the sender too: a spoofed From is still an address", () => {
    const sms: OutboundMessage = { channel: "twilio.sms", request: { to: "+15550100141", from: "+15195550199", body: "Hi" } };
    expect(() => checkRecipients(sms, ALLOW)).toThrow(/twilio.sms/);
  });

  it("finds a number pasted into a message body", () => {
    const sms: OutboundMessage = {
      channel: "twilio.sms",
      request: { to: "+15550100141", from: "+15550100100", body: "Call the landlord at 519-555-0199" },
    };
    expect(() => checkRecipients(sms, ALLOW)).toThrow(/\+1519\*\*\*99/);
  });

  it("finds a recipient in a field this module does not know about yet", () => {
    const graph = event(["agent@office.example.test"]);
    (graph.request as unknown as Record<string, unknown>).optionalAttendeesPreview = [{ address: "someone@outside.invalid" }];
    expect(() => checkRecipients(graph, ALLOW)).toThrow(OutboundRefused);
  });

  it("covers Clerk: an invitation email and a phone code are messages to people", () => {
    expect(() => checkRecipients({ channel: "clerk.invitation", request: { emailAddress: "new.hire@realdomain.example.com" } }, ALLOW)).toThrow(
      OutboundRefused,
    );
    expect(() => checkRecipients({ channel: "clerk.phoneCode", request: { phoneNumber: "+15195550199" } }, ALLOW)).toThrow(OutboundRefused);
    expect(checkRecipients({ channel: "clerk.phoneCode", request: { phoneNumber: "+15550100142" } }, ALLOW)).toHaveLength(1);
  });

  it("checks every recipient list on Graph sendMail, including bcc and reply-to", () => {
    const mail = (extra: Record<string, unknown>): OutboundMessage => ({
      channel: "graph.sendMail",
      request: {
        message: {
          subject: "Showing",
          body: { contentType: "Text", content: "Hello" },
          toRecipients: [{ emailAddress: { address: "maya@tenants.example.test" } }],
          ...extra,
        },
      },
    });
    expect(checkRecipients(mail({}), ALLOW)).toHaveLength(1);
    for (const field of ["ccRecipients", "bccRecipients", "replyTo"]) {
      expect(() => checkRecipients(mail({ [field]: [{ emailAddress: { address: "owner@realdomain.example.com" } }] }), ALLOW), field).toThrow(
        OutboundRefused,
      );
    }
  });

  it("refuses a field that holds two addresses joined together", () => {
    const sms: OutboundMessage = {
      channel: "sendgrid.mail",
      request: {
        personalizations: [{ to: [{ email: "maya@tenants.example.test, owner@realdomain.example.com" }] }],
        from: { email: "leasing@office.example.test" },
        subject: "Showing",
        content: [{ type: "text/plain", value: "Hello" }],
      },
    };
    expect(() => checkRecipients(sms, ALLOW)).toThrow(/ow\*\*\*@realdomain.example.com/);
  });

  it("refuses a message with no recipient at all rather than guessing", () => {
    expect(() => checkRecipients(event([]), ALLOW)).toThrow(/no recipient found/);
  });
});
