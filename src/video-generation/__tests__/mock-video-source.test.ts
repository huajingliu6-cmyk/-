import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  FORBIDDEN_PLACEHOLDER_MP4_SHA256,
  hashBufferSha256,
  validateMockVideoSource,
} from "@/video-generation/validate-mock-video-source";
import {
  MockVideoProvider,
  resetMockVideoProviderTasks,
} from "@/video-generation/provider/mock-provider";
import { transferRemoteVideoToLocal } from "@/video-generation/transfer-video";
import { getWan27T2VCapability } from "@/video-generation/model-capabilities";
import { parseSingleByteRange } from "@/video-generation/parse-byte-range";
import { planAssetContentResponse } from "@/video-generation/serve-generated-video";
import type { VideoGenerationInput } from "@/video-generation/types";

const PLACEHOLDER_98 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
  "base64",
);

/** 仅用于结构/完整性单测：含 box 标记，不声称可被浏览器解码 */
function buildStructuralMp4Fixture(extraBytes = 512): Buffer {
  const header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // size + ftyp
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  const mid = Buffer.from("moovtrakmdat", "ascii");
  const pad = Buffer.alloc(extraBytes, 0x7a);
  return Buffer.concat([header, mid, pad]);
}

function baseInput(): VideoGenerationInput {
  return {
    shotId: "shot-1",
    projectId: "demo",
    prompt: "test",
    resolution: "720P",
    aspectRatio: "9:16",
    durationSeconds: 5,
    watermark: false,
    promptExtend: true,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    textInputs: [],
  };
}

describe("validateMockVideoSource", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    delete process.env.MOCK_VIDEO_FILE;
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("缺少文件时返回 MOCK_VIDEO_NOT_CONFIGURED", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-miss-"));
    tmpDirs.push(dir);
    process.env.MOCK_VIDEO_FILE = path.join(dir, "missing.mp4");
    const result = await validateMockVideoSource(process.env, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MOCK_VIDEO_NOT_CONFIGURED");
      expect(result.message).toMatch(/尚未配置可播放的本地 Mock 视频/);
    }
  });

  it("拒绝 98 B 伪占位 MP4", async () => {
    expect(PLACEHOLDER_98.byteLength).toBe(98);
    expect(await hashBufferSha256(PLACEHOLDER_98)).toBe(
      FORBIDDEN_PLACEHOLDER_MP4_SHA256,
    );

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-bad-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "bad.mp4");
    await fs.writeFile(file, PLACEHOLDER_98);
    process.env.MOCK_VIDEO_FILE = file;
    const result = await validateMockVideoSource(process.env, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MOCK_VIDEO_INVALID");
      expect(result.message).toMatch(/98 B/);
    }
  });

  it("拒绝 PNG 伪装", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-png-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "fake.mp4");
    await fs.writeFile(
      file,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(100)]),
    );
    process.env.MOCK_VIDEO_FILE = file;
    const result = await validateMockVideoSource(process.env, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/PNG/);
  });

  it("通过基础 box 结构验证（不证明可解码）", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-ok-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "ok.mp4");
    const buf = buildStructuralMp4Fixture();
    await fs.writeFile(file, buf);
    process.env.MOCK_VIDEO_FILE = file;
    const result = await validateMockVideoSource(process.env, process.cwd());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sizeBytes).toBe(buf.byteLength);
      expect(result.structureCheck).toBe("basic-boxes");
      expect(result.sha256).toHaveLength(64);
    }
  });
});

