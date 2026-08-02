import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/password";

describe("password hashing", () => {
  it("hashes and verifies passwords", () => {
    const { hash, salt } = hashPassword("Secret-123");
    expect(hash).toHaveLength(128);
    expect(salt).toHaveLength(32);
    expect(verifyPassword("Secret-123", hash, salt)).toBe(true);
    expect(verifyPassword("wrong-password", hash, salt)).toBe(false);
  });

  it("produces distinct salts for the same password", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword("same-password", a.hash, a.salt)).toBe(true);
    expect(verifyPassword("same-password", b.hash, b.salt)).toBe(true);
  });
});
