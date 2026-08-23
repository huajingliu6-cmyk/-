import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getMaterialById } from "@/materials/catalog-store";
import { citeMaterialForUser } from "@/materials/citation-store";
import { readMaterialMedia } from "@/materials/media-store";
import type { Material } from "@/materials/types";
import {
  createLibraryCharacterWithImage,
  createLibraryPropWithImage,
  createLibrarySceneWithImage,
} from "@/projects/assets/create-library-imageable-asset";
import {
  isSafeProjectAssetImageId,
  writeProjectAssetImageFile,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { createCharacterAppearance } from "@/projects/assets/character-appearance-state";
import { deriveCharacterStatus } from "@/projects/assets/status";

export type ImportMaterialToProjectInput = {
  userId: string;
  materialId: string;
  projectId: string;
  characterId?: string | null;
};

export async function importMaterialToProject(
  input: ImportMaterialToProjectInput,
): Promise<NextResponse> {
  const gated = await requireProjectManagementProjectAccess(input.projectId);
  if (!gated.ok) return gated.response;

  const material = await getMaterialById(input.materialId);
  if (!material) {
    return NextResponse.json({ error: "素材不存在或已下架" }, { status: 404 });
  }

  const cite = await citeMaterialForUser({
    userId: input.userId,
    materialId: material.id,
  });

  const media = await readMaterialMedia(material.mediaId);
  if (!media) {
    return NextResponse.json({ error: "素材图片不可用" }, { status: 404 });
  }

  const characterId = (input.characterId ?? "").trim() || null;
  const createdResponse = await createProjectAssetFromMaterial({
    projectId: input.projectId,
    material,
    bytes: media.body,
    mimeType: media.mime,
    characterId,
  });
  if (!createdResponse.ok) return createdResponse;

  let created: unknown = null;
  try {
    created = await createdResponse.clone().json();
  } catch {
    created = null;
  }

  return NextResponse.json({
    ok: true,
    citation: cite.citation,
    alreadyCited: cite.alreadyCited,
    projectId: input.projectId,
    characterId,
    created,
  });
}

async function createProjectAssetFromMaterial(input: {
  projectId: string;
  material: Material;
  bytes: Buffer;
  mimeType: string;
  characterId: string | null;
}): Promise<NextResponse> {
  const { material, projectId, bytes, mimeType, characterId } = input;

  if (material.type === "clothing") {
    return importClothingAsCharacterLook({
      projectId,
      characterId,
      material,
      bytes,
      mimeType,
    });
  }

  if (material.type === "character") {
    return createLibraryCharacterWithImage({
      projectId,
      store: "management",
      name: material.name,
      description: material.description,
      bytes,
      mimeType,
    });
  }

  if (material.type === "scene") {
    return createLibrarySceneWithImage({
      projectId,
      store: "management",
      name: material.name,
      description: material.description,
      bytes,
      mimeType,
    });
  }

  return createLibraryPropWithImage({
    projectId,
    store: "management",
    name: material.name,
    description: material.description,
    bytes,
    mimeType,
  });
}

/** Clothing attaches as a character look — never via createLibraryPropWithImage. */
async function importClothingAsCharacterLook(input: {
  projectId: string;
  characterId: string | null;
  material: Material;
  bytes: Buffer;
  mimeType: string;
}): Promise<NextResponse> {
  const characterId = (input.characterId ?? "").trim();
  if (!characterId) {
    return NextResponse.json(
      {
        error: "衣服导入需要指定角色 characterId",
        code: "CLOTHING_REQUIRES_CHARACTER",
      },
      { status: 400 },
    );
  }

  const mediaId = `look_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (!isSafeProjectAssetImageId(mediaId)) {
    return NextResponse.json({ error: "无法生成媒体 ID" }, { status: 500 });
  }

  try {
    await writeProjectAssetImageFile({
      projectId: input.projectId,
      assetId: mediaId,
      buffer: input.bytes,
      mimeType: input.mimeType as ProjectAssetImageMime,
    });
  } catch {
    return NextResponse.json({ error: "上传衣服图片失败" }, { status: 500 });
  }

  try {
    const previous = await loadAssetBundleDraft(input.projectId);
    if (!previous) {
      return NextResponse.json({ error: "项目资产库不存在" }, { status: 404 });
    }
    const character = previous.characters.find((c) => c.id === characterId);
    if (!character) {
      return NextResponse.json({ error: "角色不存在" }, { status: 404 });
    }

    const created = createCharacterAppearance({
      asset: character,
      name: input.material.name,
      promptOverride: [
        input.material.description,
        `sourceMaterialId=${input.material.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      currentMediaId: mediaId,
      sourceMediaIds: [mediaId],
    });

    const nextCharacter = {
      ...created.asset,
      clothing: created.asset.clothing?.trim() || input.material.name,
      mediaDisplayNames: {
        ...(created.asset.mediaDisplayNames ?? {}),
        [mediaId]: input.material.name,
      },
      status: deriveCharacterStatus(created.asset),
    };

    const nextBundle = {
      ...previous,
      characters: previous.characters.map((c) =>
        c.id === characterId ? nextCharacter : c,
      ),
    };
    await saveAssetBundleDraft(nextBundle);

    return NextResponse.json(
      {
        kind: "clothing-look",
        character: nextCharacter,
        appearance: created.appearance,
        mediaId,
        sourceMaterialId: input.material.id,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "写入角色服装失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
