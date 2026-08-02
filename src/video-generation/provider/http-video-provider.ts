import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getHttpCapabilities } from "../model-capabilities";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { storeRemoteProviderResult } from "@/video-generation/remote-provider-result";
import type {
  ProviderCancelResult,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
} from "../types";
import type { FetchLike, VideoProvider } from "./types";
import type { VideoProviderRuntimeConfig } from "./config";
import {
  buildArkCreateUrl,
  buildArkStatusUrl,
  buildSd2ContentUrl,
  buildSd2CreateUrl,
  buildSd2NormalAssetUploadUrl,
  buildSd2RealPersonAssetUploadUrl,
  buildSd2StatusUrl,
  DEFAULT_ARK_VIDEO_MODEL,
  DEFAULT_SD2_VIDEO_MODEL,
  detectHttpVideoDialect,
  clampArkVideoDurationSeconds,
  mapArkSizeToProviderResolution,
  normalizeArkVideoModelId,
  normalizeSd2VideoModelId,
  normalizeHttpVideoBaseUrl,
  toArkResolution,
  type HttpVideoDialect,
} from "./http-video-dialect";
import {
  mapSd2TaskStatus,
  materializeSd2AssetRef,
} from "./sd2-platform-client";
import { formatVideoProviderErrorForUser } from "../user-facing-error";
import {
  appendVideoOutboundTxtLog,
  hashPromptForLog,
  sanitizeOutboundHeaders,
  summarizeResolvedMediaForLog,
} from "../outbound-log";

type HttpTask = {
  dialect: HttpVideoDialect;
  /** 上游任务 ID（方舟 / openai-videos）；legacy 用本地 id */
  upstreamTaskId: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  /** legacy-sync 后台拉取 */
  promise: Promise<void> | null;
  remoteUrl: string | null;
  resolution: string;
  aspectRatio: string | null;
  durationSeconds: number;
  providerResolution?: string;
  providerAspectRatio?: string;
  providerDurationSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
  /** 提交时缓存，供 openai-videos 轮询拼 URL */
  apiUrl: string;
  apiKey: string;
  modelId: string;
};

type HttpTasksGlobal = typeof globalThis & {
  __infiniteCanvasHttpVideoTasks?: Map<string, HttpTask>;
};

function getTasks(): Map<string, HttpTask> {
  const g = globalThis as HttpTasksGlobal;
  if (!g.__infiniteCanvasHttpVideoTasks) {
    g.__infiniteCanvasHttpVideoTasks = new Map();
  }
  return g.__infiniteCanvasHttpVideoTasks;
}

function providerResolutionEcho(resolution: string): string {
  const upper = resolution.toUpperCase();
  if (upper === "1080P" || upper === "1080") return "1080";
  if (upper === "480P" || upper === "480") return "480";
  return "720";
}

async function materializeVideoBuffer(buffer: Buffer): Promise<{
  absolutePath: string;
  fileUrl: string;
  remoteUrl?: string;
}> {
  if (isRemoteDataOnly()) {
    const remoteUrl = await storeRemoteProviderResult(buffer);
    return {
      absolutePath: remoteUrl,
      fileUrl: remoteUrl,
      remoteUrl,
    };
  }
  const dir = resolveAppDataPath("generated-videos");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const fileName = `${id}-http.mp4`;
  const absolutePath = path.join(dir, fileName);
  const tmp = `${absolutePath}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, absolutePath);
  return {
    absolutePath,
    fileUrl: `file://${absolutePath.replace(/\\/g, "/")}`,
  };
}

async function downloadVideoUrl(
  url: string,
  fetchImpl: FetchLike,
  apiKey?: string,
): Promise<Buffer> {
  const res = await fetchImpl(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`无法下载结果视频（${res.status}）`), {
      code: "HTTP_VIDEO_DOWNLOAD_FAILED",
    });
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength < 32) {
    throw Object.assign(new Error("下载的视频内容过短或为空"), {
      code: "HTTP_VIDEO_INVALID_RESPONSE",
    });
  }
  return buffer;
}

