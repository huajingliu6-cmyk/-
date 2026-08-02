import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("auth compatibility notes", () => {
  it("session cookie name remains ic_session", () => {
    const types = readFileSync(
      path.join(process.cwd(), "src/auth/types.ts"),
      "utf-8",
    );
    expect(types).toContain('SESSION_COOKIE = "ic_session"');
  });

  it("password hashing remains scrypt (not re-hashed on import)", () => {
    const pwd = readFileSync(
      path.join(process.cwd(), "src/auth/password.ts"),
      "utf-8",
    );
    expect(pwd).toContain("scryptSync");
    const importer = readFileSync(
      path.join(process.cwd(), "scripts/import-legacy-file-data.ts"),
      "utf-8",
    );
    expect(importer).toContain("Preserve hashes as-is");
    expect(importer).not.toMatch(/hashPassword\(/);
  });
});
