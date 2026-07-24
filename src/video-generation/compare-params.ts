import { resolveOutputDimensions } from "./dimensions";
import type {
  GenerationRecord,
  VideoAspectRatio,
  VideoResolution,
} from "./types";
import { isVideoAspectRatio, isVideoResolution } from "./dimensions";

export type GenerationComparisonIssue = {
  code: string;
  message: string;
};

const DURATION_TOLERANCE_SECONDS = 0.35;

function almostEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function ratioFromWH(width: number, height: number): string {
  const r = width / height;
  const candidates: Array<{ label: VideoAspectRatio; value: number }> = [
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
  ];
  let best = candidates[0]!;
  let bestDiff = Math.abs(r - best.value);
  for (const c of candidates) {
    const d = Math.abs(r - c.value);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best.label;
}

function mapProviderSr(sr: string | null): VideoResolution | null {
  if (!sr) return null;
  if (sr === "720" || sr === "720P") return "720P";
  if (sr === "1080" || sr === "1080P") return "1080P";
  if (isVideoResolution(sr)) return sr;
  return null;
}

export function compareRequestedAndActualGeneration(
  record: GenerationRecord,
): GenerationComparisonIssue[] {
  const issues: GenerationComparisonIssue[] = [];

  const providerRes = mapProviderSr(record.providerResolution);
  if (
    providerRes &&
    providerRes !== record.requestedResolution
  ) {
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

  if (
    record.actualWidth &&
    record.actualHeight &&
    record.requestedAspectRatio &&
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
      const actualRatio = ratioFromWH(record.actualWidth, record.actualHeight);
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
    !almostEqual(
      record.actualDurationSeconds,
      record.requestedDurationSeconds,
      DURATION_TOLERANCE_SECONDS,
    )
  ) {
    issues.push({
      code: "FILE_DURATION_MISMATCH",
      message: `请求 ${record.requestedDurationSeconds} 秒，实际文件为 ${record.actualDurationSeconds.toFixed(2)} 秒`,
    });
  }

  return issues;
}

export const GENERATION_DURATION_TOLERANCE_SECONDS = DURATION_TOLERANCE_SECONDS;
