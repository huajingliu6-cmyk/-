/**
 * 基础 MP4 结构：前部含 ftyp box（ISO BMFF）。
 * 不声称可解码；仅防 HTML/JSON 等伪装。
 */
export function bufferHasMp4Ftyp(buf: Buffer): boolean {
  if (buf.byteLength < 8) return false;
  const probe = buf.subarray(0, Math.min(64, buf.byteLength));
  return probe.includes(Buffer.from("ftyp", "ascii"));
}

export function looksLikeHtmlOrXml(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString("utf8").toLowerCase();
  return (
    head.includes("<!doctype") ||
    head.includes("<html") ||
    head.includes("<?xml")
  );
}

export function looksLikeJson(buf: Buffer): boolean {
  const head = buf.subarray(0, 32).toString("utf8").trimStart();
  return head.startsWith("{") || head.startsWith("[");
}

/**
 * 允许的 Content-Type：
 * - video/mp4（首选）
 * - application/octet-stream：仅当 ftyp 结构检查通过时可接受（官方 CDN 可能返回）
 */
export function isAcceptableProviderContentType(
  contentType: string | undefined,
): "video" | "octet-stream" | "reject" {
  if (!contentType) return "octet-stream"; // 无头时依赖结构检查
  const ct = contentType.toLowerCase().split(";")[0]!.trim();
  if (ct === "video/mp4" || ct.startsWith("video/")) return "video";
  if (ct === "application/octet-stream") return "octet-stream";
  if (
    ct.includes("html") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.startsWith("text/")
  ) {
    return "reject";
  }
  return "reject";
}
