import { describe, expect, it } from "vitest";
import { classifyVideoAspectRatio } from "@/video-generation/normalize-browser-metadata";
import {
  DURATION_COMPARISON_TOLERANCE_SECONDS,
  compareRequestedAndActualGeneration,
} from "@/video-generation/compare-params";
import {
  buildGenerationParameterComparisonView,
  formatParameterComparisonHistoryLabel,
  formatParameterComparisonNodeSummary,
  metadataSourceDisplayLabel,
} from "@/video-generation/parameter-comparison-view";
import type { GenerationRecord } from "@/video-generation/types";

function baseRecord(
  patch: Partial<GenerationRecord> = {},
): GenerationRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "demo",
    shotNodeId: "shot-1",
    providerId: "aliyun-wan27",
    providerModelId: "wan-test",
    providerTaskId: "task-1",
    mode: "textToVideo",
    status: "completed",
    progress: 100,
    progressLabel: "完成",
    isMock: false,
    requestSnapshot: {
      prompt: "test",
      settings: {
        resolution: "1080P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        promptExtend: false,
        watermark: false,
      },
      mediaAssetIds: [],
      unsupportedAudioLabels: [],
    },
    requestedResolution: "1080P",
    requestedAspectRatio: "16:9",
    requestedDurationSeconds: 5,
    providerResolution: "1080P",
    providerAspectRatio: "16:9",
    providerDurationSeconds: 5,
    actualWidth: 1920,
    actualHeight: 1080,
    actualDurationSeconds: 5,
    metadataSource: "browser",
    remoteVideoUrl: null,
    localVideoAssetId: "22222222-2222-4222-8222-222222222222",
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: null,
    ...patch,
  };
}

