import { describe, expect, it, afterEach, vi } from "vitest";
import { safeRandomUUID } from "@/lib/safe-random-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("safeRandomUUID", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  });

  it("uses crypto.randomUUID when available", () => {
    const spy = vi.fn(() => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: spy,
        getRandomValues: original?.getRandomValues?.bind(original),
      },
    });
    const id = safeRandomUUID();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(id).toMatch(UUID_V4);
  });

  it("falls back to getRandomValues when randomUUID is missing (HTTP LAN)", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(bytes: Uint8Array) {
          for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1;
          return bytes;
        },
      },
    });
    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4);
  });

  it("falls back to Math.random when crypto is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4);
  });

  it("returns UUID v4 shaped strings in the default environment", () => {
    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4);
  });
});