describe("MockVideoProvider without fake 98B", () => {
  const tmpDirs: string[] = [];

  beforeEach(() => {
    resetMockVideoProviderTasks();
  });

  afterEach(async () => {
    delete process.env.MOCK_VIDEO_FILE;
    resetMockVideoProviderTasks();
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("未配置 Mock 源时 submit 抛出 MOCK_VIDEO_NOT_CONFIGURED", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-sub-"));
    tmpDirs.push(dir);
    process.env.MOCK_VIDEO_FILE = path.join(dir, "nope.mp4");
    const provider = new MockVideoProvider();
    const capability = getWan27T2VCapability("mock-wan27-t2v");
    await expect(
      provider.submitGeneration({
        generationId: "g-mock-1",
        input: baseInput(),
        capability: { ...capability, providerId: "mock" },
        resolvedMedia: [],
      }),
    ).rejects.toMatchObject({ code: "MOCK_VIDEO_NOT_CONFIGURED" });
  });

  it("配置结构 fixture 后可排队并产出与源同哈希的任务文件", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-run-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "src.mp4");
    const buf = buildStructuralMp4Fixture(2048);
    await fs.writeFile(file, buf);
    process.env.MOCK_VIDEO_FILE = file;

    const provider = new MockVideoProvider();
    const capability = getWan27T2VCapability("mock-wan27-t2v");
    const submitted = await provider.submitGeneration({
      generationId: "g-mock-2",
      input: baseInput(),
      capability: { ...capability, providerId: "mock" },
      resolvedMedia: [],
    });

    const s1 = await provider.getGenerationStatus(submitted.providerTaskId);
    expect(s1.status).toBe("processing");
    const s2 = await provider.getGenerationStatus(submitted.providerTaskId);
    expect(s2.status).toBe("downloading");
    expect(s2.remoteVideoUrl?.startsWith("file://")).toBe(true);

    const localPath = decodeURIComponent(
      (s2.remoteVideoUrl ?? "").replace(/^file:\/\//, ""),
    ).replace(/^\/([A-Za-z]:)/, "$1");
    const out = await fs.readFile(localPath);
    expect(out.byteLength).toBe(buf.byteLength);
    expect(createHash("sha256").update(out).digest("hex")).toBe(
      createHash("sha256").update(buf).digest("hex"),
    );
    expect(out.byteLength).not.toBe(98);

    await fs.unlink(localPath).catch(() => undefined);
  });
});

describe("transferRemoteVideoToLocal integrity", () => {
  const cleanupFiles: string[] = [];
  const cleanupAssets: string[] = [];

  afterEach(async () => {
    for (const f of cleanupFiles.splice(0)) {
      await fs.unlink(f).catch(() => undefined);
    }
    for (const id of cleanupAssets.splice(0)) {
      const dir = path.join(process.cwd(), "data", "assets");
      const entries = await fs.readdir(dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (name.startsWith(id)) {
          await fs.unlink(path.join(dir, name)).catch(() => undefined);
        }
      }
    }
  });

  it("拒绝转存 98 B 伪 MP4", async () => {
    const dir = path.join(process.cwd(), "data", "generated-videos");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `forbidden-${randomSuffix()}.mp4`);
    await fs.writeFile(file, PLACEHOLDER_98);
    cleanupFiles.push(file);
    await expect(
      transferRemoteVideoToLocal({
        projectId: "demo",
        remoteVideoUrl: `file://${file.replace(/\\/g, "/")}`,
        title: "t",
        generationId: "00000000-0000-4000-8000-000000000099",
        isMock: true,
      }),
    ).rejects.toThrow(/98 B|伪 MP4/);
  });

  it("转存后 sizeBytes 与 SHA-256 与源一致", async () => {
    const dir = path.join(process.cwd(), "data", "generated-videos");
    await fs.mkdir(dir, { recursive: true });
    const buf = buildStructuralMp4Fixture(4096);
    const file = path.join(dir, `ok-${randomSuffix()}.mp4`);
    await fs.writeFile(file, buf);
    cleanupFiles.push(file);
    const sourceSha = createHash("sha256").update(buf).digest("hex");

    const result = await transferRemoteVideoToLocal({
      projectId: "demo",
      remoteVideoUrl: `file://${file.replace(/\\/g, "/")}`,
      title: "镜头",
      generationId: "00000000-0000-4000-8000-000000000098",
      isMock: true,
    });
    cleanupAssets.push(result.asset.id);
    cleanupFiles.push(result.absolutePath);

    expect(result.sizeBytes).toBe(buf.byteLength);
    expect(result.sha256).toBe(sourceSha);
    expect(result.asset.sizeBytes).toBe(buf.byteLength);
    expect(result.asset.metadata?.sha256).toBe(sourceSha);
    expect(result.asset.sizeBytes).not.toBe(98);
  });
});

describe("Range responses are not stuck at 98 B", () => {
  it("完整响应与多段 Range 拼接等于文件字节", () => {
    const file = buildStructuralMp4Fixture(1200);
    const full = planAssetContentResponse({
      fileSize: file.byteLength,
      rangeHeader: null,
    });
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.status).toBe(200);
      expect(full.contentLength).toBe(file.byteLength);
      expect(full.contentLength).not.toBe(98);
    }

    const a = parseSingleByteRange("bytes=0-99", file.byteLength);
    const b = parseSingleByteRange("bytes=100-", file.byteLength);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok || !a.range || !b.range) return;
    expect(a.range.length + b.range.length).toBe(file.byteLength);

    const tail = parseSingleByteRange("bytes=-50", file.byteLength);
    expect(tail.ok).toBe(true);
    if (tail.ok && tail.range) {
      expect(tail.range.length).toBe(50);
      expect(tail.range.start).toBe(file.byteLength - 50);
    }
  });
});

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}
