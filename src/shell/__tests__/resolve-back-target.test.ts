import { describe, expect, it } from "vitest";
import { resolveBackTarget } from "@/shell/resolve-back-target";
import {
  APP_WORKBENCH_PATH,
  AUTH_NAV_ITEMS,
  WORKFLOW_EDITOR_PATH,
  projectWorkbenchPath,
  workflowEditorPath,
} from "@/shell/nav";

describe("resolveBackTarget", () => {
  it("门户根隐藏返回", () => {
    expect(resolveBackTarget("/app")).toEqual({ kind: "hide" });
  });

  it("故事 / 剧本 / 资产 / 分镜返回项目管理详情", () => {
    expect(resolveBackTarget("/app/projects/p_abc/story")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
    expect(resolveBackTarget("/app/projects/p_abc/script")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
    expect(resolveBackTarget("/app/projects/p_abc/assets")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
    expect(resolveBackTarget("/app/projects/p_abc/assets/design")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
    expect(resolveBackTarget("/app/projects/p_abc/assets/library")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
    expect(resolveBackTarget("/app/projects/p_abc/storyboard")).toEqual({
      kind: "href",
      href: "/app/projects/p_abc",
    });
  });

  it("工作台资产设计 / 库 / 入口一次返回工作台项目", () => {
    expect(resolveBackTarget("/app/workspace/projects/p_abc/assets")).toEqual({
      kind: "href",
      href: "/app/workspace/projects/p_abc",
    });
    expect(
      resolveBackTarget("/app/workspace/projects/p_abc/assets/design"),
    ).toEqual({
      kind: "href",
      href: "/app/workspace/projects/p_abc",
    });
    expect(
      resolveBackTarget("/app/workspace/projects/p_abc/assets/library"),
    ).toEqual({
      kind: "href",
      href: "/app/workspace/projects/p_abc",
    });
    expect(resolveBackTarget("/app/workspace/projects/p_abc/storyboard")).toEqual({
      kind: "href",
      href: "/app/workspace/projects/p_abc",
    });
    expect(resolveBackTarget("/app/workspace/projects/p_abc")).toEqual({
      kind: "href",
      href: "/app/workspace",
    });
  });

  it("项目工作台返回项目管理", () => {
    expect(resolveBackTarget("/app/projects/p_abc")).toEqual({
      kind: "href",
      href: "/app/projects",
    });
  });

  it("一级模块一次返回门户根（不用 history.back）", () => {
    expect(resolveBackTarget(APP_WORKBENCH_PATH)).toEqual({
      kind: "href",
      href: "/app",
    });
    expect(resolveBackTarget("/app/projects")).toEqual({
      kind: "href",
      href: "/app",
    });
  });

  it("never uses history kind", () => {
    const samples = [
      "/app/workspace",
      "/app/projects",
      "/app/workspace/projects/p1/assets/design",
      "/app/projects/p1/assets/library",
      "/app/guide",
    ];
    for (const path of samples) {
      const target = resolveBackTarget(path);
      expect(target.kind).not.toBe("history");
    }
  });
});

describe("shell nav route separation", () => {
  it("顶部工作台 href 为平台工作台，不是画布", () => {
    const item = AUTH_NAV_ITEMS.find((nav) => nav.id === "workspace");
    expect(item?.href).toBe("/app/workspace");
    expect(item?.href).toBe(APP_WORKBENCH_PATH);
    expect(item?.href).not.toBe(WORKFLOW_EDITOR_PATH);
    expect(item?.href).not.toContain("/workflow");
  });

  it("项目工作台与视频画布路径分离", () => {
    expect(projectWorkbenchPath("p1")).toBe("/app/projects/p1");
    expect(workflowEditorPath("p1")).toBe("/workflow?projectId=p1");
    expect(projectWorkbenchPath("p1")).not.toContain("workflow");
  });
});