async function callLegacySyncApi(params: {
  endpoint: string;
  apiKey: string;
  input: ProviderGenerationInput;
  fetchImpl: FetchLike;
}): Promise<Buffer> {
  const { input } = params;
  const res = await params.fetchImpl(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      prompt: input.input.prompt,
      negativePrompt: input.input.negativePrompt,
      kind: "video-shot",
      mode: input.capability.mode,
      model: input.capability.modelId,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
      seed: input.input.seed,
      watermark: input.input.watermark,
      promptExtend: input.input.promptExtend,
      references: input.resolvedMedia,
      firstFrame: input.input.firstFrame
        ? input.resolvedMedia.find((m) => m.type === "first_frame")
        : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(
      new Error(
        `视频模型服务返回错误（${res.status}）：${text.slice(0, 200) || res.statusText}`,
      ),
      { code: "HTTP_VIDEO_PROVIDER_ERROR" },
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as {
      url?: string;
      base64?: string;
      mimeType?: string;
      error?: string;
    };
    if (json.error) {
      throw Object.assign(new Error(json.error), {
        code: "HTTP_VIDEO_PROVIDER_ERROR",
      });
    }
    if (json.base64) {
      return Buffer.from(json.base64, "base64");
    }
    if (json.url) {
      return downloadVideoUrl(json.url, params.fetchImpl);
    }
    throw Object.assign(new Error("模型服务响应缺少 base64 或 url 字段"), {
      code: "HTTP_VIDEO_INVALID_RESPONSE",
    });
  }

  return Buffer.from(await res.arrayBuffer());
}

function buildArkContent(input: ProviderGenerationInput): Array<
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string };
      role?: "first_frame" | "last_frame" | "reference_image";
    }
> {
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string };
        role?: "first_frame" | "last_frame" | "reference_image";
      }
  > = [{ type: "text", text: input.input.prompt }];

  for (const media of input.resolvedMedia) {
    if (media.type === "first_frame") {
      content.push({
        type: "image_url",
        image_url: { url: media.url },
        role: "first_frame",
      });
    } else if (media.type === "reference_image") {
      content.push({
        type: "image_url",
        image_url: { url: media.url },
        role: "reference_image",
      });
    }
  }
  return content;
}

export class HttpVideoProvider implements VideoProvider {
  readonly id = "http" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly dialect: HttpVideoDialect;
  private readonly fetchImpl: FetchLike;

  constructor(options: {
    config: VideoProviderRuntimeConfig;
    fetchImpl?: FetchLike;
  }) {
    this.apiUrl = normalizeHttpVideoBaseUrl(options.config.httpApiUrl ?? "");
    this.apiKey = (options.config.httpApiKey ?? "").trim();
    const configuredModel = (options.config.httpModelId ?? "").trim();
    this.dialect = detectHttpVideoDialect(this.apiUrl);
    this.modelId =
      (this.dialect === "ark"
        ? normalizeArkVideoModelId(configuredModel)
        : this.dialect === "sd2"
          ? normalizeSd2VideoModelId(configuredModel)
          : configuredModel) ||
      (this.dialect === "ark"
        ? DEFAULT_ARK_VIDEO_MODEL
        : this.dialect === "sd2"
          ? DEFAULT_SD2_VIDEO_MODEL
          : "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCapabilities() {
    return getHttpCapabilities({
      t2vModelId: this.modelId || "http-video-t2v",
      r2vModelId: this.modelId || "http-video-r2v",
    });
  }

  async submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    if (!this.apiUrl) {
      throw Object.assign(
        new Error("未配置视频镜头 API 地址，请管理员在「管理 API」中填写"),
        { code: "MISSING_HTTP_VIDEO_ENDPOINT" },
      );
    }

    if (this.dialect === "ark") {
      return this.submitArk(input);
    }
    if (this.dialect === "sd2") {
      return this.submitSd2(input);
    }
    if (this.dialect === "openai-videos") {
      return this.submitOpenAiVideos(input);
    }
    return this.submitLegacySync(input);
  }

  /**
   * 移动 SD2 平台：普通素材 /api/assets/upload；
   * 真人素材 /api/real-person-assets/upload + 轮询 active；
   * 创建 /v1/video/generations，content 使用 asset://。
   */
  private async submitSd2(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    if (!this.apiKey) {
      throw Object.assign(
        new Error("未配置视频镜头 API Key，请管理员在「管理 API」中填写"),
        { code: "MISSING_HTTP_VIDEO_API_KEY" },
      );
    }
    const model =
      this.modelId ||
      normalizeSd2VideoModelId(input.capability.modelId) ||
      DEFAULT_SD2_VIDEO_MODEL;
    const duration = clampArkVideoDurationSeconds(
      input.input.durationSeconds,
      model,
    );

    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: { url: string };
          role?: "first_frame" | "reference_image";
        }
      | { type: "video_url"; video_url: { url: string } }
    > = [{ type: "text", text: input.input.prompt }];

    const mediaMeta = summarizeResolvedMediaForLog(input.resolvedMedia);
    const mediaSummaryWithRefs = [...mediaMeta.mediaSummary];

