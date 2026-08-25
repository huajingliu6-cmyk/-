import { beforeEach, describe, expect, it } from "vitest";
import {
  beginGenerationBusy,
  clearGenerationBusyForTests,
  confirmGenerationLeaveIfNeeded,
  shouldBlockGenerationLeave,
} from "@/shell/generation-busy";

describe("generation-busy navigation scoping", () => {
  beforeEach(() => {
    clearGenerationBusyForTests();
  });

  it("allows entering storyboard while asset extraction is active", () => {
    beginGenerationBusy("extract-p1", "资产提取", {
      projectId: "p1",
      kind: "asset-extraction",
      taskStatus: "generating",
    });
    expect(
      shouldBlockGenerationLeave("/app/projects/p1/storyboard"),
    ).toBe(false);
    expect(
      shouldBlockGenerationLeave("/app/projects/p1/assets/library"),
    ).toBe(true);
  });

  it("does not block navigation for queued tasks", () => {
    beginGenerationBusy("prompt-q", "分镜提示词排队", {
      projectId: "p1",
      episodeId: "ep1",
      kind: "storyboard-prompt",
      taskStatus: "queued",
    });
    expect(shouldBlockGenerationLeave("/app/projects/p1/storyboard")).toBe(false);
    expect(shouldBlockGenerationLeave("/app/projects/p1/assets/library")).toBe(
      false,
    );
  });

  it("storyboard-prompt tasks never block stage navigation", () => {
    const end = beginGenerationBusy("prompt-run", "分镜提示词", {
      projectId: "p1",
      kind: "storyboard-prompt",
      taskStatus: "generating",
    });
    expect(shouldBlockGenerationLeave("/app/projects/p1/storyboard")).toBe(false);
    expect(shouldBlockGenerationLeave("/app/projects/p1/assets/library")).toBe(
      false,
    );
    end();
  });

  it("allows storyboard navigation while video batch is marked busy", async () => {
    beginGenerationBusy("video-batch", "整集视频生成提交", {
      projectId: "p1",
      episodeId: "ep1",
      kind: "storyboard-video",
      taskStatus: "generating",
    });
    expect(
      shouldBlockGenerationLeave("/app/projects/p1/storyboard"),
    ).toBe(false);
    expect(await confirmGenerationLeaveIfNeeded("/app/projects/p1/storyboard")).toBe(
      true,
    );
  });

  it("isolates blocking by project for asset extraction", () => {
    beginGenerationBusy("extract-p1", "资产提取", {
      projectId: "p1",
      kind: "asset-extraction",
      taskStatus: "generating",
    });
    expect(
      shouldBlockGenerationLeave("/app/projects/p2/assets/library"),
    ).toBe(false);
  });
});
