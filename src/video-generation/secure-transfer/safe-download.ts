import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import https from "https";
import type { LookupFunction } from "net";
import path from "path";
import { promises as dnsPromises } from "dns";
import { getWanResultAllowedHosts } from "./allowlist";
import { TransferError } from "./errors";
import { assertAllAddressesPublic, classifyIpAddress } from "./ip-classify";
import {
  bufferHasMp4Ftyp,
  isAcceptableProviderContentType,
  looksLikeHtmlOrXml,
  looksLikeJson,
} from "./mp4-structure";
import {
  MAX_PROVIDER_REDIRECTS,
  MAX_PROVIDER_VIDEO_BYTES,
  PROVIDER_CONNECT_TIMEOUT_MS,
  PROVIDER_DOWNLOAD_TIMEOUT_MS,
  type AllowedHostRule,
} from "./types";
import { assertValidProviderResultUrl } from "./url-validate";

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type DnsResolveAll = (hostname: string) => Promise<ResolvedAddress[]>;

export type InjectedHttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer>;
};

export type InjectedHttpGet = (
  url: string,
  options: {
    signal: AbortSignal;
    verifiedAddresses: ResolvedAddress[];
  },
) => Promise<InjectedHttpResponse>;

export type SafeDownloadDeps = {
  resolveAll?: DnsResolveAll;
  httpGet?: InjectedHttpGet;
  allowedHosts?: AllowedHostRule[];
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  connectTimeoutMs?: number;
};

export type SafeDownloadResult = {
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
};

export type SafeDownloadBufferResult = {
  buffer: Buffer;
  sizeBytes: number;
  sha256: string;
  contentType: string;
};

async function defaultResolveAll(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsPromises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return results.map((r) => ({
    address: r.address,
    family: r.family === 6 ? 6 : 4,
  }));
}

async function resolvePublicAddresses(
  hostname: string,
  resolveAll: DnsResolveAll,
): Promise<ResolvedAddress[]> {
  let resolved: ResolvedAddress[];
  try {
    resolved = await resolveAll(hostname);
  } catch {
    throw new TransferError("RESULT_DNS_RESOLUTION_FAILED");
  }
  if (!resolved.length) {
    throw new TransferError("RESULT_DNS_RESOLUTION_FAILED");
  }
  assertAllAddressesPublic(resolved.map((r) => r.address));
  return resolved.filter((r) => classifyIpAddress(r.address).ok);
}

function makeFixedLookup(verified: ResolvedAddress[]): LookupFunction {
  return ((
    _hostname: string,
    options: unknown,
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ) => {
    const cb =
      typeof options === "function"
        ? (options as typeof callback)!
        : callback!;
    const opts =
      typeof options === "object" && options !== null
        ? (options as { all?: boolean; family?: number })
        : {};

    if (!verified.length) {
      cb(
        Object.assign(new Error("no verified address"), {
          code: "ENOTFOUND",
        }),
        "",
      );
      return;
    }
    if (opts.all) {
      cb(
        null,
        verified.map((v) => ({ address: v.address, family: v.family })),
      );
      return;
    }
    const preferred = opts.family === 4 || opts.family === 6 ? opts.family : 0;
    const hit =
      preferred === 4 || preferred === 6
        ? (verified.find((v) => v.family === preferred) ?? verified[0]!)
        : verified[0]!;
    cb(null, hit.address, hit.family);
  }) as LookupFunction;
}

