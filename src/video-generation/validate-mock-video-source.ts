import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/** 旧版手写 98 B 伪 MP4 的 SHA-256；禁止再当作可播放源 */
export const FORBIDDEN_PLACEHOLDER_MP4_SHA256 =
  "22e88b51d8b29a44f39161a33aaeff037a66451360dfd4e49861f79b14548e61";

const DEFAULT_RELATIVE = path.join("data", "mock", "mock-video.mp4");

const IMAGE_MAGIC: Array<{ name: string; bytes: number[] }> = [
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { name: "GIF", bytes: [0x47, 0x49, 0x46] },
  { name: "WEBP", bytes: [0x52, 0x49, 0x46, 0x46] },
];

export type MockVideoValidationOk = {
  ok: true;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  /** 基础结构验证通过；不代表浏览器一定能解码 */
  structureCheck: "basic-boxes";
};

export type MockVideoValidationErr = {
  ok: false;
  code: "MOCK_VIDEO_NOT_CONFIGURED" | "MOCK_VIDEO_INVALID";
  message: string;
};

export type MockVideoValidationResult =
  | MockVideoValidationOk
  | MockVideoValidationErr;

function startsWithBytes(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((b, i) => buf[i] === b);
}

function containsBoxType(buf: Buffer, type: string): boolean {
  return buf.includes(Buffer.from(type, "ascii"));
}

/**
 * 解析 Mock 视频源路径。
 * - 默认：`<cwd>/data/mock/mock-video.mp4`
 * - 或环境变量 MOCK_VIDEO_FILE（绝对路径或相对 cwd）
 * 客户端不可控制此路径。
 */
export function resolveMockVideoSourcePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { ok: true; absolutePath: string } | MockVideoValidationErr {
  const raw = (env.MOCK_VIDEO_FILE ?? "").trim();
  const candidate = raw
    ? path.isAbsolute(raw)
      ? raw
      : path.resolve(cwd, raw)
    : path.resolve(cwd, DEFAULT_RELATIVE);

  const resolved = path.resolve(candidate);
  const mockRoot = path.resolve(cwd, "data", "mock");

  if (raw) {
    // 显式环境变量：禁止穿越到明显危险位置；仍必须是 .mp4
    if (resolved.includes("\0")) {
      return {
        ok: false,
        code: "MOCK_VIDEO_INVALID",
        message: "MOCK_VIDEO_FILE 路径非法",
      };
    }
  } else {
    if (
      resolved !== mockRoot &&
      !resolved.startsWith(mockRoot + path.sep)
    ) {
      return {
        ok: false,
        code: "MOCK_VIDEO_INVALID",
        message: "Mock 视频路径必须位于 data/mock 目录内",
      };
    }
  }

  if (path.extname(resolved).toLowerCase() !== ".mp4") {
    return {
      ok: false,
      code: "MOCK_VIDEO_INVALID",
      message: "Mock 视频必须是 .mp4 文件",
    };
  }

  return { ok: true, absolutePath: resolved };
}

/**
 * 基础结构验证（非解码证明）：
 * 存在、普通文件、非空、非图片伪装、含 ftyp，且含 moov 或 mdat。
 * 明确拒绝已知 98 B 伪占位文件。
 */
export async function validateMockVideoSource(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<MockVideoValidationResult> {
  const resolved = resolveMockVideoSourcePath(env, cwd);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = await fs.stat(resolved.absolutePath);
  } catch {
    return {
      ok: false,
      code: "MOCK_VIDEO_NOT_CONFIGURED",
      message:
        "尚未配置可播放的本地 Mock 视频，请将一个自有 MP4 放入 data/mock/mock-video.mp4。",
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      code: "MOCK_VIDEO_INVALID",
      message: "Mock 视频路径不是普通文件",
    };
  }

  if (stat.size <= 0) {
    return {
      ok: false,
      code: "MOCK_VIDEO_INVALID",
      message: "Mock 视频文件大小为 0",
    };
  }

  const head = Buffer.alloc(Math.min(64 * 1024, stat.size));
  const fh = await fs.open(resolved.absolutePath, "r");
  try {
    await fh.read(head, 0, head.length, 0);
  } finally {
    await fh.close();
  }

  for (const magic of IMAGE_MAGIC) {
    if (startsWithBytes(head, magic.bytes)) {
      return {
        ok: false,
        code: "MOCK_VIDEO_INVALID",
        message: `Mock 视频疑似 ${magic.name} 图片伪装，不是 MP4`,
      };
    }
  }

  // ISO BMFF：ftyp 通常在文件前部
  if (!containsBoxType(head.subarray(0, Math.min(64, head.length)), "ftyp")) {
    // 再扫完整 head
    if (!containsBoxType(head, "ftyp")) {
      return {
        ok: false,
        code: "MOCK_VIDEO_INVALID",
        message: "Mock 视频缺少 MP4 ftyp box（基础结构验证失败）",
      };
    }
  }

  const sha256 = await hashFileSha256(resolved.absolutePath);
  if (sha256 === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
    return {
      ok: false,
      code: "MOCK_VIDEO_INVALID",
      message:
        "检测到旧版 98 B 伪 MP4 占位文件，不能作为可播放 Mock 源。请替换为真实短 MP4。",
    };
  }

  // 读取更多以检查 moov/mdat（大文件只读前 256KB + 末尾 256KB）
  const probe = await readProbeWindows(resolved.absolutePath, stat.size);
  const hasMoov = containsBoxType(probe, "moov");
  const hasMdat = containsBoxType(probe, "mdat");
  if (!hasMoov && !hasMdat) {
    return {
      ok: false,
      code: "MOCK_VIDEO_INVALID",
      message: "Mock 视频缺少 moov/mdat（基础结构验证失败）",
    };
  }

  return {
    ok: true,
    absolutePath: resolved.absolutePath,
    sizeBytes: stat.size,
    sha256,
    structureCheck: "basic-boxes",
  };
}

async function readProbeWindows(
  absolutePath: string,
  size: number,
): Promise<Buffer> {
  const window = 256 * 1024;
  if (size <= window * 2) {
    return fs.readFile(absolutePath);
  }
  const head = Buffer.alloc(window);
  const tail = Buffer.alloc(window);
  const fh = await fs.open(absolutePath, "r");
  try {
    await fh.read(head, 0, window, 0);
    await fh.read(tail, 0, window, size - window);
  } finally {
    await fh.close();
  }
  return Buffer.concat([head, tail]);
}

export async function hashFileSha256(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fh = await fs.open(absolutePath, "r");
  try {
    const stream = fh.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

export async function hashBufferSha256(buffer: Buffer): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}
