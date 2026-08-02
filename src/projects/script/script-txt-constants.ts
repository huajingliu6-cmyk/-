/** TXT 剧本导入：大小与编码枚举（服务端权威）。 */

export const SCRIPT_TXT_MAX_BYTES = 10 * 1024 * 1024;

export const SCRIPT_TXT_ENCODINGS = [
  "utf-8",
  "utf-8-bom",
  "utf-16le",
  "utf-16be",
  "gb18030",
] as const;

export type ScriptTxtEncoding = (typeof SCRIPT_TXT_ENCODINGS)[number];

export function isScriptTxtEncoding(
  value: unknown,
): value is ScriptTxtEncoding {
  return (
    typeof value === "string" &&
    (SCRIPT_TXT_ENCODINGS as readonly string[]).includes(value)
  );
}
