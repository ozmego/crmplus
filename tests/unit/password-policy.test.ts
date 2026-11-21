import { afterEach, describe, expect, it } from "vitest";
import { passwordPolicyError } from "@/server/auth/password";
import { mfaRequired, passwordMinLength } from "@/server/auth/policy";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("şifre politikası", () => {
  it("varsayılan: en az 8 karakter, karakter türü zorunluluğu yok", () => {
    delete process.env.PASSWORD_MIN_LENGTH;
    expect(passwordMinLength()).toBe(8);
    expect(passwordPolicyError("abcdefgh")).toBeNull(); // yalnız harf
    expect(passwordPolicyError("12345678")).toBeNull(); // yalnız rakam
    expect(passwordPolicyError("kisa123")).toMatch(/en az 8/);
    expect(passwordPolicyError("        ")).toMatch(/boşluk/);
    expect(passwordPolicyError("a".repeat(201))).toMatch(/en fazla/);
  });

  it("alt sınır ayarlanabilir ama 6'nın altına inmez", () => {
    process.env.PASSWORD_MIN_LENGTH = "6";
    expect(passwordPolicyError("abc123")).toBeNull();
    process.env.PASSWORD_MIN_LENGTH = "3";
    expect(passwordMinLength()).toBe(8);
    process.env.PASSWORD_MIN_LENGTH = "12";
    expect(passwordPolicyError("abcdefghijk")).toMatch(/en az 12/);
  });

  it("MFA varsayılan kapalı; yalnız AUTH_MFA_REQUIRED=true ile açılır", () => {
    delete process.env.AUTH_MFA_REQUIRED;
    expect(mfaRequired()).toBe(false);
    process.env.AUTH_MFA_REQUIRED = "true";
    expect(mfaRequired()).toBe(true);
    process.env.AUTH_MFA_REQUIRED = "1";
    expect(mfaRequired()).toBe(false);
  });
});
