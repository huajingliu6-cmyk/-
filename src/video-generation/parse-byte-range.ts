export type ParsedByteRange = {
  start: number;
  end: number;
  length: number;
};

export type ParseByteRangeResult =
  | { ok: true; range: ParsedByteRange }
  | { ok: false; code: "INVALID_RANGE" | "UNSATISFIABLE" };

/**
 * 解析单一 HTTP Range：bytes=0-499 | bytes=500- | bytes=-500
 * 拒绝多 Range、非法数字、start>end、越界。
 */
export function parseSingleByteRange(
  rangeHeader: string | null | undefined,
  fileSize: number,
): ParseByteRangeResult | { ok: true; range: null } {
  if (fileSize <= 0 || !Number.isFinite(fileSize)) {
    return { ok: false, code: "UNSATISFIABLE" };
  }

  if (rangeHeader == null || rangeHeader.trim() === "") {
    return { ok: true, range: null };
  }

  const raw = rangeHeader.trim();
  if (!raw.toLowerCase().startsWith("bytes=")) {
    return { ok: false, code: "INVALID_RANGE" };
  }

  const spec = raw.slice("bytes=".length).trim();
  if (!spec || spec.includes(",")) {
    return { ok: false, code: "INVALID_RANGE" };
  }

  // bytes=-500（后缀）
  if (spec.startsWith("-")) {
    const suffixRaw = spec.slice(1);
    if (!/^\d+$/.test(suffixRaw)) {
      return { ok: false, code: "INVALID_RANGE" };
    }
    const suffix = Number(suffixRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return { ok: false, code: "INVALID_RANGE" };
    }
    const length = Math.min(suffix, fileSize);
    const start = fileSize - length;
    const end = fileSize - 1;
    return { ok: true, range: { start, end, length } };
  }

  const parts = spec.split("-");
  if (parts.length !== 2) {
    return { ok: false, code: "INVALID_RANGE" };
  }

  const [startRaw, endRaw] = parts;
  if (!startRaw || !/^\d+$/.test(startRaw)) {
    return { ok: false, code: "INVALID_RANGE" };
  }
  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0) {
    return { ok: false, code: "INVALID_RANGE" };
  }
  if (start >= fileSize) {
    return { ok: false, code: "UNSATISFIABLE" };
  }

  // bytes=500-
  if (endRaw === "") {
    const end = fileSize - 1;
    return {
      ok: true,
      range: { start, end, length: end - start + 1 },
    };
  }

  if (!/^\d+$/.test(endRaw)) {
    return { ok: false, code: "INVALID_RANGE" };
  }
  let end = Number(endRaw);
  if (!Number.isSafeInteger(end) || end < 0) {
    return { ok: false, code: "INVALID_RANGE" };
  }
  if (start > end) {
    return { ok: false, code: "INVALID_RANGE" };
  }

  // 安全截断到文件末尾
  if (end >= fileSize) {
    end = fileSize - 1;
  }

  return {
    ok: true,
    range: { start, end, length: end - start + 1 },
  };
}
