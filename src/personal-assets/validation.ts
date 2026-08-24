import {
  PERSONAL_ASSET_MAX_FILE_BYTES,
  PERSONAL_ASSET_MIME_TYPES,
} from "@/personal-assets/constants";
import type { PersonalAssetMimeType } from "@/personal-assets/types";
import { sniffMaterialImageMime } from "@/materials/media-validation";

export function validatePersonalAssetUpload(input: {
  buffer: Buffer;
  declaredMime?: string | null;
}):
  | { ok: true; mime: PersonalAssetMimeType }
  | { ok: false; error: string; code: "unsupported" | "corrupt" | "too_large" } {
  if (input.buffer.length === 0) {
    return { ok: false, error: "文件损坏", code: "corrupt" };
  }
  if (input.buffer.length > PERSONAL_ASSET_MAX_FILE_BYTES) {
    return { ok: false, error: "超过 20 MB", code: "too_large" };
  }
  const sniffed = sniffMaterialImageMime(input.buffer);
  if (!sniffed || !PERSONAL_ASSET_MIME_TYPES.includes(sniffed)) {
    return { ok: false, error: "格式不支持", code: "unsupported" };
  }
  const declared = (input.declaredMime ?? "").trim().toLowerCase();
  if (
    declared &&
    declared !== sniffed &&
    !(declared === "image/jpg" && sniffed === "image/jpeg")
  ) {
    return { ok: false, error: "格式不支持", code: "unsupported" };
  }
  return { ok: true, mime: sniffed };
}