describe("parameter-comparison-view", () => {
  it("requested/provider/actual 全部一致 → matching", () => {
    const view = buildGenerationParameterComparisonView(baseRecord());
    expect(view.overallStatus).toBe("matching");
    expect(view.resolution.comparisonStatus).toBe("matching");
    expect(view.aspectRatio.comparisonStatus).toBe("matching");
    expect(view.duration.comparisonStatus).toBe("matching");
    expect(view.summaryMessage).toContain("一致");
  });

  it("requested=1080P，provider=720P → mismatch", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ providerResolution: "720P" }),
    );
    expect(view.resolution.comparisonStatus).toBe("mismatch");
    expect(view.resolution.message).toContain("请求 1080P");
    expect(view.resolution.message).toContain("720P");
    expect(view.overallStatus).toBe("mismatch");
  });

  it("requested=16:9，provider=9:16 → mismatch", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ providerAspectRatio: "9:16" }),
    );
    expect(view.aspectRatio.comparisonStatus).toBe("mismatch");
    expect(view.overallStatus).toBe("mismatch");
  });

  it("requested=5 秒，provider=10 秒 → mismatch", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ providerDurationSeconds: 10 }),
    );
    expect(view.duration.comparisonStatus).toBe("mismatch");
    expect(view.duration.message).toContain("10 秒");
    expect(view.overallStatus).toBe("mismatch");
  });

  it("requested=5 秒，actual=5.02 秒，在容差内", () => {
    expect(DURATION_COMPARISON_TOLERANCE_SECONDS).toBe(0.35);
    const view = buildGenerationParameterComparisonView(
      baseRecord({ actualDurationSeconds: 5.02 }),
    );
    expect(view.duration.comparisonStatus).toBe("matching");
    expect(view.duration.actualValue).toContain("5.020");
  });

  it("requested=5 秒，actual=5.8 秒，不一致", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ actualDurationSeconds: 5.8 }),
    );
    expect(view.duration.comparisonStatus).toBe("mismatch");
    expect(view.overallStatus).toBe("mismatch");
  });

  it("requested=9:16，actual=16:9，不一致", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        requestedAspectRatio: "9:16",
        providerAspectRatio: "9:16",
        actualWidth: 1920,
        actualHeight: 1080,
      }),
    );
    expect(view.aspectRatio.comparisonStatus).toBe("mismatch");
    expect(view.aspectRatio.message).toContain("9:16");
    expect(view.aspectRatio.message).toContain("16:9");
  });

  it("actual=1080×1920 不能判断为 1920×1080", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        requestedAspectRatio: "16:9",
        providerAspectRatio: "16:9",
        actualWidth: 1080,
        actualHeight: 1920,
      }),
    );
    expect(view.resolution.comparisonStatus).toBe("mismatch");
    expect(view.resolution.actualValue).toContain("1080 × 1920");
    expect(view.resolution.actualValue).not.toMatch(/^1920 × 1080$/);
  });

  it("1920×1080 识别为 16:9", () => {
    expect(classifyVideoAspectRatio(1920, 1080)).toBe("16:9");
  });

  it("1080×1920 识别为 9:16", () => {
    expect(classifyVideoAspectRatio(1080, 1920)).toBe("9:16");
  });

  it("1080×1080 识别为 1:1", () => {
    expect(classifyVideoAspectRatio(1080, 1080)).toBe("1:1");
  });

  it("actual metadata 缺失时显示 pending", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        actualWidth: null,
        actualHeight: null,
        actualDurationSeconds: null,
        metadataSource: "none",
      }),
    );
    expect(view.resolution.actualState).toBe("pending");
    expect(view.resolution.actualValue).toBe("等待读取实际视频文件");
    expect(view.duration.actualState).toBe("pending");
    expect(["pending", "partial"]).toContain(view.overallStatus);
  });

  it("provider 缺失且 Mock 时显示 Mock 文案", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        isMock: true,
        providerId: "mock",
        providerResolution: null,
        providerAspectRatio: null,
        providerDurationSeconds: null,
      }),
    );
    expect(view.resolution.providerValue).toBe(
      "Mock 未提供真实 Provider 参数",
    );
    expect(view.overallStatus).toBe("mockOnly");
  });

  it("provider 缺失且真实任务时显示 Provider 未返回", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        providerResolution: null,
        providerAspectRatio: null,
        providerDurationSeconds: null,
      }),
    );
    expect(view.resolution.providerValue).toBe("Provider 未返回");
    expect(view.aspectRatio.providerValue).toBe("Provider 未返回");
    expect(view.duration.providerValue).toBe("Provider 未返回");
  });

  it("metadataSource=browser 显示非服务端可信提示", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ metadataSource: "browser" }),
    );
    expect(view.metadataSourceLabel).toBe(
      "浏览器读取，非服务端可信验证",
    );
    expect(metadataSourceDisplayLabel("browser")).toContain("非服务端");
  });

  it("metadataSource=server 正确显示", () => {
    expect(metadataSourceDisplayLabel("server")).toBe("服务端读取");
  });

  it("metadataSource=provider 正确显示", () => {
    expect(metadataSourceDisplayLabel("provider")).toBe("Provider 返回");
  });

  it("首帧模式下 ratio 为 notApplicable", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        requestedAspectRatio: null,
        mode: "referenceToVideo",
      }),
    );
    expect(view.aspectRatio.requestedState).toBe("notApplicable");
    expect(view.aspectRatio.comparisonStatus).toBe("notApplicable");
    expect(view.aspectRatio.message).toContain("首帧");
    expect(view.aspectRatio.comparisonStatus).not.toBe("mismatch");
  });

  it("requested 不会填充 provider / actual；比较不修改原记录", () => {
    const record = baseRecord({
      providerResolution: null,
      providerAspectRatio: null,
      providerDurationSeconds: null,
      actualWidth: null,
      actualHeight: null,
      actualDurationSeconds: null,
    });
    const before = JSON.stringify(record);
    const view = buildGenerationParameterComparisonView(record);
    expect(JSON.stringify(record)).toBe(before);
    expect(view.resolution.providerValue).toBe("Provider 未返回");
    expect(view.resolution.actualValue).toBe("等待读取实际视频文件");
    expect(view.resolution.requestedValue).toBe("1080P");
  });

  it("provider 不会填充 actual", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        providerResolution: "720P",
        actualWidth: null,
        actualHeight: null,
      }),
    );
    expect(view.resolution.actualValue).toBe("等待读取实际视频文件");
    expect(view.resolution.providerValue).toBe("720P");
  });

  it("Mock 任务 overallStatus 始终为 mockOnly", () => {
    const matchingMock = buildGenerationParameterComparisonView(
      baseRecord({
        isMock: true,
        providerId: "mock",
        providerResolution: "1080",
        providerAspectRatio: "16:9",
        providerDurationSeconds: 5,
      }),
    );
    expect(matchingMock.overallStatus).toBe("mockOnly");
    expect(matchingMock.mockBanner).toContain("不代表真实视频模型");
    expect(formatParameterComparisonNodeSummary(matchingMock)).toBe(
      "Mock 流程验证",
    );
    expect(matchingMock.summaryMessage).not.toContain("真实模型验证通过");
    expect(matchingMock.summaryMessage).not.toContain("万相参数验证通过");
  });

  it("Mock 不会显示真实模型验证通过，且回显标记为 Mock", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        isMock: true,
        providerId: "mock",
        providerResolution: "1080",
      }),
    );
    expect(view.resolution.providerState).toBe("mock");
    expect(view.resolution.providerValue).toBe(
      "Mock 参数回显，非真实 Provider 返回",
    );
    expect(view.summaryMessage).not.toContain("万相参数验证通过");
    expect(view.summaryMessage).not.toContain("真实模型验证通过");
    expect(view.summaryMessage).not.toContain("Provider 输出一致");
  });

  it("provider 有差异时 overallStatus 为 mismatch", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ providerResolution: "720" }),
    );
    expect(view.overallStatus).toBe("mismatch");
  });

  it("actual 有差异时 overallStatus 为 mismatch", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ actualWidth: 1280, actualHeight: 720 }),
    );
    expect(view.resolution.comparisonStatus).toBe("mismatch");
    expect(view.overallStatus).toBe("mismatch");
  });

  it("部分数据缺失时 overallStatus 为 partial 或 pending", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        providerResolution: null,
        providerAspectRatio: null,
        providerDurationSeconds: null,
        actualWidth: 1920,
        actualHeight: 1080,
        actualDurationSeconds: 5,
      }),
    );
    expect(["partial", "pending"]).toContain(view.overallStatus);
  });

  it("所有数据缺失时 overallStatus 为 unknown 或 pending", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        providerResolution: null,
        providerAspectRatio: null,
        providerDurationSeconds: null,
        actualWidth: null,
        actualHeight: null,
        actualDurationSeconds: null,
        metadataSource: "none",
      }),
    );
    expect(["unknown", "pending", "partial"]).toContain(view.overallStatus);
  });

  it("UI 格式化不输出 undefined/null/NaN", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        providerResolution: null,
        actualWidth: null,
        actualHeight: null,
        actualDurationSeconds: null,
      }),
    );
    const displayValues = [
      view.resolution.requestedValue,
      view.resolution.providerValue,
      view.resolution.actualValue,
      view.aspectRatio.requestedValue,
      view.aspectRatio.providerValue,
      view.aspectRatio.actualValue,
      view.duration.requestedValue,
      view.duration.providerValue,
      view.duration.actualValue,
      view.summaryMessage,
      view.metadataSourceLabel,
    ];
    for (const value of displayValues) {
      expect(value).not.toBe("undefined");
      expect(value).not.toBe("null");
      expect(value).not.toBe("NaN");
      expect(value.toLowerCase()).not.toContain("undefined");
      expect(value.toLowerCase()).not.toContain("nan");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("时长保留合理小数位", () => {
    const view = buildGenerationParameterComparisonView(
      baseRecord({ actualDurationSeconds: 4.782 }),
    );
    expect(view.duration.actualValue).toBe("4.782 秒");
  });

  it("自定义比例显示正确", () => {
    expect(classifyVideoAspectRatio(1000, 300)).toMatch(/自定义比例|10:3/);
    const view = buildGenerationParameterComparisonView(
      baseRecord({
        actualWidth: 1000,
        actualHeight: 300,
        requestedAspectRatio: "16:9",
      }),
    );
    expect(view.aspectRatio.actualValue).toMatch(/自定义比例|10:3/);
  });

  it("历史与节点摘要文案", () => {
    const ok = buildGenerationParameterComparisonView(baseRecord());
    expect(formatParameterComparisonHistoryLabel(ok)).toBe("参数一致");
    expect(formatParameterComparisonNodeSummary(ok)).toBe("参数一致");

    const bad = buildGenerationParameterComparisonView(
      baseRecord({ providerResolution: "720P" }),
    );
    expect(formatParameterComparisonHistoryLabel(bad)).toBe("有参数差异");
    expect(formatParameterComparisonNodeSummary(bad)).toMatch(/差异/);

    const mock = buildGenerationParameterComparisonView(
      baseRecord({ isMock: true, providerId: "mock" }),
    );
    expect(formatParameterComparisonHistoryLabel(mock)).toBe("Mock");
  });

  it("issues API 与 view 共用字段隔离（不改 record）", () => {
    const record = baseRecord({
      providerResolution: "720",
      actualDurationSeconds: 5.8,
    });
    const snapshot = structuredClone(record);
    const issues = compareRequestedAndActualGeneration(record);
    expect(record).toEqual(snapshot);
    expect(issues.some((i) => i.code === "RESOLUTION_MISMATCH")).toBe(true);
    expect(issues.some((i) => i.code === "FILE_DURATION_MISMATCH")).toBe(true);
  });

  it("不发生真实外部网络请求（纯函数）", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("unexpected network");
    };
    try {
      buildGenerationParameterComparisonView(baseRecord());
      compareRequestedAndActualGeneration(baseRecord({ isMock: true }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
