import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAppDataDir } from "@/persistence/data-root";
import type { ProjectMemberRecord } from "@/auth/roles";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  addCardEngineerRemote,
  findProjectMemberRemote,
  listMembershipsForUserRemote,
  listProjectMembersRemote,
  removeCardEngineerRemote,
} from "@/auth/remote-project-members";

type MembersFile = {
  version: 1;
  members: ProjectMemberRecord[];
};

function membersFilePath(): string {
  return path.join(getAppDataDir(), "project-members.json");
}

async function ensureDir() {
  await fs.mkdir(getAppDataDir(), { recursive: true });
}

async function readFile(): Promise<MembersFile> {
  await ensureDir();
  try {
    const raw = await fs.readFile(membersFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as MembersFile;
    if (!parsed || !Array.isArray(parsed.members)) {
      return { version: 1, members: [] };
    }
    return {
      version: 1,
      members: parsed.members.filter(
        (m) =>
          typeof m?.id === "string" &&
          typeof m.projectId === "string" &&
          typeof m.userId === "string" &&
          m.role === "CARD_ENGINEER",
      ),
    };
  } catch {
    return { version: 1, members: [] };
  }
}

async function writeFile(data: MembersFile) {
  await ensureDir();
  const file = membersFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberRecord[]> {
  if (isRemoteDataOnly()) return listProjectMembersRemote(projectId);
  const file = await readFile();
  return file.members.filter((m) => m.projectId === projectId);
}

export async function listMembershipsForUser(
  userId: string,
): Promise<ProjectMemberRecord[]> {
  if (isRemoteDataOnly()) return listMembershipsForUserRemote(userId);
  const file = await readFile();
  return file.members.filter((m) => m.userId === userId);
}

export async function findProjectMember(
  projectId: string,
  userId: string,
): Promise<ProjectMemberRecord | null> {
  if (isRemoteDataOnly()) return findProjectMemberRemote(projectId, userId);
  const file = await readFile();
  return (
    file.members.find(
      (m) => m.projectId === projectId && m.userId === userId,
    ) ?? null
  );
}

export async function addCardEngineer(input: {
  projectId: string;
  userId: string;
  createdBy: string;
}): Promise<ProjectMemberRecord> {
  if (isRemoteDataOnly()) return addCardEngineerRemote(input);
  const file = await readFile();
  const existing = file.members.find(
    (m) => m.projectId === input.projectId && m.userId === input.userId,
  );
  if (existing) {
    throw new Error("该用户已是本项目的抽卡工程师");
  }
  const now = new Date().toISOString();
  const record: ProjectMemberRecord = {
    id: `pm_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    projectId: input.projectId,
    userId: input.userId,
    role: "CARD_ENGINEER",
    createdAt: now,
    createdBy: input.createdBy,
  };
  file.members.push(record);
  await writeFile(file);
  return record;
}

export async function removeCardEngineer(
  projectId: string,
  userId: string,
): Promise<boolean> {
  if (isRemoteDataOnly()) return removeCardEngineerRemote(projectId, userId);
  const file = await readFile();
  const next = file.members.filter(
    (m) => !(m.projectId === projectId && m.userId === userId),
  );
  if (next.length === file.members.length) return false;
  await writeFile({ version: 1, members: next });
  return true;
}
