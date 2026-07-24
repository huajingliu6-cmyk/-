import { isIP } from "net";
import { hostMatchesAllowlist } from "./allowlist";
import { classifyIpAddress } from "./ip-classify";
import { TransferError } from "./errors";
import type { AllowedHostRule } from "./types";
import { MAX_PROVIDER_RESULT_URL_LENGTH } from "./types";

export type ValidateProviderResultUrlOk = {
  ok: true;
  url: URL;
  hostname: string;
};

export type ValidateProviderResultUrlErr = {
  ok: false;
  code: TransferError["code"];
  message: string;
};

/**
 * 纯函数：校验真实 Provider 结果 URL（不发起网络请求）。
 */
export function validateProviderResultUrl(params: {
  url: string;
  allowedHosts: AllowedHostRule[];
}): ValidateProviderResultUrlOk | ValidateProviderResultUrlErr {
  const raw = params.url;
  if (typeof raw !== "string" || !raw.trim()) {
    return fail("RESULT_URL_INVALID");
  }
  if (raw.length > MAX_PROVIDER_RESULT_URL_LENGTH) {
    return fail("RESULT_URL_INVALID");
  }
  // 控制字符
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      return fail("RESULT_URL_INVALID");
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail("RESULT_URL_INVALID");
  }

  if (parsed.protocol !== "https:") {
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "file:" ||
      parsed.protocol === "ftp:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:"
    ) {
      return fail("RESULT_URL_PROTOCOL_NOT_ALLOWED");
    }
    return fail("RESULT_URL_PROTOCOL_NOT_ALLOWED");
  }

  if (parsed.username || parsed.password) {
    return fail("RESULT_URL_INVALID");
  }

  if (parsed.port && parsed.port !== "443") {
    return fail("RESULT_URL_INVALID");
  }

  const hostname = parsed.hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) {
    return fail("RESULT_URL_INVALID");
  }

  if (params.allowedHosts.length === 0) {
    return fail("RESULT_HOST_ALLOWLIST_NOT_CONFIGURED");
  }

  // hostname 本身是 IP 时也要检查私网，且仍须在 allowlist（通常不会配置 IP）
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    const classified = classifyIpAddress(hostname);
    if (!classified.ok) {
      return fail("RESULT_PRIVATE_ADDRESS_BLOCKED");
    }
  }

  if (!hostMatchesAllowlist(hostname, params.allowedHosts)) {
    return fail("RESULT_HOST_NOT_ALLOWED");
  }

  return { ok: true, url: parsed, hostname };
}

function fail(
  code: TransferError["code"],
): ValidateProviderResultUrlErr {
  const err = new TransferError(code);
  return { ok: false, code, message: err.message };
}

export function assertValidProviderResultUrl(params: {
  url: string;
  allowedHosts: AllowedHostRule[];
}): URL {
  const result = validateProviderResultUrl(params);
  if (!result.ok) {
    throw new TransferError(result.code, result.message);
  }
  return result.url;
}
