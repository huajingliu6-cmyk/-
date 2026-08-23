import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { isRemoteDataOnly, getRemoteDocument, putRemoteDocument } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";

export type CharacterMergeRequestStatus = "pending" | "approved" | "rejected";
export type CharacterMergeRequest = {
  id: string;
  projectId: string;
  targetCharacterId: string;
  sourceCharacterId: string;
  submittedByUserId: string;
  status: CharacterMergeRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
};
export type CharacterMergeRequestsFile = { version: 1; revision: number; requests: CharacterMergeRequest[] };

const empty = (): CharacterMergeRequestsFile => ({ version: 1, revision: 0, requests: [] });
const filePath = (projectId: string) => path.join(projectRootDir(projectId), "character-merge-requests.json");
export function newMergeRequestId() { return `cmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`; }

export async function loadCharacterMergeRequests(projectId: string): Promise<CharacterMergeRequestsFile> {
  if (isRemoteDataOnly()) {
    const doc = await getRemoteDocument<CharacterMergeRequestsFile>("character-merge-requests", projectId);
    return doc ? { ...doc.value, revision: doc.revision } : empty();
  }
  try {
    const raw = JSON.parse(await fs.readFile(filePath(projectId), "utf8")) as CharacterMergeRequestsFile;
    return { version: 1, revision: raw.revision ?? 0, requests: Array.isArray(raw.requests) ? raw.requests : [] };
  } catch { return empty(); }
}

export async function saveCharacterMergeRequests(projectId: string, value: CharacterMergeRequestsFile, expectedRevision?: number) {
  const next = { ...value, version: 1 as const, revision: (value.revision ?? 0) + 1 };
  if (isRemoteDataOnly()) {
    const doc = await putRemoteDocument({ namespace: "character-merge-requests", key: projectId, expectedRevision, value: next });
    return doc.value;
  }
  await fs.mkdir(projectRootDir(projectId), { recursive: true });
  const target = filePath(projectId); const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8"); await fs.rename(tmp, target); return next;
}
