import { resolveOutputDimensions } from "./dimensions";
import { classifyVideoAspectRatio } from "./normalize-browser-metadata";
import type {
  GenerationRecord,
  MetadataSource,
  VideoAspectRatio,
  VideoResolution,
} from "./types";
import { isVideoAspectRatio, isVideoResolution } from "./dimensions";
import {
  DURATION_COMPARISON_TOLERANCE_SECONDS,
  mapProviderResolution,
} from "./compare-params";

export type ParameterComparisonKey =
  | "resolution"
  | "aspectRatio"
  | "duration";

export type ParameterFieldState =
  | "available"
  | "missing"
  | "notApplicable"
  | "mock"
  | "pending"
  | "invalid";

export type ParameterRowComparisonStatus =
  | "matching"
  | "mismatch"
  | "pending"
  | "partial"
  | "unknown"
  | "notApplicable"
  | "mockOnly";

export type OverallParameterComparisonStatus =
  | "matching"
  | "mismatch"
  | "partial"
  | "pending"
  | "mockOnly"
  | "unknown";

export type ParameterComparisonRow = {
  key: ParameterComparisonKey;
  label: string;
  requestedValue: string;
  providerValue: string;
  actualValue: string;
  requestedState: Extract<
    ParameterFieldState,
    "available" | "missing" | "notApplicable"
  >;
  providerState: Extract<
    ParameterFieldState,
    "available" | "missing" | "mock" | "notApplicable"
  >;
  actualState: Extract<
    ParameterFieldState,
    "available" | "pending" | "missing" | "invalid"
  >;
  comparisonStatus: ParameterRowComparisonStatus;
  message: string;
};

export type GenerationParameterComparisonView = {
  resolution: ParameterComparisonRow;
  aspectRatio: ParameterComparisonRow;
  duration: ParameterComparisonRow;
  metadataSource: MetadataSource;
  metadataSourceLabel: string;
  overallStatus: OverallParameterComparisonStatus;
  summaryMessage: string;
  isMock: boolean;
  mockBanner: string | null;
};

export type BuildParameterComparisonOptions = {
  /** Drawer 内浏览器刚读到、尚未写回 record 的实际值 */
  actualWidth?: number | null;
  actualHeight?: number | null;
  actualDurationSeconds?: number | null;
  metadataSource?: MetadataSource;
};

const MISSING_REQUESTED = "未记录请求参数";
const MISSING_PROVIDER_MOCK = "Mock 未提供真实 Provider 参数";
const MOCK_PROVIDER_ECHO = "Mock 参数回显，非真实 Provider 返回";
const MISSING_PROVIDER_REAL = "Provider 未返回";
const PENDING_ACTUAL = "等待读取实际视频文件";
const FAILED_ACTUAL = "实际视频参数读取失败";

export function metadataSourceDisplayLabel(
  source: MetadataSource,
): string {
  switch (source) {
    case "browser":
      return "浏览器读取，非服务端可信验证";
    case "provider":
      return "Provider 返回";
    case "server":
      return "服务端读取";
    case "none":
    default:
      return "尚未验证";
  }
}

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return FAILED_ACTUAL;
  const rounded = Math.round(seconds * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return `${Math.round(rounded)} 秒`;
  }
  return `${rounded.toFixed(3)} 秒`;
}

function formatRequestedDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return MISSING_REQUESTED;
  return `${seconds} 秒`;
}

function formatActualPixels(width: number, height: number): string {
  return `${width} × ${height}`;
}

function almostEqualDuration(a: number, b: number): boolean {
  return Math.abs(a - b) <= DURATION_COMPARISON_TOLERANCE_SECONDS;
}

function inferResolutionHint(
  width: number,
  height: number,
  requested: VideoResolution,
  aspect: VideoAspectRatio | null,
): string | null {
  if (!aspect || !isVideoAspectRatio(aspect)) return null;
  const expected = resolveOutputDimensions(requested, aspect);
  if (expected.width === width && expected.height === height) {
    return `接近 ${requested} 目标尺寸`;
  }
  return null;
}

