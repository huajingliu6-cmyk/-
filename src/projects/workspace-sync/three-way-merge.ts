import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import type { SyncConflictRecord } from "@/projects/workspace-sync/sync-model";

export const MERGE_RULES = {
  oneSideChanged: "only-one-side-changed: adopt the changed side",
  differentFields: "both-sides-changed-distinct-fields: field-wise merge",
  sameFieldConflict: "same-field-both-changed: durable conflict, keep both",
  mediaIdLists: "approved/history/look media ids: deterministic sorted union",
  isolation:
    "workspace-only and management-only entities stay on their store; never overwrite a store with the other bundle",
} as const;

const SKIP_FIELDS = new Set([
  "id",
  "projectId",
  "imageObjectUrl",
  "documentRevision",
  "consistencyOperationStamp",
]);

const UNION_LIST_FIELDS = new Set([
  "approvedMediaIds",
  "historyMediaIds",
  "lookMediaIds",
]);

export type AssetEntityType = "character" | "scene" | "prop" | "audio";

export type ThreeWayMergeResult = {
  management: ProjectAssetBundle;
  workspace: ProjectAssetBundle;
  ancestor: ProjectAssetBundle;
  conflicts: Omit<SyncConflictRecord, "operationId" | "managementRevision" | "workspaceRevision">[];
  rules: typeof MERGE_RULES;
};

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (key === "imageObjectUrl") continue;
      out[key] = canonicalize(rec[key]);
    }
    return out;
  }
  return value;
}

function entityMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function mergeField(input: {
  field: string;
  base: unknown;
  management: unknown;
  workspace: unknown;
}):
  | { ok: true; value: unknown }
  | { ok: false; field: string; base: unknown; management: unknown; workspace: unknown } {
  const { field, base, management, workspace } = input;
  if (UNION_LIST_FIELDS.has(field)) {
    const left = Array.isArray(management) ? (management as string[]) : [];
    const right = Array.isArray(workspace) ? (workspace as string[]) : [];
    return { ok: true, value: mergeMediaIdLists(left, right) };
  }
  const mgmtChanged = !stableEqual(management, base);
  const wsChanged = !stableEqual(workspace, base);
  if (!mgmtChanged && !wsChanged) return { ok: true, value: base };
  if (mgmtChanged && !wsChanged) return { ok: true, value: management };
  if (!mgmtChanged && wsChanged) return { ok: true, value: workspace };
  if (stableEqual(management, workspace)) return { ok: true, value: management };
  return { ok: false, field, base, management, workspace };
}

function mergeSharedRecord<T extends { id: string }>(input: {
  entityType: AssetEntityType;
  base: T | undefined;
  management: T;
  workspace: T;
}): {
  value: T;
  conflicts: ThreeWayMergeResult["conflicts"];
} {
  const keys = new Set([
    ...Object.keys(input.base ?? {}),
    ...Object.keys(input.management),
    ...Object.keys(input.workspace),
  ]);
  const next: Record<string, unknown> = {
    ...(input.base ?? {}),
    ...input.management,
    ...input.workspace,
  };
  const conflicts: ThreeWayMergeResult["conflicts"] = [];
  for (const field of keys) {
    if (SKIP_FIELDS.has(field)) continue;
    const merged = mergeField({
      field,
      base: input.base ? (input.base as Record<string, unknown>)[field] : undefined,
      management: (input.management as Record<string, unknown>)[field],
      workspace: (input.workspace as Record<string, unknown>)[field],
    });
    if (merged.ok) {
      next[field] = merged.value;
    } else {
      conflicts.push({
        entityType: input.entityType,
        entityId: input.management.id,
        field: merged.field,
        baseValue: merged.base,
        managementValue: merged.management,
        workspaceValue: merged.workspace,
      });
    }
  }
  next.id = input.management.id;
  next.imageObjectUrl = null;
  return { value: next as T, conflicts };
}

function mergeKind<T extends { id: string }>(input: {
  entityType: AssetEntityType;
  base: T[];
  management: T[];
  workspace: T[];
}): {
  management: T[];
  workspace: T[];
  ancestor: T[];
  conflicts: ThreeWayMergeResult["conflicts"];
} {
  const baseMap = entityMap(input.base);
  const mgmtMap = entityMap(input.management);
  const wsMap = entityMap(input.workspace);
  const sharedIds = new Set<string>();
  for (const id of mgmtMap.keys()) {
    if (wsMap.has(id) || baseMap.has(id)) sharedIds.add(id);
  }
  for (const id of wsMap.keys()) {
    if (mgmtMap.has(id) || baseMap.has(id)) sharedIds.add(id);
  }

  const nextMgmt = new Map(mgmtMap);
  const nextWs = new Map(wsMap);
  const nextAncestor = new Map(baseMap);
  const conflicts: ThreeWayMergeResult["conflicts"] = [];

  for (const id of sharedIds) {
    const management = mgmtMap.get(id);
    const workspace = wsMap.get(id);
    if (management && workspace) {
      const merged = mergeSharedRecord({
        entityType: input.entityType,
        base: baseMap.get(id),
        management,
        workspace,
      });
      if (merged.conflicts.length > 0) {
        conflicts.push(...merged.conflicts);
        continue;
      }
      nextMgmt.set(id, merged.value);
      nextWs.set(id, merged.value);
      nextAncestor.set(id, merged.value);
      continue;
    }
    if (management && !workspace && baseMap.has(id)) {
      nextAncestor.set(id, management);
      continue;
    }
    if (workspace && !management && baseMap.has(id)) {
      nextAncestor.set(id, workspace);
    }
  }

  return {
    management: [...nextMgmt.values()],
    workspace: [...nextWs.values()],
    ancestor: [...nextAncestor.values()],
    conflicts,
  };
}

/**
 * Three-way merge of isolated management / workspace asset stores.
 * New one-store-only entities stay on that store (store isolation).
 */
export function threeWayMergeAssetBundles(input: {
  base: ProjectAssetBundle;
  management: ProjectAssetBundle;
  workspace: ProjectAssetBundle;
}): ThreeWayMergeResult {
  const characters = mergeKind<CharacterAsset>({
    entityType: "character",
    base: input.base.characters,
    management: input.management.characters,
    workspace: input.workspace.characters,
  });
  const scenes = mergeKind<SceneAsset>({
    entityType: "scene",
    base: input.base.scenes,
    management: input.management.scenes,
    workspace: input.workspace.scenes,
  });
  const props = mergeKind<PropAsset>({
    entityType: "prop",
    base: input.base.props,
    management: input.management.props,
    workspace: input.workspace.props,
  });
  const audios = mergeKind<AudioAsset>({
    entityType: "audio",
    base: input.base.audios,
    management: input.management.audios,
    workspace: input.workspace.audios,
  });
  const projectId =
    input.management.projectId ||
    input.workspace.projectId ||
    input.base.projectId;
  return {
    management: {
      projectId,
      characters: characters.management,
      scenes: scenes.management,
      props: props.management,
      audios: audios.management,
    },
    workspace: {
      projectId,
      characters: characters.workspace,
      scenes: scenes.workspace,
      props: props.workspace,
      audios: audios.workspace,
    },
    ancestor: {
      projectId,
      characters: characters.ancestor,
      scenes: scenes.ancestor,
      props: props.ancestor,
      audios: audios.ancestor,
    },
    conflicts: [
      ...characters.conflicts,
      ...scenes.conflicts,
      ...props.conflicts,
      ...audios.conflicts,
    ],
    rules: MERGE_RULES,
  };
}

export function emptyAssetBundle(projectId: string): ProjectAssetBundle {
  return {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
}
