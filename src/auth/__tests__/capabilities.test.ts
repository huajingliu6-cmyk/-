import { describe, expect, it } from "vitest";
import {
  canCreateProject,
  canEditProjectHighlights,
  hasCapability,
  listCapabilities,
} from "@/auth/capabilities";
import type { AuthUser } from "@/auth/types";

function user(role: AuthUser["role"], id = "u1"): AuthUser {
  return {
    id,
    username: role === "admin" ? "admin" : "member",
    role,
    displayName: role,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("project principal capabilities", () => {
  it("系统管理员可以新建项目", () => {
    const admin = user("admin");
    expect(canCreateProject(admin)).toBe(true);
    expect(hasCapability(admin, "createProject")).toBe(true);
    expect(listCapabilities(admin)).toContain("createProject");
  });

  it("普通用户可以在个人空间新建项目", () => {
    const member = user("user");
    expect(canCreateProject(member)).toBe(true);
    expect(listCapabilities(member)).toContain("createProject");
  });

  it("系统管理员或项目 owner 可编辑要点", () => {
    const admin = user("admin", "owner-1");
    const otherAdmin = user("admin", "other");
    const owner = user("user", "owner-1");
    const stranger = user("user", "stranger");

    expect(canEditProjectHighlights(admin, "owner-1")).toBe(true);
    expect(canEditProjectHighlights(otherAdmin, "owner-1")).toBe(true);
    expect(canEditProjectHighlights(owner, "owner-1")).toBe(true);
    expect(canEditProjectHighlights(stranger, "owner-1")).toBe(false);
  });
});
