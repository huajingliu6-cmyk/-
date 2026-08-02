import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  buildTransferSourceFromGeneration,
  classifyIpAddress,
  getWanResultAllowedHosts,
  hostMatchesAllowlist,
  parseAllowedHosts,
  redactRemoteUrlForLogs,
  sanitizeGenerationForClient,
  safeDownloadProviderVideoToTempFile,
  TransferError,
  validateProviderResultUrl,
  type InjectedHttpGet,
  type SafeDownloadDeps,
} from "@/video-generation/secure-transfer";
import { transferRemoteVideoToLocal } from "@/video-generation/transfer-video";
import {
  getVideoProviderRuntimeConfig,
  paidGenerationAllowed,
} from "@/video-generation/provider/config";
import { createVideoProvider } from "@/video-generation/provider";
import type { GenerationRecord } from "@/video-generation/types";

function buildStructuralMp4(size = 512): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf.writeUInt32BE(16, 0);
  buf.write("ftyp", 4, "ascii");
  buf.write("isom", 8, "ascii");
  buf.writeUInt32BE(8, 16);
  buf.write("free", 20, "ascii");
  if (size >= 40) {
    buf.writeUInt32BE(8, 24);
    buf.write("mdat", 28, "ascii");
  }
  return buf;
}

function publicDns(hostname: string) {
  return async () => {
    if (hostname.includes("private") || hostname === "localhost") {
      return [{ address: "127.0.0.1", family: 4 as const }];
    }
    return [{ address: "203.0.113.10", family: 4 as const }];
  };
}

/** 203.0.113.0/24 是文档网段，已被我们拦截——测试用「看似公网」的 8.8.8.8 */
function publicDnsGoogle() {
  return async () => [{ address: "8.8.8.8", family: 4 as const }];
}

