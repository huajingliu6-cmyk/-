/**
 * Client-safe local voice id helpers (no Node fs).
 * Ids look like: localvoice_<base64url(fileName)>
 */

export const LOCAL_VOICE_ID_PREFIX = "localvoice_";

export function isLocalVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === "string" && voiceId.startsWith(LOCAL_VOICE_ID_PREFIX);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function encodeLocalVoiceId(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error("本地音色文件名不能为空");
  }
  const bytes = new TextEncoder().encode(trimmed);
  return `${LOCAL_VOICE_ID_PREFIX}${bytesToBase64Url(bytes)}`;
}

export function decodeLocalVoiceId(voiceId: string): string | null {
  if (!isLocalVoiceId(voiceId)) return null;
  const payload = voiceId.slice(LOCAL_VOICE_ID_PREFIX.length);
  if (!payload) return null;
  try {
    const bytes = base64UrlToBytes(payload);
    const fileName = new TextDecoder().decode(bytes).trim();
    if (!fileName || fileName.includes("\0")) return null;
    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
      return null;
    }
    return fileName;
  } catch {
    return null;
  }
}

export function localVoiceDisplayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, "").trim() || fileName;
}

export function getLocalVoiceFileUrl(voiceId: string): string {
  return `/api/local-voices/file?voiceId=${encodeURIComponent(voiceId)}`;
}