function pickActual(
  record: GenerationRecord,
  options?: BuildParameterComparisonOptions,
): {
  width: number | null;
  height: number | null;
  duration: number | null;
  metadataSource: MetadataSource;
} {
  const width =
    options?.actualWidth !== undefined
      ? options.actualWidth
      : record.actualWidth;
  const height =
    options?.actualHeight !== undefined
      ? options.actualHeight
      : record.actualHeight;
  const duration =
    options?.actualDurationSeconds !== undefined
      ? options.actualDurationSeconds
      : record.actualDurationSeconds;
  const metadataSource =
    options?.metadataSource ?? record.metadataSource ?? "none";
  return {
    width: width ?? null,
    height: height ?? null,
    duration: duration ?? null,
    metadataSource,
  };
}

function buildResolutionRow(
  record: GenerationRecord,
  actual: ReturnType<typeof pickActual>,
): ParameterComparisonRow {
  const isMock = record.isMock;
  const requestedRaw = record.requestedResolution;
  const requestedState: ParameterComparisonRow["requestedState"] =
    requestedRaw && isVideoResolution(requestedRaw)
      ? "available"
      : "missing";
  const requestedValue =
    requestedState === "available" ? requestedRaw : MISSING_REQUESTED;

  const providerMapped = mapProviderResolution(record.providerResolution);
  let providerState: ParameterComparisonRow["providerState"];
  let providerValue: string;
  if (isMock) {
    if (record.providerResolution) {
      providerState = "mock";
      providerValue = MOCK_PROVIDER_ECHO;
    } else {
      providerState = "missing";
      providerValue = MISSING_PROVIDER_MOCK;
    }
  } else if (providerMapped) {
    providerState = "available";
    providerValue = providerMapped;
  } else if (record.providerResolution) {
    providerState = "available";
    providerValue = record.providerResolution;
  } else {
    providerState = "missing";
    providerValue = MISSING_PROVIDER_REAL;
  }

  let actualState: ParameterComparisonRow["actualState"];
  let actualValue: string;
  if (
    actual.width != null &&
    actual.height != null &&
    actual.width > 0 &&
    actual.height > 0
  ) {
    actualState = "available";
    const hint =
      requestedState === "available"
        ? inferResolutionHint(
            actual.width,
            actual.height,
            requestedRaw,
            record.requestedAspectRatio,
          )
        : null;
    actualValue = hint
      ? `${formatActualPixels(actual.width, actual.height)}（${hint}，系统推断）`
      : formatActualPixels(actual.width, actual.height);
  } else if (
    actual.width === 0 ||
    actual.height === 0 ||
    (actual.width != null && actual.width < 0) ||
    (actual.height != null && actual.height < 0)
  ) {
    actualState = "invalid";
    actualValue = FAILED_ACTUAL;
  } else {
    actualState = "pending";
    actualValue = PENDING_ACTUAL;
  }

  let comparisonStatus: ParameterRowComparisonStatus = "unknown";
  let message = "当前没有足够数据完成分辨率比较。";

  if (isMock) {
    comparisonStatus = "mockOnly";
    if (
      actualState === "available" &&
      requestedState === "available" &&
      record.requestedAspectRatio &&
      isVideoAspectRatio(record.requestedAspectRatio)
    ) {
      const expected = resolveOutputDimensions(
        requestedRaw,
        record.requestedAspectRatio,
      );
      if (
        actual.width === expected.width &&
        actual.height === expected.height
      ) {
        message = "Mock 流程记录一致（不能证明真实模型能力）。";
      } else {
        message = `Mock 实际文件为 ${actual.width}×${actual.height}，与请求目标 ${expected.width}×${expected.height} 不同（非真实模型失败）。`;
      }
    } else if (actualState === "pending") {
      message = "Mock 任务等待读取实际视频文件。";
    } else {
      message = "Mock 仅验证应用流程，不代表真实模型参数能力。";
    }
  } else {
    // requested vs provider
    if (
      requestedState === "available" &&
      providerState === "available" &&
      providerMapped &&
      providerMapped !== requestedRaw
    ) {
      comparisonStatus = "mismatch";
      message = `请求 ${requestedRaw}，Provider 返回 ${providerMapped}`;
    } else if (
      actualState === "available" &&
      requestedState === "available"
    ) {
      if (
        !record.requestedAspectRatio ||
        !isVideoAspectRatio(record.requestedAspectRatio)
      ) {
        comparisonStatus = "unknown";
        message = "比例由首帧决定，无法按请求比例比较";
      } else {
        const expected = resolveOutputDimensions(
          requestedRaw,
          record.requestedAspectRatio,
        );
        if (
          actual.width === expected.width &&
          actual.height === expected.height
        ) {
          if (
            providerState === "missing" ||
            (providerMapped && providerMapped === requestedRaw) ||
            providerState === "available"
          ) {
            comparisonStatus =
              providerState === "missing" ? "partial" : "matching";
            message =
              providerState === "missing"
                ? "实际分辨率与请求目标一致，Provider 分辨率未返回。"
                : "请求参数与实际视频分辨率一致。";
          }
        } else {
          comparisonStatus = "mismatch";
          message = `请求目标 ${expected.width}×${expected.height}，实际文件为 ${actual.width}×${actual.height}`;
        }
      }
    } else if (actualState === "pending") {
      comparisonStatus = "pending";
      message = PENDING_ACTUAL;
    } else if (actualState === "invalid") {
      comparisonStatus = "unknown";
      message = FAILED_ACTUAL;
    } else if (providerState === "missing" && requestedState === "available") {
      comparisonStatus = "partial";
      message = MISSING_PROVIDER_REAL;
    }
  }

  return {
    key: "resolution",
    label: "分辨率",
    requestedValue,
    providerValue,
    actualValue,
    requestedState,
    providerState,
    actualState,
    comparisonStatus,
    message,
  };
}

