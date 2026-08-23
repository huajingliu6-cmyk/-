import type {
  CharacterAsset,
  CharacterDraftInput,
  PropAsset,
  PropDraftInput,
  SceneAsset,
  SceneDraftInput,
  VoiceOption,
} from "@/projects/assets/types";
import { findVoiceOption } from "@/projects/assets/voice-catalog";

export type LibraryCreateContext = "management" | "workspace";

function apiRoot(projectId: string, context: LibraryCreateContext): string {
  const encoded = encodeURIComponent(projectId);
  return context === "workspace"
    ? `/api/workspace/projects/${encoded}`
    : `/api/projects/${encoded}`;
}

export class LibraryAssetCreateError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "LibraryAssetCreateError";
    this.status = status;
    this.code = code;
  }
}

export async function createLibraryCharacter(params: {
  projectId: string;
  context?: LibraryCreateContext;
  draft: CharacterDraftInput;
  projectVoices?: VoiceOption[];
}): Promise<CharacterAsset> {
  const pending = params.draft.pendingImageFile;
  if (!pending) {
    throw new LibraryAssetCreateError("请先上传角色图片后再创建", 400);
  }
  const voice = findVoiceOption(
    params.draft.voiceId,
    params.projectVoices ?? [],
  );
  const form = new FormData();
  form.append("file", pending);
  form.append("name", params.draft.name.trim());
  form.append("role", params.draft.role.trim());
  form.append("description", params.draft.description.trim());
  form.append("clothing", params.draft.clothing.trim());
  form.append("age", params.draft.age.trim());
  if (voice?.id) form.append("voiceId", voice.id);
  if (voice?.name) form.append("voiceName", voice.name);
  if (voice?.style) form.append("voiceStyle", voice.style);

  const response = await fetch(
    `${apiRoot(params.projectId, params.context ?? "management")}/assets-draft/characters`,
    { method: "POST", credentials: "include", body: form },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    character?: CharacterAsset;
  };
  if (!response.ok || !payload.character) {
    throw new LibraryAssetCreateError(
      payload.error ?? "创建角色失败",
      response.status,
      payload.code,
    );
  }
  return payload.character;
}

export async function createLibraryScene(params: {
  projectId: string;
  context?: LibraryCreateContext;
  draft: SceneDraftInput;
}): Promise<SceneAsset> {
  const pending = params.draft.pendingImageFile;
  if (!pending) {
    throw new LibraryAssetCreateError("请先上传场景图片后再创建", 400);
  }
  const form = new FormData();
  form.append("file", pending);
  form.append("name", params.draft.name.trim());
  form.append("description", params.draft.description.trim());
  form.append("timeOfDay", params.draft.timeOfDay.trim());

  const response = await fetch(
    `${apiRoot(params.projectId, params.context ?? "management")}/assets-draft/scenes`,
    { method: "POST", credentials: "include", body: form },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    scene?: SceneAsset;
  };
  if (!response.ok || !payload.scene) {
    throw new LibraryAssetCreateError(
      payload.error ?? "创建场景失败",
      response.status,
      payload.code,
    );
  }
  return payload.scene;
}

export async function createLibraryProp(params: {
  projectId: string;
  context?: LibraryCreateContext;
  draft: PropDraftInput;
}): Promise<PropAsset> {
  const pending = params.draft.pendingImageFile;
  if (!pending) {
    throw new LibraryAssetCreateError("请先上传道具图片后再创建", 400);
  }
  const form = new FormData();
  form.append("file", pending);
  form.append("name", params.draft.name.trim());
  form.append("description", params.draft.description.trim());

  const response = await fetch(
    `${apiRoot(params.projectId, params.context ?? "management")}/assets-draft/props`,
    { method: "POST", credentials: "include", body: form },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    prop?: PropAsset;
  };
  if (!response.ok || !payload.prop) {
    throw new LibraryAssetCreateError(
      payload.error ?? "创建道具失败",
      response.status,
      payload.code,
    );
  }
  return payload.prop;
}
