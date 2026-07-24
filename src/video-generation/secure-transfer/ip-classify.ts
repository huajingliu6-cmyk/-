import { isIP } from "net";
import { TransferError } from "./errors";

export type IpKind = "ipv4" | "ipv6";

export type IpClassification =
  | { ok: true; kind: IpKind; public: true }
  | { ok: false; kind: IpKind | "unknown"; reason: "private_or_reserved" | "invalid" };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = ((n << 8) + v) >>> 0;
  }
  return n;
}

function ipv4InCidr(ip: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

/** 使用整数 CIDR，禁止字符串前缀判断 */
function isBlockedIpv4(ip: number): boolean {
  const ranges: Array<[number, number]> = [
    [0x00000000, 8], // 0.0.0.0/8
    [0x0a000000, 8], // 10.0.0.0/8
    [0x64400000, 10], // 100.64.0.0/10
    [0x7f000000, 8], // 127.0.0.0/8
    [0xa9fe0000, 16], // 169.254.0.0/16
    [0xac100000, 12], // 172.16.0.0/12
    [0xc0000000, 24], // 192.0.0.0/24
    [0xc0000008, 32], // 192.0.0.8/32 (often reserved docs; covered by /24)
    [0xc0000200, 24], // 192.0.2.0/24 TEST-NET-1
    [0xc0586300, 24], // 192.88.99.0/24
    [0xc0a80000, 16], // 192.168.0.0/16
    [0xc6120000, 15], // 198.18.0.0/15
    [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
    [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
    [0xe0000000, 4], // 224.0.0.0/4 multicast
    [0xf0000000, 4], // 240.0.0.0/4 reserved
  ];
  return ranges.some(([base, prefix]) => ipv4InCidr(ip, base, prefix));
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  // Expand IPv6 including IPv4-mapped
  let raw = ip.toLowerCase();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    raw = raw.slice(1, -1);
  }

  // IPv4-mapped / IPv4-compatible trailing dotted quad
  const v4Tail = raw.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const v4 = ipv4ToInt(v4Tail[1]!);
    if (v4 === null) return null;
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    raw = raw.slice(0, -v4Tail[1]!.length) + hi.toString(16) + ":" + lo.toString(16);
  }

  if (raw.includes(":::")) return null;
  const sides = raw.split("::");
  if (sides.length > 2) return null;

  const parseSide = (side: string): number[] => {
    if (!side) return [];
    return side.split(":").map((h) => {
      if (!/^[0-9a-f]{1,4}$/i.test(h)) return -1;
      return parseInt(h, 16);
    });
  };

  let heads: number[];
  let tails: number[];
  if (sides.length === 1) {
    heads = parseSide(sides[0]!);
    tails = [];
    if (heads.length !== 8) return null;
  } else {
    heads = parseSide(sides[0]!);
    tails = parseSide(sides[1]!);
    if (heads.includes(-1) || tails.includes(-1)) return null;
    const missing = 8 - heads.length - tails.length;
    if (missing < 0) return null;
    heads = [...heads, ...Array(missing).fill(0), ...tails];
  }
  if (heads.includes(-1) || heads.length !== 8) return null;

  let value = BigInt(0);
  for (const part of heads) {
    value = (value << BigInt(16)) + BigInt(part);
  }
  return value;
}

function ipv6InCidr(ip: bigint, base: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  const mask = ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << shift;
  return (ip & mask) === (base & mask);
}

function isIpv4Mapped(ip: bigint): boolean {
  // ::ffff:0:0/96
  return ipv6InCidr(ip, BigInt("0xffff00000000"), 96);
}

function mappedIpv4(ip: bigint): number {
  return Number(ip & BigInt("0xffffffff"));
}

function isBlockedIpv6(ip: bigint): boolean {
  if (isIpv4Mapped(ip)) {
    return isBlockedIpv4(mappedIpv4(ip));
  }

  // Unspecified ::/128
  if (ip === BigInt(0)) return true;
  // Loopback ::1/128
  if (ip === BigInt(1)) return true;
  // IPv4-compatible deprecated ::/96 (excluding mapped which handled)
  if (ipv6InCidr(ip, BigInt(0), 96) && !isIpv4Mapped(ip)) return true;
  // Unique local fc00::/7
  if (
    ipv6InCidr(ip, BigInt("0xfc000000000000000000000000000000"), 7)
  ) {
    return true;
  }
  // Link-local fe80::/10
  if (
    ipv6InCidr(ip, BigInt("0xfe800000000000000000000000000000"), 10)
  ) {
    return true;
  }
  // Multicast ff00::/8
  if (
    ipv6InCidr(ip, BigInt("0xff000000000000000000000000000000"), 8)
  ) {
    return true;
  }
  // Documentation 2001:db8::/32
  if (
    ipv6InCidr(ip, BigInt("0x20010db8000000000000000000000000"), 32)
  ) {
    return true;
  }
  // Discard 100::/64
  if (
    ipv6InCidr(ip, BigInt("0x01000000000000000000000000000000"), 64)
  ) {
    return true;
  }
  // TEREDO 2001::/32 — treat as special, block for SSRF hardening
  if (
    ipv6InCidr(ip, BigInt("0x20010000000000000000000000000000"), 32)
  ) {
    return true;
  }
  // 6to4 2002::/16 — often tunnels; block
  if (
    ipv6InCidr(ip, BigInt("0x20020000000000000000000000000000"), 16)
  ) {
    return true;
  }
  // Site-local deprecated fec0::/10
  if (
    ipv6InCidr(ip, BigInt("0xfec00000000000000000000000000000"), 10)
  ) {
    return true;
  }

  return false;
}

/**
 * 分类单个 IP；私网/保留/环回/链路本地/文档/组播均拒绝。
 * IPv4-mapped IPv6 还原后按 IPv4 规则检查。
 */
export function classifyIpAddress(ip: string): IpClassification {
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed) return { ok: false, kind: "unknown", reason: "invalid" };

  const version = isIP(trimmed);
  if (version === 4) {
    const n = ipv4ToInt(trimmed);
    if (n === null) return { ok: false, kind: "ipv4", reason: "invalid" };
    if (isBlockedIpv4(n)) {
      return { ok: false, kind: "ipv4", reason: "private_or_reserved" };
    }
    return { ok: true, kind: "ipv4", public: true };
  }

  if (version === 6) {
    const n = parseIpv6ToBigInt(trimmed);
    if (n === null) return { ok: false, kind: "ipv6", reason: "invalid" };
    if (isBlockedIpv6(n)) {
      return { ok: false, kind: "ipv6", reason: "private_or_reserved" };
    }
    return { ok: true, kind: "ipv6", public: true };
  }

  return { ok: false, kind: "unknown", reason: "invalid" };
}

/** 任一地址为私网/保留则整体拒绝 */
export function assertAllAddressesPublic(addresses: string[]): void {
  if (addresses.length === 0) {
    throw new TransferError("RESULT_DNS_RESOLUTION_FAILED");
  }
  for (const addr of addresses) {
    const c = classifyIpAddress(addr);
    if (!c.ok) {
      throw new TransferError("RESULT_PRIVATE_ADDRESS_BLOCKED");
    }
  }
}
