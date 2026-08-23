import {
  normalizeDeclaredImageMime,
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  sniffProjectAssetImageMime,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import type {
  EpisodeAssetDesignItem,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  parseDesignImageGenerationOptions,
  type DesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";
import {
  isDesignImageModelId,
  type DesignImageModelId,
} from "@/projects/assets/episode-design/image-generation-models";
import {
  isDesignMultiAngleMode,
  type DesignMultiAngleMode,
} from "@/projects/assets/episode-design/multi-angle-prompts";
import { parseIdempotencyKey } from "@/credits/generation-billing";

export const GENERATE_ASSET_REFERENCE_SLOT_COUNT = 6;

export type GenerateAssetMode = "text_to_image" | "image_to_image";

export type ParsedGenerateAssetReferenceImage = {
  buffer: Buffer;
  mimeType: ProjectAssetImageMime;
  fileName: string;
};

export type ParsedGenerateAssetReferenceSlot =
  | {
      kind: "media";
      index: number;
      mediaId: string;
    }
  | {
      kind: "upload";
      index: number;
      image: ParsedGenerateAssetReferenceImage;
    }
  | {
      kind: "personal-material";
      index: number;
      personalMaterialId: string;
    }
  | {
      kind: "system-material";
      index: number;
      materialId: string;
    };

export type ParsedGenerateAssetRequest = {
  mode: GenerateAssetMode;
  prompt: string;
  idempotencyKey: string;
  options: DesignImageGenerationOptions;
  /** Client-selected model; undefined keeps admin capability config.model. */
  model: DesignImageModelId | undefined;
  /** Scene-only multi-angle edit; templates are applied server-side. */
  multiAngleMode: DesignMultiAngleMode | undefined;
  /** Ordered reference slots for image_to_image (0-based UI indices; empty holes skipped). */
  referenceSlots: ParsedGenerateAssetReferenceSlot[];
};

export type ParseGenerateAssetRequestError = {
  error: string;
  code?: string;
  status: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseRequestedModel(
  raw: unknown,
):
  | { ok: true; value: DesignImageModelId | undefined }
  | { ok: false; error: ParseGenerateAssetRequestError } {
  if (raw == null || raw === "") {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: {
        error: "不支持的图片模型",
        code: "INVALID_IMAGE_MODEL",
        status: 400,
      },
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!isDesignImageModelId(trimmed)) {
    return {
      ok: false,
      error: {
        error: "不支持的图片模型",
        code: "INVALID_IMAGE_MODEL",
        status: 400,
      },
    };
  }
  return { ok: true, value: trimmed };
}

function rejectsClientStyleOverride(
  raw: Record<string, unknown> | null,
): ParseGenerateAssetRequestError | null {
  if (
    raw &&
    ("stylePrompt" in raw ||
      "visualStyle" in raw ||
      "promptDirective" in raw)
  ) {
    return {
      error: "不允许客户端覆盖项目视觉风格",
      status: 400,
    };
  }
  return null;
}

function rejectsClientMultiAngleTemplateOverride(
  raw: Record<string, unknown> | null,
  form?: FormData,
): ParseGenerateAssetRequestError | null {
  const forbiddenKeys = [
    "multiAngleTemplate",
    "multiAnglePrompt",
    "angleTemplate",
    "anglePrompt",
  ];
  if (raw) {
    for (const key of forbiddenKeys) {
      if (key in raw) {
        return {
          error: "不允许客户端覆盖多角度模板",
          code: "MULTI_ANGLE_TEMPLATE_FORBIDDEN",
          status: 400,
        };
      }
    }
  }
  if (form) {
    for (const key of forbiddenKeys) {
      if (form.has(key)) {
        return {
          error: "不允许客户端覆盖多角度模板",
          code: "MULTI_ANGLE_TEMPLATE_FORBIDDEN",
          status: 400,
        };
      }
    }
  }
  return null;
}

function parseRequestedMultiAngleMode(
  raw: unknown,
):
  | { ok: true; value: DesignMultiAngleMode | undefined }
  | { ok: false; error: ParseGenerateAssetRequestError } {
  if (raw == null || raw === "") {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: {
        error: "不支持的多角度模式",
        code: "INVALID_MULTI_ANGLE_MODE",
        status: 400,
      },
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!isDesignMultiAngleMode(trimmed)) {
    return {
      ok: false,
      error: {
        error: "不支持的多角度模式",
        code: "INVALID_MULTI_ANGLE_MODE",
        status: 400,
      },
    };
  }
  return { ok: true, value: trimmed };
}

function parseOptionsFromRaw(
  raw: Record<string, unknown> | null,
): DesignImageGenerationOptions | null {
  if (!raw) return DEFAULT_DESIGN_IMAGE_OPTIONS;
  const normalized: Record<string, unknown> = { ...raw };
  if (typeof normalized.count === "string" && normalized.count.trim()) {
    const n = Number(normalized.count);
    if (Number.isFinite(n)) normalized.count = n;
  }
  const hasOptionFields =
    "quality" in normalized ||
    "aspectRatio" in normalized ||
    "count" in normalized;
  if (!hasOptionFields) return DEFAULT_DESIGN_IMAGE_OPTIONS;
  return parseDesignImageGenerationOptions(normalized);
}

async function parseUploadedReferenceImage(
  file: File,
): Promise<
  | { ok: true; value: ParsedGenerateAssetReferenceImage }
  | { ok: false; error: ParseGenerateAssetRequestError }
> {
  if (file.size > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        error: "参考图片不能超过 10MB",
        code: "REFERENCE_IMAGE_TOO_LARGE",
        status: 400,
      },
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        error: "参考图片不能超过 10MB",
        code: "REFERENCE_IMAGE_TOO_LARGE",
        status: 400,
      },
    };
  }
  const sniffed = sniffProjectAssetImageMime(buffer);
  if (!sniffed) {
    return {
      ok: false,
      error: {
        error: "参考图片须为 PNG / JPEG / WEBP",
        code: "INVALID_REFERENCE_IMAGE",
        status: 400,
      },
    };
  }
  const declared = normalizeDeclaredImageMime(file.type || null);
  if (declared && declared !== sniffed) {
    return {
      ok: false,
      error: {
        error: "文件类型与内容不一致",
        code: "REFERENCE_IMAGE_MIME_MISMATCH",
        status: 400,
      },
    };
  }
  const fileName =
    typeof file.name === "string" && file.name.trim()
      ? file.name.trim().slice(0, 180)
      : `reference.${sniffed === "image/jpeg" ? "jpg" : sniffed === "image/webp" ? "webp" : "png"}`;
  return {
    ok: true,
    value: {
      buffer,
      mimeType: sniffed,
      fileName,
    },
  };
}

