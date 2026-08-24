import type { MaterialImageMime } from "@/materials/constants";

export type MarketAssetCategory = "character" | "clothing" | "scene" | "prop";

export type MarketAssetStatus =
  | "processing"
  | "published"
  | "unpublished"
  | "failed";

export type MarketAssetSort = "latest" | "updated" | "usage";

export type MarketAsset = {
  id: string;
  category: MarketAssetCategory;
  name: string;
  description: string;
  tags: string[];
  mimeType: MaterialImageMime | "";
  fileSize: number;
  width: number;
  height: number;
  status: MarketAssetStatus;
  downloadAllowed: boolean;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  thumbnailUrl: string;
  previewUrl: string;
  addedToPersonal?: boolean;
};

export type MarketAssetListQuery = {
  category?: MarketAssetCategory | null;
  keyword?: string;
  tags?: string[];
  status?: MarketAssetStatus | "all" | null;
  sort?: MarketAssetSort;
  cursor?: string | null;
  limit?: number;
};

export type MarketAssetListResult = {
  items: MarketAsset[];
  nextCursor: string | null;
  total: number;
  categoryCounts: Record<MarketAssetCategory, number>;
};

export type MarketUserAddition = {
  id: string;
  userId: string;
  marketAssetId: string;
  personalAssetId: string;
  createdAt: string;
};

export type MarketUserAdditionStore = {
  version: 1;
  userId: string;
  additions: MarketUserAddition[];
};

export type MarketAuditLogEntry = {
  id: string;
  marketAssetId: string;
  action: string;
  actorId: string;
  detail?: string;
  createdAt: string;
};
