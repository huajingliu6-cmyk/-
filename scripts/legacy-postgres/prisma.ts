import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma Client entry for server modules only.
 * Prevents connection explosion under Next.js hot reload.
 */

const globalForPrisma = globalThis as unknown as {
  __icPrisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__icPrisma) {
    globalForPrisma.__icPrisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["error", "warn"]
          : ["error"],
    });
  }
  return globalForPrisma.__icPrisma;
}

/** @deprecated Prefer getPrisma(); exported for convenience in server code */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