/**
 * Whether mediaId belongs to this design item's generated media set.
 * Does not authorize reading arbitrary project images.
 */
export function isEpisodeDesignGeneratedMediaId(
  generatedMedia: GeneratedMediaState | null | undefined,
  mediaId: string,
): boolean {
  const id = mediaId.trim();
  if (!id || !generatedMedia) return false;
  if (generatedMedia.currentId === id) return true;
  if ((generatedMedia.historyIds ?? []).includes(id)) return true;
  if ((generatedMedia.history ?? []).some((entry) => entry.mediaId === id)) {
    return true;
  }
  return false;
}

export function isItemGeneratedMediaId(
  item: EpisodeAssetDesignItem,
  mediaId: string,
): boolean {
  return isEpisodeDesignGeneratedMediaId(item.generatedMedia, mediaId);
}

async function parseIndexedReferenceSlots(
  form: FormData,
): Promise<
  | { ok: true; value: ParsedGenerateAssetReferenceSlot[] }
  | { ok: false; error: ParseGenerateAssetRequestError }
> {
  const slots: Array<ParsedGenerateAssetReferenceSlot | null> = Array.from(
    { length: GENERATE_ASSET_REFERENCE_SLOT_COUNT },
    () => null,
  );

  const sourcesRaw = readFormString(form, "referenceSources");
  if (sourcesRaw) {
    let sources: unknown;
    try {
      sources = JSON.parse(sourcesRaw);
    } catch {
      return {
        ok: false,
        error: {
          error: "参考图来源参数无效",
          code: "INVALID_REFERENCE_SOURCES",
          status: 400,
        },
      };
    }
    if (!Array.isArray(sources)) {
      return {
        ok: false,
        error: {
          error: "参考图来源参数无效",
          code: "INVALID_REFERENCE_SOURCES",
          status: 400,
        },
      };
    }
    for (const item of sources) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const index =
        typeof rec.slot === "number" ? rec.slot : Number(rec.slot);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= GENERATE_ASSET_REFERENCE_SLOT_COUNT
      ) {
        return {
          ok: false,
          error: {
            error: `参考图最多 ${GENERATE_ASSET_REFERENCE_SLOT_COUNT} 张`,
            code: "TOO_MANY_REFERENCE_IMAGES",
            status: 400,
          },
        };
      }
      const sourceType = rec.sourceType;
      if (sourceType === "personal-material") {
        const personalMaterialId =
          typeof rec.personalMaterialId === "string"
            ? rec.personalMaterialId.trim()
            : "";
        if (!personalMaterialId) {
          return {
            ok: false,
            error: {
              error: `参考图槽位 ${index + 1} 缺少个人素材 ID`,
              code: "INVALID_REFERENCE_SOURCES",
              status: 400,
            },
          };
        }
        slots[index] = {
          kind: "personal-material",
          index,
          personalMaterialId,
        };
        continue;
      }
      if (sourceType === "system-material") {
        const materialId =
          typeof rec.materialId === "string" ? rec.materialId.trim() : "";
        if (!materialId) {
          return {
            ok: false,
            error: {
              error: `参考图槽位 ${index + 1} 缺少系统素材 ID`,
              code: "INVALID_REFERENCE_SOURCES",
              status: 400,
            },
          };
        }
        slots[index] = { kind: "system-material", index, materialId };
        continue;
      }
      if (sourceType === "project-asset") {
        const mediaId =
          typeof rec.mediaId === "string" ? rec.mediaId.trim() : "";
        if (!mediaId) {
          return {
            ok: false,
            error: {
              error: `参考图槽位 ${index + 1} 缺少项目媒体 ID`,
              code: "INVALID_REFERENCE_SOURCES",
              status: 400,
            },
          };
        }
        slots[index] = { kind: "media", index, mediaId };
        continue;
      }
      if (sourceType === "upload") {
        // File bytes still come from referenceImage[index].
        continue;
      }
    }
  }

  for (let index = 0; index < GENERATE_ASSET_REFERENCE_SLOT_COUNT; index += 1) {
    const mediaId = readFormString(form, `referenceMediaId[${index}]`);
    const fileEntry = form.get(`referenceImage[${index}]`);
    const hasFile = fileEntry instanceof File && fileEntry.size > 0;
    const existing = slots[index];
    if (
      existing &&
      (existing.kind === "personal-material" ||
        existing.kind === "system-material")
    ) {
      if (mediaId || hasFile) {
        return {
          ok: false,
          error: {
            error: `参考图槽位 ${index + 1} 素材引用不能同时附带 mediaId/上传文件`,
            code: "REFERENCE_SLOT_CONFLICT",
            status: 400,
          },
        };
      }
      continue;
    }
    if (mediaId && hasFile) {
      return {
        ok: false,
        error: {
          error: `参考图槽位 ${index + 1} 不能同时提供 mediaId 与上传文件`,
          code: "REFERENCE_SLOT_CONFLICT",
          status: 400,
        },
      };
    }
    if (mediaId) {
      slots[index] = { kind: "media", index, mediaId };
      continue;
    }
    if (hasFile) {
      const parsed = await parseUploadedReferenceImage(fileEntry);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      slots[index] = { kind: "upload", index, image: parsed.value };
    }
  }

  // Legacy single-field fallback (slot 0 only).
  if (slots.filter(Boolean).length === 0) {
    const legacyMediaId = readFormString(form, "referenceMediaId");
    const legacyFile = form.get("referenceImage");
    const nextSlots: Array<ParsedGenerateAssetReferenceSlot | null> = [...slots];
    if (legacyMediaId) {
      nextSlots[0] = {
        kind: "media",
        index: 0,
        mediaId: legacyMediaId,
      };
    } else if (legacyFile instanceof File && legacyFile.size > 0) {
      const parsed = await parseUploadedReferenceImage(legacyFile);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      nextSlots[0] = {
        kind: "upload",
        index: 0,
        image: parsed.value,
      };
    }
    for (let i = 0; i < slots.length; i += 1) {
      slots[i] = nextSlots[i] ?? null;
    }
  }

  // Reject more than 6 via unexpected keys like referenceImage[6].
  for (const key of form.keys()) {
    const match = /^(?:referenceMediaId|referenceImage)\[(\d+)\]$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= GENERATE_ASSET_REFERENCE_SLOT_COUNT) {
      return {
        ok: false,
        error: {
          error: `参考图最多 ${GENERATE_ASSET_REFERENCE_SLOT_COUNT} 张`,
          code: "TOO_MANY_REFERENCE_IMAGES",
          status: 400,
        },
      };
    }
  }

  // Keep UI slot indices; empty holes are allowed and skipped (no auto-compact).
  // Filled slots stay in ascending interface order for the provider request.
  const filled: ParsedGenerateAssetReferenceSlot[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot) filled.push(slot);
  }

  return { ok: true, value: filled };
}

