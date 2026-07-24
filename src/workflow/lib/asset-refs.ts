import type { WorkflowDocument } from "../types";
import { parseMentionAssetIds } from "./mention-tokens";

function addId(set: Set<string>, value: string | undefined | null): void {
  if (value && value.trim()) {
    set.add(value);
  }
}

function addIds(set: Set<string>, values: string[] | undefined): void {
  if (!values) return;
  for (const value of values) {
    addId(set, value);
  }
}

function addMentionIds(set: Set<string>, text: string | undefined): void {
  if (!text) return;
  addIds(set, parseMentionAssetIds(text));
}

/** 收集工作流文档中所有被引用的 assetId（含 assets 表内条目）。 */
export function collectReferencedAssetIds(document: WorkflowDocument): Set<string> {
  const ids = new Set<string>();

  for (const asset of document.assets) {
    addId(ids, asset.id);
  }

  for (const node of document.nodes) {
    switch (node.type) {
      case "character":
        addId(ids, node.data.voiceAssetId);
        addIds(ids, node.data.generationHistoryIds);
        addIds(ids, node.data.voiceHistoryIds);
        addMentionIds(ids, node.data.appearancePrompt);
        addMentionIds(ids, node.data.voicePrompt);
        addMentionIds(ids, node.data.description);
        for (const variant of node.data.variants) {
          addId(ids, variant.primaryAssetId);
          addIds(ids, variant.referenceAssetIds);
          for (const ref of variant.references) {
            addId(ids, ref.assetId);
          }
        }
        break;
      case "scene":
        addId(ids, node.data.primaryAssetId);
        addIds(ids, node.data.referenceAssetIds);
        addIds(ids, node.data.generationHistoryIds);
        addMentionIds(ids, node.data.generationPrompt);
        addMentionIds(ids, node.data.description);
        for (const viewpoint of node.data.viewpoints) {
          addId(ids, viewpoint.assetId);
        }
        break;
      case "videoShot":
        addId(ids, node.data.sourceVideoAssetId);
        addId(ids, node.data.startFrameAssetId);
        addId(ids, node.data.endFrameAssetId);
        addId(ids, node.data.resultAssetId);
        addIds(ids, node.data.attachedAssetIds);
        addIds(ids, node.data.generationHistoryIds);
        addMentionIds(ids, node.data.generationInstruction);
        addMentionIds(ids, node.data.actionDescription);
        break;
      case "image":
        addId(ids, node.data.primaryAssetId);
        addIds(ids, node.data.assetIds);
        addMentionIds(ids, node.data.description);
        break;
      case "prop":
        addId(ids, node.data.primaryAssetId);
        addIds(ids, node.data.assetIds);
        addMentionIds(ids, node.data.description);
        break;
      case "audio":
        addId(ids, node.data.assetId);
        break;
      case "text":
        addMentionIds(ids, node.data.content);
        break;
      default:
        break;
    }
  }

  return ids;
}
