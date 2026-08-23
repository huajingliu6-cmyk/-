import {
  MATERIAL_IMAGE_MAX_BYTES,
  MATERIAL_IMAGE_MIMES,
  type MaterialImageMime,
} from "@/materials/constants";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_WEBP = Buffer.from([0x57, 0x45, 0x42, 0x50]);

export function sniffMaterialImageMime(
  buffer: Buffer,
): MaterialImageMime | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(PNG)) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG)) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(WEBP_RIFF) &&
    buffer.subarray(8, 12).equals(WEBP_WEBP)
  ) {
    return "image/webp";
  }
  return null;
}

export function validateMaterialImageUpload(input: {
  buffer: Buffer;
  declaredMime?: string | null;
}): { ok: true; mime: MaterialImageMime } | { ok: false; error: string } {
  if (input.buffer.length === 0) {
    return { ok: false, error: "图片为空" };
  }
  if (input.buffer.length > MATERIAL_IMAGE_MAX_BYTES) {
    return { ok: false, error: "图片不能超过 10MB" };
  }
  const sniffed = sniffMaterialImageMime(input.buffer);
  if (!sniffed) {
    return { ok: false, error: "仅支持 PNG / JPEG / WEBP" };
  }
  const declared = (input.declaredMime ?? "").trim().toLowerCase();
  if (
    declared &&
    declared !== sniffed &&
    !(MATERIAL_IMAGE_MIMES as readonly string[]).includes(declared)
  ) {
    return { ok: false, error: "图片类型与内容不匹配" };
  }
  if (declared && declared !== sniffed) {
    if (!(declared === "image/jpg" && sniffed === "image/jpeg")) {
      return { ok: false, error: "图片类型与内容不匹配" };
    }
  }
  return { ok: true, mime: sniffed };
}
