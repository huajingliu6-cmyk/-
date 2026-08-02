import { countVisibleChars } from "@/text-generation/char-count";
import type {
  ScriptEpisode,
  ScriptEpisodeList,
  ScriptProjectFolderStructure,
} from "@/projects/script/types";

export function buildScriptFolderStructure(input: {
  projectId: string;
  rootFolderId: string;
  projectName: string;
}): ScriptProjectFolderStructure {
  const { projectId, rootFolderId, projectName } = input;
  return {
    projectId,
    rootFolderId,
    projectName,
    folders: [
      {
        id: `${projectId}-original-script`,
        kind: "original-script",
        name: "原始剧本",
      },
      {
        id: `${projectId}-original-novel`,
        kind: "original-novel",
        name: "原始小说",
      },
      { id: `${projectId}-converted`, kind: "converted", name: "转换剧本" },
      { id: `${projectId}-episodes`, kind: "episodes", name: "分集剧本" },
      { id: `${projectId}-corrected`, kind: "corrected", name: "修正文档" },
    ],
  };
}

/** 生成演示分集列表（分页 UI 用） */
export function buildMockEpisodeList(
  projectId: string,
  count: number,
): ScriptEpisodeList {
  const now = "2026-07-26T12:00:00.000Z";
  const episodes: ScriptEpisode[] = Array.from({ length: count }, (_, i) => {
    const episodeNumber = i + 1;
    const content = `第${episodeNumber}集正文（可编辑）。场景一……角色对话与动作描述占位内容。`;
    return {
      id: `ep-${projectId}-${episodeNumber}`,
      projectId,
      episodeNumber,
      title: `第${episodeNumber}集`,
      content,
      wordCount: countVisibleChars(content),
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };
  });
  return { projectId, episodes, totalCount: episodes.length };
}
