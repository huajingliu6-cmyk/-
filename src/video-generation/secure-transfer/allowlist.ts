import { isIP } from "net";
import { TransferError } from "./errors";
import type { AllowedHostRule } from "./types";

/**
 * 解析 WAN_RESULT_ALLOWED_HOSTS。
 * - 普通主机名：仅精确匹配
 * - 以 `.` 或 `*.` 开头：后缀规则（host === base || host.endsWith("." + base)）
 * 禁止 `*`、空段、含空白的非法条目。
 */
export function parseAllowedHosts(
  raw: string | undefined | null,
): AllowedHostRule[] {
  if (!raw || !raw.trim()) return [];
  const rules: AllowedHostRule[] = [];
  for (const part of raw.split(",")) {
    const item = part.trim().toLowerCase();
    if (!item) continue;
    if (
      item === "*" ||
      item === "*.*" ||
      (item.includes("*") && !item.startsWith("*."))
    ) {
      throw new TransferError(
        "RESULT_URL_INVALID",
        "结果域名白名单不支持通配符 * 或任意域名",
      );
    }
    if (item.startsWith("*.")) {
      const base = item.slice(2);
      if (!isValidHostname(base)) {
        throw new TransferError(
          "RESULT_URL_INVALID",
          "结果域名白名单条目无效",
        );
      }
      rules.push({ mode: "suffix", base });
      continue;
    }
    if (item.startsWith(".")) {
      const base = item.slice(1);
      if (!isValidHostname(base)) {
        throw new TransferError(
          "RESULT_URL_INVALID",
          "结果域名白名单条目无效",
        );
      }
      rules.push({ mode: "suffix", base });
      continue;
    }
    if (!isValidHostname(item) && isIP(item) === 0) {
      throw new TransferError(
        "RESULT_URL_INVALID",
        "结果域名白名单条目无效",
      );
    }
    rules.push({ mode: "exact", host: item });
  }
  return rules;
}

export function getWanResultAllowedHosts(
  env: Record<string, string | undefined> = process.env,
): AllowedHostRule[] {
  return parseAllowedHosts(env.WAN_RESULT_ALLOWED_HOSTS);
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (host.includes("..") || host.startsWith("-") || host.endsWith("-")) {
    return false;
  }
  if (host.includes("/") || host.includes(":") || host.includes(" ")) {
    return false;
  }
  // 标签：字母数字与连字符；整体可含点
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(
    host,
  );
}

/**
 * 精确匹配自身；后缀规则使用明确边界，防止：
 * trusted.example.com.attacker.com / eviltrusted.example.com
 */
export function hostMatchesAllowlist(
  hostname: string,
  rules: AllowedHostRule[],
): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  for (const rule of rules) {
    if (rule.mode === "exact") {
      if (host === rule.host) return true;
      continue;
    }
    if (host === rule.base || host.endsWith("." + rule.base)) {
      return true;
    }
  }
  return false;
}
