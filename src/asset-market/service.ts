import "server-only";

import { listMaterials } from "@/materials/catalog-store";
import { getMaterialById } from "@/materials/catalog-store";
import { readMaterialMedia } from "@/materials/media-store";
import { readImageDimensions } from "@/personal-assets/image-dimensions";
import {
  isMarketAssetCategory,
  materialToMarketAsset,
  materialToMarketStatus,
} from "@/asset-market/map-material";
import { queryMarketAssets } from "@/asset-market/queries";
import { getMarketUserAdditionIds } from "@/asset-market/user-additions-store";
import type {
  MarketAsset,
  MarketAssetListQuery,
  MarketAssetListResult,
} from "@/asset-market/types";

export async function listMarketAssetsForUser(input: {
  userId: string;
  query: MarketAssetListQuery;
  includeUnpublished?: boolean;
}): Promise<MarketAssetListResult> {
  const materials = await listMaterials({
    includeDeleted: Boolean(input.includeUnpublished),
  });
  const addedIds = await getMarketUserAdditionIds(input.userId);
  return queryMarketAssets({
    materials,
    query: input.query,
    addedIds,
    includeUnpublished: input.includeUnpublished,
  });
}

export async function getMarketAssetForUser(input: {
  userId: string;
  assetId: string;
  includeUnpublished?: boolean;
}): Promise<MarketAsset | null> {
  const material = await getMaterialById(input.assetId);
  if (!material || !isMarketAssetCategory(material.type)) return null;

  const status = materialToMarketStatus(material);
  if (!input.includeUnpublished && status !== "published") return null;

  const media = await readMaterialMedia(material.mediaId);
  const dimensions = media ? readImageDimensions(media.body) : null;
  const addedIds = await getMarketUserAdditionIds(input.userId);

  return materialToMarketAsset(material, {
    addedToPersonal: addedIds.has(material.id),
    mimeType: media?.mime ?? "",
    fileSize: media?.body.length ?? 0,
    width: dimensions?.width ?? 0,
    height: dimensions?.height ?? 0,
  });
}

export async function getMarketAssetMedia(input: {
  assetId: string;
  includeUnpublished?: boolean;
}) {
  const material = await getMaterialById(input.assetId);
  if (!material || !isMarketAssetCategory(material.type)) return null;
  const status = materialToMarketStatus(material);
  if (!input.includeUnpublished && status !== "published") return null;
  const media = await readMaterialMedia(material.mediaId);
  if (!media) return null;
  return { material, media };
}
