import { describe, expect, it, vi } from "vitest";
import {
  createTextGenerationAbortScope,
  resolveTextGenerationTimeoutMs,
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

  it("uses a bounded configurable timeout", () => {
    expect(resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "90000" })).toBe(90_000);
    expect(resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "1" })).toBe(30_000);
    expect(resolveTextGenerationTimeoutMs({ TEXT_GENERATION_TIMEOUT_MS: "999999" })).toBe(600_000);
  });
});
