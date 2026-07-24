import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionPayload,
  type UserRole,
} from "@/auth/types";

function getAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  return "infinite-canvas-dev-secret-change-me";
}

function b64urlEncodeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const arr =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.length; i += 1) {
    str += String.fromCharCode(arr[i]!);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(str)
      : Buffer.from(arr).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlEncodeText(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  return b64urlEncodeBytes(new TextEncoder().encode(text));
}

function b64urlDecodeToText(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded + pad, "base64").toString("utf8");
  }
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function signAsync(payloadB64: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  return b64urlEncodeBytes(sig);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function createSessionToken(params: {
  userId: string;
  username: string;
  role: UserRole;
  displayName: string;
  ttlSeconds?: number;
}): Promise<string> {
  const payload: SessionPayload = {
    userId: params.userId,
    username: params.username,
    role: params.role,
    displayName: params.displayName,
    exp:
      Math.floor(Date.now() / 1000) +
      (params.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const payloadB64 = b64urlEncodeText(JSON.stringify(payload));
  const signature = await signAsync(payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  const expected = await signAsync(payloadB64);
  if (!timingSafeEqualString(signature, expected)) return null;

  try {
    const json = b64urlDecodeToText(payloadB64);
    const payload = JSON.parse(json) as SessionPayload;
    if (
      !payload.userId ||
      !payload.username ||
      !payload.role ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
