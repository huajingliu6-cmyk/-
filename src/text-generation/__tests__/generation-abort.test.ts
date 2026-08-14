import { describe, expect, it, vi } from "vitest";
import {
  createTextGenerationAbortScope,
  resolveScriptAssetDesignTimeoutMs,
  resolveTextGenerationTimeoutMs,
  resolveTimeoutMsForOutputKind,
} from "@/text-generation/generation-abort";

describe("text generation abort scope", () => {
  it("aborts on timeout and records the timeout cause", () => {
    vi.useFakeTimers();
    const scope = createTextGenerationAbortScope(undefined, 50);

    vi.advanceTimersByTime(49);
    expect(scope.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(scope.controller.signal.aborted).toBe(true);
    expect(scope.didTimeout()).toBe(true);

    scope.dispose();
    vi.useRealTimers();
  });

  it("propagates browser disconnect without reporting a timeout", () => {
    const upstream = new AbortController();
    const scope = createTextGenerationAbortScope(upstream.signal, 60_000);

    upstream.abort();
    expect(scope.controller.signal.aborted).toBe(true);
    expect(scope.didTimeout()).toBe(false);
    scope.dispose();
  });

  it("uses 170000ms default for ordinary text tasks", () => {
    expect(resolveTextGenerationTimeoutMs({})).toBe(170_000);
    expect(resolveTimeoutMsForOutputKind("story", {})).toBe(170_000);
    expect(resolveTimeoutMsForOutputKind("episode_asset_design", {})).toBe(
      170_000,
    );
  });

  it("uses 600000ms default for script_asset_design", () => {
    expect(resolveScriptAssetDesignTimeoutMs({})).toBe(600_000);
    expect(resolveTimeoutMsForOutputKind("script_asset_design", {})).toBe(
      600_000,
    );
  });

  it("applies env overrides with bounds for ordinary tasks", () => {
    expect(
      resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "90000" }),
    ).toBe(90_000);
    expect(
      resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "1" }),
    ).toBe(30_000);
    expect(
      resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "999999" }),
    ).toBe(600_000);
  });

  it("applies SCRIPT_ASSET_DESIGN_TIMEOUT_MS with its own bounds", () => {
    expect(
      resolveScriptAssetDesignTimeoutMs({
        SCRIPT_ASSET_DESIGN_TIMEOUT_MS: "480000",
      }),
    ).toBe(480_000);
    expect(
      resolveScriptAssetDesignTimeoutMs({
        SCRIPT_ASSET_DESIGN_TIMEOUT_MS: "1000",
      }),
    ).toBe(60_000);
    expect(
      resolveScriptAssetDesignTimeoutMs({
        SCRIPT_ASSET_DESIGN_TIMEOUT_MS: "9999999",
      }),
    ).toBe(1_200_000);
    // Ordinary TEXT_GENERATION_TIMEOUT_MS must not change script_asset_design default.
    expect(
      resolveTimeoutMsForOutputKind("script_asset_design", {
        TEXT_GENERATION_TIMEOUT_MS: "90000",
      }),
    ).toBe(600_000);
  });
});
