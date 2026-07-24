export type BrowserVideoMetadataInput = {
  width: number;
  height: number;
  duration: number;
};

export type NormalizedBrowserVideoMetadata = {
  actualWidth: number;
  actualHeight: number;
  actualDurationSeconds: number;
  aspectRatioLabel: string;
};

export type NormalizeBrowserMetadataResult =
  | { ok: true; value: NormalizedBrowserVideoMetadata }
  | { ok: false; code: string; message: string };

const KNOWN_RATIOS: Array<{ label: string; value: number }> = [
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
];

/** 相对误差阈值：约 2% */
const RATIO_TOLERANCE = 0.02;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * 将宽高识别为常见比例；无法匹配时返回简化整数比或「自定义比例」。
 */
export function classifyVideoAspectRatio(
  width: number,
  height: number,
): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "自定义比例";
  }

  const ratio = width / height;
  for (const candidate of KNOWN_RATIOS) {
    const diff = Math.abs(ratio - candidate.value) / candidate.value;
    if (diff <= RATIO_TOLERANCE) {
      return candidate.label;
    }
  }

  const w = Math.round(width);
  const h = Math.round(height);
  const g = gcd(w, h);
  const sw = w / g;
  const sh = h / g;
  if (sw > 0 && sh > 0 && sw <= 100 && sh <= 100) {
    return `${sw}:${sh}`;
  }
  return "自定义比例";
}

/**
 * 规范化浏览器 loadedmetadata 读数。不使用 requested/provider 填充。
 */
export function normalizeBrowserVideoMetadata(
  input: BrowserVideoMetadataInput,
): NormalizeBrowserMetadataResult {
  const { width, height, duration } = input;

  if (
    !Number.isFinite(width) ||
    !Number.isInteger(width) ||
    width <= 0
  ) {
    return {
      ok: false,
      code: "INVALID_WIDTH",
      message: "视频宽度无效",
    };
  }
  if (
    !Number.isFinite(height) ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    return {
      ok: false,
      code: "INVALID_HEIGHT",
      message: "视频高度无效",
    };
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      code: "INVALID_DURATION",
      message: "视频时长无效",
    };
  }

  const actualDurationSeconds =
    Math.round(duration * 1000) / 1000;

  if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds <= 0) {
    return {
      ok: false,
      code: "INVALID_DURATION",
      message: "视频时长无效",
    };
  }

  return {
    ok: true,
    value: {
      actualWidth: width,
      actualHeight: height,
      actualDurationSeconds,
      aspectRatioLabel: classifyVideoAspectRatio(width, height),
    },
  };
}
