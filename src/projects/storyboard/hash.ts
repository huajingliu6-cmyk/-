import { createHash } from "crypto";

export function stableHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeAssetName(raw: string): string {
  return raw
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/[（）]/g, (ch) => (ch === "（" ? "(" : ")"))
    .replace(/[：:]/g, ":")
    .replace(/[，,]/g, ",")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