export async function parseGenerateAssetRequest(
  request: Request,
): Promise<
  | { ok: true; value: ParsedGenerateAssetRequest }
  | { ok: false; error: ParseGenerateAssetRequestError }
> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { ok: false, error: { error: "无效请求", status: 400 } };
    }

    const modeRaw = readFormString(form, "mode");
    const mode: GenerateAssetMode =
      modeRaw === "image_to_image" ? "image_to_image" : "text_to_image";
    const multiAngleParsed = parseRequestedMultiAngleMode(
      readFormString(form, "multiAngleMode"),
    );
    if (!multiAngleParsed.ok) {
      return { ok: false, error: multiAngleParsed.error };
    }
    const multiAngleMode = multiAngleParsed.value;
    if (multiAngleMode && mode !== "image_to_image") {
      return {
        ok: false,
        error: {
          error: "多角度生图必须使用图生图模式",
          code: "MULTI_ANGLE_REQUIRES_IMAGE_TO_IMAGE",
          status: 400,
        },
      };
    }
    const prompt = readFormString(form, "prompt");
    if (!prompt && !multiAngleMode) {
      return { ok: false, error: { error: "缺少提示词", status: 400 } };
    }

    const raw: Record<string, unknown> = {
      quality: readFormString(form, "quality") || undefined,
      aspectRatio: readFormString(form, "aspectRatio") || undefined,
      count: readFormString(form, "count") || undefined,
      stylePrompt: form.has("stylePrompt") ? form.get("stylePrompt") : undefined,
      visualStyle: form.has("visualStyle") ? form.get("visualStyle") : undefined,
      promptDirective: form.has("promptDirective")
        ? form.get("promptDirective")
        : undefined,
      multiAngleTemplate: form.has("multiAngleTemplate")
        ? form.get("multiAngleTemplate")
        : undefined,
      multiAnglePrompt: form.has("multiAnglePrompt")
        ? form.get("multiAnglePrompt")
        : undefined,
      angleTemplate: form.has("angleTemplate")
        ? form.get("angleTemplate")
        : undefined,
      anglePrompt: form.has("anglePrompt") ? form.get("anglePrompt") : undefined,
    };
    if (!form.has("stylePrompt")) delete raw.stylePrompt;
    if (!form.has("visualStyle")) delete raw.visualStyle;
    if (!form.has("promptDirective")) delete raw.promptDirective;
    if (!form.has("multiAngleTemplate")) delete raw.multiAngleTemplate;
    if (!form.has("multiAnglePrompt")) delete raw.multiAnglePrompt;
    if (!form.has("angleTemplate")) delete raw.angleTemplate;
    if (!form.has("anglePrompt")) delete raw.anglePrompt;
    if (!form.has("quality")) delete raw.quality;
    if (!form.has("aspectRatio")) delete raw.aspectRatio;
    if (!form.has("count")) delete raw.count;

    const styleErr = rejectsClientStyleOverride(raw);
    if (styleErr) return { ok: false, error: styleErr };
    const templateErr = rejectsClientMultiAngleTemplateOverride(raw, form);
    if (templateErr) return { ok: false, error: templateErr };

    const idempotencyKey = parseIdempotencyKey(
      readFormString(form, "idempotencyKey"),
    );
    if (!idempotencyKey) {
      return {
        ok: false,
        error: {
          error: "缺少 idempotencyKey",
          code: "IDEMPOTENCY_KEY_REQUIRED",
          status: 400,
        },
      };
    }

    const options = parseOptionsFromRaw(raw);
    if (!options) {
      return {
        ok: false,
        error: {
          error: "画质、画面比例或生成张数无效（张数须为 1–4）",
          code: "INVALID_IMAGE_OPTIONS",
          status: 400,
        },
      };
    }

    const modelParsed = parseRequestedModel(readFormString(form, "model"));
    if (!modelParsed.ok) return { ok: false, error: modelParsed.error };

    const slotsParsed = await parseIndexedReferenceSlots(form);
    if (!slotsParsed.ok) return { ok: false, error: slotsParsed.error };

    let referenceSlots =
      mode === "image_to_image" ? slotsParsed.value : [];
    if (multiAngleMode) {
      referenceSlots = referenceSlots.slice(0, 1);
    }

    if (mode === "image_to_image" && referenceSlots.length === 0) {
      return {
        ok: false,
        error: {
          error: multiAngleMode
            ? "请先生成或上传场景参考图"
            : "图生图至少需要 1 张参考图",
          code: "REFERENCE_IMAGE_REQUIRED",
          status: 400,
        },
      };
    }

    return {
      ok: true,
      value: {
        mode,
        prompt,
        idempotencyKey,
        options,
        model: modelParsed.value,
        multiAngleMode,
        referenceSlots,
      },
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: { error: "无效请求", status: 400 } };
  }
  const raw = asRecord(body);
  const prompt = typeof raw?.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: { error: "缺少提示词", status: 400 } };
  }
  const styleErr = rejectsClientStyleOverride(raw);
  if (styleErr) return { ok: false, error: styleErr };

  const idempotencyKey = parseIdempotencyKey(raw?.idempotencyKey);
  if (!idempotencyKey) {
    return {
      ok: false,
      error: {
        error: "缺少 idempotencyKey",
        code: "IDEMPOTENCY_KEY_REQUIRED",
        status: 400,
      },
    };
  }

  const options = parseOptionsFromRaw(raw);
  if (!options) {
    return {
      ok: false,
      error: {
        error: "画质、画面比例或生成张数无效（张数须为 1–4）",
        code: "INVALID_IMAGE_OPTIONS",
        status: 400,
      },
    };
  }

  const modelParsed = parseRequestedModel(raw?.model);
  if (!modelParsed.ok) return { ok: false, error: modelParsed.error };

  const multiAngleParsed = parseRequestedMultiAngleMode(raw?.multiAngleMode);
  if (!multiAngleParsed.ok) return { ok: false, error: multiAngleParsed.error };
  if (multiAngleParsed.value) {
    return {
      ok: false,
      error: {
        error: "多角度生图必须使用 multipart 图生图请求",
        code: "MULTI_ANGLE_REQUIRES_IMAGE_TO_IMAGE",
        status: 400,
      },
    };
  }

  const templateErr = rejectsClientMultiAngleTemplateOverride(raw);
  if (templateErr) return { ok: false, error: templateErr };

  const modeRaw =
    typeof raw?.mode === "string" ? raw.mode.trim() : "text_to_image";
  const mode: GenerateAssetMode =
    modeRaw === "image_to_image" ? "image_to_image" : "text_to_image";

  const referenceSlots: ParsedGenerateAssetReferenceSlot[] = [];
  if (mode === "image_to_image") {
    const referenceMediaId =
      typeof raw?.referenceMediaId === "string"
        ? raw.referenceMediaId.trim() || null
        : null;
    if (!referenceMediaId) {
      return {
        ok: false,
        error: {
          error: "图生图至少需要 1 张参考图",
          code: "REFERENCE_IMAGE_REQUIRED",
          status: 400,
        },
      };
    }
    referenceSlots.push({ kind: "media", index: 0, mediaId: referenceMediaId });
  }

  return {
    ok: true,
    value: {
      mode,
      prompt,
      idempotencyKey,
      options,
      model: modelParsed.value,
      multiAngleMode: undefined,
      referenceSlots,
    },
  };
}
