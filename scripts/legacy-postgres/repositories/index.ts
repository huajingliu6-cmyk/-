import "server-only";
import type { Prisma, PrismaClient, User, UserRole, UserStatus } from "@prisma/client";
import { getPrisma } from "../prisma";
import { RevisionConflictError } from "@/persistence/revision";

export type CreateUserInput = {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  avatar?: string | null;
  role: UserRole;
  status?: UserStatus;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
  updatedAt: Date;
};

export class UserRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async create(input: CreateUserInput): Promise<User> {
    return this.db.user.create({
      data: {
        id: input.id,
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        avatar: input.avatar ?? null,
        role: input.role,
        status: input.status ?? "active",
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { username } });
  }

  async upsertById(input: CreateUserInput): Promise<User> {
    return this.db.user.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        avatar: input.avatar ?? null,
        role: input.role,
        status: input.status ?? "active",
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
      update: {
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        avatar: input.avatar ?? null,
        role: input.role,
        status: input.status ?? "active",
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        updatedAt: input.updatedAt,
      },
    });
  }

  async count(): Promise<number> {
    return this.db.user.count();
  }

  toPublic(user: User): Omit<User, "passwordHash" | "passwordSalt"> {
    const { passwordHash: _h, passwordSalt: _s, ...pub } = user;
    void _h;
    void _s;
    return pub;
  }
}

