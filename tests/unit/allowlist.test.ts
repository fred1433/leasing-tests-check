import { describe, expect, it } from "vitest";
import { AllowlistError, normalizePhone, parseAllowlist } from "@/lib/outbound/allowlist";

const list = parseAllowlist("email:*@tenants.example.test, email:agent@office.example.test\nsms:+1555010*");

describe("allowlist", () => {
  it("allows a listed domain and an exact address, case-insensitively", () => {
    expect(list.allows({ kind: "email", value: "Maya.Chen@Tenants.Example.Test" })).toBe(true);
    expect(list.allows({ kind: "email", value: "agent@office.example.test" })).toBe(true);
  });

  it("does not let a look-alike domain through", () => {
    expect(list.allows({ kind: "email", value: "maya@tenants.example.test.evil.com" })).toBe(false);
    expect(list.allows({ kind: "email", value: "other@office.example.test" })).toBe(false);
  });

  it("normalises phone formatting before matching, so formatting cannot slip past", () => {
    expect(normalizePhone("(555) 010-0141")).toBe("+15550100141");
    expect(list.allows({ kind: "sms", value: "+1 (555) 010-0141" })).toBe(true);
    expect(list.allows({ kind: "sms", value: "+1 519 555 0141" })).toBe(false);
  });

  it("reads an 11-digit North American number with a leading 1", () => {
    expect(normalizePhone("1 555 010 0141")).toBe("+15550100141");
    expect(list.allows({ kind: "sms", value: "1-555-010-0141" })).toBe(true);
  });

  it("does not treat a display name or a second address as part of an allowed address", () => {
    expect(list.allows({ kind: "email", value: "Maya <maya@tenants.example.test>" })).toBe(false);
    expect(list.allows({ kind: "email", value: "x maya@tenants.example.test" })).toBe(false);
    expect(list.allows({ kind: "email", value: "maya@tenants.example.test x" })).toBe(false);
  });

  it("requires an SMS prefix of at least four digits", () => {
    expect(() => parseAllowlist("sms:+155*")).toThrow(AllowlistError);
    expect(parseAllowlist("sms:+1555*").allows({ kind: "sms", value: "+15559999999" })).toBe(true);
  });

  it.each([undefined, "", "   "])("closes the gate when the list is missing or empty (%j)", (source) => {
    expect(() => parseAllowlist(source)).toThrow(AllowlistError);
  });

  it.each([
    "email:*",
    "email:*.example.test",
    "phone:+15550100141",
    "sms:5550100141",
    "sms:+1*",
    "email:agent@office",
    "*@tenants.example.test",
  ])("rejects the whole list on a malformed entry: %s", (bad) => {
    expect(() => parseAllowlist(`email:agent@office.example.test,${bad}`)).toThrow(AllowlistError);
  });
});
