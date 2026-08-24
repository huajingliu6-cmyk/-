import "server-only";

import { sniffMaterialImageMime } from "@/materials/media-validation";
import type { MaterialImageMime } from "@/materials/constants";

export async function readFormDataImageFile(
  entry: FormDataEntryValue | null,
): Promise<{ buffer: Buffer; mime: MaterialImageMime; fileName: string } | null> {
  if (entry == null) return null;
  if (!(entry instanceof File) || entry.size <= 0) return null;
  const buffer = Buffer.from(await entry.arrayBuffer());
  const sniffed = sniffMaterialImageMime(buffer);
  if (!sniffed) return null;
  return {
    buffer,
    mime: sniffed,
    fileName: entry.name.trim() || "image.png",
  };
}
