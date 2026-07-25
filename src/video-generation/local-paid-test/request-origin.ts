import { LocalPaidTestError } from "./errors";

export type LocalPaidTestRequestOriginHeaders = {
  host?: string | null;
  origin?: string | null;
  secFetchSite?: string | null;
  forwarded?: string | null;
  xForwardedHost?: string | null;
  xForwardedProto?: string | null;
  xForwardedFor?: string | null;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

function splitHostPort(raw: string): { hostname: string; port: string | null } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { hostname: "", port: null };
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return { hostname: "", port: null };
    const hostname = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : null;
    return { hostname, port: port || null };
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx > -1 && trimmed.indexOf(":") === idx) {
    return {
      hostname: trimmed.slice(0, idx),
      port: trimmed.slice(idx + 1) || null,
    };
  }
  return { hostname: trimmed, port: null };
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  return false;
}

function isNonLoopbackProxyValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  // Any forwarded chain that is not exclusively loopback is rejected.
  const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const hostOnly = part.split(":")[0] ?? part;
    if (!isLoopbackHostname(hostOnly) && hostOnly !== "unknown") {
      return true;
    }
    // Explicit non-loopback markers
    if (
      hostOnly === "0.0.0.0" ||
      hostOnly.startsWith("10.") ||
      hostOnly.startsWith("192.168.") ||
      hostOnly.startsWith("172.")
    ) {
      return true;
    }
  }
  return parts.some((p) => {
    const { hostname } = splitHostPort(p);
    return hostname.length > 0 && !isLoopbackHostname(hostname);
  });
}

/**
 * Validates Host / Origin / Sec-Fetch-Site / Forwarded headers for
 * local one-shot paid test sensitive APIs.
 * Does not trust X-Forwarded-* from the client.
 * Error messages never echo full malicious header values.
 */
export function validateLocalPaidTestRequestOrigin(
  headers: LocalPaidTestRequestOriginHeaders,
): { ok: true; hostname: string; port: string | null } {
  const hostRaw = (headers.host ?? "").trim();
  if (!hostRaw) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_LOOPBACK_REQUIRED");
  }
  const host = splitHostPort(hostRaw);
  if (!host.hostname || !isLoopbackHostname(host.hostname)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_LOOPBACK_REQUIRED");
  }
  if (host.hostname === "0.0.0.0") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_LOOPBACK_REQUIRED");
  }

  const originRaw = headers.origin;
  if (originRaw == null || originRaw.trim() === "" || originRaw === "null") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }
  if (originRaw.trim().toLowerCase().startsWith("file:")) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }

  let originUrl: URL;
  try {
    originUrl = new URL(originRaw.trim());
  } catch {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }

  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }
  if (!isLoopbackHostname(originUrl.hostname)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }

  const originPort =
    originUrl.port ||
    (originUrl.protocol === "https:" ? "443" : "80");
  const hostPort = host.port;
  // Same hostname required. Port must match when Host includes a port;
  // when Host omits port, accept default http(s) ports from Origin.
  if (originUrl.hostname.toLowerCase() !== host.hostname.toLowerCase()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }
  if (hostPort != null && hostPort !== "" && hostPort !== originPort) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ORIGIN_INVALID");
  }

  const site = (headers.secFetchSite ?? "").trim().toLowerCase();
  if (site && site !== "same-origin") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_CSRF_REJECTED");
  }

  const forwarded = headers.forwarded?.trim() ?? "";
  const xHost = headers.xForwardedHost?.trim() ?? "";
  const xProto = headers.xForwardedProto?.trim() ?? "";
  const xFor = headers.xForwardedFor?.trim() ?? "";

  if (forwarded || xHost || xProto || xFor) {
    // Presence of proxy headers is suspicious for loopback-only APIs.
    // Allow only if every value is exclusively loopback (dev reverse-proxy edge case);
    // otherwise reject without echoing values.
    if (
      (forwarded && isNonLoopbackProxyValue(forwarded)) ||
      (xHost && isNonLoopbackProxyValue(xHost)) ||
      (xFor && isNonLoopbackProxyValue(xFor)) ||
      (xProto &&
        xProto.toLowerCase() !== "http" &&
        xProto.toLowerCase() !== "https")
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_PROXY_NOT_ALLOWED");
    }
    // Any X-Forwarded-* / Forwarded on this sensitive path → reject
    // (do not trust client-supplied proxy headers).
    throw new LocalPaidTestError("LOCAL_PAID_TEST_PROXY_NOT_ALLOWED");
  }

  return { ok: true, hostname: host.hostname, port: host.port };
}

export function readLocalPaidTestOriginHeaders(
  headers: Headers,
): LocalPaidTestRequestOriginHeaders {
  return {
    host: headers.get("host"),
    origin: headers.get("origin"),
    secFetchSite: headers.get("sec-fetch-site"),
    forwarded: headers.get("forwarded"),
    xForwardedHost: headers.get("x-forwarded-host"),
    xForwardedProto: headers.get("x-forwarded-proto"),
    xForwardedFor: headers.get("x-forwarded-for"),
  };
}