function headerGet(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (!key) return undefined;
  const v = headers[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

async function nativeHttpsGet(
  url: URL,
  options: {
    signal: AbortSignal;
    verifiedAddresses: ResolvedAddress[];
    connectTimeoutMs: number;
  },
): Promise<InjectedHttpResponse> {
  if (url.protocol !== "https:") {
    throw new TransferError("RESULT_URL_PROTOCOL_NOT_ALLOWED");
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "GET",
        headers: { Accept: "video/mp4,application/octet-stream,*/*" },
        lookup: makeFixedLookup(options.verifiedAddresses),
        rejectUnauthorized: true,
        servername: url.hostname,
        timeout: options.connectTimeoutMs,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const headers = res.headers as Record<
          string,
          string | string[] | undefined
        >;
        const body: AsyncIterable<Buffer> = {
          async *[Symbol.asyncIterator]() {
            for await (const chunk of res) {
              yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            }
          },
        };
        resolve({ statusCode, headers, body });
      },
    );

    const onAbort = () => {
      req.destroy(new TransferError("RESULT_DOWNLOAD_TIMEOUT"));
    };
    if (options.signal.aborted) {
      onAbort();
      return;
    }
    options.signal.addEventListener("abort", onAbort, { once: true });

    req.on("timeout", () => {
      req.destroy(new TransferError("RESULT_DOWNLOAD_TIMEOUT"));
    });
    req.on("error", (err) => {
      if (err instanceof TransferError) reject(err);
      else {
        reject(
          new TransferError("RESULT_TRANSFER_FAILED", "下载远程结果失败"),
        );
      }
    });
    req.end();
  });
}

async function streamBodyToFile(params: {
  body: AsyncIterable<Buffer>;
  tempPath: string;
  maxBytes: number;
  contentLength: number | null;
  signal: AbortSignal;
}): Promise<{ sizeBytes: number; sha256: string; head: Buffer }> {
  const hash = createHash("sha256");
  const headChunks: Buffer[] = [];
  let headLen = 0;
  let total = 0;
  const handle = createWriteStream(params.tempPath);

  const closeHandle = () =>
    new Promise<void>((resolve) => {
      if (handle.destroyed || handle.closed) {
        resolve();
        return;
      }
      handle.once("close", () => resolve());
      handle.destroy();
    });

  try {
    for await (const chunk of params.body) {
      if (params.signal.aborted) {
        throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
      }
      total += chunk.byteLength;
      if (total > params.maxBytes) {
        throw new TransferError("RESULT_FILE_TOO_LARGE");
      }
      hash.update(chunk);
      if (headLen < 64) {
        const need = 64 - headLen;
        headChunks.push(chunk.subarray(0, Math.min(need, chunk.byteLength)));
        headLen += Math.min(need, chunk.byteLength);
      }
      const ok = handle.write(chunk);
      if (!ok) {
        await new Promise<void>((resolve, reject) => {
          handle.once("drain", resolve);
          handle.once("error", reject);
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      handle.end(() => resolve());
      handle.on("error", reject);
    });
  } catch (err) {
    await closeHandle();
    throw err;
  }

  if (
    params.contentLength != null &&
    Number.isFinite(params.contentLength) &&
    params.contentLength >= 0 &&
    total !== params.contentLength
  ) {
    throw new TransferError("RESULT_CONTENT_LENGTH_MISMATCH");
  }

  return {
    sizeBytes: total,
    sha256: hash.digest("hex"),
    head: Buffer.concat(headChunks),
  };
}

async function streamBodyToBuffer(params: {
  body: AsyncIterable<Buffer>;
  maxBytes: number;
  contentLength: number | null;
  signal: AbortSignal;
}): Promise<{ buffer: Buffer; sizeBytes: number; sha256: string; head: Buffer }> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of params.body) {
    if (params.signal.aborted) throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
    total += chunk.byteLength;
    if (total > params.maxBytes) throw new TransferError("RESULT_FILE_TOO_LARGE");
    hash.update(chunk);
    chunks.push(Buffer.from(chunk));
  }
  if (
    params.contentLength != null &&
    Number.isFinite(params.contentLength) &&
    params.contentLength >= 0 &&
    total !== params.contentLength
  ) {
    throw new TransferError("RESULT_CONTENT_LENGTH_MISMATCH");
  }
  const buffer = Buffer.concat(chunks, total);
  return {
    buffer,
    sizeBytes: total,
    sha256: hash.digest("hex"),
    head: buffer.subarray(0, Math.min(64, buffer.byteLength)),
  };
}

