import "server-only";
import {
  ProjectRepository,
  type CreateProjectInput,
} from "../repositories";
import { getFileStorageProvider } from "@/persistence/storage";
import type { FileStorageProvider } from "@/persistence/storage/types";
import { CreditRepository } from "../repositories";

export class ProjectService {
  constructor(private readonly projects = new ProjectRepository()) {}

  async createProjectAtomic(input: CreateProjectInput) {
    if (input.creationIdempotencyKey) {
      const existing = await this.projects.findByIdempotencyKey(
        input.creationIdempotencyKey,
      );
      if (existing) return existing;
    }
    return this.projects.createWithOwner(input);
  }

  toPublicSafe(project: Awaited<ReturnType<ProjectRepository["findById"]>>) {
    if (!project) return null;
    return this.projects.toPublic(project);
  }
}

export class FileStorageService {
  constructor(private readonly storage: FileStorageProvider = getFileStorageProvider()) {}

  getProvider(): FileStorageProvider {
    return this.storage;
  }
}

export class CreditLedgerService {
  constructor(private readonly credits = new CreditRepository()) {}

  postEntry(
    input: Parameters<CreditRepository["postLedgerEntry"]>[0],
  ) {
    return this.credits.postLedgerEntry(input);
  }
}

export class ProjectDocumentService {
  // Placeholder for Batch B/C — documents go through repositories.
}