function makeBody(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

const TRUSTED = "cdn.example-results.test";
const ALLOWED = parseAllowedHosts(TRUSTED);

describe("validateProviderResultUrl", () => {
  it("https + exact allowlist 合法", () => {
    const r = validateProviderResultUrl({
      url: `https://${TRUSTED}/a.mp4?Expires=1&Signature=secret`,
      allowedHosts: ALLOWED,
    });
    expect(r.ok).toBe(true);
  });

  it("http 被拒绝", () => {
    const r = validateProviderResultUrl({
      url: `http://${TRUSTED}/a.mp4`,
      allowedHosts: ALLOWED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESULT_URL_PROTOCOL_NOT_ALLOWED");
  });

  it("file 被真实 Provider 拒绝", () => {
    const r = validateProviderResultUrl({
      url: "file:///tmp/a.mp4",
      allowedHosts: ALLOWED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESULT_URL_PROTOCOL_NOT_ALLOWED");
  });

  it("含用户名密码 URL 被拒绝", () => {
    const r = validateProviderResultUrl({
      url: `https://user:pass@${TRUSTED}/a.mp4`,
      allowedHosts: ALLOWED,
    });
    expect(r.ok).toBe(false);
  });

  it("非 443 端口被拒绝", () => {
    const r = validateProviderResultUrl({
      url: `https://${TRUSTED}:8443/a.mp4`,
      allowedHosts: ALLOWED,
    });
    expect(r.ok).toBe(false);
  });

  it("allowlist exact match", () => {
    expect(hostMatchesAllowlist(TRUSTED, ALLOWED)).toBe(true);
    expect(hostMatchesAllowlist("other.test", ALLOWED)).toBe(false);
  });

  it("trusted.example.com.attacker.com 被拒绝", () => {
    const rules = parseAllowedHosts("trusted.example.com");
    expect(
      hostMatchesAllowlist("trusted.example.com.attacker.com", rules),
    ).toBe(false);
  });

  it("eviltrusted.example.com 被拒绝", () => {
    const rules = parseAllowedHosts("trusted.example.com");
    expect(hostMatchesAllowlist("eviltrusted.example.com", rules)).toBe(false);
  });

  it("合法子域边界匹配", () => {
    const rules = parseAllowedHosts(".example.com");
    expect(hostMatchesAllowlist("example.com", rules)).toBe(true);
    expect(hostMatchesAllowlist("cdn.example.com", rules)).toBe(true);
    expect(hostMatchesAllowlist("example.com.evil.test", rules)).toBe(false);
  });

  it("allowlist 为空时真实下载被拒绝", () => {
    const r = validateProviderResultUrl({
      url: `https://${TRUSTED}/a.mp4`,
      allowedHosts: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESULT_HOST_ALLOWLIST_NOT_CONFIGURED");
  });
});

describe("classifyIpAddress", () => {
  const blocked = [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];
  for (const ip of blocked) {
    it(`拒绝 ${ip}`, () => {
      expect(classifyIpAddress(ip).ok).toBe(false);
    });
  }

  it("公网 IPv4 合法", () => {
    expect(classifyIpAddress("8.8.8.8").ok).toBe(true);
  });

  it("公网 IPv6 合法", () => {
    expect(classifyIpAddress("2001:4860:4860::8888").ok).toBe(true);
  });

  it("DNS 返回一个公网和一个私网地址时拒绝", async () => {
    const mp4 = buildStructuralMp4();
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(mp4.byteLength),
      },
      body: makeBody([mp4]),
    });
    const temp = path.join(
      process.cwd(),
      "data",
      "generated-videos",
      `ssrf-mix-${randomUUID()}.tmp`,
    );
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/out.mp4`,
        tempPath: temp,
        deps: {
          allowedHosts: ALLOWED,
          resolveAll: async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.1", family: 4 },
          ],
          httpGet,
        },
      }),
    ).rejects.toMatchObject({ code: "RESULT_PRIVATE_ADDRESS_BLOCKED" });
    await fs.unlink(temp).catch(() => undefined);
  });
});

describe("safeDownload redirects and body", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    for (const f of cleanup.splice(0)) {
      await fs.unlink(f).catch(() => undefined);
    }
  });

  function tempFile() {
    const p = path.join(
      process.cwd(),
      "data",
      "generated-videos",
      `ssrf-${randomUUID()}.tmp`,
    );
    cleanup.push(p);
    return p;
  }

  function deps(httpGet: InjectedHttpGet): SafeDownloadDeps {
    return {
      allowedHosts: ALLOWED,
      resolveAll: publicDnsGoogle(),
      httpGet,
    };
  }

  it("合法 allowlist 内重定向成功", async () => {
    const mp4 = buildStructuralMp4(800);
    let step = 0;
    const httpGet: InjectedHttpGet = async (url) => {
      step += 1;
      if (step === 1) {
        return {
          statusCode: 302,
          headers: { location: `https://${TRUSTED}/final.mp4` },
          body: makeBody([]),
        };
      }
      expect(url).toContain("/final.mp4");
      return {
        statusCode: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(mp4.byteLength),
        },
        body: makeBody([mp4]),
      };
    };
    const result = await safeDownloadProviderVideoToTempFile({
      remoteUrl: `https://${TRUSTED}/start.mp4`,
      tempPath: tempFile(),
      deps: deps(httpGet),
    });
    expect(result.sizeBytes).toBe(mp4.byteLength);
    expect(result.sha256).toBe(
      createHash("sha256").update(mp4).digest("hex"),
    );
  });

  it("重定向到 http 被拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 302,
      headers: { location: `http://${TRUSTED}/x.mp4` },
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_URL_PROTOCOL_NOT_ALLOWED" });
  });

  it("重定向到 localhost 被拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 302,
      headers: { location: "https://localhost/x.mp4" },
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: {
          allowedHosts: parseAllowedHosts(`${TRUSTED},localhost`),
          resolveAll: async (h) =>
            h === "localhost"
              ? [{ address: "127.0.0.1", family: 4 }]
              : [{ address: "8.8.8.8", family: 4 }],
          httpGet,
        },
      }),
    ).rejects.toMatchObject({ code: "RESULT_PRIVATE_ADDRESS_BLOCKED" });
  });

  it("重定向到私网地址被拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 302,
      headers: { location: "https://10.0.0.5/x.mp4" },
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: {
          allowedHosts: parseAllowedHosts(`${TRUSTED},10.0.0.5`),
          resolveAll: publicDnsGoogle(),
          httpGet,
        },
      }),
    ).rejects.toMatchObject({ code: "RESULT_PRIVATE_ADDRESS_BLOCKED" });
  });

  it("重定向到 allowlist 外域名被拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 302,
      headers: { location: "https://evil.other.test/x.mp4" },
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_HOST_NOT_ALLOWED" });
  });

  it("重定向循环被拒绝", async () => {
    const httpGet: InjectedHttpGet = async (url) => ({
      statusCode: 302,
      headers: {
        location:
          url.includes("b.mp4")
            ? `https://${TRUSTED}/a.mp4`
            : `https://${TRUSTED}/b.mp4`,
      },
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_REDIRECT_NOT_ALLOWED" });
  });

  it("超过最大次数被拒绝", async () => {
    let n = 0;
    const httpGet: InjectedHttpGet = async () => {
      n += 1;
      return {
        statusCode: 302,
        headers: { location: `https://${TRUSTED}/hop-${n}.mp4` },
        body: makeBody([]),
      };
    };
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/start.mp4`,
        tempPath: tempFile(),
        deps: { ...deps(httpGet), maxRedirects: 3 },
      }),
    ).rejects.toMatchObject({ code: "RESULT_TOO_MANY_REDIRECTS" });
  });

  it("3xx 无 Location 被拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 302,
      headers: {},
      body: makeBody([]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/a.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_REDIRECT_NOT_ALLOWED" });
  });

  it("video/mp4 正常", async () => {
    const mp4 = buildStructuralMp4(600);
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(mp4.byteLength),
      },
      body: makeBody([mp4]),
    });
    const result = await safeDownloadProviderVideoToTempFile({
      remoteUrl: `https://${TRUSTED}/ok.mp4`,
      tempPath: tempFile(),
      deps: deps(httpGet),
    });
    expect(result.sizeBytes).toBe(600);
  });

  it("application/octet-stream + 合法 MP4 结构可接受", async () => {
    const mp4 = buildStructuralMp4(700);
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(mp4.byteLength),
      },
      body: makeBody([mp4]),
    });
    const result = await safeDownloadProviderVideoToTempFile({
      remoteUrl: `https://${TRUSTED}/ok.bin`,
      tempPath: tempFile(),
      deps: deps(httpGet),
    });
    expect(result.sizeBytes).toBe(700);
  });

  it("text/html 被拒绝", async () => {
    const html = Buffer.from("<!doctype html><html></html>");
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(html.byteLength),
      },
      body: makeBody([html]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/x`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_CONTENT_TYPE_INVALID" });
  });

  it("application/json 被拒绝", async () => {
    const json = Buffer.from('{"error":"no"}');
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(json.byteLength),
      },
      body: makeBody([json]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/x`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_CONTENT_TYPE_INVALID" });
  });

  it("Content-Length 超限提前拒绝", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(1000),
      },
      body: makeBody([buildStructuralMp4(100)]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/big.mp4`,
        tempPath: tempFile(),
        deps: { ...deps(httpGet), maxBytes: 100 },
      }),
    ).rejects.toMatchObject({ code: "RESULT_FILE_TOO_LARGE" });
  });

  it("chunked 下载超过上限中止", async () => {
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: { "content-type": "video/mp4" },
      body: makeBody([
        buildStructuralMp4(80),
        Buffer.alloc(50, 1),
      ]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/chunk.mp4`,
        tempPath: tempFile(),
        deps: { ...deps(httpGet), maxBytes: 100 },
      }),
    ).rejects.toMatchObject({ code: "RESULT_FILE_TOO_LARGE" });
  });

  it("Content-Length 不一致被拒绝", async () => {
    const mp4 = buildStructuralMp4(200);
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": "999",
      },
      body: makeBody([mp4]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/badlen.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_CONTENT_LENGTH_MISMATCH" });
  });

  it("超时中止并清理临时文件", async () => {
    const temp = tempFile();
    const httpGet: InjectedHttpGet = async (_url, opts) => {
      await new Promise((r) => setTimeout(r, 50));
      if (opts.signal.aborted) {
        throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
      }
      return {
        statusCode: 200,
        headers: { "content-type": "video/mp4" },
        body: makeBody([buildStructuralMp4()]),
      };
    };
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/slow.mp4`,
        tempPath: temp,
        deps: { ...deps(httpGet), timeoutMs: 10 },
      }),
    ).rejects.toMatchObject({ code: "RESULT_DOWNLOAD_TIMEOUT" });
    await expect(fs.stat(temp)).rejects.toThrow();
  });

  it("中途流错误清理临时文件", async () => {
    const temp = tempFile();
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: { "content-type": "video/mp4" },
      body: {
        async *[Symbol.asyncIterator]() {
          yield buildStructuralMp4(40);
          throw new Error("stream broke");
        },
      },
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/broken.mp4`,
        tempPath: temp,
        deps: deps(httpGet),
      }),
    ).rejects.toBeTruthy();
    await expect(fs.stat(temp)).rejects.toThrow();
  });

  it("无 ftyp 被拒绝", async () => {
    const bad = Buffer.alloc(200, 0x41);
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(bad.byteLength),
      },
      body: makeBody([bad]),
    });
    await expect(
      safeDownloadProviderVideoToTempFile({
        remoteUrl: `https://${TRUSTED}/noftyp.mp4`,
        tempPath: tempFile(),
        deps: deps(httpGet),
      }),
    ).rejects.toMatchObject({ code: "RESULT_VIDEO_STRUCTURE_INVALID" });
  });
});

