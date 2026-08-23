import { describe, expect, it } from "vitest";
import { isEnterpriseOnlyPath, resolveSpaceRedirect } from "@/enterprise/space-access";

describe("enterprise space route guard", () => {
  it.each([
    "/app/team",
    "/app/enterprise-assets",
    "/app/workspace",
    "/app/workspace/projects/project-1/assets/design",
  ])("redirects personal space away from %s", (pathname) => {
    expect(resolveSpaceRedirect(pathname, { kind: "personal" })).toBe("/app/projects");
  });

  it.each(["/app/projects", "/app/materials", "/app/guide"])(
    "keeps personal routes accessible: %s",
    (pathname) => {
      expect(resolveSpaceRedirect(pathname, { kind: "personal" })).toBeNull();
      expect(isEnterpriseOnlyPath(pathname)).toBe(false);
    },
  );

  it("keeps enterprise-only routes accessible inside an enterprise", () => {
    expect(resolveSpaceRedirect("/app/team", { kind: "enterprise", enterpriseId: "enterprise-1" })).toBeNull();
  });
});
