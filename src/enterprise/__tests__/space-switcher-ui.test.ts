import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/enterprise/SpaceSwitcher.tsx"),
  "utf8",
);

describe("enterprise space switcher actions", () => {
  it("keeps enterprise actions only in the personal-space dropdown", () => {
    expect(source).not.toContain("space-switcher__quick-join");
    expect(source).toContain("创建企业");
    expect(source).toContain("申请加入企业");
    expect(source).toContain('role="menuitem"');
  });

  it("creates an enterprise and enters its team management space", () => {
    expect(source).toContain('fetch("/api/enterprises"');
    expect(source).toContain('memberRole: "OWNER"');
    expect(source).toContain('writeActiveSpace({ kind: "enterprise"');
    expect(source).toContain('router.push("/app/team")');
  });
});
