import JSZip from "jszip";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type DocxParagraphSpec =
  | { type: "p"; runs: string[] }
  | { type: "p-mixed"; xml: string }
  | { type: "tbl"; rows: string[][] };

/**
 * Build a minimal in-memory DOCX (ZIP) for tests. No disk writes.
 */
export async function buildMinimalDocx(
  parts: DocxParagraphSpec[],
  options?: { contentTypesExtra?: string; extraFiles?: Record<string, string> },
): Promise<Uint8Array> {
  const bodyChunks: string[] = [];
  for (const part of parts) {
    if (part.type === "p") {
      const runs = part.runs
        .map(
          (t) =>
            `<w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>`,
        )
        .join("");
      bodyChunks.push(`<w:p>${runs}</w:p>`);
    } else if (part.type === "p-mixed") {
      bodyChunks.push(`<w:p>${part.xml}</w:p>`);
    } else {
      const rows = part.rows
        .map((cells) => {
          const tcs = cells
            .map(
              (c) =>
                `<w:tc><w:p><w:r><w:t>${escapeXml(c)}</w:t></w:r></w:p></w:tc>`,
            )
            .join("");
          return `<w:tr>${tcs}</w:tr>`;
        })
        .join("");
      bodyChunks.push(`<w:tbl>${rows}</w:tbl>`);
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyChunks.join("\n")}
    <w:sectPr/>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  ${options?.contentTypesExtra ?? ""}
</Types>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("word/document.xml", documentXml);
  if (options?.extraFiles) {
    for (const [name, content] of Object.entries(options.extraFiles)) {
      zip.file(name, content);
    }
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function buildThreeEpisodeDocxWithSplitTitle(): Promise<Uint8Array> {
  return buildMinimalDocx([
    {
      type: "p",
      runs: ["第", "一", "集", "：开端"],
    },
    { type: "p", runs: ["第一集正文。"] },
    { type: "p", runs: [] },
    { type: "p", runs: ["第2集：冲突"] },
    { type: "p", runs: ["第二集正文。"] },
    { type: "p", runs: [] },
    { type: "p", runs: ["第3集：转折"] },
    { type: "p", runs: ["第三集正文。"] },
  ]);
}
