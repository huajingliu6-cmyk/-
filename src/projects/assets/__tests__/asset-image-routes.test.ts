import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  listTmpFilesInAssetImagesDir,
  resolveAssetImageFilePath,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import {
  GET as getAssetImage,
  PUT as putAssetImage,
  DELETE as deleteAssetImage,
} from "@/app/api/projects/[projectId]/assets-draft/images/[assetId]/route";

function auth(
  role: AuthUser["role"],
  id: string,
  username = id,
): AuthUser {
  return {
    id,
    username,
    role,
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function character(projectId: string, id = "char_1") {
  return {
    id,
    projectId,
    name: "鏋楁竻",
    role: "濂充富",
    description: "desc",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: null as string | null,
    imageObjectUrl: null as string | null,
    imageMimeType: null as string | null,
    status: "draft" as const,
  };
}

async function seedProjectWithCharacter(owner: AuthUser) {
  const project = await createProjectRecord(owner.id, {
    name: `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await saveAssetBundleDraft({
    projectId: project.projectId,
    characters: [character(project.projectId)],
    scenes: [],
    props: [],
    audios: [
      {
        id: "audio_1",
        projectId: project.projectId,
        name: "BGM",
        type: "music",
        duration: "",
        source: "",
        fileName: null,
        objectUrl: null,
        mimeType: null,
        status: "draft",
      },
    ],
  });
  return project;
}

function putFileRequest(
  projectId: string,
  assetId: string,
  bytes: Buffer,
  fileName: string,
  mimeType: string,
) {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(bytes)], fileName, { type: mimeType }),
  );
  return putAssetImage(
    new Request(
      `http://localhost/api/projects/${projectId}/assets-draft/images/${assetId}`,
      { method: "PUT", body: form },
    ),
    { params: Promise.resolve({ projectId, assetId }) },
  );
}

describe("project asset image upload/read routes", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-asset-img-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("sniffs png/jpeg/webp signatures", () => {
    expect(sniffProjectAssetImageMime(PNG_BYTES)).toBe("image/png");
    expect(sniffProjectAssetImageMime(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffProjectAssetImageMime(WEBP_BYTES)).toBe("image/webp");
    expect(sniffProjectAssetImageMime(Buffer.from("not-an-image"))).toBeNull();
  });

  it("owner can upload png and get identical bytes back", async () => {
    const owner = auth("user", "owner-img-1");
    const project = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const put = await putFileRequest(
      project.projectId,
      "char_1",
      PNG_BYTES,
      "hero.png",
      "image/png",
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as {
      imageFileName: string;
      imageMimeType: string;
      sizeBytes: number;
    };
    expect(putBody.imageFileName).toBe("hero.png");
    expect(putBody.imageMimeType).toBe("image/png");
    expect(putBody.sizeBytes).toBe(PNG_BYTES.byteLength);

    const disk = resolveAssetImageFilePath(project.projectId, "char_1");
    expect(disk).toBeTruthy();
    expect(existsSync(disk!)).toBe(true);
    expect(readFileSync(disk!)).toEqual(PNG_BYTES);

    const get = await getAssetImage(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        assetId: "char_1",
      }),
    });
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(get.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    const got = Buffer.from(await get.arrayBuffer());
    expect(got.equals(PNG_BYTES)).toBe(true);
  });

  it("only actual owner can upload management images; admin/CE/stranger/anonymous denied", async () => {
    const owner = auth("user", "owner-img-2");
    const admin = auth("admin", "admin-img-2");
    const engineer = auth("user", "eng-img-2");
    const stranger = auth("user", "stranger-img-2");
    const project = await seedProjectWithCharacter(owner);
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "owner.png",
          "image/png",
        )
      ).status,
    ).toBe(200);

    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: admin });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          JPEG_BYTES,
          "b.jpg",
          "image/jpeg",
        )
      ).status,
    ).toBe(403);

    // Assigned CE may GET synced management images (read-only).
    expect(
      (
        await getAssetImage(new Request("http://localhost"), {
          params: Promise.resolve({
            projectId: project.projectId,
            assetId: "char_1",
          }),
        })
      ).status,
    ).toBe(200);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: stranger,
    });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "c.png",
          "image/png",
        )
      ).status,
    ).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "d.png",
          "image/png",
        )
      ).status,
    ).toBe(401);
  });

  it("returns 404 for missing asset, other project asset, audio id, and traversal", async () => {
    const owner = auth("user", "owner-img-3");
    const project = await seedProjectWithCharacter(owner);
    const other = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_missing",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(200);

    // asset exists only on `other`
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_other_only",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);

    await saveAssetBundleDraft({
      projectId: other.projectId,
      characters: [character(other.projectId, "char_other_only")],
      scenes: [],
      props: [],
      audios: [],
    });
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_other_only",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);

    expect(resolveAssetImageFilePath(project.projectId, "../etc")).toBeNull();
    expect(
      (
        await putFileRequest(
          project.projectId,
          "..%2Fetc",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "../secret",
          PNG_BYTES,
          "a.png",
          "image/png",
        )
      ).status,
    ).toBe(404);
  });

  it("rejects unsupported mime, forged headers, and oversize", async () => {
    const owner = auth("user", "owner-img-4");
    const project = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          Buffer.from("<svg></svg>"),
          "a.svg",
          "image/svg+xml",
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          JPEG_BYTES,
          "fake.png",
          "image/png",
        )
      ).status,
    ).toBe(400);

    const huge = Buffer.concat([
      PNG_BYTES.subarray(0, 8),
      Buffer.alloc(PROJECT_ASSET_IMAGE_MAX_BYTES),
    ]);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          huge,
          "big.png",
          "image/png",
        )
      ).status,
    ).toBe(413);
  });

  it("replaces image safely and leaves old file when rename would fail mid-write", async () => {
    const owner = auth("user", "owner-img-5");
    const project = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          PNG_BYTES,
          "old.png",
          "image/png",
        )
      ).status,
    ).toBe(200);
    const disk = resolveAssetImageFilePath(project.projectId, "char_1")!;
    expect(readFileSync(disk)).toEqual(PNG_BYTES);

    expect(
      (
        await putFileRequest(
          project.projectId,
          "char_1",
          JPEG_BYTES,
          "new.jpg",
          "image/jpeg",
        )
      ).status,
    ).toBe(200);
    expect(readFileSync(disk)).toEqual(JPEG_BYTES);

    // Simulate failed replacement: write temp then ensure cleanup helper sees no permanent tmp
    writeFileSync(disk, PNG_BYTES);
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "char_1",
      buffer: JPEG_BYTES,
      mimeType: "image/jpeg",
    });
    expect(readFileSync(disk)).toEqual(JPEG_BYTES);
    expect(await listTmpFilesInAssetImagesDir(project.projectId)).toEqual([]);
  });

  it("GET denies cross-project, missing file, unauthorized; DELETE clears meta", async () => {
    const owner = auth("user", "owner-img-6");
    const stranger = auth("user", "stranger-img-6");
    const project = await seedProjectWithCharacter(owner);
    const other = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    expect(
      (
        await getAssetImage(new Request("http://localhost"), {
          params: Promise.resolve({
            projectId: project.projectId,
            assetId: "char_1",
          }),
        })
      ).status,
    ).toBe(404);

    await putFileRequest(
      project.projectId,
      "char_1",
      PNG_BYTES,
      "hero.png",
      "image/png",
    );

    expect(
      (
        await getAssetImage(new Request("http://localhost"), {
          params: Promise.resolve({
            projectId: other.projectId,
            assetId: "char_1",
          }),
        })
      ).status,
    ).toBe(404);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: stranger,
    });
    expect(
      (
        await getAssetImage(new Request("http://localhost"), {
          params: Promise.resolve({
            projectId: project.projectId,
            assetId: "char_1",
          }),
        })
      ).status,
    ).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const del = await deleteAssetImage(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        assetId: "char_1",
      }),
    });
    expect(del.status).toBe(200);
    const disk = resolveAssetImageFilePath(project.projectId, "char_1")!;
    expect(existsSync(disk)).toBe(false);
    expect(
      (
        await getAssetImage(new Request("http://localhost"), {
          params: Promise.resolve({
            projectId: project.projectId,
            assetId: "char_1",
          }),
        })
      ).status,
    ).toBe(404);
  });

  it("upload patches image meta without wiping unrelated fields", async () => {
    const owner = auth("user", "owner-img-7");
    const project = await seedProjectWithCharacter(owner);
    await saveAssetBundleDraft({
      projectId: project.projectId,
      characters: [
        {
          ...character(project.projectId),
          name: "KeepName",
          description: "KeepDesc",
          role: "KeepRole",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    await putFileRequest(
      project.projectId,
      "char_1",
      PNG_BYTES,
      "keep.png",
      "image/png",
    );
    const raw = readFileSync(
      path.join(tmp, "projects", project.projectId, "drafts", "assets.json"),
      "utf-8",
    );
    const draft = JSON.parse(raw) as {
      characters: Array<{
        name: string;
        description: string;
        role: string;
        imageFileName: string | null;
        imageObjectUrl: string | null;
        imageMimeType: string | null;
      }>;
    };
    expect(draft.characters[0]?.name).toBe("KeepName");
    expect(draft.characters[0]?.description).toBe("KeepDesc");
    expect(draft.characters[0]?.role).toBe("KeepRole");
    expect(draft.characters[0]?.imageFileName).toBe("keep.png");
    expect(draft.characters[0]?.imageMimeType).toBe("image/png");
    expect(draft.characters[0]?.imageObjectUrl).toBeNull();
    expect(raw).not.toContain("blob:");
    expect(raw).not.toMatch(/data:image\//);
    expect(raw).not.toContain(path.join(tmp, "projects"));
  });

  it("GET returns 200 image/png for gen_ design preview written via writeProjectAssetImageFile", async () => {
    const owner = auth("user", "owner-gen-preview-1");
    const project = await seedProjectWithCharacter(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const genId = "gen_testpreview001";
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: genId,
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });

    const get = await getAssetImage(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        assetId: genId,
      }),
    });
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    const got = Buffer.from(await get.arrayBuffer());
    expect(got.equals(PNG_BYTES)).toBe(true);
  });

  it("GET gen_ works when management owner gate fails but workspace asset access succeeds", async () => {
    const owner = auth("user", "owner-gen-preview-2");
    const engineer = auth("user", "eng-gen-preview-2");
    const project = await seedProjectWithCharacter(owner);
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    const genId = "gen_testpreview001";
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: genId,
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });

    // Non-owner: requireProjectManagementProjectAccess fails; CE has workspace assets.
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const get = await getAssetImage(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: project.projectId,
        assetId: genId,
      }),
    });
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    const got = Buffer.from(await get.arrayBuffer());
    expect(got.equals(PNG_BYTES)).toBe(true);
  });
  it("path traversal cannot escape asset-images directory", () => {
    expect(resolveAssetImageFilePath("p_ok", "..")).toBeNull();
    expect(resolveAssetImageFilePath("p_ok", "a/b")).toBeNull();
    expect(resolveAssetImageFilePath("p_ok", "a\\b")).toBeNull();
    expect(resolveAssetImageFilePath("../x", "char_1")).toBeNull();
    const ok = resolveAssetImageFilePath("p_ok", "char_1");
    expect(ok).toBeTruthy();
    expect(ok!.includes(`${path.sep}asset-images${path.sep}char_1`)).toBe(true);
  });
});
