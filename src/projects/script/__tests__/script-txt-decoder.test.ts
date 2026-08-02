import { describe, expect, it } from "vitest";
import { decodeScriptTxtBytes } from "@/projects/script/script-txt-decoder";
import { SCRIPT_TXT_MAX_BYTES } from "@/projects/script/script-txt-constants";

function encUtf16Le(text: string): Uint8Array {
  const bom = [0xff, 0xfe];
  const body: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    body.push(code & 0xff, (code >> 8) & 0xff);
  }
  return Uint8Array.from([...bom, ...body]);
}

function encUtf16Be(text: string): Uint8Array {
  const bom = [0xfe, 0xff];
  const body: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    body.push((code >> 8) & 0xff, code & 0xff);
  }
  return Uint8Array.from([...bom, ...body]);
}

describe("decodeScriptTxtBytes", () => {
  it("decodes UTF-8", () => {
    const bytes = new TextEncoder().encode("第1集\n你好");
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.encoding).toBe("utf-8");
      expect(result.text).toContain("你好");
    }
  });

  it("decodes UTF-8 BOM", () => {
    const body = new TextEncoder().encode("hello");
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...body]);
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.encoding).toBe("utf-8-bom");
      expect(result.text).toBe("hello");
    }
  });

  it("decodes UTF-16 LE BOM", () => {
    const result = decodeScriptTxtBytes(encUtf16Le("第1集\n正文"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.encoding).toBe("utf-16le");
      expect(result.text).toContain("正文");
    }
  });

  it("decodes UTF-16 BE BOM", () => {
    const result = decodeScriptTxtBytes(encUtf16Be("Episode 1\nBody"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.encoding).toBe("utf-16be");
      expect(result.text).toContain("Body");
    }
  });

  it("decodes GB18030 Chinese fixture", () => {
    // 「第1集\n你好」 in GB18030/GBK
    const bytes = Uint8Array.from([
      0xb5, 0xda, 0x31, 0xbc, 0xaf, 0x0a, 0xc4, 0xe3, 0xba, 0xc3,
    ]);
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.encoding).toBe("gb18030");
      expect(result.text).toContain("你好");
      expect(result.text).toContain("第1集");
    }
  });

  it("rejects undecodable bytes", () => {
    // Invalid UTF-8 and unlikely valid GB18030 lead alone
    const bytes = Uint8Array.from([0xc3, 0x28]);
    const result = decodeScriptTxtBytes(bytes);
    // May fail as binary or undecodable depending on path
    expect(result.ok).toBe(false);
  });

  it("rejects NUL / binary content", () => {
    const bytes = Uint8Array.from([0x48, 0x00, 0x69, 0x00]);
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BINARY");
  });

  it("rejects empty text", () => {
    const bytes = new TextEncoder().encode("   \n\n  ");
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY");
  });

  it("rejects oversize payload", () => {
    const bytes = new Uint8Array(SCRIPT_TXT_MAX_BYTES + 1);
    bytes.fill(0x61);
    const result = decodeScriptTxtBytes(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_LARGE");
  });
});
