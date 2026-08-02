import "server-only";

/**
 * Clean-start identity bootstrap — NOT a legacy business data import.
 *
 * Only upserts the currently authenticated session user into PostgreSQL,
 * using password hash/salt already present in the trusted server-side auth
 * file store. Does not import projects, credits, assets, documents, or workflows.
 * Idempotent: repeated calls do not create duplicate users.
 */
import { getStoredUserById } from "@/auth/users";
import { UserRepository } from "./repositories";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma";

export class IdentityBootstrapError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IdentityBootstrapError";
    this.code = code;
  }
}

export async function ensurePostgresIdentityForSessionUser(
  userId: string,
  db: PrismaClient = getPrisma(),
): Promise<{ id: string; username: string }> {
  if (!userId.trim()) {
    throw new IdentityBootstrapError(
      "MISSING_SESSION_USER",
      "Authenticated user id is required for identity bootstrap",
    );
  }

  const stored = await getStoredUserById(userId);
  if (!stored) {
    throw new IdentityBootstrapError(
      "AUTH_USER_MISSING",
      "Authenticated session user is missing from the server auth store",
    );
  }

  if (stored.id !== userId) {
    throw new IdentityBootstrapError(
      "AUTH_USER_MISMATCH",
      "Auth store user id does not match session user id",
    );
  }

  const users = new UserRepository(db);
  const row = await users.upsertById({
    id: stored.id,
    username: stored.username,
    displayName: stored.displayName,
    role: stored.role,
    status: "active",
    passwordHash: stored.passwordHash,
    passwordSalt: stored.passwordSalt,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  });

  return { id: row.id, username: row.username };
}
