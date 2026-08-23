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
import {
  MATERIAL_CATALOG_KEY,
  MATERIAL_CATALOG_NAMESPACE,
} from "@/materials/constants";
import {
  filterAndSortMaterials,
  hasRequiredFilterTags,
  parseGenderTags,
  parseStringTags,
  parseThemeTags,
} from "@/materials/filters";
import type {
  CreateMaterialInput,
  Material,
  MaterialCatalog,
  MaterialListQuery,
  UpdateMaterialInput,
} from "@/materials/types";

function emptyCatalog(): MaterialCatalog {
  return { version: 1, materials: [] };
}

function localCatalogPath(): string {
  return resolveAppDataPath("materials", "catalog.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMaterial(raw: unknown): Material | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  const type = rec.type;
  if (!id || !name) return null;
  if (
    type !== "character" &&
    type !== "clothing" &&
    type !== "prop" &&
    type !== "scene"
  ) {
    return null;
  }
  const mediaId = typeof rec.mediaId === "string" ? rec.mediaId.trim() : "";
  if (!mediaId) return null;
  return {
    id,
    name,
    type,
    mediaId,
    description:
      typeof rec.description === "string" ? rec.description.trim() : "",
    tags: parseStringTags(rec.tags),
    genderTags: parseGenderTags(rec.genderTags),
    themeTags: parseThemeTags(rec.themeTags),
    sortOrder:
      typeof rec.sortOrder === "number" && Number.isFinite(rec.sortOrder)
        ? rec.sortOrder
        : 0,
    status: rec.status === "deleted" ? "deleted" : "active",
    citeCount:
      typeof rec.citeCount === "number" && Number.isFinite(rec.citeCount)
        ? Math.max(0, Math.floor(rec.citeCount))
        : 0,
    createdBy: typeof rec.createdBy === "string" ? rec.createdBy : "",
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

function normalizeCatalog(raw: unknown): MaterialCatalog {
  if (!raw || typeof raw !== "object") return emptyCatalog();
  const rec = raw as Record<string, unknown>;
  const materials = Array.isArray(rec.materials)
    ? rec.materials
        .map((item) => normalizeMaterial(item))
        .filter((item): item is Material => item != null)
    : [];
  return { version: 1, materials };
}

async function readCatalogLocal(): Promise<MaterialCatalog> {
  try {
    const raw = await fs.readFile(localCatalogPath(), "utf-8");
    return normalizeCatalog(JSON.parse(raw));
  } catch {
    return emptyCatalog();
  }
}

async function writeCatalogLocal(catalog: MaterialCatalog): Promise<void> {
  const file = localCatalogPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(catalog, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readCatalogRemote(): Promise<{
  catalog: MaterialCatalog;
  revision: number;
}> {
  const doc = await getRemoteDocument<MaterialCatalog>(
    MATERIAL_CATALOG_NAMESPACE,
    MATERIAL_CATALOG_KEY,
  );
  if (!doc) return { catalog: emptyCatalog(), revision: 0 };
  return { catalog: normalizeCatalog(doc.value), revision: doc.revision };
}

async function writeCatalogRemote(
  catalog: MaterialCatalog,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: MATERIAL_CATALOG_NAMESPACE,
    key: MATERIAL_CATALOG_KEY,
    expectedRevision,
    value: catalog,
  });
}

export async function loadMaterialCatalog(): Promise<MaterialCatalog> {
  if (isRemoteDataOnly()) {
    const { catalog } = await readCatalogRemote();
    return catalog;
  }
  return readCatalogLocal();
}

async function mutateCatalog(
  mutator: (catalog: MaterialCatalog) => MaterialCatalog,
): Promise<MaterialCatalog> {
  if (isRemoteDataOnly()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { catalog, revision } = await readCatalogRemote();
      const next = mutator(catalog);
      try {
        await writeCatalogRemote(next, revision);
        return next;
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
    throw new Error("素材目录保存冲突，请重试");
  }
  const catalog = await readCatalogLocal();
  const next = mutator(catalog);
  await writeCatalogLocal(next);
  return next;
}

export async function listMaterials(
  query: MaterialListQuery = {},
): Promise<Material[]> {
  const catalog = await loadMaterialCatalog();
  return filterAndSortMaterials(catalog.materials, query);
}

export async function getMaterialById(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<Material | null> {
  const catalog = await loadMaterialCatalog();
  const found = catalog.materials.find((item) => item.id === id) ?? null;
  if (!found) return null;
  if (!options?.includeDeleted && found.status === "deleted") return null;
  return found;
}

export async function createMaterial(
  input: CreateMaterialInput,
  createdBy: string,
): Promise<Material> {
  const name = input.name.trim();
  if (!name) throw new Error("请填写素材名称");
  const genderTags = parseGenderTags(input.genderTags);
  const themeTags = parseThemeTags(input.themeTags);
  if (!hasRequiredFilterTags({ genderTags, themeTags })) {
    throw new Error("请至少选择一个性别或主题（可选手不限）");
  }
  const mediaId = input.mediaId.trim();
  if (!mediaId) throw new Error("请先上传图片");

  let created: Material | null = null;
  await mutateCatalog((catalog) => {
    const maxOrder = catalog.materials.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      0,
    );
    const stamp = nowIso();
    created = {
      id: randomUUID(),
      name,
      type: input.type,
      mediaId,
      description: (input.description ?? "").trim(),
      tags: parseStringTags(input.tags),
      genderTags,
      themeTags,
      sortOrder:
        typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
          ? input.sortOrder
          : maxOrder + 1,
      status: "active",
      citeCount: 0,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    return { version: 1, materials: [...catalog.materials, created] };
  });
  if (!created) throw new Error("创建素材失败");
  return created;
}

export async function updateMaterial(
  id: string,
  input: UpdateMaterialInput,
): Promise<Material> {
  let updated: Material | null = null;
  await mutateCatalog((catalog) => {
    const index = catalog.materials.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("素材不存在");
    const current = catalog.materials[index]!;
    const nextGender =
      input.genderTags !== undefined
        ? parseGenderTags(input.genderTags)
        : current.genderTags;
    const nextThemes =
      input.themeTags !== undefined
        ? parseThemeTags(input.themeTags)
        : current.themeTags;
    if (
      !hasRequiredFilterTags({ genderTags: nextGender, themeTags: nextThemes })
    ) {
      throw new Error("请至少选择一个性别或主题（可选手不限）");
    }
    const next: Material = {
      ...current,
      name:
        input.name !== undefined
          ? input.name.trim() || current.name
          : current.name,
      type: input.type ?? current.type,
      description:
        input.description !== undefined
          ? input.description.trim()
          : current.description,
      tags:
        input.tags !== undefined ? parseStringTags(input.tags) : current.tags,
      genderTags: nextGender,
      themeTags: nextThemes,
      sortOrder:
        typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
          ? input.sortOrder
          : current.sortOrder,
      status: input.status ?? current.status,
      mediaId:
        input.mediaId !== undefined && input.mediaId.trim()
          ? input.mediaId.trim()
          : current.mediaId,
      updatedAt: nowIso(),
    };
    updated = next;
    const materials = [...catalog.materials];
    materials[index] = next;
    return { version: 1, materials };
  });
  if (!updated) throw new Error("更新素材失败");
  return updated;
}

export async function softDeleteMaterial(id: string): Promise<Material> {
  return updateMaterial(id, { status: "deleted" });
}

export async function reorderMaterials(
  orderedIds: string[],
): Promise<Material[]> {
  const ids = orderedIds.map((id) => id.trim()).filter(Boolean);
  await mutateCatalog((catalog) => {
    const byId = new Map(catalog.materials.map((item) => [item.id, item]));
    const stamp = nowIso();
    const updated: Material[] = [];
    ids.forEach((id, index) => {
      const item = byId.get(id);
      if (!item) return;
      updated.push({ ...item, sortOrder: index + 1, updatedAt: stamp });
      byId.delete(id);
    });
    for (const rest of byId.values()) updated.push(rest);
    return { version: 1, materials: updated };
  });
  return listMaterials({ includeDeleted: true, sort: "all" });
}

export async function incrementMaterialCiteCount(id: string): Promise<void> {
  await mutateCatalog((catalog) => {
    const index = catalog.materials.findIndex((item) => item.id === id);
    if (index < 0) return catalog;
    const current = catalog.materials[index]!;
    const materials = [...catalog.materials];
    materials[index] = {
      ...current,
      citeCount: current.citeCount + 1,
      updatedAt: nowIso(),
    };
    return { version: 1, materials };
  });
}