async function safeDownloadProviderVideo<T>(params: {
  remoteUrl: string;
  deps?: SafeDownloadDeps;
  consume: (input: {
    body: AsyncIterable<Buffer>;
    maxBytes: number;
    contentLength: number | null;
    signal: AbortSignal;
    contentType: string;
  }) => Promise<T & { sizeBytes: number; sha256: string; head: Buffer }>;
}): Promise<T & { sizeBytes: number; sha256: string; contentType: string }> {
  const deps = params.deps ?? {};
  const allowedHosts = deps.allowedHosts ?? getWanResultAllowedHosts();
  const maxBytes = deps.maxBytes ?? MAX_PROVIDER_VIDEO_BYTES;
  const maxRedirects = deps.maxRedirects ?? MAX_PROVIDER_REDIRECTS;
  const timeoutMs = deps.timeoutMs ?? PROVIDER_DOWNLOAD_TIMEOUT_MS;
  const connectTimeoutMs = deps.connectTimeoutMs ?? PROVIDER_CONNECT_TIMEOUT_MS;
  const resolveAll = deps.resolveAll ?? defaultResolveAll;
  const overall = AbortSignal.timeout(timeoutMs);
  const visited = new Set<string>();
  let currentUrl = params.remoteUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (overall.aborted) throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
    const validated = assertValidProviderResultUrl({ url: currentUrl, allowedHosts });
    const normalizedKey = validated.href.split("#")[0]!;
    if (visited.has(normalizedKey)) throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
    visited.add(normalizedKey);
    const verified = await resolvePublicAddresses(validated.hostname, resolveAll);
    const response = deps.httpGet
      ? await deps.httpGet(validated.href, { signal: overall, verifiedAddresses: verified })
      : await nativeHttpsGet(validated, { signal: overall, verifiedAddresses: verified, connectTimeoutMs });
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = headerGet(response.headers, "location");
      if (!location) throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
      for await (const chunk of response.body) void chunk;
      if (hop >= maxRedirects) throw new TransferError("RESULT_TOO_MANY_REDIRECTS");
      try {
        currentUrl = new URL(location, validated).href;
      } catch {
        throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new TransferError("RESULT_TRANSFER_FAILED", `下载远程结果失败（HTTP ${response.statusCode}）`);
    }
    const contentType = headerGet(response.headers, "content-type") ?? "";
    if (isAcceptableProviderContentType(contentType) === "reject") {
      throw new TransferError("RESULT_CONTENT_TYPE_INVALID");
    }
    const rawLength = headerGet(response.headers, "content-length");
    const contentLength = rawLength ? Number(rawLength) : null;
    if (contentLength != null && Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new TransferError("RESULT_FILE_TOO_LARGE");
    }
    const consumed = await params.consume({
      body: response.body,
      maxBytes,
      contentLength: contentLength != null && Number.isFinite(contentLength) ? contentLength : null,
      signal: overall,
      contentType,
    });
    if (
      consumed.sizeBytes <= 0 ||
      looksLikeHtmlOrXml(consumed.head) ||
      looksLikeJson(consumed.head) ||
      !bufferHasMp4Ftyp(consumed.head)
    ) {
      throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
    }
    const result = { ...consumed } as T & {
      sizeBytes: number;
      sha256: string;
      head?: Buffer;
    };
    delete result.head;
    return { ...result, contentType: contentType || "video/mp4" };
  }
  throw new TransferError("RESULT_TOO_MANY_REDIRECTS");
}

export async function safeDownloadProviderVideoToBuffer(params: {
  remoteUrl: string;
  deps?: SafeDownloadDeps;
}): Promise<SafeDownloadBufferResult> {
  try {
    return await safeDownloadProviderVideo({
      remoteUrl: params.remoteUrl,
      deps: params.deps,
      consume: ({ body, maxBytes, contentLength, signal }) =>
        streamBodyToBuffer({ body, maxBytes, contentLength, signal }),
    });
  } catch (error) {
    if (error instanceof TransferError) throw error;
    if (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "TimeoutError") {
      throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
    }
    throw new TransferError("RESULT_TRANSFER_FAILED", error instanceof Error ? error.message : "下载远程结果失败");
  }
}

/**
 * 安全下载真实 Provider 结果到临时文件（流式）。
 * DNS 经公网校验后通过 custom lookup 固定给连接层；手动重定向逐跳校验。
 */
