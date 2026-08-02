import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { normalizeScriptTxt } from "@/projects/script/script-txt-decoder";
import {
  OLE_COMPOUND_SIGNATURE,
  SCRIPT_DOCX_DOCUMENT_XML_MAX_BYTES,
  SCRIPT_DOCX_MAX_BYTES,
  SCRIPT_DOCX_MAX_ENTRIES,
  SCRIPT_DOCX_SELECTED_XML_TOTAL_MAX_BYTES,
} from "@/projects/script/script-docx-constants";

export type ScriptDocxExtractOk = {
  ok: true;
  text: string;
  warnings: string[];
};

export type ScriptDocxExtractErr = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type ScriptDocxExtractResult = ScriptDocxExtractOk | ScriptDocxExtractErr;

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function isOleCompound(bytes: Uint8Array): boolean {
  if (bytes.length < OLE_COMPOUND_SIGNATURE.length) return false;
  return OLE_COMPOUND_SIGNATURE.every((b, i) => bytes[i] === b);
}

function isPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export function isDocxFileName(fileName: string): boolean {
  const base = fileName.replace(/\\/g, "/").split("/").pop() || fileName;
  const lower = base.toLowerCase();
  // Exactly one trailing .docx; reject .doc / .docm / .docx.exe etc.
  return /^[^\\/]+\.docx$/i.test(lower) && !/\.(docx)\./i.test(lower);
}

function assertSafeEntryName(name: string): ScriptDocxExtractErr | null {
  if (!name || name.includes("\0")) {
    return {
      ok: false,
      status: 400,
      code: "UNSAFE_ENTRY",
      message: "DOCX 包含非法条目名称",
    };
  }
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return {
      ok: false,
      status: 400,
      code: "UNSAFE_ENTRY",
      message: "DOCX 条目路径不安全",
    };
  }
  const parts = normalized.split("/");
  if (parts.some((p) => p === ".." || p === "")) {
    // allow empty only from trailing slash edge; reject ..
    if (parts.includes("..")) {
      return {
        ok: false,
        status: 400,
        code: "UNSAFE_ENTRY",
        message: "DOCX 条目路径不安全",
      };
    }
  }
  return null;
}

function localName(key: string): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textFromNode(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!isRecord(node)) return "";
  if (typeof node["#text"] === "string" || typeof node["#text"] === "number") {
    return String(node["#text"]);
  }
  return "";
}

type ExtractCtx = {
  warnings: Set<string>;
  sawRevision: boolean;
};

function extractInline(node: unknown, ctx: ExtractCtx, insideDel: boolean): string {
  if (insideDel) return "";
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!isRecord(node)) return "";

  let out = "";
  for (const [rawKey, value] of Object.entries(node)) {
    if (rawKey.startsWith("@_") || rawKey === "#text") continue;
    const name = localName(rawKey);

    if (name === "del" || name === "delText" || name === "moveFrom") {
      ctx.sawRevision = true;
      continue;
    }
    if (name === "ins" || name === "moveTo") {
      ctx.sawRevision = true;
      out += extractInline(value, ctx, false);
      continue;
    }
    if (name === "t") {
      for (const t of asArray(value)) {
        out += textFromNode(t);
      }
      continue;
    }
    if (name === "tab") {
      out += "\t";
      continue;
    }
    if (name === "br" || name === "cr") {
      out += "\n";
      continue;
    }
    if (name === "drawing" || name === "pict" || name === "object") {
      ctx.warnings.add("文档包含图片或嵌入对象，已忽略");
      continue;
    }
    if (name === "commentReference" || name === "footnoteReference" || name === "endnoteReference") {
      ctx.warnings.add("文档包含批注或脚注引用，已忽略");
      continue;
    }
    if (name === "hyperlink" || name === "r" || name === "sdt" || name === "sdtContent") {
      out += extractInline(value, ctx, false);
      continue;
    }
    out += extractInline(value, ctx, false);
  }
  return out;
}

function extractParagraph(node: unknown, ctx: ExtractCtx): string {
  return extractInline(node, ctx, false);
}

