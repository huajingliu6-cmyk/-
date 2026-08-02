/** DOCX 剧本导入：大小与 ZIP/XML 安全上限。 */

export const SCRIPT_DOCX_MAX_BYTES = 10 * 1024 * 1024;
export const SCRIPT_DOCX_MAX_ENTRIES = 2048;
export const SCRIPT_DOCX_DOCUMENT_XML_MAX_BYTES = 20 * 1024 * 1024;
export const SCRIPT_DOCX_SELECTED_XML_TOTAL_MAX_BYTES = 24 * 1024 * 1024;

export const SCRIPT_DOCX_REQUIRED_ENTRIES = [
  "[Content_Types].xml",
  "word/document.xml",
] as const;

export const OLE_COMPOUND_SIGNATURE = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
