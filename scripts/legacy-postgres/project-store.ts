import "server-only";

/**
 * PostgreSQL project store for PERSISTENCE_DRIVER=postgres.
 * Does not read or write data/projects. No silent fallback to file storage.
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@/auth/password";
import { getPrisma } from "./prisma";
import {
  ProjectRepository,
  type CreateProjectInput as PrismaCreateProjectInput,
} from "./repositories";
import { ProjectService } from "./services";
import { ensurePostgresIdentityForSessionUser } from "./identity-bootstrap";
import {
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-errors";
import type {
  CreateProjectInput,
  ProjectPublic,
  ProjectRecord,
} from "@/projects/types";
import type { WorkflowProjectSummary } from "@/workflow/lib/workflow-storage";

function toCreationSource(
  source: CreateProjectInput["creationSource"],
): PrismaCreateProjectInput["creationSource"] {
  return source === "script-upload" ? "script_upload" : "story";
}

function toProjectMode(
  mode: CreateProjectInput["projectMode"],
): PrismaCreateProjectInput["projectMode"] {
  return mode === "full-stack" ? "full_stack" : "canvas";
}

function fromCreationSource(
  source: "story" | "script_upload",
): ProjectRecord["creationSource"] {
  return source === "script_upload" ? "script-upload" : "story";
}

function fromProjectMode(
  mode: "canvas" | "full_stack",
): ProjectRecord["projectMode"] {
  return mode === "full_stack" ? "full-stack" : "canvas";
}

function toRecord(project: {
  id: string;
  rootFolderId: string;
  name: string;
  ownerId: string;
  creationSource: "story" | "script_upload";
  projectMode: "canvas" | "full_stack";
  status: string;
  highlights: string;
  passwordEnabled: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectRecord {
  return {
    projectId: project.id,
    rootFolderId: project.rootFolderId,
    name: project.name,
    ownerId: project.ownerId,
    creationSource: fromCreationSource(project.creationSource),
    projectMode: fromProjectMode(project.projectMode),
    status: "draft",
    highlights: project.highlights,
    passwordEnabled: project.passwordEnabled,
    passwordHash: project.passwordHash,
    passwordSalt: project.passwordSalt,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toPublic(record: ProjectRecord): ProjectPublic {
  return {
    projectId: record.projectId,
    rootFolderId: record.rootFolderId,
    name: record.name,
    ownerId: record.ownerId,
    creationSource: record.creationSource,
    projectMode: record.projectMode,
    status: record.status,
    highlights: record.highlights,
    passwordEnabled: record.passwordEnabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function listProjectRecordsPostgres(): Promise<ProjectRecord[]> {
  const projects = new ProjectRepository(getPrisma());
  const rows = await projects.listAllOrderedByUpdatedAt();
  return rows.map(toRecord);
}

export async function listProjectSummariesPostgres(): Promise<
  WorkflowProjectSummary[]
> {
  const projects = new ProjectRepository(getPrisma());
  const rows = await projects.listAllOrderedByUpdatedAt();
  return rows.map((p) => ({
    projectId: p.id,
    name: p.name,
    updatedAt: p.updatedAt.toISOString(),
    revision: p.revision,
    nodeCount: 0,
    videoShotCount: 0,
    status: "draft" as const,
    generationProgress: null,
  }));
}

export async function getProjectRecordPostgres(
  projectId: string,
): Promise<ProjectRecord | null> {
  const projects = new ProjectRepository(getPrisma());
  const row = await projects.findById(projectId);
  return row ? toRecord(row) : null;
}

export async function getProjectPublicPostgres(
  projectId: string,
): Promise<ProjectPublic | null> {
  const record = await getProjectRecordPostgres(projectId);
  return record ? toPublic(record) : null;
}

export async function createProjectRecordPostgres(
  ownerId: string,
  input: CreateProjectInput,
): Promise<ProjectPublic> {
  // Identity must come from the trusted session ownerId — never from request body.
  await ensurePostgresIdentityForSessionUser(ownerId);

  const projects = new ProjectRepository(getPrisma());
  const service = new ProjectService(projects);

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const prior = await projects.findByIdempotencyKey(idempotencyKey);
    if (prior) {
      if (prior.ownerId !== ownerId) {
        throw new Error("幂等键已被其他用户使用");
      }
      return toPublic(toRecord(prior));
    }
  }

  const existingName = await projects.findByName(input.name.trim());
  if (existingName) {
    throw new ProjectNameConflictError();
  }

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (input.passwordEnabled) {
    const password = (input.projectPassword ?? "").trim();
    if (!password) {
      throw new Error("已启用项目密码，请填写项目访问密码");
    }
    const hashed = hashPassword(password);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  const projectId = `p_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date();
  const creationSource = toCreationSource(input.creationSource);

  try {
    const created = await service.createProjectAtomic({
      id: projectId,
      ownerId,
      name: input.name.trim(),
      creationSource,
      projectMode: toProjectMode(input.projectMode),
      currentStage:
        creationSource === "script_upload"
          ? "script_processing"
          : "story_creation",
      highlights: (input.highlights ?? "").trim(),
      passwordEnabled: input.passwordEnabled,
      passwordHash,
      passwordSalt,
      creationIdempotencyKey: idempotencyKey,
      rootFolderId: projectId,
      createdAt: now,
      updatedAt: now,
    });
    return toPublic(toRecord(created));
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      const raced = await projects.findByIdempotencyKey(idempotencyKey);
      if (raced && raced.ownerId === ownerId) {
        return toPublic(toRecord(raced));
      }
    }
    if (isUniqueViolation(error)) {
      const byName = await projects.findByName(input.name.trim());
      if (byName) {
        throw new ProjectNameConflictError();
      }
    }
    throw error;
  }
}

export async function updateProjectHighlightsPostgres(
  projectId: string,
  highlights: string,
): Promise<ProjectPublic> {
  const projects = new ProjectRepository(getPrisma());
  const existing = await projects.findById(projectId);
  if (!existing) {
    throw new ProjectNotFoundError();
  }
  const updated = await projects.updateHighlights(projectId, highlights.trim());
  return toPublic(toRecord(updated));
}