function buildAspectRatioRow(
  record: GenerationRecord,
  actual: ReturnType<typeof pickActual>,
): ParameterComparisonRow {
  const isMock = record.isMock;
  const firstFrameMode = record.requestedAspectRatio == null;

  let requestedState: ParameterComparisonRow["requestedState"];
  let requestedValue: string;
  if (firstFrameMode) {
    requestedState = "notApplicable";
    requestedValue = "不适用";
  } else if (
    record.requestedAspectRatio &&
    isVideoAspectRatio(record.requestedAspectRatio)
  ) {
    requestedState = "available";
    requestedValue = record.requestedAspectRatio;
  } else {
    requestedState = "missing";
    requestedValue = MISSING_REQUESTED;
  }

  let providerState: ParameterComparisonRow["providerState"];
  let providerValue: string;
  if (isMock) {
    if (record.providerAspectRatio) {
      providerState = "mock";
      providerValue = MOCK_PROVIDER_ECHO;
    } else {
      providerState = "missing";
      providerValue = MISSING_PROVIDER_MOCK;
    }
  } else if (record.providerAspectRatio) {
    providerState = "available";
    providerValue = record.providerAspectRatio;
  } else {
    providerState = "missing";
    providerValue = MISSING_PROVIDER_REAL;
  }

  let actualState: ParameterComparisonRow["actualState"];
  let actualValue: string;
  let actualLabel: string | null = null;
  if (
    actual.width != null &&
    actual.height != null &&
    actual.width > 0 &&
    actual.height > 0
  ) {
    actualState = "available";
    actualLabel = classifyVideoAspectRatio(actual.width, actual.height);
    if (isVideoAspectRatio(actualLabel)) {
      actualValue = actualLabel;
    } else if (actualLabel === "自定义比例") {
      actualValue = "自定义比例";
    } else {
      actualValue = `自定义比例（${actualLabel}）`;
    }
  } else {
    actualState = "pending";
    actualValue = PENDING_ACTUAL;
  }

  let comparisonStatus: ParameterRowComparisonStatus = "unknown";
  let message = "当前没有足够数据完成画面比例比较。";

  if (firstFrameMode) {
    comparisonStatus = "notApplicable";
    message = "已使用首帧，画面比例由首帧决定";
    if (isMock) {
      comparisonStatus = "mockOnly";
      message = "已使用首帧，画面比例由首帧决定（Mock 流程）。";
    }
  } else if (isMock) {
    comparisonStatus = "mockOnly";
    if (
      actualState === "available" &&
      requestedState === "available" &&
      actualLabel === record.requestedAspectRatio
    ) {
      message = "Mock 流程记录一致（不能证明真实模型能力）。";
    } else if (
      actualState === "available" &&
      requestedState === "available"
    ) {
      message = `请求 ${record.requestedAspectRatio}，实际文件为 ${actualValue}（Mock 差异，非真实模型失败）。`;
    } else {
      message = "Mock 仅验证应用流程，不代表真实模型参数能力。";
    }
  } else if (
    requestedState === "available" &&
    providerState === "available" &&
    record.providerAspectRatio !== record.requestedAspectRatio
  ) {
    comparisonStatus = "mismatch";
    message = `请求 ${record.requestedAspectRatio}，Provider 返回 ${record.providerAspectRatio}`;
  } else if (
    actualState === "available" &&
    requestedState === "available" &&
    actualLabel !== record.requestedAspectRatio
  ) {
    comparisonStatus = "mismatch";
    message = `请求 ${record.requestedAspectRatio}，实际文件为 ${actualValue}`;
  } else if (
    actualState === "available" &&
    requestedState === "available" &&
    actualLabel === record.requestedAspectRatio
  ) {
    comparisonStatus =
      providerState === "missing" ? "partial" : "matching";
    message =
      providerState === "missing"
        ? "实际比例与请求一致，Provider 比例未返回。"
        : "请求参数与实际视频比例一致。";
  } else if (actualState === "pending") {
    comparisonStatus = "pending";
    message = PENDING_ACTUAL;
  } else if (providerState === "missing") {
    comparisonStatus = "partial";
    message = MISSING_PROVIDER_REAL;
  }

  return {
    key: "aspectRatio",
    label: "画面比例",
    requestedValue,
    providerValue,
    actualValue,
    requestedState,
    providerState,
    actualState,
    comparisonStatus,
    message,
  };
}

