import { describe, expect, it } from "vitest";
import {
  resolveEpisodeDownstreamStatus,
  shouldPollEpisodeDownstream,
} from "@/projects/storyboard/episode-downstream-state";

describe("episode downstream state (one-click pipeline)", () => {
  it("shows extract CTA when script confirmed but no assets", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "not_started",
      designItemCount: 0,
      confirmedItemCount: 0,
      libraryMatchCount: 0,
      assetsExtracting: false,
      storyboardStatus: "awaiting_storyboard",
      hasStoryboard: false,
    });
    expect(status.phase).toBe("assets_not_extracted");
    expect(status.nextAction).toBe("extract_assets");
    expect(status.message).toContain("自动入库并生成分镜提示词");
  });

  it("treats review status as downstream pipeline without manual confirm", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "review",
      designItemCount: 3,
      confirmedItemCount: 0,
      libraryMatchCount: 0,
      assetsExtracting: false,
      storyboardStatus: "awaiting_storyboard",
      hasStoryboard: false,
    });
    expect(status.phase).toBe("downstream_pipeline");
    expect(status.message).toContain("正在入库资产并生成分镜提示词");
  });

  it("shows generation failed when assets exist but no active storyboard job", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "confirmed",
      designItemCount: 0,
      confirmedItemCount: 0,
      libraryMatchCount: 22,
      assetsExtracting: false,
      storyboardStatus: "awaiting_storyboard",
      hasStoryboard: false,
    });
    expect(status.phase).toBe("generation_failed");
    expect(status.nextAction).toBe("regenerate_storyboard");
    expect(status.message).toContain("重新生成分镜提示词");
  });

  it("shows generating only when production status is storyboard_generating", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "confirmed",
      designItemCount: 2,
      confirmedItemCount: 2,
      libraryMatchCount: 22,
      assetsExtracting: false,
      storyboardStatus: "storyboard_generating",
      hasStoryboard: false,
    });
    expect(status.phase).toBe("storyboard_prompt_generating");
    expect(status.nextAction).toBe("none");
  });

  it("marks storyboard ready when prompts exist", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "confirmed",
      designItemCount: 2,
      confirmedItemCount: 2,
      libraryMatchCount: 2,
      assetsExtracting: false,
      storyboardStatus: "storyboard_review",
      hasStoryboard: true,
    });
    expect(status.phase).toBe("storyboard_ready");
    expect(status.canGenerateStoryboardPrompts).toBe(true);
  });

  it("does not poll when assets are ready but generation stalled", () => {
    const status = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "confirmed",
      designItemCount: 0,
      confirmedItemCount: 0,
      libraryMatchCount: 22,
      assetsExtracting: false,
      storyboardStatus: "awaiting_storyboard",
      hasStoryboard: false,
    });
    expect(
      shouldPollEpisodeDownstream(status, {
        extractingAssets: false,
        productionStatus: "awaiting_storyboard",
      }),
    ).toBe(false);
  });

  it("polls while storyboard_generating or downstream pipeline is active", () => {
    const generating = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "confirmed",
      designItemCount: 2,
      confirmedItemCount: 2,
      libraryMatchCount: 2,
      assetsExtracting: false,
      storyboardStatus: "storyboard_generating",
      hasStoryboard: false,
    });
    expect(
      shouldPollEpisodeDownstream(generating, {
        productionStatus: "storyboard_generating",
      }),
    ).toBe(true);

    const promoting = resolveEpisodeDownstreamStatus({
      scriptConfirmed: true,
      designStatus: "review",
      designItemCount: 3,
      confirmedItemCount: 0,
      libraryMatchCount: 0,
      assetsExtracting: false,
      storyboardStatus: "awaiting_storyboard",
      hasStoryboard: false,
    });
    expect(shouldPollEpisodeDownstream(promoting)).toBe(true);
  });
});
