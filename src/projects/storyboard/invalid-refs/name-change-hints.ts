import "server-only";

import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { projectRootDir } from "@/projects/project-storage";

export type AssetNameChangeHint = {
  assetId: string;
  oldName: string;
  newName: string;
  recordedAt: string;
};

type HintFile = {
  projectId: string;
  hints: AssetNameChangeHint[];
  updatedAt: string;
};

function hintsPath(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts", "asset-name-change-hints.json");
}

async function readHintsFile(projectId: string): Promise<HintFile> {
  try {
    const raw = await fs.readFile(hintsPath(projectId), "utf-8");
    const parsed = JSON.parse(raw) as HintFile;
    if (!parsed || !Array.isArray(parsed.hints)) {
      return { projectId, hints: [], updatedAt: new Date().toISOString() };
    }
    return {
      projectId,
      hints: parsed.hints.filter(
        (h) =>
          typeof h?.assetId === "string" &&
          typeof h?.oldName === "string" &&
          typeof h?.newName === "string",
      ),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return { projectId, hints: [], updatedAt: new Date().toISOString() };
  }
}

async function writeHintsFile(file: HintFile): Promise<void> {
  const dir = path.dirname(hintsPath(file.projectId));
  await fs.mkdir(dir, { recursive: true });
  const target = hintsPath(file.projectId);
  const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(file, null, 2), "utf-8");
  await fs.rename(temp, target);
}

/** Map assetId → unique old names still pending repair. */
export async function loadAssetNameChangeHintMap(
  projectId: string,
): Promise<Map<string, string[]>> {
  const file = await readHintsFile(projectId);
  const map = new Map<string, string[]>();
  for (const hint of file.hints) {
    const assetId = hint.assetId.trim();
    const oldName = hint.oldName.trim();
    const newName = hint.newName.trim();
    if (!assetId || !oldName || !newName || oldName === newName) continue;
    const list = map.get(assetId) ?? [];
    if (!list.includes(oldName)) list.push(oldName);
    map.set(assetId, list);
  }
  return map;
}

export async function recordAssetNameChanges(input: {
  projectId: string;
  changes: Array<{ assetId: string; oldName: string; newName: string }>;
}): Promise<void> {
  if (input.changes.length === 0) return;
  const file = await readHintsFile(input.projectId);
  const now = new Date().toISOString();
  const byKey = new Map<string, AssetNameChangeHint>();
  for (const hint of file.hints) {
    byKey.set(`${hint.assetId}::${hint.oldName}`, hint);
  }
  for (const change of input.changes) {
    const assetId = change.assetId.trim();
    const oldName = change.oldName.trim();
    const newName = change.newName.trim();
    if (!assetId || !oldName || !newName || oldName === newName) continue;
    byKey.set(`${assetId}::${oldName}`, {
      assetId,
      oldName,
      newName,
      recordedAt: now,
    });
  }
  await writeHintsFile({
    projectId: input.projectId,
    hints: [...byKey.values()],
    updatedAt: now,
  });
}

export async function clearAssetNameChangeHints(input: {
  projectId: string;
  assetIds: string[];
  oldNames?: string[];
}): Promise<void> {
  if (input.assetIds.length === 0) return;
  const file = await readHintsFile(input.projectId);
  const assetSet = new Set(input.assetIds.map((id) => id.trim()).filter(Boolean));
  const oldSet =
    input.oldNames && input.oldNames.length > 0
      ? new Set(input.oldNames.map((n) => n.trim()).filter(Boolean))
      : null;
  const next = file.hints.filter((hint) => {
    if (!assetSet.has(hint.assetId)) return true;
    if (oldSet && !oldSet.has(hint.oldName)) return true;
    return false;
  });
  await writeHintsFile({
    projectId: input.projectId,
    hints: next,
    updatedAt: new Date().toISOString(),
  });
}

export function collectNameChangesFromBundles(input: {
  previous: {
    characters: Array<{ id: string; name: string }>;
    scenes: Array<{ id: string; name: string }>;
    props: Array<{ id: string; name: string }>;
  } | null;
  next: {
    characters: Array<{ id: string; name: string }>;
    scenes: Array<{ id: string; name: string }>;
    props: Array<{ id: string; name: string }>;
  };
}): Array<{ assetId: string; oldName: string; newName: string }> {
  if (!input.previous) return [];
  const prev = new Map<string, string>();
  for (const a of input.previous.characters) prev.set(a.id, a.name.trim());
  for (const a of input.previous.scenes) prev.set(a.id, a.name.trim());
  for (const a of input.previous.props) prev.set(a.id, a.name.trim());

  const changes: Array<{ assetId: string; oldName: string; newName: string }> =
    [];
  const check = (id: string, newName: string) => {
    const oldName = prev.get(id);
    if (oldName == null) return;
    const nextName = newName.trim();
    if (!oldName || !nextName || oldName === nextName) return;
    changes.push({ assetId: id, oldName, newName: nextName });
  };
  for (const a of input.next.characters) check(a.id, a.name);
  for (const a of input.next.scenes) check(a.id, a.name);
  for (const a of input.next.props) check(a.id, a.name);
  return changes;
}

export function stableHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
