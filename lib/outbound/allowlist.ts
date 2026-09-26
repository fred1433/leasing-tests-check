/**
 * Recipient allowlist for every non-production process.
 *
 * Format, comma or newline separated:
 *   email:someone@office.example.test   exact address
 *   email:*@tenants.example.test        any address at that domain
 *   sms:+15550100123                    exact E.164 number
 *   sms:+1555010*                       E.164 prefix
 *
 * Anything else is malformed and the whole list is rejected: a typo must close
 * the gate, never open it.
 */
export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

export type RecipientKind = "email" | "sms";
export interface Recipient {
  kind: RecipientKind;
  value: string;
}

interface Rule {
  kind: RecipientKind;
  exact?: string;
  domain?: string;
  prefix?: string;
}

export interface Allowlist {
  rules: readonly Rule[];
  allows(recipient: Recipient): boolean;
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const E164_PREFIX = /^\+[1-9]\d{0,13}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Reduces any written phone number to E.164 digits so formatting cannot slip past a rule. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\+/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

export function parseAllowlist(source: string | undefined): Allowlist {
  if (source === undefined || source.trim() === "") {
    throw new AllowlistError("OUTBOUND_ALLOWLIST is missing or empty. Nothing may be sent.");
  }
  const entries = source.split(/[,\n]/).map((e) => e.trim()).filter(Boolean);
  const rules: Rule[] = entries.map((entry) => {
    const match = /^(email|sms):(.+)$/.exec(entry);
    if (!match) throw new AllowlistError(`Malformed allowlist entry "${entry}": expected email:... or sms:...`);
    const kind = match[1] as RecipientKind;
    const pattern = match[2].trim();
    if (kind === "email") {
      const lower = pattern.toLowerCase();
      if (lower.startsWith("*@")) {
        const domain = lower.slice(2);
        if (!DOMAIN.test(domain)) throw new AllowlistError(`Malformed email domain in "${entry}"`);
        return { kind, domain };
      }
      if (lower.includes("*")) throw new AllowlistError(`Only a leading "*@" wildcard is allowed in "${entry}"`);
      if (!EMAIL.test(lower)) throw new AllowlistError(`Malformed email address in "${entry}"`);
      return { kind, exact: lower };
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (!E164_PREFIX.test(prefix) || prefix.length < 5) {
        throw new AllowlistError(`SMS prefix in "${entry}" must be E.164 and at least 4 digits long`);
      }
      return { kind, prefix };
    }
    if (!E164.test(pattern)) throw new AllowlistError(`Malformed E.164 number in "${entry}"`);
    return { kind, exact: pattern };
  });

  return {
    rules,
    allows(recipient: Recipient): boolean {
      if (recipient.kind === "email") {
        const address = normalizeEmail(recipient.value);
        if (!EMAIL.test(address)) return false;
        const domain = address.split("@")[1];
        return rules.some((r) => r.kind === "email" && (r.exact === address || r.domain === domain));
      }
      const phone = normalizePhone(recipient.value);
      if (!E164.test(phone)) return false;
      return rules.some((r) => r.kind === "sms" && (r.exact === phone || (r.prefix !== undefined && phone.startsWith(r.prefix))));
    },
  };
}
