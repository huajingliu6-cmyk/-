import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { hashPassword, verifyPassword } from "@/auth/password";
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  type AuthUser,
  type StoredUser,
  type UserRole,
} from "@/auth/types";

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

type UsersFile = {
  version: 1;
  users: StoredUser[];
};

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<UsersFile> {
  await ensureDir();
  try {
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UsersFile;
    if (!parsed || !Array.isArray(parsed.users)) {
      return { version: 1, users: [] };
    }
    return { version: 1, users: parsed.users };
  } catch {
    return { version: 1, users: [] };
  }
}

async function writeFile(data: UsersFile) {
  await ensureDir();
  const tmp = `${USERS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, USERS_FILE);
}

function toPublic(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function adminPasswordFromEnv(): string {
  return process.env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;
}

/** 确保存在管理员账号；已存在则不覆盖密码。 */
export async function ensureAdminUser(): Promise<AuthUser> {
  const file = await readFile();
  const existing = file.users.find(
    (u) => u.username === DEFAULT_ADMIN_USERNAME || u.role === "admin",
  );
  if (existing) {
    return toPublic(existing);
  }

  const now = new Date().toISOString();
  const { hash, salt } = hashPassword(adminPasswordFromEnv());
  const admin: StoredUser = {
    id: randomUUID(),
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    displayName: "管理员",
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now,
  };
  file.users.push(admin);
  await writeFile(file);
  return toPublic(admin);
}

export async function findUserByUsername(
  username: string,
): Promise<StoredUser | null> {
  await ensureAdminUser();
  const file = await readFile();
  return (
    file.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
    ) ?? null
  );
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return null;
  }
  return toPublic(user);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  await ensureAdminUser();
  const file = await readFile();
  const user = file.users.find((u) => u.id === id);
  return user ? toPublic(user) : null;
}

export async function listUsers(): Promise<AuthUser[]> {
  await ensureAdminUser();
  const file = await readFile();
  return file.users.map(toPublic);
}

export async function createUser(params: {
  username: string;
  password: string;
  role?: UserRole;
  displayName?: string;
}): Promise<AuthUser> {
  await ensureAdminUser();
  const username = params.username.trim();
  if (!username || username.length < 2) {
    throw new Error("用户名至少 2 个字符");
  }
  if (!params.password || params.password.length < 6) {
    throw new Error("密码至少 6 个字符");
  }

  const file = await readFile();
  if (
    file.users.some((u) => u.username.toLowerCase() === username.toLowerCase())
  ) {
    throw new Error("用户名已存在");
  }

  const now = new Date().toISOString();
  const { hash, salt } = hashPassword(params.password);
  const user: StoredUser = {
    id: randomUUID(),
    username,
    role: params.role ?? "user",
    displayName: params.displayName?.trim() || username,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now,
  };
  file.users.push(user);
  await writeFile(file);
  return toPublic(user);
}

export async function updateUserProfile(
  userId: string,
  patch: { displayName?: string },
): Promise<AuthUser> {
  await ensureAdminUser();
  const file = await readFile();
  const index = file.users.findIndex((u) => u.id === userId);
  if (index < 0) {
    throw new Error("用户不存在");
  }
  const current = file.users[index]!;
  const displayName = patch.displayName?.trim();
  if (displayName !== undefined) {
    if (displayName.length < 1) {
      throw new Error("显示名称不能为空");
    }
    if (displayName.length > 32) {
      throw new Error("显示名称过长");
    }
  }
  const next: StoredUser = {
    ...current,
    displayName: displayName ?? current.displayName,
    updatedAt: new Date().toISOString(),
  };
  file.users[index] = next;
  await writeFile(file);
  return toPublic(next);
}