function extractCell(node: unknown, ctx: ExtractCtx): string {
  const parts: string[] = [];
  if (!isRecord(node)) return "";
  for (const [rawKey, value] of Object.entries(node)) {
    if (rawKey.startsWith("@_")) continue;
    const name = localName(rawKey);
    if (name === "p") {
      for (const p of asArray(value)) {
        parts.push(extractParagraph(p, ctx));
      }
    } else if (name === "tbl") {
      parts.push(extractTable(value, ctx));
    }
  }
  return parts.join("\n");
}

function extractTable(node: unknown, ctx: ExtractCtx): string {
  const rows: string[] = [];
  for (const tbl of asArray(node)) {
    if (!isRecord(tbl)) continue;
    for (const [rawKey, value] of Object.entries(tbl)) {
      if (localName(rawKey) !== "tr") continue;
      for (const tr of asArray(value)) {
        if (!isRecord(tr)) continue;
        const cells: string[] = [];
        for (const [ck, cv] of Object.entries(tr)) {
          if (localName(ck) !== "tc") continue;
          for (const tc of asArray(cv)) {
            cells.push(extractCell(tc, ctx).replace(/\n/g, " "));
          }
        }
        rows.push(cells.join("\t"));
      }
    }
  }
  return rows.join("\n");
}

function extractInlineOrdered(
  nodes: unknown,
  ctx: ExtractCtx,
  insideDel: boolean,
): string {
  if (insideDel) return "";
  if (typeof nodes === "string" || typeof nodes === "number") {
    return String(nodes);
  }
  if (!Array.isArray(nodes)) {
    if (isRecord(nodes)) {
      return extractInline(nodes, ctx, insideDel);
    }
    return "";
  }

  let out = "";
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    for (const [rawKey, value] of Object.entries(node)) {
      if (rawKey === ":@") continue;
      const name = localName(rawKey);

      if (name === "del" || name === "delText" || name === "moveFrom") {
        ctx.sawRevision = true;
        continue;
      }
      if (name === "ins" || name === "moveTo") {
        ctx.sawRevision = true;
        out += extractInlineOrdered(value, ctx, false);
        continue;
      }
      if (rawKey === "#text") {
        out += String(value);
        continue;
      }
      if (name === "t") {
        out += extractInlineOrdered(value, ctx, false);
        continue;
      }
      if (name === "tab") {
        out += "\t";
        continue;
      }
      if (name === "br" || name === "cr") {
        out += "\n";
        continue;
      }
      if (name === "drawing" || name === "pict" || name === "object") {
        ctx.warnings.add("文档包含图片或嵌入对象，已忽略");
        continue;
      }
      if (
        name === "commentReference" ||
        name === "footnoteReference" ||
        name === "endnoteReference"
      ) {
        ctx.warnings.add("文档包含批注或脚注引用，已忽略");
        continue;
      }
      out += extractInlineOrdered(value, ctx, false);
    }
  }
  return out;
}

function extractTableOrdered(nodes: unknown, ctx: ExtractCtx): string {
  if (!Array.isArray(nodes)) return extractTable(nodes, ctx);
  const rows: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    for (const [rawKey, value] of Object.entries(node)) {
      if (localName(rawKey) !== "tr") continue;
      if (!Array.isArray(value)) continue;
      const cells: string[] = [];
      for (const trChild of value) {
        if (!isRecord(trChild)) continue;
        for (const [ck, cv] of Object.entries(trChild)) {
          if (localName(ck) !== "tc") continue;
          const cellText = extractInlineOrdered(cv, ctx, false).replace(
            /\n/g,
            " ",
          );
          cells.push(cellText);
        }
      }
      rows.push(cells.join("\t"));
    }
  }
  return rows.join("\n");
}

