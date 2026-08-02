import type {
  AudioAsset,
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";

/**
 * 后续 AI / 图像 / 语音接入预留。
 * 资产目录持久化请走 PUT /api/projects/:id/assets-draft。
 */

export async function generateCharactersFromScript(input: {
  projectId: string;
}): Promise<never> {
  void input;
  throw new Error("generateCharactersFromScript：本阶段未接入 AI 角色生成");
}

export async function generateCharacterPortrait(input: {
  projectId: string;
  characterId: string;
}): Promise<never> {
  void input;
  throw new Error("generateCharacterPortrait：本阶段未接入图像生成");
}

export async function generateSceneImage(input: {
  projectId: string;
  sceneId: string;
}): Promise<never> {
  void input;
  throw new Error("generateSceneImage：本阶段未接入图像生成");
}

export async function previewCharacterVoice(input: {
  projectId: string;
  voiceId: string;
}): Promise<never> {
  void input;
  throw new Error("previewCharacterVoice：本阶段未接入语音合成");
}

export async function saveCharacterAsset(input: {
  projectId: string;
  character: CharacterAsset;
}): Promise<void> {
  void input;
  // Prefer AssetManagementWorkspace → assets-draft; kept for call-site compat.
}

export async function saveSceneAsset(input: {
  projectId: string;
  scene: SceneAsset;
}): Promise<void> {
  void input;
}

export async function savePropAsset(input: {
  projectId: string;
  prop: PropAsset;
}): Promise<void> {
  void input;
}

export async function saveAudioAsset(input: {
  projectId: string;
  audio: AudioAsset;
}): Promise<void> {
  void input;
}
