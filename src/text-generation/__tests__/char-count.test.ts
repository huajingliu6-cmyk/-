import { describe, expect, it } from "vitest";
import {
  countVisibleChars,
  isValidTargetChars,
} from "@/text-generation/char-count";
import { truncateToVisibleCharLimit } from "@/text-generation/truncate";

describe("visible char count", () => {
  it("空格与换行不计数，标点计数", () => {
    expect(countVisibleChars("你好 世界\n！")).toBe(5);
  });

  it("targetChars 边界", () => {
    expect(isValidTargetChars(100)).toBe(true);
    expect(isValidTargetChars(1000)).toBe(true);
    expect(isValidTargetChars(99)).toBe(false);
    expect(isValidTargetChars(1001)).toBe(false);
    expect(isValidTargetChars(500.5)).toBe(false);
  });

  it("超限截断到句边界", () => {
    const text = "第一句。第二句很长很长很长。";
    const { text: cut, truncated } = truncateToVisibleCharLimit(text, 4);
    expect(truncated).toBe(true);
    expect(cut).toContain("。");
    expect(countVisibleChars(cut)).toBeLessThanOrEqual(4);
  });
});