function extractBodyText(documentXml: string, ctx: ExtractCtx): string {
  if (/<!DOCTYPE/i.test(documentXml) || /<!ENTITY/i.test(documentXml)) {
    throw Object.assign(new Error("XML_DTD"), { code: "XML_DTD" });
  }

  const orderParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    htmlEntities: false,
    trimValues: false,
    preserveOrder: true,
    removeNSPrefix: false,
  });

  let ordered: unknown;
  try {
    ordered = orderParser.parse(documentXml);
  } catch {
    throw Object.assign(new Error("XML_INVALID"), { code: "XML_INVALID" });
  }

  const orderedDoc = findOrderedNode(ordered, "document");
  const orderedBody = orderedDoc ? findOrderedChild(orderedDoc, "body") : null;
  if (!orderedBody) {
    throw Object.assign(new Error("XML_INVALID"), { code: "XML_INVALID" });
  }

  const lines: string[] = [];
  for (const child of orderedBody) {
    if (!isRecord(child)) continue;
    const key = Object.keys(child).find((k) => k !== ":@") ?? "";
    const name = localName(key);
    const value = child[key];
    if (name === "p") {
      lines.push(extractInlineOrdered(value, ctx, false));
    } else if (name === "tbl") {
      lines.push(extractTableOrdered(value, ctx));
    }
  }

  return lines.join("\n");
}

