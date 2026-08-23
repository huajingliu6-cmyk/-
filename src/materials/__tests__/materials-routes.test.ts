import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";

vi.mock("@/auth/require-access", () => ({
  requireAuthenticatedUser: vi.fn(),
  requireSystemAdmin: vi.fn(),
}));

import {
  requireAuthenticatedUser,
  requireSystemAdmin,
} from "@/auth/require-access";
import { POST as createMaterialRoute } from "@/app/api/materials/route";
import { DELETE as deleteMaterialRoute } from "@/app/api/materials/[id]/route";
import { PUT as reorderMaterialsRoute } from "@/app/api/materials/reorder/route";
import { POST as uploadMaterialRoute } from "@/app/api/materials/upload/route";

function auth(role: AuthUser["role"], id: string): AuthUser {
  return {
    id,
    username: id,
    role,
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function forbidden() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "需要系统管理员权限" }, { status: 403 }),
  };
}

describe("materials admin routes auth", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-materials-api-"));
    process.env.APP_DATA_DIR = tmp;
    delete process.env.REMOTE_DATA_ONLY;
    vi.mocked(requireSystemAdmin).mockReset();
    vi.mocked(requireAuthenticatedUser).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("non-admin write/upload/reorder/delete returns 403", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue(forbidden());

    const createRes = await createMaterialRoute(
      new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "x",
          type: "prop",
          mediaId: "m",
          genderTags: ["unrestricted"],
          themeTags: ["unrestricted"],
        }),
      }),
    );
    expect(createRes.status).toBe(403);

    const uploadRes = await uploadMaterialRoute(
      new Request("http://localhost/api/materials/upload", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(uploadRes.status).toBe(403);

    const reorderRes = await reorderMaterialsRoute(
      new Request("http://localhost/api/materials/reorder", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: ["a"] }),
      }),
    );
    expect(reorderRes.status).toBe(403);

    const deleteRes = await deleteMaterialRoute(
      new Request("http://localhost/api/materials/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(deleteRes.status).toBe(403);
  });

  it("admin can create material after upload metadata validation", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: auth("admin", "adm1"),
    });

    const missing = await createMaterialRoute(
      new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "缺标签",
          type: "clothing",
          mediaId: "media-1",
          genderTags: [],
          themeTags: [],
        }),
      }),
    );
    expect(missing.status).toBe(400);

    const ok = await createMaterialRoute(
      new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "完整素材",
          type: "clothing",
          mediaId: "media-1",
          genderTags: ["male"],
          themeTags: ["modern"],
        }),
      }),
    );
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { material: { name: string } };
    expect(body.material.name).toBe("完整素材");
  });
});