export type CreateProjectInput = {
  id: string;
  ownerId: string;
  name: string;
  creationSource: "story" | "script_upload";
  projectMode: "canvas" | "full_stack";
  currentStage: "story_creation" | "script_processing" | "asset_management" | "storyboard" | "workspace";
  highlights?: string;
  passwordEnabled?: boolean;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  creationIdempotencyKey?: string | null;
  rootFolderId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export class ProjectRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  /**
   * Atomically create Project + owner ProjectMember.
   * Project itself is the root container (rootFolderId === projectId).
   */
  async createWithOwner(input: CreateProjectInput) {
    const rootFolderId = input.rootFolderId ?? input.id;
    return this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          id: input.id,
          ownerId: input.ownerId,
          name: input.name,
          creationSource: input.creationSource,
          projectMode: input.projectMode,
          currentStage: input.currentStage,
          highlights: input.highlights ?? "",
          passwordEnabled: input.passwordEnabled ?? false,
          passwordHash: input.passwordHash ?? null,
          passwordSalt: input.passwordSalt ?? null,
          creationIdempotencyKey: input.creationIdempotencyKey ?? null,
          rootFolderId,
          revision: 1,
          status: "draft",
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
      });
      await tx.projectMember.create({
        data: {
          id: `pm_${input.id}`,
          projectId: input.id,
          userId: input.ownerId,
          role: "owner",
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
      });
      return project;
    });
  }

  async findById(id: string) {
    return this.db.project.findUnique({ where: { id } });
  }

  async findByIdempotencyKey(key: string) {
    return this.db.project.findUnique({
      where: { creationIdempotencyKey: key },
    });
  }

  async listAllOrderedByUpdatedAt() {
    return this.db.project.findMany({
      orderBy: { updatedAt: "desc" },
    });
  }

  async findByName(name: string, ownerId?: string) {
    return this.db.project.findFirst({
      where: ownerId ? { name, ownerId } : { name },
    });
  }

  async updateHighlights(id: string, highlights: string) {
    return this.db.project.update({
      where: { id },
      data: {
        highlights,
        updatedAt: new Date(),
        revision: { increment: 1 },
      },
    });
  }

  async updateWithRevision(input: {
    id: string;
    expectedRevision: number;
    data: Prisma.ProjectUpdateManyMutationInput;
  }) {
    const result = await this.db.project.updateMany({
      where: { id: input.id, revision: input.expectedRevision },
      data: {
        ...input.data,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      const current = await this.findById(input.id);
      throw new RevisionConflictError({
        resource: `Project:${input.id}`,
        expectedRevision: input.expectedRevision,
        currentRevision: current?.revision ?? null,
      });
    }
    return this.findById(input.id);
  }

  async count(): Promise<number> {
    return this.db.project.count();
  }

  toPublic<T extends { passwordHash: string | null; passwordSalt: string | null }>(
    project: T,
  ): Omit<T, "passwordHash" | "passwordSalt"> {
    const { passwordHash: _h, passwordSalt: _s, ...pub } = project;
    void _h;
    void _s;
    return pub;
  }
}

export class ProjectDocumentRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async create(data: Prisma.ProjectDocumentCreateInput) {
    return this.db.projectDocument.create({ data });
  }

  async findById(id: string) {
    return this.db.projectDocument.findUnique({ where: { id } });
  }

  async updateWithRevision(input: {
    id: string;
    expectedRevision: number;
    content?: string;
    title?: string;
    updatedBy: string;
  }) {
    const result = await this.db.projectDocument.updateMany({
      where: { id: input.id, revision: input.expectedRevision },
      data: {
        content: input.content,
        title: input.title,
        updatedBy: input.updatedBy,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      const current = await this.findById(input.id);
      throw new RevisionConflictError({
        resource: `ProjectDocument:${input.id}`,
        expectedRevision: input.expectedRevision,
        currentRevision: current?.revision ?? null,
      });
    }
    return this.findById(input.id);
  }

  async count(): Promise<number> {
    return this.db.projectDocument.count();
  }
}

export class ScriptEpisodeRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async create(data: Prisma.ScriptEpisodeCreateInput) {
    return this.db.scriptEpisode.create({ data });
  }

  async listPage(input: {
    projectId: string;
    page: number;
    pageSize: number;
  }) {
    const pageSize = Math.min(Math.max(1, input.pageSize), 30);
    const page = Math.max(1, input.page);
    const where = { projectId: input.projectId };
    const [total, items] = await this.db.$transaction([
      this.db.scriptEpisode.count({ where }),
      this.db.scriptEpisode.findMany({
        where,
        orderBy: { episodeNumber: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async updateWithRevision(input: {
    id: string;
    expectedRevision: number;
    content?: string;
    title?: string;
    wordCount?: number;
    updatedBy: string;
  }) {
    const result = await this.db.scriptEpisode.updateMany({
      where: { id: input.id, revision: input.expectedRevision },
      data: {
        content: input.content,
        title: input.title,
        wordCount: input.wordCount,
        updatedBy: input.updatedBy,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      const current = await this.db.scriptEpisode.findUnique({
        where: { id: input.id },
      });
      throw new RevisionConflictError({
        resource: `ScriptEpisode:${input.id}`,
        expectedRevision: input.expectedRevision,
        currentRevision: current?.revision ?? null,
      });
    }
    return this.db.scriptEpisode.findUnique({ where: { id: input.id } });
  }
}

export class ProjectFileRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async create(data: Prisma.ProjectFileCreateInput) {
    return this.db.projectFile.create({ data });
  }

  async findById(id: string) {
    return this.db.projectFile.findUnique({ where: { id } });
  }

  async upsertById(data: Prisma.ProjectFileCreateInput) {
    const id = typeof data.id === "string" ? data.id : undefined;
    if (!id) return this.create(data);
    return this.db.projectFile.upsert({
      where: { id },
      create: data,
      update: {
        originalName: data.originalName,
        mimeType: data.mimeType,
        extension: data.extension,
        size: data.size,
        storageDriver: data.storageDriver,
        storageKey: data.storageKey,
        checksum: data.checksum,
        status: data.status,
        updatedAt: data.updatedAt,
      },
    });
  }

  async count(): Promise<number> {
    return this.db.projectFile.count();
  }
}

export class ProjectAssetRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async createCharacter(data: Prisma.CharacterAssetCreateInput) {
    return this.db.characterAsset.create({ data });
  }

  async createScene(data: Prisma.SceneAssetCreateInput) {
    return this.db.sceneAsset.create({ data });
  }

  async createProp(data: Prisma.PropAssetCreateInput) {
    return this.db.propAsset.create({ data });
  }

  async createAudio(data: Prisma.AudioAssetCreateInput) {
    return this.db.audioAsset.create({ data });
  }
}

export class WorkflowRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async upsertByProjectId(input: {
    projectId: string;
    schemaVersion: number;
    content: Prisma.InputJsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return this.db.workflowDocument.upsert({
      where: { projectId: input.projectId },
      create: {
        projectId: input.projectId,
        schemaVersion: input.schemaVersion,
        content: input.content,
        revision: 1,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
      update: {
        schemaVersion: input.schemaVersion,
        content: input.content,
        revision: { increment: 1 },
        updatedAt: input.updatedAt,
      },
    });
  }

  async count(): Promise<number> {
    return this.db.workflowDocument.count();
  }
}

export class CreditRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async ensureAccount(userId: string) {
    return this.db.creditAccount.upsert({
      where: { userId },
      create: {
        userId,
        balance: BigInt(0),
        reservedBalance: BigInt(0),
        revision: 1,
      },
      update: {},
    });
  }

  async getAccount(userId: string) {
    return this.db.creditAccount.findUnique({ where: { userId } });
  }

  /**
   * Append-only ledger entry with balance update in one transaction.
   * Idempotent on idempotencyKey.
   */
  async postLedgerEntry(input: {
    id: string;
    userId: string;
    type:
      | "reserve"
      | "charge"
      | "release"
      | "topup"
      | "adjust"
      | "legacy_opening_balance";
    amount: bigint;
    idempotencyKey: string;
    description?: string;
    projectId?: string | null;
    generationId?: string | null;
    rechargeOrderId?: string | null;
    createdAt?: Date;
    allowNegative?: boolean;
  }) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.creditLedgerEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const account = await tx.creditAccount.findUniqueOrThrow({
          where: { userId: input.userId },
        });
        return { account, entry: existing, duplicate: true as const };
      }

      let account = await tx.creditAccount.findUnique({
        where: { userId: input.userId },
      });
      if (!account) {
        account = await tx.creditAccount.create({
          data: {
            userId: input.userId,
            balance: BigInt(0),
            reservedBalance: BigInt(0),
            revision: 1,
          },
        });
      }

      const nextBalance = account.balance + input.amount;
      if (!input.allowNegative && nextBalance < BigInt(0)) {
        throw new Error("INSUFFICIENT_CREDITS");
      }

      const updatedCount = await tx.creditAccount.updateMany({
        where: { id: account.id, revision: account.revision },
        data: {
          balance: nextBalance,
          revision: { increment: 1 },
        },
      });
      if (updatedCount.count === 0) {
        throw new Error("CREDIT_ACCOUNT_REVISION_CONFLICT");
      }

      const entry = await tx.creditLedgerEntry.create({
        data: {
          id: input.id,
          accountId: account.id,
          type: input.type,
          amount: input.amount,
          balanceAfter: nextBalance,
          projectId: input.projectId ?? null,
          generationId: input.generationId ?? null,
          rechargeOrderId: input.rechargeOrderId ?? null,
          idempotencyKey: input.idempotencyKey,
          description: input.description ?? "",
          createdAt: input.createdAt ?? new Date(),
        },
      });

      const updated = await tx.creditAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      return { account: updated, entry, duplicate: false as const };
    });
  }

  async sumBalances(): Promise<bigint> {
    const agg = await this.db.creditAccount.aggregate({
      _sum: { balance: true },
    });
    return agg._sum.balance ?? BigInt(0);
  }

  async countAccounts(): Promise<number> {
    return this.db.creditAccount.count();
  }
}