    for (let i = 0; i < input.resolvedMedia.length; i += 1) {
      const media = input.resolvedMedia[i]!;
      const realPerson =
        media.realPersonCandidate === true ||
        (media.type !== "reference_video" && media.kind === "character");
      const uploadUrl = realPerson
        ? buildSd2RealPersonAssetUploadUrl(this.apiUrl)
        : buildSd2NormalAssetUploadUrl(this.apiUrl);
      const uploadHeaders = sanitizeOutboundHeaders({
        Authorization: `Bearer ${this.apiKey}`,
      });
      const uploadRequestBody = {
        multipart: true,
        fields: {
          file: {
            sourceUrlKind: media.url.startsWith("data:")
              ? "data-url"
              : media.url.startsWith("asset://")
                ? "asset-ref"
                : media.url.startsWith("https://")
                  ? "https"
                  : "other",
            label: media.label,
            realPerson,
          },
        },
      };
      try {
        const assetRef = await materializeSd2AssetRef({
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          sourceUrl: media.url,
          realPerson,
          label: media.label,
          fetchImpl: this.fetchImpl,
        });
        mediaSummaryWithRefs[i] = {
          ...mediaSummaryWithRefs[i]!,
          assetRef,
        };
        void appendVideoOutboundTxtLog({
          event: "sd2.asset.upload",
          dialect: "sd2",
          generationId: input.generationId,
          clientIdempotencyKey: input.clientIdempotencyKey,
          projectId: input.input.projectId,
          shotId: input.input.shotId,
          method: "POST",
          url: uploadUrl,
          requestHeaders: uploadHeaders,
          requestBody: uploadRequestBody,
          responseBody: JSON.stringify({ assetRef }),
          mediaFingerprint: mediaMeta.mediaFingerprint,
          mediaAssetIds: [media.assetId],
          mediaSummary: [
            {
              assetId: media.assetId,
              label: media.label,
              kind: media.kind,
              realPerson,
              assetRef,
            },
          ],
          ok: true,
          note: realPerson
            ? "real-person upload + cert active"
            : "normal asset upload",
        });
        if (media.type === "reference_video") {
          content.push({
            type: "video_url",
            video_url: { url: assetRef },
          });
        } else if (media.type === "first_frame") {
          content.push({
            type: "image_url",
            image_url: { url: assetRef },
            role: "first_frame",
          });
        } else {
          content.push({
            type: "image_url",
            image_url: { url: assetRef },
            role: "reference_image",
          });
        }
      } catch (uploadErr) {
        const message =
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        const code =
          uploadErr &&
          typeof uploadErr === "object" &&
          "code" in uploadErr &&
          typeof (uploadErr as { code?: unknown }).code === "string"
            ? (uploadErr as { code: string }).code
            : "SD2_ASSET_UPLOAD_FAILED";
        void appendVideoOutboundTxtLog({
          event: realPerson ? "sd2.asset.cert" : "sd2.asset.upload",
          dialect: "sd2",
          generationId: input.generationId,
          clientIdempotencyKey: input.clientIdempotencyKey,
          projectId: input.input.projectId,
          shotId: input.input.shotId,
          method: "POST",
          url: uploadUrl,
          requestHeaders: uploadHeaders,
          requestBody: uploadRequestBody,
          mediaFingerprint: mediaMeta.mediaFingerprint,
          mediaAssetIds: [media.assetId],
          mediaSummary: [
            {
              assetId: media.assetId,
              label: media.label,
              kind: media.kind,
              realPerson,
            },
          ],
          ok: false,
          errorCode: code,
          errorMessage: message,
        });
        throw uploadErr;
      }
    }

    const body = {
      model,
      content,
      resolution: toArkResolution(input.input.resolution),
      duration,
      ...(typeof input.input.seed === "number" ? { seed: input.input.seed } : {}),
    };

