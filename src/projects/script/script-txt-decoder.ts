import {
  SCRIPT_TXT_MAX_BYTES,
  type ScriptTxtEncoding,
} from "@/projects/script/script-txt-constants";

export type ScriptTxtDecodeOk = {
  ok: true;
  text: string;
  encoding: ScriptTxtEncoding;
};

export type ScriptTxtDecodeErr = {
  ok: false;
  code: "TOO_LARGE" | "EMPTY" | "BINARY" | "UNDECODEABLE";
  message: string;
};

export type ScriptTxtDecodeResult = ScriptTxtDecodeOk | ScriptTxtDecodeErr;

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  );
}

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
}

function stripTrailingNuls(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0) end -= 1;
  return text.slice(0, end);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimOuterWhitespace(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}

/**
 * Non-semantic normalize only: drop BOM already handled by decoder slice,
 * unify newlines, strip trailing NULs, trim outermost whitespace.
 */
export function normalizeScriptTxt(text: string): string {
  return trimOuterWhitespace(normalizeNewlines(stripTrailingNuls(text)));
}

function countControlChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0) return Number.POSITIVE_INFINITY;
    // Allow TAB / LF / CR; reject other C0 controls and DEL.
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      n += 1;
    }
  }
  return n;
}

function looksBinaryBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let nul = 0;
  let suspicious = 0;
  const sample = Math.min(bytes.length, 8192);
  for (let i = 0; i < sample; i += 1) {
    const b = bytes[i]!;
    if (b === 0) nul += 1;
    // High proportion of non-text C0 (excl. tab/lf/cr) suggests binary.
    if (b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f) suspicious += 1;
  }
  if (nul > 0 && !hasUtf16LeBom(bytes) && !hasUtf16BeBom(bytes)) return true;
  return suspicious / sample > 0.3;
}

function tryDecode(
  bytes: Uint8Array,
  label: string,
  fatal: boolean,
): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

function validateDecodedText(raw: string): ScriptTxtDecodeErr | null {
  if (raw.includes("\u0000")) {
    return {
      ok: false,
      code: "BINARY",
      message: "文本包含非法空字符，无法作为剧本导入",
    };
  }
  const normalized = normalizeScriptTxt(raw);
  if (!normalized) {
    return {
      ok: false,
      code: "EMPTY",
      message: "文本为空或仅包含空白字符",
    };
  }
  const controls = countControlChars(normalized);
  if (controls === Number.POSITIVE_INFINITY) {
    return {
      ok: false,
      code: "BINARY",
      message: "文本包含非法空字符，无法作为剧本导入",
    };
  }
  if (normalized.length > 0 && controls / normalized.length > 0.05) {
    return {
      ok: false,
      code: "BINARY",
      message: "文本控制字符比例异常，疑似二进制文件",
    };
  }
  return null;
}

/**
 * Decode TXT bytes: BOM → UTF-8 fatal → GB18030 fatal.
 */
export function decodeScriptTxtBytes(
  bytes: Uint8Array,
): ScriptTxtDecodeResult {
  if (bytes.byteLength > SCRIPT_TXT_MAX_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      message: `文件超过 ${SCRIPT_TXT_MAX_BYTES} 字节上限`,
    };
  }
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      code: "EMPTY",
      message: "文件为空",
    };
  }

  if (hasUtf8Bom(bytes)) {
    const decoded = tryDecode(bytes.subarray(3), "utf-8", true);
    if (decoded === null) {
      return {
        ok: false,
        code: "UNDECODEABLE",
        message: "无法识别文本编码",
      };
    }
    const err = validateDecodedText(decoded);
    if (err) return err;
    return {
      ok: true,
      text: normalizeScriptTxt(decoded),
      encoding: "utf-8-bom",
    };
  }

  if (hasUtf16LeBom(bytes)) {
    const decoded = tryDecode(bytes, "utf-16le", true);
    if (decoded === null) {
      return {
        ok: false,
        code: "UNDECODEABLE",
        message: "无法识别文本编码",
      };
    }
    const err = validateDecodedText(decoded);
    if (err) return err;
    return {
      ok: true,
      text: normalizeScriptTxt(decoded),
      encoding: "utf-16le",
    };
  }

  if (hasUtf16BeBom(bytes)) {
    const decoded = tryDecode(bytes, "utf-16be", true);
    if (decoded === null) {
      return {
        ok: false,
        code: "UNDECODEABLE",
        message: "无法识别文本编码",
      };
    }
    const err = validateDecodedText(decoded);
    if (err) return err;
    return {
      ok: true,
      text: normalizeScriptTxt(decoded),
      encoding: "utf-16be",
    };
  }

  if (looksBinaryBuffer(bytes)) {
    return {
      ok: false,
      code: "BINARY",
      message: "文件疑似二进制内容，无法作为 TXT 剧本导入",
    };
  }

  const utf8 = tryDecode(bytes, "utf-8", true);
  if (utf8 !== null) {
    const err = validateDecodedText(utf8);
    if (err) return err;
    return {
      ok: true,
      text: normalizeScriptTxt(utf8),
      encoding: "utf-8",
    };
  }

  const gb = tryDecode(bytes, "gb18030", true);
  if (gb !== null) {
    const err = validateDecodedText(gb);
    if (err) return err;
    return {
      ok: true,
      text: normalizeScriptTxt(gb),
      encoding: "gb18030",
    };
  }

  return {
    ok: false,
    code: "UNDECODEABLE",
    message: "无法识别文本编码",
  };
}