function findOrderedNode(
  nodes: unknown,
  local: string,
): Record<string, unknown>[] | null {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    for (const [k, v] of Object.entries(node)) {
      if (localName(k) === local && Array.isArray(v)) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return null;
}

function findOrderedChild(
  parent: Record<string, unknown>[],
  local: string,
): Record<string, unknown>[] | null {
  for (const node of parent) {
    if (!isRecord(node)) continue;
    for (const [k, v] of Object.entries(node)) {
      if (localName(k) === local && Array.isArray(v)) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return null;
}

function scanContentTypes(xml: string, warnings: Set<string>): ScriptDocxExtractErr | null {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return {
      ok: false,
      status: 400,
      code: "XML_DTD",
      message: "DOCX 内容类型声明不安全",
    };
  }
  const lower = xml.toLowerCase();
  if (
    lower.includes("macroenabled") ||
    lower.includes("vbaproject") ||
    lower.includes("application/vnd.ms-word.document.macroenabled")
  ) {
    return {
      ok: false,
      status: 400,
      code: "MACRO_DENIED",
      message: "不支持包含宏的 Word 文档",
    };
  }
  if (lower.includes("/header") || lower.includes("header+xml")) {
    warnings.add("文档包含页眉，已忽略");
  }
  if (lower.includes("/footer") || lower.includes("footer+xml")) {
    warnings.add("文档包含页脚，已忽略");
  }
  if (lower.includes("comments+xml") || lower.includes("/comments")) {
    warnings.add("文档包含批注部件，已忽略");
  }
  if (lower.includes("footnotes+xml") || lower.includes("endnotes+xml")) {
    warnings.add("文档包含脚注或尾注，已忽略");
  }
  return null;
}

/**
 * Read a DOCX buffer in memory and extract main-document visible text.
 * Does not write temporary files or follow external relationships.
 */
export async function extractScriptTextFromDocx(
  bytes: Uint8Array,
): Promise<ScriptDocxExtractResult> {
  if (bytes.byteLength > SCRIPT_DOCX_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      message: `文件超过 ${SCRIPT_DOCX_MAX_BYTES} 字节上限`,
    };
  }
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY",
      message: "文件为空",
    };
  }
  if (isOleCompound(bytes)) {
    return {
      ok: false,
      status: 400,
      code: "OLE_DOC",
      message: "不支持旧版 .doc 格式，请使用 .docx",
    };
  }
  if (isPdfSignature(bytes)) {
    return {
      ok: false,
      status: 400,
      code: "NOT_DOCX",
      message: "文件不是有效的 DOCX",
    };
  }
  if (!isZipSignature(bytes)) {
    return {
      ok: false,
      status: 400,
      code: "NOT_ZIP",
      message: "文件不是有效的 DOCX（ZIP）容器",
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    return {
      ok: false,
      status: 400,
      code: "CORRUPT_ZIP",
      message: "DOCX 压缩包损坏或无法读取",
    };
  }

  const entries = Object.keys(zip.files);
  if (entries.length > SCRIPT_DOCX_MAX_ENTRIES) {
    return {
      ok: false,
      status: 400,
      code: "TOO_MANY_ENTRIES",
      message: "DOCX 内部文件数量过多",
    };
  }

  for (const name of entries) {
    const unsafe = assertSafeEntryName(name);
    if (unsafe) return unsafe;
    const lower = name.replace(/\\/g, "/").toLowerCase();
    if (lower === "word/vbaproject.bin" || lower.endsWith("/vbaproject.bin")) {
      return {
        ok: false,
        status: 400,
        code: "MACRO_DENIED",
        message: "不支持包含宏的 Word 文档",
      };
    }
  }

  const contentTypesFile = zip.file("[Content_Types].xml");
  const documentFile = zip.file("word/document.xml");
  if (!contentTypesFile) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_CONTENT_TYPES",
      message: "DOCX 缺少 [Content_Types].xml",
    };
  }
  if (!documentFile) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_DOCUMENT",
      message: "DOCX 缺少 word/document.xml",
    };
  }

  // JSZip may mark encrypted entries; reject if present.
  for (const name of ["[Content_Types].xml", "word/document.xml"]) {
    const f = zip.file(name);
    if (!f) continue;
    const data = f as JSZip.JSZipObject & {
      options?: { encrypted?: boolean };
      _data?: { uncompressedSize?: number; compressedSize?: number };
    };
    if (data.options?.encrypted) {
      return {
        ok: false,
        status: 400,
        code: "ENCRYPTED_ENTRY",
        message: "不支持加密的 DOCX",
      };
    }
    const unc = data._data?.uncompressedSize;
    if (typeof unc === "number") {
      if (name === "word/document.xml" && unc > SCRIPT_DOCX_DOCUMENT_XML_MAX_BYTES) {
        return {
          ok: false,
          status: 413,
          code: "DOCUMENT_XML_TOO_LARGE",
          message: "document.xml 解压后超过大小上限",
        };
      }
    }
  }

  const warnings = new Set<string>();
  let contentTypesXml: string;
  let documentXml: string;
  try {
    contentTypesXml = await contentTypesFile.async("string");
    documentXml = await documentFile.async("string");
  } catch {
    return {
      ok: false,
      status: 400,
      code: "READ_ENTRY_FAILED",
      message: "无法读取 DOCX 内部文件",
    };
  }

  const selectedTotal =
    Buffer.byteLength(contentTypesXml, "utf8") +
    Buffer.byteLength(documentXml, "utf8");
  if (selectedTotal > SCRIPT_DOCX_SELECTED_XML_TOTAL_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "XML_TOO_LARGE",
      message: "DOCX 选定 XML 解压后超过大小上限",
    };
  }
  if (Buffer.byteLength(documentXml, "utf8") > SCRIPT_DOCX_DOCUMENT_XML_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "DOCUMENT_XML_TOO_LARGE",
      message: "document.xml 解压后超过大小上限",
    };
  }

  const ctErr = scanContentTypes(contentTypesXml, warnings);
  if (ctErr) return ctErr;

  const ctx: ExtractCtx = { warnings, sawRevision: false };
  let rawText: string;
  try {
    rawText = extractBodyText(documentXml, ctx);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "XML_INVALID";
    if (code === "XML_DTD") {
      return {
        ok: false,
        status: 400,
        code: "XML_DTD",
        message: "DOCX XML 声明不安全",
      };
    }
    return {
      ok: false,
      status: 400,
      code: "XML_INVALID",
      message: "DOCX 主文档 XML 损坏或无法解析",
    };
  }

  if (ctx.sawRevision) {
    warnings.add("文档包含修订标记：已保留插入文本并忽略删除文本");
  }

  const text = normalizeScriptTxt(rawText);
  if (!text) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_TEXT",
      message: "未能从 DOCX 提取到可见正文",
    };
  }

  return {
    ok: true,
    text,
    warnings: [...warnings],
  };
}
