import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, sha256HexSync } from "@/projects/script/sha256-hex";
import { episodeContentFingerprint } from "@/projects/script/script-split-reconstruct";
import { episodeContentFingerprintClient } from "@/projects/script/script-split-client";

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("sha256Hex (LAN HTTP fallback)", () => {
  it("sync fallback matches Node crypto for empty and common strings", () => {
    const samples = ["", "abc", "hello\r\nworld", "第1集\n正文"];
    for (const text of samples) {
      const bytes = new TextEncoder().encode(text);
      expect(sha256HexSync(bytes)).toBe(nodeSha256(bytes));
    }
  });

  it("async helper matches Node crypto", async () => {
    const bytes = new TextEncoder().encode("confirm-script-fingerprint");
    expect(await sha256Hex(bytes)).toBe(nodeSha256(bytes));
  });

  it("episode fingerprint client matches server fingerprint", async () => {
    const text = "第1集\r\n对白一行\n场景：夜";
    expect(await episodeContentFingerprintClient(text)).toBe(
      episodeContentFingerprint(text),
    );
  });

  it("sync path works when subtle is unavailable", async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: original?.randomUUID },
    });
    try {
      const text = "insecure-context-hash";
      expect(await episodeContentFingerprintClient(text)).toBe(
        episodeContentFingerprint(text),
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: original,
      });
    }
  });
});
