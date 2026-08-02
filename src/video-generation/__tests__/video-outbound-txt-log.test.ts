import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendVideoOutboundTxtLog,
  buildMediaFingerprint,
  formatVideoOutboundTxtBlock,
  formatVideoOutboundJsonEvent,
  hashPromptForLog,
  sanitizeOutboundBodyForLog,
  summarizeResolvedMediaForLog,
} from "../outbound-log";

describe("video outbound TXT log", () => {
  let prevAppData: string | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    prevAppData = process.env.APP_DATA_DIR;
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "video-outbound-"));
    process.env.APP_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    delete process.env.REMOTE_DATA_ONLY;
    vi.restoreAllMocks();
    if (prevAppData === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prevAppData;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("远端模式输出脱敏 JSON stdout 且不创建本地文件", async () => {
    process.env.REMOTE_DATA_ONLY = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await appendVideoOutboundTxtLog({
      event: "video.create.request",
      dialect: "sd2",
      generationId: "gen-remote",
      url: "https://cdn.example.test/private/path?token=secret",
      requestHeaders: { Authorization: "Bearer sk-secret" },
      requestBody: { prompt: "用户提示词原文", apiKey: "sk-secret" },
      responseBody: "上游响应正文",
      promptChars: 7,
      promptSha256: "hash-1",
    });

    expect(result).toBe("stdout:json");
    expect(info).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(info.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      event: "video.create.request",
      generationId: "gen-remote",
      upstreamHost: "cdn.example.test",
      promptChars: 7,
      promptSha256: "hash-1",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("用户提示词原文");
    expect(serialized).not.toContain("上游响应正文");
    expect(serialized).not.toContain("sk-secret");
    expect(await import("fs/promises").then((fs) => fs.readdir(tmpDir))).toEqual([]);
  });

  it("JSON 事件仅保留安全字段", () => {
    const event = formatVideoOutboundJsonEvent({
      event: "video.create.error",
      errorMessage: "Bearer sk-abcdefghijklmnop failed",
      requestBody: { content: "secret prompt" },
      responseBody: "secret response",
    });
    expect(event.errorMessage).toContain("Bearer ***");
    expect(event).not.toHaveProperty("requestBody");
    expect(event).not.toHaveProperty("responseBody");
  });

  it("mediaFingerprint 对同一素材集合稳定，与顺序无关", () => {
    const a = buildMediaFingerprint(["img_b", "img_a"]);
    const b = buildMediaFingerprint(["img_a", "img_b", "img_a"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^media:[a-f0-9]{16}$/);
  });

  it("不同素材集合指纹不同；空集合有固定哨兵", () => {
    expect(buildMediaFingerprint(["a"])).not.toBe(buildMediaFingerprint(["b"]));
    expect(buildMediaFingerprint([])).toBe("media:empty");
  });

  it("同素材反复抽卡：fingerprint 相同，generation / client 幂等键可不同", () => {
    const media = [
      { assetId: "char_1", label: "江宸", kind: "character", realPersonCandidate: true },
      { assetId: "scene_9", label: "办公室", kind: "scene" },
    ];
    const meta = summarizeResolvedMediaForLog(media);
    const draw1 = formatVideoOutboundTxtBlock({
      event: "video.create.request",
      dialect: "sd2",
      generationId: "gen-draw-1",
      clientIdempotencyKey: "client-draw-1",
      upstreamIdempotencyKey: "gen-draw-1",
      mediaFingerprint: meta.mediaFingerprint,
      mediaAssetIds: meta.mediaAssetIds,
      promptSha256: hashPromptForLog("同一提示词"),
    });
    const draw2 = formatVideoOutboundTxtBlock({
      event: "video.create.request",
      dialect: "sd2",
      generationId: "gen-draw-2",
      clientIdempotencyKey: "client-draw-2",
      upstreamIdempotencyKey: "gen-draw-2",
      mediaFingerprint: meta.mediaFingerprint,
      mediaAssetIds: meta.mediaAssetIds,
      promptSha256: hashPromptForLog("同一提示词"),
    });
    expect(draw1).toContain(`mediaFingerprint: ${meta.mediaFingerprint}`);
    expect(draw2).toContain(`mediaFingerprint: ${meta.mediaFingerprint}`);
    expect(draw1).toContain("clientIdempotencyKey: client-draw-1");
    expect(draw2).toContain("clientIdempotencyKey: client-draw-2");
    expect(draw1).toContain("upstreamIdempotencyKey: gen-draw-1");
    expect(draw2).toContain("upstreamIdempotencyKey: gen-draw-2");
  });

  it("格式化会脱敏 Bearer / apiKey，并写入隔离 APP_DATA_DIR", async () => {
    const block = formatVideoOutboundTxtBlock({
      event: "video.create.error",
      dialect: "ark",
      errorMessage: "Authorization Bearer sk-abcdefg12345678 failed",
      responseBody: '{"apiKey":"sk-secretvalue","msg":"x"}',
      at: "2026-08-01T12:00:00.000Z",
    });
    expect(block).toContain("Bearer ***");
    expect(block).not.toContain("sk-abcdefg12345678");
    expect(block).toContain('"apiKey": "***"');

    const filePath = await appendVideoOutboundTxtLog({
      event: "video.create.request",
      dialect: "sd2",
      generationId: "gen-1",
      clientIdempotencyKey: "idem-1",
      upstreamIdempotencyKey: "gen-1",
      mediaFingerprint: "media:abcd",
      note: "unit",
    });
    expect(filePath).toBeTruthy();
    expect(filePath!.startsWith(tmpDir)).toBe(true);
    const text = await readFile(filePath!, "utf8");
    expect(text).toContain("event=video.create.request");
    expect(text).toContain("clientIdempotencyKey: idem-1");
    expect(text).toContain("mediaFingerprint: media:abcd");
  });

  it("落盘实际上送 headers + requestBody（含完整 prompt / content）", () => {
    const block = formatVideoOutboundTxtBlock({
      event: "video.create.request",
      dialect: "sd2",
      method: "POST",
      url: "http://36.212.37.227:3099/v1/video/generations",
      requestHeaders: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-key",
        "Idempotency-Key": "gen-1",
      },
      requestBody: {
        model: "doubao-seedance-2.0",
        content: [
          { type: "text", text: "镜头提示词原文" },
          {
            type: "image_url",
            image_url: { url: "asset://asset_abc" },
            role: "reference_image",
          },
        ],
        resolution: "720p",
        duration: 4,
      },
      at: "2026-08-01T12:00:00.000Z",
    });
    expect(block).toContain("requestHeaders:");
    expect(block).toContain('"Authorization": "Bearer ***"');
    expect(block).not.toContain("secret-key");
    expect(block).toContain("requestBody:");
    expect(block).toContain('"model": "doubao-seedance-2.0"');
    expect(block).toContain("镜头提示词原文");
    expect(block).toContain("asset://asset_abc");
    expect(block).toContain('"duration": 4');
  });

  it("超大 data URL 在 requestBody 中截断，asset:// 保留", () => {
    const huge = `data:image/png;base64,${"A".repeat(5000)}`;
    const cleaned = sanitizeOutboundBodyForLog({
      content: [{ type: "image_url", image_url: { url: huge } }],
      keep: "asset://asset_x",
    }) as {
      content: Array<{ image_url: { url: string } }>;
      keep: string;
    };
    expect(cleaned.keep).toBe("asset://asset_x");
    expect(cleaned.content[0]!.image_url.url).toContain("[data-url omitted chars=");
    expect(cleaned.content[0]!.image_url.url.length).toBeLessThan(120);
  });
});
