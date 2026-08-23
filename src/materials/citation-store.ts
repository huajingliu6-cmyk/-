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
import { MATERIAL_CITATIONS_NAMESPACE } from "@/materials/constants";
import {
  getMaterialById,
  incrementMaterialCiteCount,
} from "@/materials/catalog-store";
import type {
  CreatePersonalMaterialInput,
  Material,
  MaterialGenderTag,
  MaterialType,
  PersonalMaterial,
  UserMaterialCitation,
  UserMaterialLibrary,
} from "@/materials/types";

function emptyLibrary(userId: string): UserMaterialLibrary {
  return { version: 2, userId, materials: [], citations: [] };
}

function localLibraryPath(userId: string): string {
  return resolveAppDataPath("materials", "citations", `${userId}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMaterialType(value: unknown): value is MaterialType {
  return (
    value === "character" ||
    value === "clothing" ||
    value === "prop" ||
    value === "scene"
  );
}

function parseGenderTags(raw: unknown): MaterialGenderTag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is MaterialGenderTag =>
      t === "male" || t === "female" || t === "child" || t === "unrestricted",
  );
}

function citationToPersonal(citation: UserMaterialCitation): PersonalMaterial {
  return {
    id: citation.personalAssetId,
    ownerId: citation.userId,
    sourceType: "system-citation",
    sourceMaterialId: citation.sourceMaterialId || citation.materialId,
    mediaId: citation.snapshot.mediaId,
    name: citation.snapshot.name,
    type: citation.snapshot.type,
    description: citation.snapshot.description,
    tags: [...citation.snapshot.tags],
    genderTags: [...citation.snapshot.genderTags],
    themeTags: [...citation.snapshot.themeTags],
    createdAt: citation.createdAt,
    updatedAt: citation.createdAt,
  };
}

function personalToCitation(material: PersonalMaterial): UserMaterialCitation | null {
  if (material.sourceType !== "system-citation") return null;
  const sourceMaterialId = (material.sourceMaterialId ?? "").trim();
  if (!sourceMaterialId) return null;
  return {
    userId: material.ownerId,
    materialId: sourceMaterialId,
    personalAssetId: material.id,
    sourceMaterialId,
    snapshot: {
      name: material.name,
      type: material.type,
      mediaId: material.mediaId,
      description: material.description,
      tags: [...material.tags],
      genderTags: [...material.genderTags],
      themeTags: [...material.themeTags],
    },
    createdAt: material.createdAt,
  };
}

function snapshotFromMaterial(
  material: Material,
): UserMaterialCitation["snapshot"] {
  return {
    name: material.name,
    type: material.type,
    mediaId: material.mediaId,
    description: material.description,
    tags: [...material.tags],
    genderTags: [...material.genderTags],
    themeTags: [...material.themeTags],
  };
}

function normalizeCitation(raw: unknown): UserMaterialCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const userId = typeof rec.userId === "string" ? rec.userId : "";
  const materialId = typeof rec.materialId === "string" ? rec.materialId : "";
  const personalAssetId =
    typeof rec.personalAssetId === "string" ? rec.personalAssetId.trim() : "";
  if (!userId || !materialId || !personalAssetId) return null;
  const sourceMaterialId =
    typeof rec.sourceMaterialId === "string" && rec.sourceMaterialId.trim()
      ? rec.sourceMaterialId.trim()
      : materialId;
  const snap = rec.snapshot;
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  if (!isMaterialType(s.type)) return null;
  return {
    userId,
    materialId,
    personalAssetId,
    sourceMaterialId,
    snapshot: {
      name: typeof s.name === "string" ? s.name : "",
      type: s.type,
      mediaId: typeof s.mediaId === "string" ? s.mediaId : "",
      description: typeof s.description === "string" ? s.description : "",
      tags: Array.isArray(s.tags)
        ? s.tags.filter((t): t is string => typeof t === "string")
        : [],
      genderTags: parseGenderTags(s.genderTags),
      themeTags: Array.isArray(s.themeTags)
        ? s.themeTags.filter((t): t is string => typeof t === "string")
        : [],
    },
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
  };
}

function normalizePersonalMaterial(
  userId: string,
  raw: unknown,
): PersonalMaterial | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const mediaId = typeof rec.mediaId === "string" ? rec.mediaId.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (!id || !mediaId || !name || !isMaterialType(rec.type)) return null;
  const sourceType = rec.sourceType;
  if (
    sourceType !== "upload" &&
    sourceType !== "system-citation" &&
    sourceType !== "generated"
  ) {
    return null;
  }
  const ownerId =
    typeof rec.ownerId === "string" && rec.ownerId.trim()
      ? rec.ownerId.trim()
      : userId;
  return {
    id,
    ownerId,
    sourceType,
    sourceMaterialId:
      typeof rec.sourceMaterialId === "string" && rec.sourceMaterialId.trim()
        ? rec.sourceMaterialId.trim()
        : null,
    mediaId,
    name,
    type: rec.type,
    description: typeof rec.description === "string" ? rec.description : "",
    tags: Array.isArray(rec.tags)
      ? rec.tags.filter((t): t is string => typeof t === "string")
      : [],
    genderTags: parseGenderTags(rec.genderTags),
    themeTags: Array.isArray(rec.themeTags)
      ? rec.themeTags.filter((t): t is string => typeof t === "string")
      : [],
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

function normalizeLibrary(userId: string, raw: unknown): UserMaterialLibrary {
  if (!raw || typeof raw !== "object") return emptyLibrary(userId);
  const rec = raw as Record<string, unknown>;
  const citations = Array.isArray(rec.citations)
    ? rec.citations
        .map((item) => normalizeCitation(item))
        .filter((item): item is UserMaterialCitation => item != null)
    : [];
  let materials = Array.isArray(rec.materials)
    ? rec.materials
        .map((item) => normalizePersonalMaterial(userId, item))
        .filter((item): item is PersonalMaterial => item != null)
    : [];

  // Migrate legacy citations into materials when missing.
  if (materials.length === 0 && citations.length > 0) {
    materials = citations.map(citationToPersonal);
  } else if (citations.length > 0) {
    const bySource = new Set(
      materials
        .filter((m) => m.sourceType === "system-citation" && m.sourceMaterialId)
        .map((m) => m.sourceMaterialId as string),
    );
    for (const citation of citations) {
      if (bySource.has(citation.materialId)) continue;
      if (materials.some((m) => m.id === citation.personalAssetId)) continue;
      materials.push(citationToPersonal(citation));
    }
  }

  const syncedCitations = materials
    .map(personalToCitation)
    .filter((item): item is UserMaterialCitation => item != null);

  return {
    version: 2,
    userId,
    materials,
    citations: syncedCitations.length > 0 ? syncedCitations : citations,
  };
}

async function readLibraryLocal(userId: string): Promise<UserMaterialLibrary> {
  try {
    const raw = await fs.readFile(localLibraryPath(userId), "utf-8");
    return normalizeLibrary(userId, JSON.parse(raw));
  } catch {
    return emptyLibrary(userId);
  }
}

async function writeLibraryLocal(library: UserMaterialLibrary): Promise<void> {
  const file = localLibraryPath(library.userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readLibraryRemote(userId: string): Promise<{
  library: UserMaterialLibrary;
  revision: number;
}> {
  const doc = await getRemoteDocument<UserMaterialLibrary>(
    MATERIAL_CITATIONS_NAMESPACE,
    userId,
  );
  if (!doc) return { library: emptyLibrary(userId), revision: 0 };
  return {
    library: normalizeLibrary(userId, doc.value),
    revision: doc.revision,
  };
}

async function writeLibraryRemote(
  library: UserMaterialLibrary,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: MATERIAL_CITATIONS_NAMESPACE,
    key: library.userId,
    expectedRevision,
    value: library,
  });
}

async function mutateLibrary(
  userId: string,
  mutator: (
    library: UserMaterialLibrary,
  ) => { library: UserMaterialLibrary; result: unknown; skipWrite?: boolean },
): Promise<unknown> {
  if (isRemoteDataOnly()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { library, revision } = await readLibraryRemote(userId);
      const applied = mutator(library);
      if (applied.skipWrite) return applied.result;
      try {
        await writeLibraryRemote(applied.library, revision);
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

  const library = await readLibraryLocal(userId);
  const applied = mutator(library);
  if (!applied.skipWrite) {
    await writeLibraryLocal(applied.library);
  }
  return applied.result;
}

export async function loadUserMaterialLibrary(
  userId: string,
): Promise<UserMaterialLibrary> {
  if (isRemoteDataOnly()) {
    const { library } = await readLibraryRemote(userId);
    return library;
  }
  return readLibraryLocal(userId);
}

export async function listPersonalMaterials(
  userId: string,
): Promise<PersonalMaterial[]> {
  const library = await loadUserMaterialLibrary(userId);
  return library.materials;
}

export async function getPersonalMaterialForUser(input: {
  userId: string;
  personalMaterialId: string;
}): Promise<PersonalMaterial | null> {
  const library = await loadUserMaterialLibrary(input.userId);
  return (
    library.materials.find((item) => item.id === input.personalMaterialId) ??
    null
  );
}

export async function createPersonalMaterial(input: {
  userId: string;
  material: CreatePersonalMaterialInput;
}): Promise<PersonalMaterial> {
  const name = input.material.name.trim();
  if (!name) throw new Error("素材名称不能为空");
  const mediaId = input.material.mediaId.trim();
  if (!mediaId) throw new Error("缺少媒体 ID");
  const now = nowIso();
  const created: PersonalMaterial = {
    id: randomUUID(),
    ownerId: input.userId,
    sourceType: input.material.sourceType ?? "upload",
    sourceMaterialId: null,
    mediaId,
    name,
    type: input.material.type,
    description: (input.material.description ?? "").trim(),
    tags: [...(input.material.tags ?? [])],
    genderTags: [...(input.material.genderTags ?? [])],
    themeTags: [...(input.material.themeTags ?? [])],
    createdAt: now,
    updatedAt: now,
  };

  await mutateLibrary(input.userId, (library) => ({
    library: {
      version: 2,
      userId: input.userId,
      materials: [created, ...library.materials],
      citations: library.citations,
    },
    result: created,
  }));
  return created;
}

export async function citeMaterialForUser(input: {
  userId: string;
  materialId: string;
}): Promise<{
  citation: UserMaterialCitation;
  personalMaterial: PersonalMaterial;
  alreadyCited: boolean;
}> {
  const material = await getMaterialById(input.materialId);
  if (!material) throw new Error("素材不存在或已下架");

  type ApplyResult = {
    library: UserMaterialLibrary;
    citation: UserMaterialCitation;
    personalMaterial: PersonalMaterial;
    alreadyCited: boolean;
    skipWrite?: boolean;
  };

  const apply = (library: UserMaterialLibrary): ApplyResult => {
    const existingPersonal = library.materials.find(
      (item) =>
        item.sourceType === "system-citation" &&
        item.sourceMaterialId === material.id,
    );
    if (existingPersonal) {
      const citation =
        personalToCitation(existingPersonal) ??
        ({
          userId: input.userId,
          materialId: material.id,
          personalAssetId: existingPersonal.id,
          sourceMaterialId: material.id,
          snapshot: snapshotFromMaterial(material),
          createdAt: existingPersonal.createdAt,
        } satisfies UserMaterialCitation);
      return {
        library,
        citation,
        personalMaterial: existingPersonal,
        alreadyCited: true,
        skipWrite: true,
      };
    }

    const existingCitation = library.citations.find(
      (item) => item.materialId === material.id,
    );
    if (existingCitation) {
      const personal = citationToPersonal(existingCitation);
      return {
        library: {
          version: 2,
          userId: input.userId,
          materials: [personal, ...library.materials],
          citations: library.citations,
        },
        citation: existingCitation,
        personalMaterial: personal,
        alreadyCited: true,
      };
    }

    const personalId = randomUUID();
    const createdAt = nowIso();
    const personal: PersonalMaterial = {
      id: personalId,
      ownerId: input.userId,
      sourceType: "system-citation",
      sourceMaterialId: material.id,
      mediaId: material.mediaId,
      name: material.name,
      type: material.type,
      description: material.description,
      tags: [...material.tags],
      genderTags: [...material.genderTags],
      themeTags: [...material.themeTags],
      createdAt,
      updatedAt: createdAt,
    };
    const citation: UserMaterialCitation = {
      userId: input.userId,
      materialId: material.id,
      personalAssetId: personalId,
      sourceMaterialId: material.id,
      snapshot: snapshotFromMaterial(material),
      createdAt,
    };
    return {
      library: {
        version: 2,
        userId: input.userId,
        materials: [personal, ...library.materials],
        citations: [citation, ...library.citations],
      },
      citation,
      personalMaterial: personal,
      alreadyCited: false,
    };
  };

  if (isRemoteDataOnly()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { library, revision } = await readLibraryRemote(input.userId);
      const result = apply(library);
      if (result.alreadyCited && result.skipWrite) {
        return {
          citation: result.citation,
          personalMaterial: result.personalMaterial,
          alreadyCited: true,
        };
      }
      try {
        await writeLibraryRemote(result.library, revision);
        if (!result.alreadyCited) {
          await incrementMaterialCiteCount(material.id);
        }
        return {
          citation: result.citation,
          personalMaterial: result.personalMaterial,
          alreadyCited: result.alreadyCited,
        };
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
    throw new Error("引用保存冲突，请重试");
  }

  const library = await readLibraryLocal(input.userId);
  const result = apply(library);
  if (!result.skipWrite) {
    await writeLibraryLocal(result.library);
    if (!result.alreadyCited) {
      await incrementMaterialCiteCount(material.id);
    }
  }
  return {
    citation: result.citation,
    personalMaterial: result.personalMaterial,
    alreadyCited: result.alreadyCited,
  };
}

export async function listCitedMaterialIds(userId: string): Promise<string[]> {
  const library = await loadUserMaterialLibrary(userId);
  return library.materials
    .filter((item) => item.sourceType === "system-citation" && item.sourceMaterialId)
    .map((item) => item.sourceMaterialId as string);
}