export async function safeDownloadProviderVideoToTempFile(params: {
  remoteUrl: string;
  tempPath: string;
  deps?: SafeDownloadDeps;
}): Promise<SafeDownloadResult> {
  const deps = params.deps ?? {};
  const allowedHosts = deps.allowedHosts ?? getWanResultAllowedHosts();
  const maxBytes = deps.maxBytes ?? MAX_PROVIDER_VIDEO_BYTES;
  const maxRedirects = deps.maxRedirects ?? MAX_PROVIDER_REDIRECTS;
  const timeoutMs = deps.timeoutMs ?? PROVIDER_DOWNLOAD_TIMEOUT_MS;
  const connectTimeoutMs =
    deps.connectTimeoutMs ?? PROVIDER_CONNECT_TIMEOUT_MS;
  const resolveAll = deps.resolveAll ?? defaultResolveAll;
  const httpGet = deps.httpGet;

  const overall = AbortSignal.timeout(timeoutMs);
  const visited = new Set<string>();
  let currentUrl = params.remoteUrl;

  await fs.mkdir(path.dirname(params.tempPath), { recursive: true });

  const cleanup = async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await fs.unlink(params.tempPath);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  };

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (overall.aborted) {
        throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
      }

      const validated = assertValidProviderResultUrl({
        url: currentUrl,
        allowedHosts,
      });

      const normalizedKey = validated.href.split("#")[0]!;
      if (visited.has(normalizedKey)) {
        throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
      }
      visited.add(normalizedKey);

      const verified = await resolvePublicAddresses(
        validated.hostname,
        resolveAll,
      );

      const response = httpGet
        ? await httpGet(validated.href, {
            signal: overall,
            verifiedAddresses: verified,
          })
        : await nativeHttpsGet(validated, {
            signal: overall,
            verifiedAddresses: verified,
            connectTimeoutMs,
          });

      const status = response.statusCode;
      if (status >= 300 && status < 400) {
        const location = headerGet(response.headers, "location");
        if (!location) {
          throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
        }
        for await (const _chunk of response.body) {
          void _chunk;
        }
        if (hop >= maxRedirects) {
          throw new TransferError("RESULT_TOO_MANY_REDIRECTS");
        }
        let next: URL;
        try {
          next = new URL(location, validated);
        } catch {
          throw new TransferError("RESULT_REDIRECT_NOT_ALLOWED");
        }
        currentUrl = next.href;
        continue;
      }

      if (status < 200 || status >= 300) {
        throw new TransferError(
          "RESULT_TRANSFER_FAILED",
          `下载远程结果失败（HTTP ${status}）`,
        );
      }

      const contentType = headerGet(response.headers, "content-type") ?? "";
      const mimeKind = isAcceptableProviderContentType(contentType);
      if (mimeKind === "reject") {
        throw new TransferError("RESULT_CONTENT_TYPE_INVALID");
      }

      const contentLengthHeader = headerGet(response.headers, "content-length");
      const contentLength = contentLengthHeader
        ? Number(contentLengthHeader)
        : null;
      if (
        contentLength != null &&
        Number.isFinite(contentLength) &&
        contentLength > maxBytes
      ) {
        throw new TransferError("RESULT_FILE_TOO_LARGE");
      }

      const written = await streamBodyToFile({
        body: response.body,
        tempPath: params.tempPath,
        maxBytes,
        contentLength:
          contentLength != null && Number.isFinite(contentLength)
            ? contentLength
            : null,
        signal: overall,
      });

      if (written.sizeBytes <= 0) {
        throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
      }
      if (
        looksLikeHtmlOrXml(written.head) ||
        looksLikeJson(written.head) ||
        !bufferHasMp4Ftyp(written.head)
      ) {
        throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
      }

      const stat = await fs.stat(params.tempPath);
      if (stat.size !== written.sizeBytes) {
        throw new TransferError("RESULT_CONTENT_LENGTH_MISMATCH");
      }

      return {
        absolutePath: params.tempPath,
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
        contentType: contentType || "video/mp4",
      };
    }

    throw new TransferError("RESULT_TOO_MANY_REDIRECTS");
  } catch (err) {
    await cleanup();
    if (err instanceof TransferError) throw err;
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "TimeoutError"
    ) {
      throw new TransferError("RESULT_DOWNLOAD_TIMEOUT");
    }
    throw new TransferError(
      "RESULT_TRANSFER_FAILED",
      err instanceof Error ? err.message : "下载远程结果失败",
    );
  }
}
