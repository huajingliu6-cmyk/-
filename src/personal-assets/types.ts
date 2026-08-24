export type PersonalAssetCategory = "character" | "scene" | "prop" | "other";

export type PersonalAssetSourceType = "manual_upload" | "ai_image" | "market_reference";

export type PersonalAssetMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type PersonalAssetQuality = "1K" | "2K" | "4K";

export type PersonalAssetSort = "recent" | "oldest" | "name";

export type PersonalAsset = {
  id: string;
  ownerId: string;
  name: string;
  category: PersonalAssetCategory;
  mimeType: PersonalAssetMimeType;
  sizeBytes: number;
  width: number;
  height: number;
  storageKey: string;
  sourceType: PersonalAssetSourceType;
  marketAssetId?: string;
  prompt?: string;
  aspectRatio?: string;
  quality?: PersonalAssetQuality;
  modelId?: string;
  generatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalAssetStore = {
  version: 1;
  userId: string;
  assets: PersonalAsset[];
};

export type PersonalAssetListQuery = {
  category?: PersonalAssetCategory | "all";
  search?: string;
  sort?: PersonalAssetSort;
  cursor?: string | null;
  limit?: number;
};

export type PersonalAssetListResult = {
  items: PersonalAsset[];
  nextCursor: string | null;
  total: number;
  categoryCounts: Record<PersonalAssetCategory, number>;
  usedBytes: number;
  quotaBytes: number;
};

export type CreatePersonalAssetInput = {
  name: string;
  category: PersonalAssetCategory;
  mimeType: PersonalAssetMimeType;
  sizeBytes: number;
  width: number;
  height: number;
  storageKey: string;
  sourceType?: PersonalAssetSourceType;
  marketAssetId?: string;
  prompt?: string;
  aspectRatio?: string;
  quality?: PersonalAssetQuality;
  modelId?: string;
  generatedAt?: string;
};

export type UpdatePersonalAssetInput = {
  name?: string;
  category?: PersonalAssetCategory;
};
