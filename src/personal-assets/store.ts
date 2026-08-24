import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getRemoteDocument,
  isRemoteDataOnly,
  putRemoteDocument,
} from "@/persistence/remote-data-client";
import { PERSONAL_ASSETS_NAMESPACE, PERSONAL_ASSET_QUOTA_BYTES } from "@/personal-assets/constants";
import { queryPersonalAssets, sumPersonalAssetBytes } from "@/personal-assets/queries";
import type {
  CreatePersonalAssetInput,
  PersonalAsset,
  PersonalAssetCategory,
  PersonalAssetListQuery,
  PersonalAssetListResult,
  PersonalAssetMimeType,
  PersonalAssetQuality,
  PersonalAssetSourceType,
  PersonalAssetStore,
  UpdatePersonalAssetInput,
} from "@/personal-assets/types";

function emptyStore(userId: string): PersonalAssetStore {
  return { version: 1, userId, assets: [] };
}

function localStorePath(userId: string): string {
  return resolveAppDataPath(
    PERSONAL_ASSETS_NAMESPACE,
    "users",
    `${userId}.json`,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function isCategory(value: unknown): value is PersonalAssetCategory {
  return (
    value === "character" ||
    value === "scene" ||
    value === "prop" ||
    value === "other"
  );
}

function isMimeType(value: unknown): value is PersonalAssetMimeType {
  return (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/webp"
  );
}

function isSourceType(value: unknown): value is PersonalAssetSourceType {
  return (
    value === "manual_upload" ||
    value === "ai_image" ||
    value === "market_reference"
  );
}

function isQuality(value: unknown): value is PersonalAssetQuality {
  return value === "1K" || value === "2K" || value === "4K";
}

function normalizeAsset(userId: string, raw: unknown): PersonalAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  const storageKey =
    typeof rec.storageKey === "string" ? rec.storageKey.trim() : "";
  if (!id || !name || !storageKey || !isCategory(rec.category)) return null;
  if (!isMimeType(rec.mimeType) || !isSourceType(rec.sourceType)) return null;
  const sizeBytes =
    typeof rec.sizeBytes === "number" && Number.isFinite(rec.sizeBytes)
      ? Math.max(0, Math.floor(rec.sizeBytes))
      : 0;
  const width =
    typeof rec.width === "number" && Number.isFinite(rec.width)
      ? Math.max(0, Math.floor(rec.width))
      : 0;
  const height =
    typeof rec.height === "number" && Number.isFinite(rec.height)
      ? Math.max(0, Math.floor(rec.height))
      : 0;
  const ownerId =
    typeof rec.ownerId === "string" && rec.ownerId.trim()
      ? rec.ownerId.trim()
      : userId;
  return {
    id,
    ownerId,
    name,
    category: rec.category,
    mimeType: rec.mimeType,
    sizeBytes,
    width,
    height,
    storageKey,
    sourceType: rec.sourceType,
    marketAssetId:
      typeof rec.marketAssetId === "string" && rec.marketAssetId.trim()
        ? rec.marketAssetId.trim()
        : undefined,
    prompt: typeof rec.prompt === "string" ? rec.prompt : undefined,
    aspectRatio:
      typeof rec.aspectRatio === "string" ? rec.aspectRatio : undefined,
    quality: isQuality(rec.quality) ? rec.quality : undefined,
    modelId: typeof rec.modelId === "string" ? rec.modelId : undefined,
    generatedAt:
      typeof rec.generatedAt === "string" ? rec.generatedAt : undefined,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

function normalizeStore(userId: string, raw: unknown): PersonalAssetStore {
  if (!raw || typeof raw !== "object") return emptyStore(userId);
  const rec = raw as Record<string, unknown>;
  const assets = Array.isArray(rec.assets)
    ? rec.assets
        .map((item) => normalizeAsset(userId, item))
        .filter((item): item is PersonalAsset => item != null)
    : [];
  return { version: 1, userId, assets };
}

async function readStoreLocal(userId: string): Promise<PersonalAssetStore> {
  try {
    const raw = await fs.readFile(localStorePath(userId), "utf-8");
    return normalizeStore(userId, JSON.parse(raw));
  } catch {
    return emptyStore(userId);
  }
}

async function writeStoreLocal(store: PersonalAssetStore): Promise<void> {
  const file = localStorePath(store.userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readStoreRemote(userId: string): Promise<{
  store: PersonalAssetStore;
  revision: number;
}> {
  const doc = await getRemoteDocument<PersonalAssetStore>(
    PERSONAL_ASSETS_NAMESPACE,
    userId,
  );
  if (!doc) return { store: emptyStore(userId), revision: 0 };
  return {
    store: normalizeStore(userId, doc.value),
    revision: doc.revision,
  };
}

async function writeStoreRemote(
  store: PersonalAssetStore,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: PERSONAL_ASSETS_NAMESPACE,
    key: store.userId,
    expectedRevision,
    value: store,
  });
}

async function mutateStore<T>(
  userId: string,
  mutator: (store: PersonalAssetStore) => {
    store: PersonalAssetStore;
    result: T;
    skipWrite?: boolean;
  },
): Promise<T> {
  if (isRemoteDataOnly()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { store, revision } = await readStoreRemote(userId);
      const applied = mutator(store);
      if (applied.skipWrite) return applied.result;
      try {
        await writeStoreRemote(applied.store, revision);
        return applied.result;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "REVISION_CONFLICT" &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("个人素材保存冲突，请重试");
  }

  const store = await readStoreLocal(userId);
  const applied = mutator(store);
  if (!applied.skipWrite) {
    await writeStoreLocal(applied.store);
  }
  return applied.result;
}

export async function listPersonalAssets(
  userId: string,
  query: PersonalAssetListQuery = {},
): Promise<PersonalAssetListResult> {
  const store = isRemoteDataOnly()
    ? (await readStoreRemote(userId)).store
    : await readStoreLocal(userId);
  return queryPersonalAssets(store.assets, query);
}

export async function getPersonalAssetForUser(input: {
  userId: string;
  assetId: string;
}): Promise<PersonalAsset | null> {
  const store = isRemoteDataOnly()
    ? (await readStoreRemote(input.userId)).store
    : await readStoreLocal(input.userId);
  return store.assets.find((asset) => asset.id === input.assetId) ?? null;
}

export async function createPersonalAsset(input: {
  userId: string;
  asset: CreatePersonalAssetInput;
}): Promise<PersonalAsset> {
  const name = input.asset.name.trim();
  if (!name) throw new Error("素材名称不能为空");
  const storageKey = input.asset.storageKey.trim();
  if (!storageKey) throw new Error("缺少存储键");

  const now = nowIso();
  const created: PersonalAsset = {
    id: randomUUID(),
    ownerId: input.userId,
    name,
    category: input.asset.category,
    mimeType: input.asset.mimeType,
    sizeBytes: input.asset.sizeBytes,
    width: input.asset.width,
    height: input.asset.height,
    storageKey,
    sourceType: input.asset.sourceType ?? "manual_upload",
    marketAssetId: input.asset.marketAssetId,
    prompt: input.asset.prompt,
    aspectRatio: input.asset.aspectRatio,
    quality: input.asset.quality,
    modelId: input.asset.modelId,
    generatedAt: input.asset.generatedAt,
    createdAt: now,
    updatedAt: now,
  };

  await mutateStore(input.userId, (store) => ({
    store: {
      version: 1,
      userId: input.userId,
      assets: [created, ...store.assets],
    },
    result: created,
  }));
  return created;
}

export async function updatePersonalAsset(input: {
  userId: string;
  assetId: string;
  patch: UpdatePersonalAssetInput;
}): Promise<PersonalAsset> {
  let updated: PersonalAsset | null = null;
  await mutateStore(input.userId, (store) => {
    const index = store.assets.findIndex((asset) => asset.id === input.assetId);
    if (index < 0) throw new Error("素材不存在");
    const current = store.assets[index];
    const nextName =
      typeof input.patch.name === "string"
        ? input.patch.name.trim()
        : current.name;
    if (!nextName) throw new Error("素材名称不能为空");
    const nextCategory = input.patch.category ?? current.category;
    updated = {
      ...current,
      name: nextName,
      category: nextCategory,
      updatedAt: nowIso(),
    };
    const assets = [...store.assets];
    assets[index] = updated;
    return {
      store: { version: 1, userId: input.userId, assets },
      result: updated,
    };
  });
  if (!updated) throw new Error("素材不存在");
  return updated;
}

export async function deletePersonalAsset(input: {
  userId: string;
  assetId: string;
}): Promise<void> {
  await mutateStore(input.userId, (store) => ({
    store: {
      version: 1,
      userId: input.userId,
      assets: store.assets.filter((asset) => asset.id !== input.assetId),
    },
    result: undefined,
  }));
}

export async function bulkDeletePersonalAssets(input: {
  userId: string;
  assetIds: string[];
}): Promise<number> {
  const ids = new Set(input.assetIds);
  let deleted = 0;
  await mutateStore(input.userId, (store) => {
    const assets = store.assets.filter((asset) => {
      if (!ids.has(asset.id)) return true;
      deleted += 1;
      return false;
    });
    return {
      store: { version: 1, userId: input.userId, assets },
      result: deleted,
    };
  });
  return deleted;
}

export async function getPersonalAssetUsage(userId: string): Promise<number> {
  const store = isRemoteDataOnly()
    ? (await readStoreRemote(userId)).store
    : await readStoreLocal(userId);
  return sumPersonalAssetBytes(store.assets);
}

export async function canStorePersonalAssetBytes(input: {
  userId: string;
  additionalBytes: number;
}): Promise<boolean> {
  const used = await getPersonalAssetUsage(input.userId);
  return used + input.additionalBytes <= PERSONAL_ASSET_QUOTA_BYTES;
}
