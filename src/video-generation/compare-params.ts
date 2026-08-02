import { resolveOutputDimensions } from "./dimensions";
import { classifyVideoAspectRatio } from "./normalize-browser-metadata";
import type {
  GenerationRecord,
  VideoResolution,
} from "./types";
import { isVideoAspectRatio, isVideoResolution } from "./dimensions";

export type GenerationComparisonIssue = {
  code: string;
  message: string;
};

/**
 * 时长比较容差（秒）。
 * 用于容纳编码与容器时长的小数偏差（例如请求 5 秒、实际 5.02 秒仍视为一致）；
 * 明显偏差（如 5.8 秒）不得判为编码误差。
 */
export const DURATION_COMPARISON_TOLERANCE_SECONDS = 0.35;

/** @deprecated 使用 DURATION_COMPARISON_TOLERANCE_SECONDS */
export const GENERATION_DURATION_TOLERANCE_SECONDS =
  DURATION_COMPARISON_TOLERANCE_SECONDS;

export function almostEqualDuration(
  a: number,
  b: number,
  tol: number = DURATION_COMPARISON_TOLERANCE_SECONDS,
): boolean {
  return Math.abs(a - b) <= tol;
}

/** 将 Provider 侧分辨率字符串规范为 VideoResolution。 */
export function mapProviderResolution(
  sr: string | null | undefined,
): VideoResolution | null {
  if (!sr) return null;
  if (sr === "480" || sr === "480P") return "480P";
  if (sr === "720" || sr === "720P") return "720P";
  if (sr === "1080" || sr === "1080P") return "1080P";
  if (isVideoResolution(sr)) return sr;
  return null;
}

/**
 * 服务端/API 用的差异列表（派生自同一套字段隔离规则）。
 * 不修改 record；不把 requested 填入 provider/actual。
 */
export function compareRequestedAndActualGeneration(
  record: GenerationRecord,
): GenerationComparisonIssue[] {
  const issues: GenerationComparisonIssue[] = [];

  const providerRes = mapProviderResolution(record.providerResolution);
  if (providerRes && providerRes !== record.requestedResolution) {
    issues.push({
      code: "RESOLUTION_MISMATCH",
      message: `请求 ${record.requestedResolution}，Provider 返回 ${providerRes}`,
    });
  }

  if (
    record.requestedAspectRatio &&
    record.providerAspectRatio &&
    record.providerAspectRatio !== record.requestedAspectRatio
  ) {
    issues.push({
      code: "PROVIDER_RATIO_MISMATCH",
      message: `请求 ${record.requestedAspectRatio}，Provider 返回 ${record.providerAspectRatio}`,
    });
  }

  if (
    record.providerDurationSeconds !== null &&
    record.providerDurationSeconds !== record.requestedDurationSeconds
  ) {
    issues.push({
      code: "PROVIDER_DURATION_MISMATCH",
      message: `请求 ${record.requestedDurationSeconds} 秒，Provider 返回 ${record.providerDurationSeconds} 秒`,
    });
  }

  // 首帧：请求比例为空时不做 requested↔actual 比例/目标宽高硬比较
  if (record.requestedAspectRatio == null) {
    // no FILE_RATIO / FILE_DIMENSION from requested ratio
  } else if (
    record.actualWidth &&
    record.actualHeight &&
    isVideoAspectRatio(record.requestedAspectRatio)
  ) {
    const expected = resolveOutputDimensions(
      record.requestedResolution,
      record.requestedAspectRatio,
    );
    if (
      record.actualWidth !== expected.width ||
      record.actualHeight !== expected.height
    ) {
      const actualRatio = classifyVideoAspectRatio(
        record.actualWidth,
        record.actualHeight,
      );
      if (actualRatio !== record.requestedAspectRatio) {
        issues.push({
          code: "FILE_RATIO_MISMATCH",
          message: `请求 ${record.requestedAspectRatio}，实际文件为 ${actualRatio}（${record.actualWidth}×${record.actualHeight}）`,
        });
      } else {
        issues.push({
          code: "FILE_DIMENSION_MISMATCH",
          message: `请求目标约 ${expected.width}×${expected.height}，实际文件为 ${record.actualWidth}×${record.actualHeight}`,
        });
      }
    }
  }

  if (
    record.actualDurationSeconds !== null &&
    !almostEqualDuration(
      record.actualDurationSeconds,
      record.requestedDurationSeconds,
    )
  ) {
    issues.push({
      code: "FILE_DURATION_MISMATCH",
      message: `请求 ${record.requestedDurationSeconds} 秒，实际文件为 ${record.actualDurationSeconds.toFixed(3)} 秒`,
    });
  }

  return issues;
}
