/** 剧本全栈工作台类型（便于后续接 AI / DB） */

export type ScriptSourceFileStatus =
  | "idle"
  | "selected"
  | "uploading"
  | "uploaded"
  | "error";

export type ScriptSourceFile = {
  id: string;
  name: string;
  type: "docx" | "txt" | "md" | "unknown";
  size: number;
  status: ScriptSourceFileStatus;
};

/** TXT / DOCX / Markdown 导入元数据（规范化文本另存 sourceText；原始二进制不归档）。 */
export type ScriptImportFormat = "txt" | "docx" | "md";

export type ScriptTxtEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "gb18030";

export type ScriptSourceImport = {
  format: ScriptImportFormat;
  fileName: string;
  mimeType: string | null;
  byteLength: number;
  sha256: string;
  /** TXT / Markdown；DOCX 不设此字段。旧 C1 数据无 format 时推断为 txt。 */
  encoding?: ScriptTxtEncoding;
  importedAt: string;
};

export type ScriptEpisodeStatus =
  | "pending"
  | "ready"
  | "editing"
  | "saved";

export type ScriptEpisode = {
  id: string;
  projectId: string;
  episodeNumber: number;
  title: string;
  content: string;
  wordCount: number;
  status: ScriptEpisodeStatus;
  createdAt: string;
  updatedAt: string;
};

export type ScriptEpisodeList = {
  projectId: string;
  episodes: ScriptEpisode[];
  totalCount: number;
};

export type NovelConversionStatus =
  | "uploaded"
  | "processing"
  | "completed"
  | "failed";

export type NovelConversionTask = {
  id: string;
  projectId: string;
  sourceFile: ScriptSourceFile | null;
  status: NovelConversionStatus;
  resultScriptId: string | null;
  createdAt: string;
};

/** 分集方式：按剧本集数 / 按每集字数 */
export type EpisodeSplitMode = "by-episode-count" | "by-chars";

export type EpisodeSplitConfig = {
  mode: EpisodeSplitMode;
  totalEpisodes: number;
  charsPerEpisode: number;
};

export type ScriptFolderKind =
  | "original-script"
  | "original-novel"
  | "converted"
  | "episodes"
  | "corrected";

export type ScriptFolderNode = {
  id: string;
  kind: ScriptFolderKind;
  name: string;
};

export type ScriptProjectFolderStructure = {
  projectId: string;
  rootFolderId: string;
  projectName: string;
  folders: ScriptFolderNode[];
};

export const EPISODE_CHARS_MIN = 1000;
export const EPISODE_CHARS_MAX = 3000;
export const EPISODE_CHARS_DEFAULT = 1500;
export const EPISODE_COUNT_MIN = 1;
export const EPISODE_COUNT_MAX = 100;
export const EPISODES_PER_PAGE = 8;