function buildDurationRow(
  record: GenerationRecord,
  actual: ReturnType<typeof pickActual>,
): ParameterComparisonRow {
  const isMock = record.isMock;
  const requested = record.requestedDurationSeconds;
  const requestedState: ParameterComparisonRow["requestedState"] =
    Number.isFinite(requested) && requested > 0 ? "available" : "missing";
  const requestedValue =
    requestedState === "available"
      ? formatRequestedDuration(requested)
      : MISSING_REQUESTED;

  let providerState: ParameterComparisonRow["providerState"];
  let providerValue: string;
  const providerDur = record.providerDurationSeconds;
  if (isMock) {
    if (providerDur != null && Number.isFinite(providerDur)) {
      providerState = "mock";
      providerValue = MOCK_PROVIDER_ECHO;
    } else {
      providerState = "missing";
      providerValue = MISSING_PROVIDER_MOCK;
    }
  } else if (providerDur != null && Number.isFinite(providerDur)) {
    providerState = "available";
    providerValue = formatRequestedDuration(providerDur);
  } else {
    providerState = "missing";
    providerValue = MISSING_PROVIDER_REAL;
  }

  let actualState: ParameterComparisonRow["actualState"];
  let actualValue: string;
  if (actual.duration != null && Number.isFinite(actual.duration) && actual.duration > 0) {
    actualState = "available";
    actualValue = formatDurationSeconds(actual.duration);
  } else if (actual.duration != null && !(actual.duration > 0)) {
    actualState = "invalid";
    actualValue = FAILED_ACTUAL;
  } else {
    actualState = "pending";
    actualValue = PENDING_ACTUAL;
  }

  let comparisonStatus: ParameterRowComparisonStatus = "unknown";
  let message = "当前没有足够数据完成时长比较。";

  if (isMock) {
    comparisonStatus = "mockOnly";
    if (
      actualState === "available" &&
      requestedState === "available" &&
      almostEqualDuration(actual.duration!, requested)
    ) {
      message = "Mock 流程记录一致（不能证明真实模型能力）。";
    } else if (actualState === "available" && requestedState === "available") {
      message = `请求 ${requested} 秒，实际文件为 ${formatDurationSeconds(actual.duration!)}（Mock 差异，非真实模型失败）。`;
    } else {
      message = "Mock 仅验证应用流程，不代表真实模型参数能力。";
    }
  } else if (
    requestedState === "available" &&
    providerState === "available" &&
    providerDur != null &&
    !almostEqualDuration(providerDur, requested)
  ) {
    comparisonStatus = "mismatch";
    message = `请求 ${requested} 秒，Provider 返回 ${providerDur} 秒`;
  } else if (
    actualState === "available" &&
    requestedState === "available" &&
    !almostEqualDuration(actual.duration!, requested)
  ) {
    comparisonStatus = "mismatch";
    message = `请求 ${requested} 秒，实际文件为 ${formatDurationSeconds(actual.duration!)}`;
  } else if (
    actualState === "available" &&
    providerState === "available" &&
    providerDur != null &&
    !almostEqualDuration(actual.duration!, providerDur)
  ) {
    comparisonStatus = "mismatch";
    message = `Provider 返回 ${providerDur} 秒，实际文件为 ${formatDurationSeconds(actual.duration!)}`;
  } else if (
    actualState === "available" &&
    requestedState === "available" &&
    almostEqualDuration(actual.duration!, requested)
  ) {
    comparisonStatus =
      providerState === "missing" ? "partial" : "matching";
    message =
      providerState === "missing"
        ? "实际时长与请求一致，Provider 时长未返回。"
        : "请求参数与实际视频时长一致。";
  } else if (actualState === "pending") {
    comparisonStatus = "pending";
    message = PENDING_ACTUAL;
  } else if (actualState === "invalid") {
    comparisonStatus = "unknown";
    message = FAILED_ACTUAL;
  } else if (providerState === "missing") {
    comparisonStatus = "partial";
    message = MISSING_PROVIDER_REAL;
  }

  return {
    key: "duration",
    label: "视频时长",
    requestedValue,
    providerValue,
    actualValue,
    requestedState,
    providerState,
    actualState,
    comparisonStatus,
    message,
  };
}

