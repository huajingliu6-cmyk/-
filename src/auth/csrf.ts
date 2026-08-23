/**
 * Cookie session CSRF defense for same-site mutating API calls.
 * Browsers cannot read the HttpOnly session cookie; we reject cross-origin
 * state-changing requests via Origin/Referer checks (SameSite=Lax complement).
 */

export function assertSameOriginMutation(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");
  if (!host) {
    return new Response(JSON.stringify({ error: "缺少 Host", code: "CSRF_REJECTED" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const allowed = buildAllowedOrigins(request, host);

  const candidate = origin || (referer ? safeOriginFromReferer(referer) : null);
  // Same-origin fetch from browser always sends Origin on POST; non-browser
  // internal tools may omit both — allow only when neither is present AND
  // request carries internal marker is not used. For cookie auth from browsers,
  // require Origin or Referer.
  if (!candidate) {
    // Node/server-side BFF calls and same-tab navigations without Origin:
    // allow Sec-Fetch-Site=same-origin or missing (curl/tests).
    const site = request.headers.get("sec-fetch-site");
    if (!site || site === "same-origin" || site === "none") {
      return null;
    }
    return csrfRejected();
  }

  if (!originMatchesAllowed(candidate, allowed)) {
    return csrfRejected();
  }
  return null;
}

function buildAllowedOrigins(request: Request, host: string): Set<string> {
  const allowed = new Set<string>();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  // Accept both schemes for Host / X-Forwarded-Host so reverse proxies
  // (Cloudflare tunnel, LAN IP) are not rejected by a wrong Host guess.
  const hosts = [host, forwardedHost].filter(
    (value): value is string => Boolean(value),
  );
  const schemes =
    forwardedProto === "http" || forwardedProto === "https"
      ? [forwardedProto]
      : ["http", "https"];
  for (const candidateHost of hosts) {
    for (const origin of expandHostOrigins(candidateHost, schemes)) {
      allowed.add(origin);
    }
  }
  return allowed;
}

function expandHostOrigins(host: string, schemes: string[]): string[] {
  const out: string[] = [];
  for (const scheme of schemes) {
    out.push(`${scheme}://${host}`);
  }
  const colon = host.lastIndexOf(":");
  const hostPart = colon > -1 && !host.includes("]") ? host.slice(0, colon) : host;
  const portPart =
    colon > -1 && !host.includes("]") ? host.slice(colon + 1) : null;
  const envPort = process.env.WEB_PORT?.trim();

  if (!portPart && envPort && envPort !== "80" && envPort !== "443") {
    for (const scheme of schemes) {
      out.push(`${scheme}://${host}:${envPort}`);
    }
  }
  // Misconfigured reverse proxy may strip the port from Host on LAN HTTP.
  if (portPart && isPrivateLanHost(hostPart)) {
    for (const scheme of schemes) {
      out.push(`${scheme}://${hostPart}`);
    }
  }
  return out;
}

function originMatchesAllowed(candidate: string, allowed: Set<string>): boolean {
  if ([...allowed].some((base) => candidate === base || candidate.startsWith(`${base}/`))) {
    return true;
  }
  try {
    const url = new URL(candidate);
    if (!isPrivateLanHost(url.hostname)) return false;
    const envPort = process.env.WEB_PORT?.trim();
    const variants = new Set<string>([candidate]);
    if (!url.port && envPort) {
      variants.add(`${url.protocol}//${url.hostname}:${envPort}`);
    }
    if (url.port && envPort && url.port === envPort) {
      variants.add(`${url.protocol}//${url.hostname}`);
    }
    return [...variants].some((variant) =>
      [...allowed].some(
        (base) => variant === base || variant.startsWith(`${base}/`),
      ),
    );
  } catch {
    return false;
  }
}

function isPrivateLanHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("10.")) return true;
  const match = /^172\.(\d+)\./.exec(hostname);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function csrfRejected(): Response {
  return new Response(
    JSON.stringify({ error: "跨站请求被拒绝", code: "CSRF_REJECTED" }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

function safeOriginFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
