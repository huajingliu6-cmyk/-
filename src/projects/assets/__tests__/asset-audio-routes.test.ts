import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  listTmpFilesInAssetAudioDir,
  PROJECT_ASSET_AUDIO_MAX_BYTES,
  resolveAssetAudioFilePath,
  writeProjectAssetAudioFile,
} from "@/projects/assets/asset-audio-storage";
import * as assetBundleStore from "@/projects/assets/asset-bundle-store";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import {
  GET as getAssetAudio,
  PUT as putAssetAudio,
  DELETE as deleteAssetAudio,
} from "@/app/api/projects/[projectId]/assets-draft/audio/[assetId]/route";

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

function wavBytes(seed = 1): Buffer {
  const samples = 64;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.sin((i * seed) / 8) * 10000, 44 + i * 2);
  }
  return buf;
}

function id3Mp3(): Buffer {
  return Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb,
    0x90, 0x00,
  ]);
}

function oggBytes(): Buffer {
  return Buffer.from("OggS\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0extra", "binary");
}

function audioRow(projectId: string, id = "audio_1") {
  return {
    id,
    projectId,
    name: "Theme",
    type: "music" as const,
    duration: "00:01",
    source: "test",
    fileName: null as string | null,
    objectUrl: null as string | null,
    mimeType: null as string | null,
    status: "draft" as const,
  };
}