function summarizeOverall(
  isMock: boolean,
  rows: ParameterComparisonRow[],
): {
  overallStatus: OverallParameterComparisonStatus;
  summaryMessage: string;
} {
  if (isMock) {
    return {
      overallStatus: "mockOnly",
      summaryMessage:
        "Mock 仅验证应用流程，不代表真实模型参数能力。",
    };
  }

  const comparable = rows.filter(
    (r) =>
      r.comparisonStatus !== "notApplicable" &&
      r.comparisonStatus !== "mockOnly",
  );
  const mismatches = comparable.filter((r) => r.comparisonStatus === "mismatch");
  if (mismatches.length > 0) {
    return {
      overallStatus: "mismatch",
      summaryMessage: `检测到 ${mismatches.length} 项参数差异，请查看详细对照。`,
    };
  }

  const pendings = comparable.filter((r) => r.comparisonStatus === "pending");
  const partials = comparable.filter((r) => r.comparisonStatus === "partial");
  const matchings = comparable.filter((r) => r.comparisonStatus === "matching");
  const unknowns = comparable.filter((r) => r.comparisonStatus === "unknown");

  if (matchings.length === comparable.length && comparable.length > 0) {
    return {
      overallStatus: "matching",
      summaryMessage: "请求参数、Provider 返回和实际视频文件一致。",
    };
  }

  if (pendings.length === comparable.length) {
    return {
      overallStatus: "pending",
      summaryMessage: "视频参数尚未完整读取。",
    };
  }

  if (unknowns.length === comparable.length) {
    return {
      overallStatus: "unknown",
      summaryMessage: "当前没有足够数据完成参数比较。",
    };
  }

  if (partials.length > 0 || pendings.length > 0 || unknowns.length > 0) {
    if (matchings.length > 0 || partials.length > 0) {
      return {
        overallStatus: "partial",
        summaryMessage: "部分参数已验证，仍有数据缺失。",
      };
    }
    return {
      overallStatus: "pending",
      summaryMessage: "视频参数尚未完整读取。",
    };
  }

  return {
    overallStatus: "unknown",
    summaryMessage: "当前没有足够数据完成参数比较。",
  };
}

