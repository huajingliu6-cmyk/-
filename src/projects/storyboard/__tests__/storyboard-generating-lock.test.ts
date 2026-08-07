import { describe, expect, it } from "vitest";
import {
  isStoryboardGeneratingLockActive,
  STORYBOARD_GENERATING_STALE_MS,
} from "@/projects/storyboard/services/storyboard-generating-lock";

describe("isStoryboardGeneratingLockActive", () => {
  it("is inactive when status is not generating", () => {
    expect(
      isStoryboardGeneratingLockActive({
        status: "storyboard_incomplete",
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("is active for a fresh generating lock", () => {
    const now = Date.parse("2026-08-05T03:00:00.000Z");
    expect(
      isStoryboardGeneratingLockActive(
        {
          status: "storyboard_generating",
          updatedAt: "2026-08-05T02:58:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("is inactive after the stale window so the user can retry", () => {
    const updatedAt = "2026-08-05T02:00:00.000Z";
    const now =
      Date.parse(updatedAt) + STORYBOARD_GENERATING_STALE_MS + 1_000;
    expect(
      isStoryboardGeneratingLockActive(
        { status: "storyboard_generating", updatedAt },
        now,
      ),
    ).toBe(false);
  });

  it("is inactive when updatedAt is invalid", () => {
    expect(
      isStoryboardGeneratingLockActive({
        status: "storyboard_generating",
        updatedAt: "not-a-date",
      }),
    ).toBe(false);
  });
});
