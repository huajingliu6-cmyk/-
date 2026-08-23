import type { PropAsset, SceneAsset } from "@/projects/assets/types";

export function buildSceneVariantPromptPrefill(scene: SceneAsset): string {
  const name = scene.name?.trim();
  return `基于主场景生成新版本。保持同一空间结构、光线氛围与画幅一致。${
    name ? `场景：${name}。` : ""
  }`;
}

export function buildPropVariantPromptPrefill(prop: PropAsset): string {
  const name = prop.name?.trim();
  return `基于主道具生成新版本。保持同一道具形态、材质与风格一致。${
    name ? `道具：${name}。` : ""
  }`;
}
