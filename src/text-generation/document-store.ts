import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { projectRootDir } from "@/projects/project-storage";
import type {
  ProjectTextDocument,
  StoryDraft,
  TextOutputKind,
} from "@/text-generation/types";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  getCurrentDocumentRemote,
  listDocumentVersionsRemote,
  loadStoryDraftRemote,
  saveNewDocumentVersionRemote,
  saveStoryDraftRemote,
} from "@/text-generation/remote-document-store";

function docsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "documents");
}

function draftsPath(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts", "story.json");
}

function currentPointerPath(projectId: string): string {
  return path.join(docsDir(projectId), "current.json");
}

async function ensure(projectId: string) {
  await fs.mkdir(docsDir(projectId), { recursive: true });
  await fs.mkdir(path.join(projectRootDir(projectId), "drafts"), {
    recursive: true,
  });
}

export async function listDocumentVersions(
  projectId: string,
): Promise<ProjectTextDocument[]> {
  if (isRemoteDataOnly()) return listDocumentVersionsRemote(projectId);
  await ensure(projectId);
  const entries = await fs.readdir(docsDir(projectId)).catch(() => []);
  const docs: ProjectTextDocument[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name === "current.json") continue;
    try {
      const raw = await fs.readFile(path.join(docsDir(projectId), name), "utf-8");
      docs.push(JSON.parse(raw) as ProjectTextDocument);
    } catch {
      // skip
    }
  }
  docs.sort((a, b) => b.version - a.version);
  return docs;
}

export async function getCurrentDocument(
  projectId: string,
): Promise<ProjectTextDocument | null> {
  if (isRemoteDataOnly()) return getCurrentDocumentRemote(projectId);
  try {
    const raw = await fs.readFile(currentPointerPath(projectId), "utf-8");
    const ptr = JSON.parse(raw) as { documentId: string };
    const docRaw = await fs.readFile(
      path.join(docsDir(projectId), `${ptr.documentId}.json`),
      "utf-8",
    );
    return JSON.parse(docRaw) as ProjectTextDocument;
  } catch {
    return null;
  }
}

export async function saveNewDocumentVersion(input: {
  projectId: string;
  rootFolderId: string;
  documentType: TextOutputKind;
  title: string;
  content: string;
  createdBy: string;
  modelKey: string;
  providerModel: string;
  targetChars: number;
  actualChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  generationId: string;
}): Promise<ProjectTextDocument> {
  if (isRemoteDataOnly()) return saveNewDocumentVersionRemote(input);
  await ensure(input.projectId);
  const existing = await listDocumentVersions(input.projectId);
  const version = (existing[0]?.version ?? 0) + 1;
  const documentId = `doc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const doc: ProjectTextDocument = {
    documentId,
    projectId: input.projectId,
    rootFolderId: input.rootFolderId,
    documentType: input.documentType,
    title: input.title,
    content: input.content,
    version,
    createdBy: input.createdBy,
    modelKey: input.modelKey,
    providerModel: input.providerModel,
    targetChars: input.targetChars,
    actualChars: input.actualChars,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    generationId: input.generationId,
    createdAt: new Date().toISOString(),
  };
  const target = path.join(docsDir(input.projectId), `${documentId}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(doc, null, 2), "utf-8");
  await fs.rename(temp, target);

  const ptr = path.join(docsDir(input.projectId), "current.json");
  const ptrTemp = `${ptr}.${process.pid}.tmp`;
  await fs.writeFile(
    ptrTemp,
    JSON.stringify({ documentId, version }, null, 2),
    "utf-8",
  );
  await fs.rename(ptrTemp, ptr);
  return doc;
}

export async function saveStoryDraft(draft: StoryDraft): Promise<void> {
  if (isRemoteDataOnly()) return saveStoryDraftRemote(draft);
  await ensure(draft.projectId);
  const target = draftsPath(draft.projectId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(draft, null, 2), "utf-8");
  await fs.rename(temp, target);
}

export async function loadStoryDraft(
  projectId: string,
): Promise<StoryDraft | null> {
  if (isRemoteDataOnly()) return loadStoryDraftRemote(projectId);
  try {
    const raw = await fs.readFile(draftsPath(projectId), "utf-8");
    return JSON.parse(raw) as StoryDraft;
  } catch {
    return null;
  }
}