function character(projectId: string, id = "char_1") {
  return {
    id,
    projectId,
    name: "林清",
    role: "女主",
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

async function seedProject(owner: AuthUser) {
  const project = await createProjectRecord(owner.id, {
    name: `aud-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    creationSource: "story",
    projectMode: "full-stack",
    visualStyle: "live_action_cinematic",
      passwordEnabled: false,
  });
  await saveAssetBundleDraft({
    projectId: project.projectId,
    characters: [character(project.projectId)],
    scenes: [
      {
        id: "scene_1",
        projectId: project.projectId,
        name: "S",
        sceneType: "",
        description: "",
        timeOfDay: "",
        location: "",
        style: "",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    props: [
      {
        id: "prop_1",
        projectId: project.projectId,
        name: "P",
        propType: "",
        usage: "",
        description: "",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    audios: [audioRow(project.projectId)],
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
  return putAssetAudio(
    new Request(
      `http://localhost/api/projects/${projectId}/assets-draft/audio/${assetId}`,
      { method: "PUT", body: form },
    ),
    { params: Promise.resolve({ projectId, assetId }) },
  );
}

describe("project asset audio upload/read/delete routes", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-asset-aud-"));
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
  });

  it("only actual owner can upload management audio; admin/CE/stranger/anonymous denied", async () => {
    const owner = auth("user", "owner_a");
    const project = await seedProject(owner);
    const engineer = auth("user", "eng_a");
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    const admin = auth("admin", "admin_a");
    const stranger = auth("user", "stranger");

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    let res = await putFileRequest(
      project.projectId,
      "audio_1",
      wavBytes(1),
      "a.wav",
      "audio/wav",
    );
    expect(res.status).toBe(200);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    res = await putFileRequest(
      project.projectId,
      "audio_1",
      wavBytes(2),
      "b.wav",
      "audio/wav",
    );
    expect(res.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    res = await putFileRequest(
      project.projectId,
      "audio_1",
      wavBytes(3),
      "c.wav",
      "audio/wav",
    );
    expect(res.status).toBe(403);

    res = await getAssetAudio(
      new Request("http://localhost/audio"),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(res.status).toBe(200);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: stranger,
    });
    res = await putFileRequest(
      project.projectId,
      "audio_1",
      wavBytes(4),
      "d.wav",
      "audio/wav",
    );
    expect(res.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "未登录" }), {
        status: 401,
      }),
    } as never);
    res = await putFileRequest(
      project.projectId,
      "audio_1",
      wavBytes(5),
      "e.wav",
      "audio/wav",
    );
    expect(res.status).toBe(401);
  });

  it("writes bytes to asset-audio path and patches metadata without objectUrl", async () => {
    const owner = auth("user", "owner_b");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    const bytes = wavBytes(9);
    const res = await putFileRequest(
      project.projectId,
      "audio_1",
      bytes,
      "theme.wav",
      "",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    };
    expect(body.fileName).toBe("theme.wav");
    expect(body.mimeType).toBe("audio/wav");
    expect(body.sizeBytes).toBe(bytes.byteLength);

    const disk = resolveAssetAudioFilePath(project.projectId, "audio_1");
    expect(disk).toBeTruthy();
    expect(existsSync(disk!)).toBe(true);
    expect(readFileSync(disk!).equals(bytes)).toBe(true);

    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft?.audios[0]?.fileName).toBe("theme.wav");
    expect(draft?.audios[0]?.mimeType).toBe("audio/wav");
    expect(draft?.audios[0]?.objectUrl).toBeNull();
    expect(draft?.audios[0]?.name).toBe("Theme");
    expect(JSON.stringify(draft)).not.toContain("blob:");
    expect(await listTmpFilesInAssetAudioDir(project.projectId)).toEqual([]);
  });

  it("returns 404 for unknown, cross-project, character/scene/prop ids and traversal", async () => {
    const owner = auth("user", "owner_c");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    const other = await seedProject(owner);

    for (const id of ["missing", "char_1", "scene_1", "prop_1", "../etc", "a/b"]) {
      const res = await putFileRequest(
        project.projectId,
        id,
        wavBytes(1),
        "a.wav",
        "audio/wav",
      );
      expect(res.status).toBe(404);
    }

    const cross = await putFileRequest(
      other.projectId,
      "audio_1",
      wavBytes(1),
      "a.wav",
      "audio/wav",
    );
    // other project also has audio_1 — that succeeds. Cross means using A's id on B without that asset.
    const { bindAssetBundleRevisionForSave } = await import(
      "@/projects/assets/asset-bundle-revision"
    );
    const otherDraft = await bindAssetBundleRevisionForSave(other.projectId, {
      projectId: other.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [audioRow(other.projectId, "audio_other")],
    });
    await saveAssetBundleDraft(otherDraft);
    const cross2 = await putFileRequest(
      other.projectId,
      "audio_1",
      wavBytes(1),
      "a.wav",
      "audio/wav",
    );
    expect(cross2.status).toBe(404);
    expect(cross.status).toBe(200);
  });

  it("rejects forged headers, oversize, empty, unsupported ext", async () => {
    const owner = auth("user", "owner_d");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);

    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          Buffer.from("<html>"),
          "a.wav",
          "audio/wav",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          Buffer.from("%PDF"),
          "a.mp3",
          "audio/mpeg",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          wavBytes(1),
          "a.mp3",
          "audio/mpeg",
        )
      ).status,
    ).toBe(400); // ext vs content
    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          id3Mp3(),
          "a.mp3",
          "audio/mpeg",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          oggBytes(),
          "a.ogg",
          "application/octet-stream",
        )
      ).status,
    ).toBe(200);

    const huge = Buffer.concat([
      Buffer.from("RIFF....WAVE"),
      Buffer.alloc(PROJECT_ASSET_AUDIO_MAX_BYTES),
    ]);
    // Fix RIFF size fields so sniff still sees WAVE (we fail on size first anyway).
    huge.write("RIFF", 0);
    huge.writeUInt32LE(huge.byteLength - 8, 4);
    huge.write("WAVE", 8);
    expect(
      (
        await putFileRequest(
          project.projectId,
          "audio_1",
          huge,
          "big.wav",
          "audio/wav",
        )
      ).status,
    ).toBe(413);
  });

  it("GET supports 200 / 206 / 416 Range and auth", async () => {
    const owner = auth("user", "owner_e");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    const bytes = wavBytes(7);
    await putFileRequest(
      project.projectId,
      "audio_1",
      bytes,
      "r.wav",
      "audio/wav",
    );

    const full = await getAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("audio/wav");
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect(full.headers.get("Cache-Control")).toContain("no-store");
    expect(full.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);

    const partial = await getAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { headers: { Range: "bytes=0-99" } },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(
      `bytes 0-99/${bytes.byteLength}`,
    );
    const partBuf = Buffer.from(await partial.arrayBuffer());
    expect(partBuf.equals(bytes.subarray(0, 100))).toBe(true);

    const openEnd = await getAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { headers: { Range: "bytes=100-" } },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(openEnd.status).toBe(206);
    expect(Buffer.from(await openEnd.arrayBuffer()).equals(bytes.subarray(100))).toBe(
      true,
    );

    const suffix = await getAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { headers: { Range: "bytes=-10" } },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(suffix.status).toBe(206);
    expect(
      Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(bytes.length - 10)),
    ).toBe(true);

    const unsat = await getAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { headers: { Range: `bytes=${bytes.byteLength + 10}-` } },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(unsat.status).toBe(416);
    expect(unsat.headers.get("Content-Range")).toBe(`bytes */${bytes.byteLength}`);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "未登录" }), {
        status: 401,
      }),
    } as never);
    expect(
      (
        await getAssetAudio(
          new Request(
            `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
          ),
          {
            params: Promise.resolve({
              projectId: project.projectId,
              assetId: "audio_1",
            }),
          },
        )
      ).status,
    ).toBe(401);
  });

  it("DELETE clears file meta, keeps name, is idempotent, restores on patch fail", async () => {
    const owner = auth("user", "owner_f");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    const bytes = wavBytes(3);
    await putFileRequest(
      project.projectId,
      "audio_1",
      bytes,
      "keep-name.wav",
      "audio/wav",
    );

    let del = await deleteAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(del.status).toBe(200);
    const disk = resolveAssetAudioFilePath(project.projectId, "audio_1")!;
    expect(existsSync(disk)).toBe(false);
    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft?.audios[0]?.fileName).toBeNull();
    expect(draft?.audios[0]?.name).toBe("Theme");
    expect(draft?.audios[0]?.source).toBe("test");

    del = await deleteAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(del.status).toBe(200);

    await putFileRequest(
      project.projectId,
      "audio_1",
      bytes,
      "again.wav",
      "audio/wav",
    );
    const spy = vi
      .spyOn(assetBundleStore, "saveAssetBundleDraft")
      .mockRejectedValueOnce(new Error("meta fail"));
    del = await deleteAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: "audio_1",
        }),
      },
    );
    expect(del.status).toBe(500);
    expect(existsSync(disk)).toBe(true);
    expect(readFileSync(disk).equals(bytes)).toBe(true);
    spy.mockRestore();
    expect(await listTmpFilesInAssetAudioDir(project.projectId)).toEqual([]);
  });

  it("DELETE ?hard=1 removes audio row and clears character voice refs", async () => {
    const owner = auth("user", "owner_hard");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: `aud-hard-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const voiceId = "audio_voice_1";
    await saveAssetBundleDraft({
      projectId: project.projectId,
      characters: [
        {
          ...character(project.projectId, "char_1"),
          voiceId,
          voiceName: "Custom",
          voiceStyle: "项目音色",
          mediaVoices: {
            media_1: { voiceId, voiceName: "Custom" },
            media_2: { voiceId: "audio_other", voiceName: "Keep" },
          },
        },
      ],
      scenes: [],
      props: [],
      audios: [
        {
          ...audioRow(project.projectId, voiceId),
          type: "voice",
          name: "Custom Voice",
        },
      ],
    });
    const bytes = wavBytes(7);
    await writeProjectAssetAudioFile({
      projectId: project.projectId,
      assetId: voiceId,
      buffer: bytes,
      mimeType: "audio/wav",
    });
    const disk = resolveAssetAudioFilePath(project.projectId, voiceId)!;
    expect(existsSync(disk)).toBe(true);

    const del = await deleteAssetAudio(
      new Request(
        `http://localhost/api/projects/${project.projectId}/assets-draft/audio/${voiceId}?hard=1`,
        { method: "DELETE", headers: { "X-Hard-Delete": "1" } },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          assetId: voiceId,
        }),
      },
    );
    expect(del.status).toBe(200);
    const payload = (await del.json()) as { hard?: boolean };
    expect(payload.hard).toBe(true);
    expect(existsSync(disk)).toBe(false);

    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft?.audios.find((a) => a.id === voiceId)).toBeUndefined();
    expect(draft?.characters[0]?.voiceId).toBeNull();
    expect(draft?.characters[0]?.voiceName).toBeNull();
    expect(draft?.characters[0]?.voiceStyle).toBeNull();
    expect(draft?.characters[0]?.mediaVoices).toEqual({
      media_2: { voiceId: "audio_other", voiceName: "Keep" },
    });
  });

  it("replace keeps old file when write fails mid-flight; patch fail restores", async () => {
    const owner = auth("user", "owner_g");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    const first = wavBytes(1);
    await putFileRequest(
      project.projectId,
      "audio_1",
      first,
      "first.wav",
      "audio/wav",
    );
    const disk = resolveAssetAudioFilePath(project.projectId, "audio_1")!;
    expect(readFileSync(disk).equals(first)).toBe(true);

    const second = wavBytes(2);
    await putFileRequest(
      project.projectId,
      "audio_1",
      second,
      "second.wav",
      "audio/wav",
    );
    expect(readFileSync(disk).equals(second)).toBe(true);
    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft?.audios[0]?.fileName).toBe("second.wav");

    const spy = vi
      .spyOn(assetBundleStore, "saveAssetBundleDraft")
      .mockRejectedValueOnce(new Error("patch boom"));
    const third = wavBytes(3);
    const res = await putFileRequest(
      project.projectId,
      "audio_1",
      third,
      "third.wav",
      "audio/wav",
    );
    expect(res.status).toBe(500);
    expect(readFileSync(disk).equals(second)).toBe(true);
    const after = await loadAssetBundleDraft(project.projectId);
    expect(after?.audios[0]?.fileName).toBe("second.wav");
    spy.mockRestore();
    expect(await listTmpFilesInAssetAudioDir(project.projectId)).toEqual([]);
  });

  it("GET 404 for missing file and non-audio; path safe", async () => {
    const owner = auth("user", "owner_h");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await seedProject(owner);
    expect(
      (
        await getAssetAudio(
          new Request(
            `http://localhost/api/projects/${project.projectId}/assets-draft/audio/audio_1`,
          ),
          {
            params: Promise.resolve({
              projectId: project.projectId,
              assetId: "audio_1",
            }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await getAssetAudio(
          new Request(
            `http://localhost/api/projects/${project.projectId}/assets-draft/audio/char_1`,
          ),
          {
            params: Promise.resolve({
              projectId: project.projectId,
              assetId: "char_1",
            }),
          },
        )
      ).status,
    ).toBe(404);
    expect(resolveAssetAudioFilePath(project.projectId, "../x")).toBeNull();
  });

  it("storage write helper leaves no tmp after success", async () => {
    const owner = auth("user", "owner_i");
    const project = await seedProject(owner);
    await writeProjectAssetAudioFile({
      projectId: project.projectId,
      assetId: "audio_1",
      buffer: wavBytes(1),
      mimeType: "audio/wav",
    });
    const dir = path.dirname(
      resolveAssetAudioFilePath(project.projectId, "audio_1")!,
    );
    const leftover = readdirSync(dir).filter(
      (n) => n.includes(".tmp") || n.includes(".bak"),
    );
    expect(leftover).toEqual([]);
  });
});
