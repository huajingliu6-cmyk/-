import { describe, expect, it, afterEach } from "vitest";
import { safeRandomUUID } from "@/lib/safe-random-id";

describe("safeRandomUUID", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  });

  it("returns UUID-shaped string when randomUUID exists", () => {
    const id = safeRandomUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("falls back when randomUUID is missing (HTTP LAN)", () => {
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
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
