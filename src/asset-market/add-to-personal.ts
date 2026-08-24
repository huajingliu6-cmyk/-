import "server-only";

import { getMaterialById, incrementMaterialCiteCount } from "@/materials/catalog-store";
import { isMarketAssetCategory, materialToMarketStatus } from "@/asset-market/map-material";
import { createMarketUserAddition, findMarketUserAddition } from "@/asset-market/user-additions-store";
import { readMaterialMedia } from "@/materials/media-store";
import { readImageDimensions } from "@/personal-assets/image-dimensions";
import { createPersonalAsset } from "@/personal-assets/store";
import { personalAssetStorageKey } from "@/personal-assets/media";
import type { MarketAssetCategory } from "@/asset-market/types";
import type { PersonalAssetCategory } from "@/personal-assets/types";

function toPersonalCategory(category: MarketAssetCategory): PersonalAssetCategory {
  if (category === "character" || category === "scene" || category === "prop") {
    return category;
  }
  return "other";
}

export async function addMarketAssetToPersonal(input: {
  userId: string;
  marketAssetId: string;
}) {
  const material = await getMaterialById(input.marketAssetId);
  if (!material || !isMarketAssetCategory(material.type)) {
    throw Object.assign(new Error("素材不存在"), { status: 404 });
  }
  if (materialToMarketStatus(material) !== "published") {
    throw Object.assign(new Error("素材已下架"), { status: 404 });
  }

  const existing = await findMarketUserAddition({
    userId: input.userId,
    marketAssetId: material.id,
  });
  if (existing) {
    return { alreadyAdded: true, addition: existing, personalAssetId: existing.personalAssetId };
  }

  const media = await readMaterialMedia(material.mediaId);
  if (!media) {
    throw Object.assign(new Error("素材图片不可用"), { status: 404 });
  }
  const dimensions = readImageDimensions(media.body);

  const personalAsset = await createPersonalAsset({
    userId: input.userId,
    asset: {
      name: material.name,
      category: toPersonalCategory(material.type),
      mimeType: media.mime,
      sizeBytes: media.body.length,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      storageKey: personalAssetStorageKey(material.mediaId),
      sourceType: "market_reference",
      marketAssetId: material.id,
    },
  });

  const addition = await createMarketUserAddition({
    userId: input.userId,
    marketAssetId: material.id,
    personalAssetId: personalAsset.id,
  });

  await incrementMaterialCiteCount(material.id);

  return {
    alreadyAdded: false,
    addition,
    personalAssetId: personalAsset.id,
    personalAsset,
  };
}
