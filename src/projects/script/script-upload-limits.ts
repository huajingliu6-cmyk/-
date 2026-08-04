export const SCRIPT_UPLOAD_MAX_CHARS = 100_000;
export const SCRIPT_UPLOAD_MAX_CHARS_LABEL = "10 万字";

export function scriptUploadCharacterLimitMessage(
  actualChars?: number,
): string {
  const actual =
    typeof actualChars === "number"
      ? `，当前约 ${actualChars.toLocaleString("zh-CN")} 字`
      : "";
  return `内容超过 ${SCRIPT_UPLOAD_MAX_CHARS_LABEL}上限${actual}，请删减或拆分文件后重新上传。`;
}

export function validateScriptUploadCharacterCount(
  characterCount: number,
): string | null {
  return characterCount > SCRIPT_UPLOAD_MAX_CHARS
    ? scriptUploadCharacterLimitMessage(characterCount)
    : null;
}