/**
 * 展示层派生对照模型。不修改入参 GenerationRecord，也不持久化。
 */
export function buildGenerationParameterComparisonView(
  record: GenerationRecord,
  options?: BuildParameterComparisonOptions,
): GenerationParameterComparisonView {
  const actual = pickActual(record, options);
  const resolution = buildResolutionRow(record, actual);
  const aspectRatio = buildAspectRatioRow(record, actual);
  const duration = buildDurationRow(record, actual);
  const { overallStatus, summaryMessage } = summarizeOverall(record.isMock, [
    resolution,
    aspectRatio,
    duration,
  ]);

  return {
    resolution,
    aspectRatio,
    duration,
    metadataSource: actual.metadataSource,
    metadataSourceLabel: metadataSourceDisplayLabel(actual.metadataSource),
    overallStatus,
    summaryMessage,
    isMock: record.isMock,
    mockBanner: record.isMock
      ? "Mock 结果只用于验证应用流程、视频播放和参数记录，不代表真实视频模型会按照这些参数生成。"
      : null,
  };
}

export function formatParameterComparisonNodeSummary(
  view: GenerationParameterComparisonView,
): string {
  if (view.isMock) {
    const dims = view.resolution;
    if (
      dims.comparisonStatus === "mockOnly" &&
      dims.actualState === "available" &&
      dims.message.includes("不同")
    ) {
      return "Mock 实际文件与请求参数不同";
    }
    return "Mock 流程验证";
  }

  switch (view.overallStatus) {
    case "matching":
      return "参数一致";
    case "mismatch": {
      const n = [view.resolution, view.aspectRatio, view.duration].filter(
        (r) => r.comparisonStatus === "mismatch",
      ).length;
      return n === 1 ? "存在 1 项差异" : `存在 ${n} 项差异`;
    }
    case "pending":
      return "等待实际视频验证";
    case "partial":
      if (
        [view.resolution, view.aspectRatio, view.duration].some(
          (r) => r.providerState === "missing",
        )
      ) {
        return "Provider 参数未返回";
      }
      return "等待实际视频验证";
    case "unknown":
    default:
      return "Provider 参数未返回";
  }
}

export function formatParameterComparisonHistoryLabel(
  view: GenerationParameterComparisonView,
): string {
  if (view.isMock) return "Mock";
  switch (view.overallStatus) {
    case "matching":
      return "参数一致";
    case "mismatch":
      return "有参数差异";
    case "pending":
    case "partial":
      return "待验证";
    case "unknown":
    default:
      return "数据不足";
  }
}

export function formatParameterRowStatusLabel(
  status: ParameterRowComparisonStatus,
): string {
  switch (status) {
    case "matching":
      return "一致";
    case "mismatch":
      return "存在差异";
    case "pending":
      return "等待验证";
    case "partial":
      return "部分验证";
    case "notApplicable":
      return "不适用";
    case "mockOnly":
      return "Mock 数据";
    case "unknown":
    default:
      return "未返回";
  }
}

/** 历史列表在无 GenerationRecord 时的降级文案（不发起网络请求）。 */
export function formatHistoryLabelFromAssetFlags(flags: {
  isVideo: boolean;
  isMock: boolean;
  hasGenerationView?: boolean;
}): string | null {
  if (!flags.isVideo) return null;
  if (flags.isMock) return "Mock";
  if (!flags.hasGenerationView) return "数据不足";
  return null;
}
