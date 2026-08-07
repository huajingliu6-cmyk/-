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
  for (const candidateHost of hosts) {
    if (forwardedProto === "http" || forwardedProto === "https") {
      allowed.add(`${forwardedProto}://${candidateHost}`);
    }
    allowed.add(`http://${candidateHost}`);
    allowed.add(`https://${candidateHost}`);
  }

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

  if (![...allowed].some((base) => candidate === base || candidate.startsWith(`${base}/`))) {
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
  return null;
}

function safeOriginFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
