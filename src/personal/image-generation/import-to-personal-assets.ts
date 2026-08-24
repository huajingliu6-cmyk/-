import "server-only";

import { readMaterialMedia } from "@/materials/media-store";
import { sniffMaterialImageMime } from "@/materials/media-validation";
import {
  defaultPersonalMaterialName,
  extractMediaIdFromImageUrl,
} from "@/personal/image-generation/generate-personal-image";
import {
  listPersonalImageHistory,
  markPersonalImageUploaded,
} from "@/personal/image-generation/store";
import type { PersonalImageHistoryItem } from "@/personal/image-generation/types";
import { PERSONAL_ASSET_DEFAULT_CATEGORY } from "@/personal-assets/constants";
import { readImageDimensions } from "@/personal-assets/image-dimensions";
import {
  personalAssetStorageKey,
  savePersonalAssetMedia,
} from "@/personal-assets/media";
import {
  canStorePersonalAssetBytes,
  createPersonalAsset,
  getPersonalAssetForUser,
  listPersonalAssets,
} from "@/personal-assets/store";
import type {
  PersonalAsset,
  PersonalAssetMimeType,
} from "@/personal-assets/types";

function toPersonalAssetMime(
  mime: string,
): PersonalAssetMimeType | null {
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
    return mime;
  }
  return null;
}

async function findImportedPersonalAsset(input: {
  userId: string;
  item: PersonalImageHistoryItem;
  mediaId: string;
}): Promise<PersonalAsset | null> {
  if (input.item.personalAssetId) {
    const linked = await getPersonalAssetForUser({
      userId: input.userId,
      assetId: input.item.personalAssetId,
    });
    if (linked) return linked;
  }

  const legacyStorageKey = personalAssetStorageKey(input.mediaId);
  const listed = await listPersonalAssets(input.userId, { limit: 500 });
  return (
    listed.items.find(
      (asset) =>
        asset.sourceType === "ai_image" &&
        (asset.storageKey === legacyStorageKey ||
          asset.generatedAt === input.item.generatedAt),
    ) ?? null
  );
}

export async function importPersonalImageHistoryToAssets(input: {
  userId: string;
  itemId: string;
  name?: string;
}): Promise<{
  item: PersonalImageHistoryItem;
  asset: PersonalAsset;
  created: boolean;
}> {
  const items = await listPersonalImageHistory(input.userId);
  const item = items.find((entry) => entry.id === input.itemId);
  if (!item) {
    throw Object.assign(new Error("记录不存在"), { status: 404 });
  }

  const mediaId = extractMediaIdFromImageUrl(item.imageUrl);
  if (!mediaId) {
    throw Object.assign(new Error("图片地址无效"), { status: 400 });
  }

  const existing = await findImportedPersonalAsset({
    userId: input.userId,
    item,
    mediaId,
  });
  if (existing) {
    const synced =
      (await markPersonalImageUploaded(input.userId, item.id, existing.id)) ??
      {
        ...item,
        uploadedToPersonalAssets: true,
        personalAssetId: existing.id,
      };
    return { item: synced, asset: existing, created: false };
  }

  const media = await readMaterialMedia(mediaId);
  if (!media) {
    throw Object.assign(new Error("图片文件不存在"), { status: 404 });
  }

  const mimeType =
    toPersonalAssetMime(media.mime) ??
    toPersonalAssetMime(sniffMaterialImageMime(media.body) ?? "");
  if (!mimeType) {
    throw Object.assign(new Error("图片格式不支持"), { status: 400 });
  }

  const dimensions = readImageDimensions(media.body);
  const hasCapacity = await canStorePersonalAssetBytes({
    userId: input.userId,
    additionalBytes: media.body.length,
  });
  if (!hasCapacity) {
    throw Object.assign(new Error("个人素材空间不足"), {
      status: 409,
      code: "quota_exceeded",
    });
  }

  const saved = await savePersonalAssetMedia({
    buffer: media.body,
    declaredMime: mimeType,
  });

  const materialName =
    input.name?.trim() ||
    item.name ||
    defaultPersonalMaterialName(item.prompt);

  const asset = await createPersonalAsset({
    userId: input.userId,
    asset: {
      name: materialName,
      category: PERSONAL_ASSET_DEFAULT_CATEGORY,
      mimeType: saved.mime,
      sizeBytes: media.body.length,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      storageKey: saved.storageKey,
      sourceType: "ai_image",
      prompt: item.prompt,
      aspectRatio: item.aspectRatio,
      quality: item.resolution,
      modelId: item.modelId,
      generatedAt: item.generatedAt,
    },
  });

  const updated =
    (await markPersonalImageUploaded(input.userId, item.id, asset.id)) ?? {
      ...item,
      uploadedToPersonalAssets: true,
      personalAssetId: asset.id,
    };

  return { item: updated, asset, created: true };
}
