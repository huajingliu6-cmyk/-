import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { AUTH_NAV_ITEMS } from "@/shell/nav";
import { resolveAdminInitialView, adminPrimaryView } from "@/auth/ai-admin/admin-view";
import {
  createSystemVoice,
  listSystemVoices,
  softDeleteSystemVoice,
  restoreSystemVoice,
  systemVoiceToOption,
} from "@/projects/assets/system-voice-store";
import { readFileSync } from "fs";

describe("system config admin center contracts", () => {
  it("top nav exposes API 配置 only (no duplicate materials admin)", () => {
    expect(AUTH_NAV_ITEMS.some((item) => item.id === "admin-materials")).toBe(
      false,
    );
    const admin = AUTH_NAV_ITEMS.find((item) => item.id === "admin");
    expect(admin?.label).toBe("API 配置");
    expect(admin?.href).toBe("/app/admin?view=api");
  });

  it("maps legacy view params and primary tabs", () => {
    expect(resolveAdminInitialView("materials")).toBe("materials");
    expect(resolveAdminInitialView("api")).toBe("api");
    expect(resolveAdminInitialView("connections")).toBe("api");
    expect(resolveAdminInitialView("overview")).toBe("api");
    expect(resolveAdminInitialView(undefined)).toBe("api");
    expect(adminPrimaryView("materials")).toBe("materials");
    expect(adminPrimaryView("connections")).toBe("api");
  });

  it("sidebar and redirects include system config entry points", () => {
    const sidebar = readFileSync(
      path.join(process.cwd(), "src/shell/AppSidebar.tsx"),
      "utf-8",
    );
    expect(sidebar).toContain('testId: "app-sidebar-system-config"');
    expect(sidebar).toContain("系统配置");
    expect(sidebar).toContain("adminOnly: true");
    expect(sidebar).toContain("data-testid={item.testId}");

    const materialsPage = readFileSync(
      path.join(process.cwd(), "src/app/app/materials/page.tsx"),
      "utf-8",
    );
    expect(materialsPage).toContain("APP_ASSET_MARKET_PATH");
    expect(materialsPage).toContain("redirect");
    expect(materialsPage).not.toContain("MaterialsPage");

    const adminMaterials = readFileSync(
      path.join(process.cwd(), "src/app/app/admin/materials/page.tsx"),
      "utf-8",
    );
    expect(adminMaterials).toContain('redirect("/app/admin?view=materials")');

    const apisPage = readFileSync(
      path.join(process.cwd(), "src/app/app/admin/apis/page.tsx"),
      "utf-8",
    );
    expect(apisPage).toContain('redirect("/app/admin?view=api")');

    const materialsAdmin = readFileSync(
      path.join(process.cwd(), "src/materials/ui/MaterialsAdminPage.tsx"),
      "utf-8",
    );
    expect(materialsAdmin).toContain('href="/app/asset-market"');
    expect(materialsAdmin).toContain("返回浏览");
    expect(materialsAdmin).not.toContain('href="/app/materials"');

    const consoleSrc = readFileSync(
      path.join(process.cwd(), "src/auth/ai-admin/AdminConsole.tsx"),
      "utf-8",
    );
    expect(consoleSrc).toContain("admin-primary-api");
    expect(consoleSrc).toContain("admin-primary-materials");
    expect(consoleSrc).toContain("MaterialsAdminPage");
    expect(consoleSrc).toContain("SystemVoicesAdminPanel");
    expect(consoleSrc).not.toContain("运行概览");
    expect(consoleSrc).not.toContain("生成记录");
    expect(consoleSrc).not.toContain("素材审批");
  });
});

describe("system voice store", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sys-voice-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("seeds active catalog and soft-deletes without dropping history ids", async () => {
    const active = await listSystemVoices();
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((voice) => voice.status === "active")).toBe(true);

    const created = await createSystemVoice({
      name: "测试音色",
      mediaId: "media_test_voice_1",
      createdBy: "admin_1",
      gender: "female",
      ageRange: "青年",
      language: "中文",
    });
    expect(created.source).toBe("system");
    expect(systemVoiceToOption(created).previewUrl).toContain(created.id);

    await softDeleteSystemVoice(created.id);
    const visible = await listSystemVoices({ includeDeleted: false });
    expect(visible.some((voice) => voice.id === created.id)).toBe(false);

    const all = await listSystemVoices({ includeDeleted: true });
    const deleted = all.find((voice) => voice.id === created.id);
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.mediaId).toBe("media_test_voice_1");

    await restoreSystemVoice(created.id);
    const restored = await listSystemVoices();
    expect(restored.some((voice) => voice.id === created.id)).toBe(true);
  });
});
