import { describe, expect, it } from "vitest";
import { canAccessProjectManagementNav } from "@/auth/roles";

describe("project management navigation", () => {
  it("allows unassigned users while keeping assigned engineers restricted", () => {
    expect(canAccessProjectManagementNav("USER", false, 0)).toBe(true);
    expect(canAccessProjectManagementNav("USER", false, 1)).toBe(false);
    expect(canAccessProjectManagementNav("USER", true, 1)).toBe(true);
    expect(canAccessProjectManagementNav("SYSTEM_ADMIN", false, 1)).toBe(true);
  });
});
