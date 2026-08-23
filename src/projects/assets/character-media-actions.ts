import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  findImageableAssetInDraft,
  isSafeProjectAssetImageId,
  normalizeDeclaredImageMime,
  readProjectAssetImageFile,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleForMutation,
  saveAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  ensureCharacterAppearances,
  confirmMainAppearanceMedia,
  isAppearanceMedia,
} from "@/projects/assets/character-appearance-state";
import {
  normalizeCharacterMediaLists,
  resolveCharacterPrimaryMediaId,
} from "@/projects/assets/character-media-state";
import { isCharacterMediaSd2Certified } from "@/projects/assets/character-media-video-ref";
import {
  runCharacterLookAction,
  type CharacterLookAction,
} from "@/projects/assets/character-look-actions";
import type { CharacterAsset } from "@/projects/assets/types";
import { PROJECT_ASSET_IMAGE_MAX_BYTES } from "@/projects/assets/asset-image-constants";

/** @deprecated Prefer CharacterLookAction — kept for route/test compatibility. */
export type CharacterMediaAction = Extract<
  CharacterLookAction,
  "set-primary" | "history-to-look" | "add-look" | "confirm-main"
>;

const VIDEO_REF_REQUIRED_MESSAGE =
  "该图片尚未通过 SD 真人素材认证。请先完成人物校验并写入认证结果后再操作。";

function patchCharacterInDraft(
  draft: AssetBundleDraft,
  characterId: string,
  next: CharacterAsset,
): AssetBundleDraft {
  return {
    ...draft,
    characters: draft.characters.map((c) =>
      c.id === characterId ? next : c,
    ),
  };
}

async function persistCharacterUpdate(
  scope: AssetBundleStoreScope,
  draft: AssetBundleDraft,
  characterId: string,
  next: CharacterAsset,
): Promise<CharacterAsset> {
  const nextDraft = patchCharacterInDraft(draft, characterId, next);
  await saveAssetBundleForScope({
    scope,
    previous: draft,
    next: nextDraft,
  });
  return next;
}

function videoRefRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: VIDEO_REF_REQUIRED_MESSAGE,
      code: "VIDEO_REF_REQUIRED",
    },
    { status: 422 },
  );
}

export async function runCharacterMediaAction(input: {
  projectId: string;
  characterId: string;
  action: CharacterMediaAction;
  mediaId: string;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  return runCharacterLookAction({
    projectId: input.projectId,
    characterId: input.characterId,
    action: input.action,
    mediaId: input.mediaId,
    store: input.store,
  });
}

function parseCommitFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

export async function runCharacterReplacePrimary(input: {
  projectId: string;
  characterId: string;
  file?: File | Blob | null;
  mimeType?: string | null;
  bytes?: Buffer;
  commit?: boolean | string | number | null;
  mediaId?: string | null;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const scope = input.store ?? "management";
  if (!isSafeProjectAssetImageId(input.characterId)) {
    return NextResponse.json({ error: "无效角色 ID" }, { status: 400 });
  }

  const draft = await loadAssetBundleForMutation(input.projectId, scope, {
    ensureCharacterIds: [input.characterId],
  });
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }

  const found = findImageableAssetInDraft(draft, input.characterId);
  if (!found || found.kind !== "character") {
    return NextResponse.json(
      { error: "角色不存在", code: "CHARACTER_NOT_FOUND" },
      { status: 404 },
    );
  }

  const character = ensureCharacterAppearances(
    normalizeCharacterMediaLists(found.asset as CharacterAsset),
  );
  const commit = parseCommitFlag(input.commit);

  if (commit) {
    const mediaId = (input.mediaId ?? "").trim();
    if (!mediaId || !isSafeProjectAssetImageId(mediaId)) {
      return NextResponse.json({ error: "无效媒体 ID" }, { status: 400 });
    }
    const file = await readProjectAssetImageFile(input.projectId, mediaId);
    if (!file) {
      return NextResponse.json(
        { error: "媒体文件不存在", code: "MEDIA_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (!isCharacterMediaSd2Certified(character, mediaId)) {
      return videoRefRequiredResponse();
    }
    const primary = resolveCharacterPrimaryMediaId(character);
    if (isAppearanceMedia(character, mediaId) && mediaId !== primary) {
      return NextResponse.json(
        {
          error: "造型图片不能设为主形象",
          code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
        },
        { status: 400 },
      );
    }
    let next: CharacterAsset;
    try {
      next = confirmMainAppearanceMedia(character, mediaId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN"
      ) {
        return NextResponse.json(
          {
            error: "造型图片不能设为主形象",
            code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
          },
          { status: 400 },
        );
      }
      throw error;
    }
    const saved = await persistCharacterUpdate(
      scope,
      draft,
      input.characterId,
      next,
    );
    return NextResponse.json({ character: saved });
  }

  if (!input.bytes && !input.file) {
    return NextResponse.json(
      { error: "请上传图片文件，或使用 commit=1 与 mediaId 提交已认证候选图" },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  if (input.bytes) {
    buffer = input.bytes;
  } else {
    const arrayBuffer = await input.file!.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  if (buffer.byteLength > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: "图片不能超过 10MB" },
      { status: 413 },
    );
  }

  const sniffed = sniffProjectAssetImageMime(buffer);
  if (!sniffed) {
    return NextResponse.json(
      { error: "仅支持 PNG / JPEG / WEBP 图片" },
      { status: 400 },
    );
  }

  const declared =
    normalizeDeclaredImageMime(input.mimeType) ??
    normalizeDeclaredImageMime(
      input.file instanceof File ? input.file.type : null,
    );
  if (declared && declared !== sniffed) {
    return NextResponse.json(
      { error: "文件类型与内容不一致" },
      { status: 400 },
    );
  }

  const candidateMediaId = `upload_${randomUUID().replace(/-/g, "")}`;

  try {
    await writeProjectAssetImageFile({
      projectId: input.projectId,
      assetId: candidateMediaId,
      buffer,
      mimeType: sniffed as ProjectAssetImageMime,
    });
  } catch {
    return NextResponse.json({ error: "上传图片失败" }, { status: 500 });
  }

  return NextResponse.json({
    candidateMediaId,
    character,
  });
}
