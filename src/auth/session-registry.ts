import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAppDataDir } from "@/persistence/data-root";
import {
  getRemoteDocument,
  isRemoteDataOnly,
  isRemoteRevisionConflict,
  putRemoteDocument,
} from "@/persistence/remote-data-client";

const NAMESPACE = "auth-active-sessions";

type ActiveSession = { sessionId: string; issuedAt: string };

function filePath(userId: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(getAppDataDir(), "active-sessions", `${safeUserId}.json`);
}

async function readLocal(userId: string): Promise<ActiveSession | null> {
  try {
    const raw = await fs.readFile(filePath(userId), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ActiveSession>;
    if (typeof parsed.sessionId === "string") {
      return {
        sessionId: parsed.sessionId,
        issuedAt: typeof parsed.issuedAt === "string" ? parsed.issuedAt : "",
      };
    }
  } catch {
    // The first login creates the registry.
  }
  return null;
}

async function writeLocal(userId: string, value: ActiveSession) {
  const target = filePath(userId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(temp, target);
}

export async function issueActiveSession(userId: string): Promise<string> {
  const sessionId = randomUUID();
  const value: ActiveSession = { sessionId, issuedAt: new Date().toISOString() };

  if (!isRemoteDataOnly()) {
    await writeLocal(userId, value);
    return sessionId;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getRemoteDocument<ActiveSession>(NAMESPACE, userId);
    try {
      await putRemoteDocument({
        namespace: NAMESPACE,
        key: userId,
        expectedRevision: current?.revision ?? 0,
        value,
      });
      return sessionId;
    } catch (error) {
      if (!isRemoteRevisionConflict(error)) throw error;
    }
  }
  throw new Error("REMOTE_SESSION_REGISTRY_CONFLICT");
}

export async function isActiveSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  if (!userId || !sessionId) return false;
  if (!isRemoteDataOnly()) {
    const current = await readLocal(userId);
    return current?.sessionId === sessionId;
  }
  const current = await getRemoteDocument<ActiveSession>(NAMESPACE, userId);
  return current?.value.sessionId === sessionId;
}