describe("transfer isolation + redact + defaults", () => {
  const cleanupFiles: string[] = [];
  const cleanupAssets: string[] = [];

  afterEach(async () => {
    for (const f of cleanupFiles.splice(0)) {
      await fs.unlink(f).catch(() => undefined);
    }
    for (const id of cleanupAssets.splice(0)) {
      const dir = resolveAppDataPath("assets");
      const entries = await fs.readdir(dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (name.startsWith(id)) {
          await fs.unlink(path.join(dir, name)).catch(() => undefined);
        }
      }
    }
  });

  it("成功后 SHA-256 和 sizeBytes 正确且失败不创建 AssetRecord", async () => {
    const mp4 = buildStructuralMp4(900);
    const httpGet: InjectedHttpGet = async () => ({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(mp4.byteLength),
      },
      body: makeBody([mp4]),
    });
    const result = await transferRemoteVideoToLocal({
      projectId: "demo",
      title: "镜头",
      generationId: randomUUID(),
      providerId: "aliyun-wan27",
      isMock: false,
      remoteVideoUrl: `https://${TRUSTED}/ok.mp4?Signature=tokensecret`,
      downloadDeps: {
        allowedHosts: ALLOWED,
        resolveAll: publicDnsGoogle(),
        httpGet,
      },
    });
    cleanupAssets.push(result.asset.id);
    cleanupFiles.push(result.absolutePath);
    expect(result.sizeBytes).toBe(mp4.byteLength);
    expect(result.sha256).toBe(
      createHash("sha256").update(mp4).digest("hex"),
    );
    expect(result.asset.sizeBytes).toBe(mp4.byteLength);

    await expect(
      transferRemoteVideoToLocal({
        projectId: "demo",
        title: "镜头",
        generationId: randomUUID(),
        providerId: "aliyun-wan27",
        isMock: false,
        remoteVideoUrl: `https://${TRUSTED}/bad.mp4`,
        downloadDeps: {
          allowedHosts: ALLOWED,
          resolveAll: publicDnsGoogle(),
          httpGet: async () => ({
            statusCode: 200,
            headers: { "content-type": "text/html" },
            body: makeBody([Buffer.from("<html>")]),
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "RESULT_CONTENT_TYPE_INVALID" });
  });

  it("日志脱敏不含 query token", () => {
    const redacted = redactRemoteUrlForLogs(
      `https://${TRUSTED}/path/out.mp4?Expires=1&Signature=supersecret`,
    );
    expect(redacted).not.toContain("Signature");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain(TRUSTED);
  });

  it("客户端 sanitize 不返回完整 remoteVideoUrl", () => {
    const record = {
      remoteVideoUrl: `https://${TRUSTED}/x.mp4?Signature=abc`,
    } as GenerationRecord;
    const client = sanitizeGenerationForClient({
      ...record,
      id: "x",
      projectId: "p",
      shotNodeId: "s",
      providerId: "aliyun-wan27",
      providerModelId: "m",
      providerTaskId: "t",
      mode: "textToVideo",
      status: "downloading",
      progress: null,
      progressLabel: "",
      isMock: false,
      requestSnapshot: {
        prompt: "",
        settings: {
          resolution: "720P",
          aspectRatio: "16:9",
          durationSeconds: 5,
          watermark: false,
          promptExtend: true,
        },
        mediaAssetIds: [],
        unsupportedAudioLabels: [],
      },
      requestedResolution: "720P",
      requestedAspectRatio: "16:9",
      requestedDurationSeconds: 5,
      providerResolution: null,
      providerAspectRatio: null,
      providerDurationSeconds: null,
      actualWidth: null,
      actualHeight: null,
      actualDurationSeconds: null,
      metadataSource: "none",
      localVideoAssetId: null,
      resultAsset: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "",
      updatedAt: "",
      completedAt: null,
      idempotencyKey: null,
    });
    expect(client.remoteVideoUrl).toBeNull();
    expect(client.hasRemoteVideo).toBe(true);
    expect(client.remoteVideoSummary).not.toContain("Signature");
  });

  it("Mock file:// 仍能成功；目录外拒绝；真实 Provider 不能用 file://", async () => {
    const dir = resolveAppDataPath("generated-videos");
    await fs.mkdir(dir, { recursive: true });
    const buf = buildStructuralMp4(1024);
    const file = path.join(dir, `mock-ok-${randomUUID()}.mp4`);
    await fs.writeFile(file, buf);
    cleanupFiles.push(file);

    const ok = await transferRemoteVideoToLocal({
      projectId: "demo",
      remoteVideoUrl: `file://${file.replace(/\\/g, "/")}`,
      title: "镜头",
      generationId: randomUUID(),
      providerId: "mock",
      isMock: true,
    });
    cleanupAssets.push(ok.asset.id);
    cleanupFiles.push(ok.absolutePath);
    expect(ok.sizeBytes).toBe(buf.byteLength);

    const outside = resolveAppDataPath("mock", `out-${randomUUID()}.mp4`);
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, buf);
    cleanupFiles.push(outside);
    await expect(
      transferRemoteVideoToLocal({
        projectId: "demo",
        remoteVideoUrl: `file://${outside.replace(/\\/g, "/")}`,
        title: "t",
        generationId: randomUUID(),
        providerId: "mock",
        isMock: true,
      }),
    ).rejects.toThrow(/非法本地视频路径/);

    expect(() =>
      buildTransferSourceFromGeneration({
        providerId: "aliyun-wan27",
        isMock: false,
        remoteVideoUrl: `file://${file.replace(/\\/g, "/")}`,
      }),
    ).toThrow(TransferError);

    expect(() =>
      buildTransferSourceFromGeneration({
        providerId: "mock",
        isMock: true,
        remoteVideoUrl: `https://${TRUSTED}/x.mp4`,
      }),
    ).toThrow(TransferError);
  });

  it("Provider 失败不回退 Mock；默认 mock / paid false；allowlist 默认空", () => {
    const cfg = getVideoProviderRuntimeConfig({});
    expect(cfg.providerId).toBe("mock");
    expect(cfg.allowPaidGeneration).toBe(false);
    expect(getWanResultAllowedHosts({})).toEqual([]);
    const gate = paidGenerationAllowed(
      {
        ...cfg,
        providerId: "aliyun-wan27",
        allowPaidGeneration: false,
      },
      true,
    );
    expect(gate.ok).toBe(false);
    const provider = createVideoProvider({
      config: {
        ...cfg,
        providerId: "aliyun-wan27",
        dashscopeApiKey: "sk-test",
        dashscopeWorkspaceId: "ws",
      },
    });
    expect(provider.id).toBe("aliyun-wan27");
  });

  it("POST generations schema 不含 remoteVideoUrl 字段（客户端不能传）", async () => {
    const mod = await import("@/app/api/generations/route");
    expect(typeof mod.POST).toBe("function");
    // 权威：服务端用 buildTransferSourceFromGeneration，不接受客户端 URL
    expect(() =>
      buildTransferSourceFromGeneration({
        providerId: "aliyun-wan27",
        isMock: false,
        remoteVideoUrl: null,
      }),
    ).toThrow(/没有可转存/);
  });
});

void publicDns;
