export type PersonalImageResolution = "1K" | "2K" | "4K";

export type PersonalImageCount = 1 | 2 | 3;

export type PersonalImageHistoryItem = {
  id: string;
  imageUrl: string;
  name: string;
  prompt: string;
  aspectRatio: string;
  resolution: PersonalImageResolution;
  modelId: string;
  count: PersonalImageCount;
  generatedAt: string;
  uploadedToPersonalAssets: boolean;
  personalAssetId?: string;
};

export type PersonalImageHistoryStore = {
  version: 1;
  userId: string;
  items: PersonalImageHistoryItem[];
};
