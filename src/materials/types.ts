export type MaterialType = "character" | "clothing" | "prop" | "scene";

export type MaterialStatus = "active" | "deleted";

export type MaterialGenderTag = "male" | "female" | "child" | "unrestricted";

export type MaterialSort = "all" | "newest" | "popular";

export type Material = {
  id: string;
  name: string;
  type: MaterialType;
  mediaId: string;
  description: string;
  tags: string[];
  genderTags: MaterialGenderTag[];
  themeTags: string[];
  sortOrder: number;
  status: MaterialStatus;
  citeCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MaterialCatalog = {
  version: 1;
  materials: Material[];
};

/** How a personal-space material was created. */
export type PersonalMaterialSourceType =
  | "upload"
  | "system-citation"
  | "generated";

/**
 * User-owned reusable material in「个人空间」.
 * System citations keep snapshot fields so soft-deleted catalog rows stay usable.
 */
export type PersonalMaterial = {
  id: string;
  ownerId: string;
  sourceType: PersonalMaterialSourceType;
  /** Present for system-citation (and optionally generated from catalog). */
  sourceMaterialId?: string | null;
  mediaId: string;
  name: string;
  type: MaterialType;
  description: string;
  tags: string[];
  genderTags: MaterialGenderTag[];
  themeTags: string[];
  createdAt: string;
  updatedAt: string;
};

/** @deprecated Prefer PersonalMaterial; kept for persisted v1 citation JSON. */
export type UserMaterialCitation = {
  userId: string;
  materialId: string;
  personalAssetId: string;
  sourceMaterialId: string;
  snapshot: {
    name: string;
    type: MaterialType;
    mediaId: string;
    description: string;
    tags: string[];
    genderTags: MaterialGenderTag[];
    themeTags: string[];
  };
  createdAt: string;
};

export type UserMaterialLibrary = {
  version: 1 | 2;
  userId: string;
  /** v2 personal space entries (upload / citation / generated). */
  materials: PersonalMaterial[];
  /** v1 legacy citations; migrated into materials on read. */
  citations: UserMaterialCitation[];
};

export type MaterialListQuery = {
  type?: MaterialType | null;
  genders?: MaterialGenderTag[];
  themes?: string[];
  q?: string;
  sort?: MaterialSort;
  includeDeleted?: boolean;
};

export type CreateMaterialInput = {
  name: string;
  type: MaterialType;
  mediaId: string;
  description?: string;
  tags?: string[];
  genderTags: MaterialGenderTag[];
  themeTags: string[];
  sortOrder?: number;
};

export type UpdateMaterialInput = {
  name?: string;
  type?: MaterialType;
  description?: string;
  tags?: string[];
  genderTags?: MaterialGenderTag[];
  themeTags?: string[];
  sortOrder?: number;
  status?: MaterialStatus;
  mediaId?: string;
};

export type CreatePersonalMaterialInput = {
  name: string;
  type: MaterialType;
  mediaId: string;
  description?: string;
  tags?: string[];
  genderTags?: MaterialGenderTag[];
  themeTags?: string[];
  sourceType?: Extract<PersonalMaterialSourceType, "upload" | "generated">;
};