    const createUrl = buildSd2CreateUrl(this.apiUrl);
    const createHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "Idempotency-Key": input.generationId,
    };
    void appendVideoOutboundTxtLog({
      event: "video.create.request",
      dialect: "sd2",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      mediaSummary: mediaSummaryWithRefs,
      promptChars: input.input.prompt.length,
      promptSha256: hashPromptForLog(input.input.prompt),
      durationSeconds: duration,
      resolution: body.resolution,
      note: "实际上送 JSON 见 requestBody；同 mediaFingerprint 可对账反复抽卡",
    });

    const res = await this.fetchImpl(createUrl, {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let json: {
      id?: string;
      error?: { message?: string } | string;
      message?: string;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "sd2",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        mediaAssetIds: mediaMeta.mediaAssetIds,
        ok: false,
        errorCode: "HTTP_VIDEO_INVALID_RESPONSE",
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(
          `SD2 创建任务响应无效（${res.status}）：${rawText.slice(0, 200)}`,
        ),
        { code: "HTTP_VIDEO_INVALID_RESPONSE" },
      );
    }

    if (!res.ok || !json.id) {
      const errMsg =
        (typeof json.error === "object" ? json.error?.message : json.error) ||
        json.message ||
        rawText.slice(0, 200) ||
        res.statusText;
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "sd2",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        mediaAssetIds: mediaMeta.mediaAssetIds,
        mediaSummary: mediaSummaryWithRefs,
        ok: false,
        errorCode: "HTTP_VIDEO_PROVIDER_ERROR",
        errorMessage: String(errMsg),
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(
          formatVideoProviderErrorForUser(
            `SD2 创建任务失败（${res.status}）：${errMsg}`,
          ),
        ),
        { code: "HTTP_VIDEO_PROVIDER_ERROR" },
      );
    }

    void appendVideoOutboundTxtLog({
      event: "video.create.response",
      dialect: "sd2",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      httpStatus: res.status,
      upstreamTaskId: json.id,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      mediaSummary: mediaSummaryWithRefs,
      responseBody: rawText,
      ok: true,
    });

    const localId = `http-sd2-${json.id}`;
    getTasks().set(localId, {
      dialect: "sd2",
      upstreamTaskId: json.id,
      status: "queued",
      promise: null,
      remoteUrl: null,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
      providerResolution: providerResolutionEcho(input.input.resolution),
      providerAspectRatio: input.input.aspectRatio ?? undefined,
      providerDurationSeconds: duration,
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      modelId: model,
    });

    return {
      providerTaskId: localId,
      status: "queued",
      progressLabel: "SD2 · 已提交",
    };
  }

  private async submitArk(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    if (!this.apiKey) {
      throw Object.assign(
        new Error("未配置视频镜头 API Key，请管理员在「管理 API」中填写"),
        { code: "MISSING_HTTP_VIDEO_API_KEY" },
      );
    }
    const model = this.modelId || DEFAULT_ARK_VIDEO_MODEL;
    const duration = clampArkVideoDurationSeconds(
      input.input.durationSeconds,
      model,
    );
    const mediaMeta = summarizeResolvedMediaForLog(input.resolvedMedia);
    const body = {
      model,
      content: buildArkContent(input),
      resolution: toArkResolution(input.input.resolution),
      ratio: input.input.aspectRatio ?? "16:9",
      duration,
      watermark: input.input.watermark,
      ...(typeof input.input.seed === "number" ? { seed: input.input.seed } : {}),
    };

    const createUrl = buildArkCreateUrl(this.apiUrl);
    const createHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "Idempotency-Key": input.generationId,
    };
    void appendVideoOutboundTxtLog({
      event: "video.create.request",
      dialect: "ark",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      mediaSummary: mediaMeta.mediaSummary,
      promptChars: input.input.prompt.length,
      promptSha256: hashPromptForLog(input.input.prompt),
      durationSeconds: duration,
      resolution: body.resolution,
      note: "实际上送 JSON 见 requestBody；同 mediaFingerprint 可对账反复抽卡",
    });

    const res = await this.fetchImpl(createUrl, {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let json: {
      id?: string;
      error?: { message?: string } | string;
      message?: string;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "ark",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        mediaAssetIds: mediaMeta.mediaAssetIds,
        ok: false,
        errorCode: "HTTP_VIDEO_INVALID_RESPONSE",
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(
          `方舟创建任务响应无效（${res.status}）：${rawText.slice(0, 200)}`,
        ),
        { code: "HTTP_VIDEO_INVALID_RESPONSE" },
      );
    }

    if (!res.ok || !json.id) {
      const errMsg =
        (typeof json.error === "object" ? json.error?.message : json.error) ||
        json.message ||
        rawText.slice(0, 200) ||
        res.statusText;
      const hint =
        res.status === 404 ||
        /does not exist|do not have access|不存在|无权/i.test(String(errMsg))
          ? "。请到火山方舟控制台复制可用的模型 ID 或推理接入点 ID（ep-xxxx），填入「管理 API → 视频镜头 → 模型」后保存"
          : /duration.*not valid|duration.*invalid/i.test(String(errMsg))
            ? "。Seedance 参考生视频时长需为 4–15 秒；分镜若不足 4 秒会自动上调后重试"
            : /image_url.*not valid|image_url.*invalid/i.test(String(errMsg))
              ? "。参考图未能被方舟读取；请确认镜头已绑定可用人物/场景图片后重试"
              : /real person|真实人物|真人/i.test(String(errMsg))
                ? "。方舟拒绝疑似真人照片的参考图。请改用更偏插画/设定图风格的人物图，或暂时去掉人物参考后仅用场景/文生视频重试"
                : "";
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "ark",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        mediaAssetIds: mediaMeta.mediaAssetIds,
        mediaSummary: mediaMeta.mediaSummary,
        ok: false,
        errorCode: "HTTP_VIDEO_PROVIDER_ERROR",
        errorMessage: String(errMsg),
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(
          formatVideoProviderErrorForUser(
            `方舟创建任务失败（${res.status}）：${errMsg}${hint}`,
          ),
        ),
        { code: "HTTP_VIDEO_PROVIDER_ERROR" },
      );
    }

    void appendVideoOutboundTxtLog({
      event: "video.create.response",
      dialect: "ark",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      httpStatus: res.status,
      upstreamTaskId: json.id,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      mediaSummary: mediaMeta.mediaSummary,
      responseBody: rawText,
      ok: true,
    });

    const localId = `http-ark-${json.id}`;
    getTasks().set(localId, {
      dialect: "ark",
      upstreamTaskId: json.id,
      status: "queued",
      promise: null,
      remoteUrl: null,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
      providerResolution: providerResolutionEcho(input.input.resolution),
      providerAspectRatio: input.input.aspectRatio ?? undefined,
      providerDurationSeconds: input.input.durationSeconds,
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      modelId: this.modelId,
    });

    return {
      providerTaskId: localId,
      status: "queued",
      progressLabel: "方舟 · 已提交",
    };
  }

  private async submitOpenAiVideos(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    if (!this.apiKey) {
      throw Object.assign(
        new Error("未配置视频镜头 API Key，请管理员在「管理 API」中填写"),
        { code: "MISSING_HTTP_VIDEO_API_KEY" },
      );
    }
    const model = this.modelId || input.capability.modelId;
    const createUrl = normalizeHttpVideoBaseUrl(this.apiUrl);
    const mediaMeta = summarizeResolvedMediaForLog(input.resolvedMedia);
    const body = {
      model,
      prompt: input.input.prompt,
      seconds: String(input.input.durationSeconds),
      aspect_ratio: input.input.aspectRatio ?? "16:9",
      resolution: input.input.resolution,
    };
    const createHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "Idempotency-Key": input.generationId,
    };
    void appendVideoOutboundTxtLog({
      event: "video.create.request",
      dialect: "openai-videos",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      mediaSummary: mediaMeta.mediaSummary,
      promptChars: input.input.prompt.length,
      promptSha256: hashPromptForLog(input.input.prompt),
      durationSeconds: input.input.durationSeconds,
      resolution: input.input.resolution,
      note: "实际上送 JSON 见 requestBody",
    });
    const res = await this.fetchImpl(createUrl, {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    let json: {
      id?: string;
      task_id?: string;
      status?: string;
      error?: { message?: string } | string;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "openai-videos",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        ok: false,
        errorCode: "HTTP_VIDEO_INVALID_RESPONSE",
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(`视频任务响应无效（${res.status}）：${rawText.slice(0, 200)}`),
        { code: "HTTP_VIDEO_INVALID_RESPONSE" },
      );
    }
    const taskId = json.id || json.task_id;
    if (!res.ok || !taskId) {
      const errMsg =
        (typeof json.error === "object" ? json.error?.message : json.error) ||
        rawText.slice(0, 200) ||
        res.statusText;
      void appendVideoOutboundTxtLog({
        event: "video.create.error",
        dialect: "openai-videos",
        generationId: input.generationId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        upstreamIdempotencyKey: input.generationId,
        projectId: input.input.projectId,
        shotId: input.input.shotId,
        model,
        method: "POST",
        url: createUrl,
        requestHeaders: sanitizeOutboundHeaders(createHeaders),
        requestBody: body,
        httpStatus: res.status,
        mediaFingerprint: mediaMeta.mediaFingerprint,
        ok: false,
        errorCode: "HTTP_VIDEO_PROVIDER_ERROR",
        errorMessage: String(errMsg),
        responseBody: rawText,
      });
      throw Object.assign(
        new Error(`创建视频任务失败（${res.status}）：${errMsg}`),
        { code: "HTTP_VIDEO_PROVIDER_ERROR" },
      );
    }

    void appendVideoOutboundTxtLog({
      event: "video.create.response",
      dialect: "openai-videos",
      generationId: input.generationId,
      clientIdempotencyKey: input.clientIdempotencyKey,
      upstreamIdempotencyKey: input.generationId,
      projectId: input.input.projectId,
      shotId: input.input.shotId,
      model,
      method: "POST",
      url: createUrl,
      requestHeaders: sanitizeOutboundHeaders(createHeaders),
      requestBody: body,
      httpStatus: res.status,
      upstreamTaskId: taskId,
      mediaFingerprint: mediaMeta.mediaFingerprint,
      mediaAssetIds: mediaMeta.mediaAssetIds,
      responseBody: rawText,
      ok: true,
    });

    const localId = `http-oai-${taskId}`;
    getTasks().set(localId, {
      dialect: "openai-videos",
      upstreamTaskId: taskId,
      status: "queued",
      promise: null,
      remoteUrl: null,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
      providerResolution: providerResolutionEcho(input.input.resolution),
      providerAspectRatio: input.input.aspectRatio ?? undefined,
      providerDurationSeconds: input.input.durationSeconds,
      apiUrl: createUrl,
      apiKey: this.apiKey,
      modelId: model,
    });

    return {
      providerTaskId: localId,
      status: "queued",
      progressLabel: "HTTP · 已提交",
    };
  }

  private async submitLegacySync(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    const taskId = `http-${randomUUID()}`;
    const task: HttpTask = {
      dialect: "legacy-sync",
      upstreamTaskId: null,
      status: "queued",
      promise: null,
      remoteUrl: null,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
      providerResolution: providerResolutionEcho(input.input.resolution),
      providerAspectRatio: input.input.aspectRatio ?? undefined,
      providerDurationSeconds: input.input.durationSeconds,
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      modelId: this.modelId,
    };
    getTasks().set(taskId, task);

    task.promise = (async () => {
      task.status = "processing";
      try {
        const buffer = await callLegacySyncApi({
          endpoint: this.apiUrl,
          apiKey: this.apiKey,
          input,
          fetchImpl: this.fetchImpl,
        });
        const written = await materializeVideoBuffer(buffer);
        task.remoteUrl = written.remoteUrl ?? written.fileUrl;
        task.status = "completed";
      } catch (error) {
        task.status = "failed";
        task.errorCode =
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "HTTP_VIDEO_PROVIDER_ERROR";
        task.errorMessage =
          error instanceof Error ? error.message : "HTTP 视频生成失败";
      }
    })();

    return {
      providerTaskId: taskId,
      status: "queued",
      progressLabel: "HTTP · 已提交",
    };
  }

  async getGenerationStatus(
    providerTaskId: string,
  ): Promise<ProviderStatusResult> {
    let task = getTasks().get(providerTaskId);
    // 进程/HMR 丢内存后，仍可凭 http-ark-{upstreamId} 继续向方舟轮询
    if (!task && providerTaskId.startsWith("http-ark-")) {
      const upstreamTaskId = providerTaskId.slice("http-ark-".length);
      if (upstreamTaskId && this.apiUrl && this.apiKey) {
        task = {
          dialect: "ark",
          upstreamTaskId,
          status: "processing",
          promise: null,
          remoteUrl: null,
          resolution: "720P",
          aspectRatio: null,
          durationSeconds: 5,
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          modelId: this.modelId,
        };
        getTasks().set(providerTaskId, task);
      }
    }
    if (!task && providerTaskId.startsWith("http-oai-")) {
      const upstreamTaskId = providerTaskId.slice("http-oai-".length);
      if (upstreamTaskId && this.apiUrl && this.apiKey) {
        task = {
          dialect: "openai-videos",
          upstreamTaskId,
          status: "processing",
          promise: null,
          remoteUrl: null,
          resolution: "720P",
          aspectRatio: null,
          durationSeconds: 5,
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          modelId: this.modelId,
        };
        getTasks().set(providerTaskId, task);
      }
    }
    if (!task && providerTaskId.startsWith("http-sd2-")) {
      const upstreamTaskId = providerTaskId.slice("http-sd2-".length);
      if (upstreamTaskId && this.apiUrl && this.apiKey) {
        task = {
          dialect: "sd2",
          upstreamTaskId,
          status: "processing",
          promise: null,
          remoteUrl: null,
          resolution: "720P",
          aspectRatio: null,
          durationSeconds: 5,
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          modelId: this.modelId,
        };
        getTasks().set(providerTaskId, task);
      }
    }
    if (!task) {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "HTTP · 任务不存在",
        errorCode: "HTTP_VIDEO_TASK_NOT_FOUND",
        errorMessage: "HTTP 视频任务不存在或已过期",
        rawTaskStatus: "FAILED",
      };
    }

    if (task.dialect === "ark" && task.upstreamTaskId) {
      return this.pollArk(providerTaskId, task);
    }
    if (task.dialect === "sd2" && task.upstreamTaskId) {
      return this.pollSd2(providerTaskId, task);
    }
    if (task.dialect === "openai-videos" && task.upstreamTaskId) {
      return this.pollOpenAiVideos(providerTaskId, task);
    }

    if (task.promise) {
      await task.promise.catch(() => undefined);
    }
    return this.statusFromTask(providerTaskId, task);
  }

  private async pollSd2(
    providerTaskId: string,
    task: HttpTask,
  ): Promise<ProviderStatusResult> {
    if (task.status === "completed" && task.remoteUrl) {
      return this.statusFromTask(providerTaskId, task);
    }
    if (task.status === "failed" || task.status === "cancelled") {
      return this.statusFromTask(providerTaskId, task);
    }

    const statusUrl = buildSd2StatusUrl(task.apiUrl, task.upstreamTaskId!);
    const res = await this.fetchImpl(statusUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${task.apiKey}` },
    });
    const rawText = await res.text();
    let json: {
      status?: string;
      code?: string;
      data?: {
        status?: string;
        result_url?: string;
        fail_reason?: string;
        progress?: string | number;
      };
      error?: { message?: string } | string;
      message?: string;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_INVALID_RESPONSE";
      task.errorMessage = `SD2 任务查询响应无效：${rawText.slice(0, 200)}`;
      return this.statusFromTask(providerTaskId, task);
    }

    const rawStatus = json.data?.status || json.status;
    const mapped = mapSd2TaskStatus(rawStatus);

    if (mapped === "completed") {
      const videoUrl =
        json.data?.result_url ||
        buildSd2ContentUrl(task.apiUrl, task.upstreamTaskId!);
      try {
        const buffer = await downloadVideoUrl(
          videoUrl,
          this.fetchImpl,
          task.apiKey,
        );
        const written = await materializeVideoBuffer(buffer);
        task.remoteUrl = written.remoteUrl ?? written.fileUrl;
        task.status = "completed";
      } catch (error) {
        task.status = "failed";
        task.errorCode =
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "HTTP_VIDEO_DOWNLOAD_FAILED";
        task.errorMessage =
          error instanceof Error ? error.message : "下载 SD2 视频失败";
      }
      return this.statusFromTask(providerTaskId, task);
    }

    if (mapped === "failed") {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_PROVIDER_ERROR";
      task.errorMessage = formatVideoProviderErrorForUser(
        json.data?.fail_reason ||
          (typeof json.error === "object" ? json.error?.message : json.error) ||
          json.message ||
          "SD2 视频生成失败",
      );
      return this.statusFromTask(providerTaskId, task);
    }

    if (mapped === "cancelled") {
      task.status = "cancelled";
      return this.statusFromTask(providerTaskId, task);
    }

    task.status = mapped === "processing" ? "processing" : "queued";
    return this.statusFromTask(providerTaskId, task);
  }

  private async pollArk(
    providerTaskId: string,
    task: HttpTask,
  ): Promise<ProviderStatusResult> {
    if (task.status === "completed" && task.remoteUrl) {
      return this.statusFromTask(providerTaskId, task);
    }
    if (task.status === "failed" || task.status === "cancelled") {
      return this.statusFromTask(providerTaskId, task);
    }

    const statusUrl = buildArkStatusUrl(task.apiUrl, task.upstreamTaskId!);
    const res = await this.fetchImpl(statusUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${task.apiKey}` },
    });
    const rawText = await res.text();
    let json: {
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string } | string;
      size?: string;
      resolution?: string;
      ratio?: string;
      duration?: number;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_INVALID_RESPONSE";
      task.errorMessage = `方舟任务查询响应无效：${rawText.slice(0, 200)}`;
      return this.statusFromTask(providerTaskId, task);
    }

    const st = (json.status ?? "").toLowerCase();
    if (st === "succeeded" || st === "success") {
      const videoUrl = json.content?.video_url;
      if (!videoUrl) {
        task.status = "failed";
        task.errorCode = "HTTP_VIDEO_INVALID_RESPONSE";
        task.errorMessage = "方舟任务成功但未返回 video_url";
        return this.statusFromTask(providerTaskId, task);
      }
      try {
        const buffer = await downloadVideoUrl(videoUrl, this.fetchImpl);
        const written = await materializeVideoBuffer(buffer);
        task.remoteUrl = written.remoteUrl ?? written.fileUrl;
        task.status = "completed";
        const fromSize = mapArkSizeToProviderResolution(json.size);
        if (fromSize) task.providerResolution = fromSize;
        else if (json.resolution) {
          task.providerResolution = providerResolutionEcho(json.resolution);
        }
        if (json.ratio) task.providerAspectRatio = json.ratio;
        if (typeof json.duration === "number") {
          task.providerDurationSeconds = json.duration;
        }
      } catch (error) {
        task.status = "failed";
        task.errorCode =
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "HTTP_VIDEO_DOWNLOAD_FAILED";
        task.errorMessage =
          error instanceof Error ? error.message : "下载方舟视频失败";
      }
      return this.statusFromTask(providerTaskId, task);
    }

    if (st === "failed") {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_PROVIDER_ERROR";
      const rawFail =
        (typeof json.error === "object" ? json.error?.message : json.error) ||
        "方舟视频生成失败";
      task.errorMessage = formatVideoProviderErrorForUser(String(rawFail));
      return this.statusFromTask(providerTaskId, task);
    }

    if (st === "cancelled" || st === "canceled") {
      task.status = "cancelled";
      return this.statusFromTask(providerTaskId, task);
    }

    task.status =
      st === "running" || st === "processing" ? "processing" : "queued";
    return {
      providerTaskId,
      status: task.status === "processing" ? "processing" : "queued",
      progressLabel:
        task.status === "processing" ? "方舟 · 正在生成" : "方舟 · 排队中",
      rawTaskStatus: json.status,
    };
  }

  private async pollOpenAiVideos(
    providerTaskId: string,
    task: HttpTask,
  ): Promise<ProviderStatusResult> {
    if (task.status === "completed" && task.remoteUrl) {
      return this.statusFromTask(providerTaskId, task);
    }
    if (task.status === "failed" || task.status === "cancelled") {
      return this.statusFromTask(providerTaskId, task);
    }

    const base = task.apiUrl.replace(/\/$/, "");
    const statusUrl = `${base}/${encodeURIComponent(task.upstreamTaskId!)}`;
    const res = await this.fetchImpl(statusUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${task.apiKey}` },
    });
    const rawText = await res.text();
    let json: {
      status?: string;
      url?: string;
      video_url?: string;
      error?: { message?: string } | string;
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_INVALID_RESPONSE";
      task.errorMessage = `任务查询响应无效：${rawText.slice(0, 200)}`;
      return this.statusFromTask(providerTaskId, task);
    }

    const st = (json.status ?? "").toLowerCase();
    if (st === "completed" || st === "succeeded") {
      const videoUrl = json.url || json.video_url;
      const contentUrl = `${base}/${encodeURIComponent(task.upstreamTaskId!)}/content`;
      try {
        const buffer = videoUrl
          ? await downloadVideoUrl(videoUrl, this.fetchImpl, task.apiKey)
          : await downloadVideoUrl(contentUrl, this.fetchImpl, task.apiKey);
        const written = await materializeVideoBuffer(buffer);
        task.remoteUrl = written.remoteUrl ?? written.fileUrl;
        task.status = "completed";
      } catch (error) {
        task.status = "failed";
        task.errorCode = "HTTP_VIDEO_DOWNLOAD_FAILED";
        task.errorMessage =
          error instanceof Error ? error.message : "下载视频失败";
      }
      return this.statusFromTask(providerTaskId, task);
    }

    if (st === "failed") {
      task.status = "failed";
      task.errorCode = "HTTP_VIDEO_PROVIDER_ERROR";
      const rawFail =
        (typeof json.error === "object" ? json.error?.message : json.error) ||
        "视频生成失败";
      task.errorMessage = formatVideoProviderErrorForUser(String(rawFail));
      return this.statusFromTask(providerTaskId, task);
    }

    task.status =
      st === "processing" || st === "running" ? "processing" : "queued";
    return {
      providerTaskId,
      status: task.status === "processing" ? "processing" : "queued",
      progressLabel:
        task.status === "processing" ? "HTTP · 正在生成" : "HTTP · 排队中",
      rawTaskStatus: json.status,
    };
  }

  private statusFromTask(
    providerTaskId: string,
    task: HttpTask,
  ): ProviderStatusResult {
    if (task.status === "cancelled") {
      return {
        providerTaskId,
        status: "cancelled",
        progressLabel: "HTTP · 已取消",
        rawTaskStatus: "CANCELED",
      };
    }
    if (task.status === "failed") {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "HTTP · 失败",
        errorCode: task.errorCode ?? "HTTP_VIDEO_PROVIDER_ERROR",
        errorMessage: task.errorMessage ?? "HTTP 视频生成失败",
        rawTaskStatus: "FAILED",
      };
    }
    if (task.status === "completed" && task.remoteUrl) {
      return {
        providerTaskId,
        status: "downloading",
        progressLabel: "HTTP · 准备转存",
        remoteVideoUrl: task.remoteUrl,
        providerResolution:
          task.providerResolution ?? providerResolutionEcho(task.resolution),
        providerAspectRatio:
          task.providerAspectRatio ?? task.aspectRatio ?? undefined,
        providerDurationSeconds:
          task.providerDurationSeconds ?? task.durationSeconds,
        rawTaskStatus: "SUCCEEDED",
      };
    }
    return {
      providerTaskId,
      status: "processing",
      progressLabel: "HTTP · 正在生成",
      rawTaskStatus: "RUNNING",
    };
  }

  async cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult> {
    const task = getTasks().get(providerTaskId);
    if (!task) {
      return { cancelled: false, message: "HTTP 任务不存在" };
    }
    if (task.status !== "queued") {
      return {
        cancelled: false,
        message: "仅排队中的任务可以取消",
      };
    }
    task.status = "cancelled";
    return { cancelled: true, message: "HTTP 任务已取消" };
  }
}

/** 测试辅助 */
export function resetHttpVideoProviderTasks(): void {
  getTasks().clear();
}
