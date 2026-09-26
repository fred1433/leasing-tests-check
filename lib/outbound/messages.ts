/**
 * The four ways this kind of application can make a message reach a person.
 * Shapes follow each provider's request body closely enough that the recipient
 * fields are the real ones.
 */
export interface EmailAddress {
  address: string;
  name?: string;
}

export type OutboundMessage =
  | { channel: "twilio.sms"; request: { to: string; from: string; body: string } }
  | {
      channel: "sendgrid.mail";
      request: {
        personalizations: Array<{ to: Array<{ email: string; name?: string }>; cc?: Array<{ email: string }>; bcc?: Array<{ email: string }> }>;
        from: { email: string; name?: string };
        reply_to?: { email: string };
        subject: string;
        content: Array<{ type: "text/plain" | "text/html"; value: string }>;
      };
    }
  | {
      channel: "graph.sendMail";
      request: {
        message: {
          subject: string;
          body: { contentType: "Text" | "HTML"; content: string };
          toRecipients: Array<{ emailAddress: EmailAddress }>;
          ccRecipients?: Array<{ emailAddress: EmailAddress }>;
          bccRecipients?: Array<{ emailAddress: EmailAddress }>;
          replyTo?: Array<{ emailAddress: EmailAddress }>;
        };
      };
    }
  | {
      // POST /users/{id}/events: Exchange emails every attendee an invitation.
      // That cannot be switched off, so a calendar write is a send.
      channel: "graph.createEvent";
      request: {
        subject: string;
        body: { contentType: "Text" | "HTML"; content: string };
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
        location?: { displayName: string };
        attendees: Array<{ emailAddress: EmailAddress; type: "required" | "optional" | "resource" }>;
      };
    }
  | { channel: "clerk.invitation"; request: { emailAddress: string; redirectUrl?: string } }
  | { channel: "clerk.phoneCode"; request: { phoneNumber: string } };

export type Channel = OutboundMessage["channel"];
