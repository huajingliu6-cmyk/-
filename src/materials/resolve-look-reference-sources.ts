import "server-only";

import {
  getPersonalMaterialForUser,
} from "@/materials/citation-store";
import { getMaterialById } from "@/materials/catalog-store";
import { readMaterialMedia } from "@/materials/media-store";
import type { ParsedGenerateAssetReferenceImage } from "@/projects/assets/episode-design/parse-generate-asset-request";
import type { ProjectAssetImageMime } from "@/projects/assets/asset-image-storage";

export type LookReferenceSourceInput =
  | {
      slot: number;
      sourceType: "personal-material";
      personalMaterialId: string;
    }
  | {
      slot: number;
      sourceType: "system-material";
      materialId: string;
    }
  | {
      slot: number;
      sourceType: "project-asset";
      mediaId: string;
    }
  | {
      slot: number;
      sourceType: "upload";
    };

export function parseLookReferenceSourcesField(
  raw: string,
): LookReferenceSourceInput[] | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: LookReferenceSourceInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const slot = typeof rec.slot === "number" ? rec.slot : Number(rec.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) continue;
    const sourceType = rec.sourceType;
    if (sourceType === "personal-material") {
      const personalMaterialId =
        typeof rec.personalMaterialId === "string"
          ? rec.personalMaterialId.trim()
          : "";
      if (!personalMaterialId) continue;
      out.push({ slot, sourceType, personalMaterialId });
      continue;
    }
    if (sourceType === "system-material") {
      const materialId =
        typeof rec.materialId === "string" ? rec.materialId.trim() : "";
      if (!materialId) continue;
      out.push({ slot, sourceType, materialId });
      continue;
    }
    if (sourceType === "project-asset") {
      const mediaId =
        typeof rec.mediaId === "string" ? rec.mediaId.trim() : "";
      if (!mediaId) continue;
      out.push({ slot, sourceType, mediaId });
      continue;
    }
    if (sourceType === "upload") {
      out.push({ slot, sourceType });
    }
  }
  return out;
}

function toReferenceImage(
  media: { body: Buffer; mime: string },
  fileName: string,
): ParsedGenerateAssetReferenceImage | null {
  const mime = media.mime as ProjectAssetImageMime;
  if (
    mime !== "image/png" &&
    mime !== "image/jpeg" &&
    mime !== "image/webp"
  ) {
    return null;
  }
  return {
    buffer: media.body,
    mimeType: mime,
    fileName,
  };
}

export async function resolvePersonalMaterialReference(input: {
  userId: string;
  personalMaterialId: string;
}): Promise<
  | { ok: true; image: ParsedGenerateAssetReferenceImage; mediaId: string }
  | { ok: false; error: string; code: string; status: number }
> {
  const personal = await getPersonalMaterialForUser({
    userId: input.userId,
    personalMaterialId: input.personalMaterialId,
  });
  if (!personal || personal.ownerId !== input.userId) {
    return {
      ok: false,
      error: "个人素材不存在或无权使用",
      code: "PERSONAL_MATERIAL_FORBIDDEN",
      status: 403,
    };
  }
  const media = await readMaterialMedia(personal.mediaId);
  if (!media) {
    return {
      ok: false,
      error: "个人素材媒体不可用",
      code: "PERSONAL_MATERIAL_MEDIA_MISSING",
      status: 404,
    };
  }
  const image = toReferenceImage(media, `personal-${personal.id}`);
  if (!image) {
    return {
      ok: false,
      error: "个人素材媒体格式不支持",
      code: "PERSONAL_MATERIAL_MEDIA_INVALID",
      status: 400,
    };
  }
  return { ok: true, image, mediaId: personal.mediaId };
}

export async function resolveSystemMaterialReference(input: {
  userId: string;
  materialId: string;
}): Promise<
  | { ok: true; image: ParsedGenerateAssetReferenceImage; mediaId: string }
  | { ok: false; error: string; code: string; status: number }
> {
  const material = await getMaterialById(input.materialId);
  if (!material || material.status !== "active") {
    return {
      ok: false,
      error: "系统素材不存在或已下架",
      code: "SYSTEM_MATERIAL_UNAVAILABLE",
      status: 404,
    };
  }
  const media = await readMaterialMedia(material.mediaId);
  if (!media) {
    return {
      ok: false,
      error: "系统素材媒体不可用",
      code: "SYSTEM_MATERIAL_MEDIA_MISSING",
      status: 404,
    };
  }
  const image = toReferenceImage(media, `system-${material.id}`);
  if (!image) {
    return {
      ok: false,
      error: "系统素材媒体格式不支持",
      code: "SYSTEM_MATERIAL_MEDIA_INVALID",
      status: 400,
    };
  }
  return { ok: true, image, mediaId: material.mediaId };
}
