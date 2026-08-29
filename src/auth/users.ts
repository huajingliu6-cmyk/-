import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { hashPassword, verifyPassword } from "@/auth/password";
import type { AuthUser, StoredUser, UserRole } from "@/auth/types";
import { getAppDataDir } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  authenticateUserRemote,
  countSystemAdminsRemote,
  createUserRemote,
  findUserByUsernameRemote,
  getStoredUserByIdRemote,
  getUserByIdRemote,
  grantSystemAdminByUsernameRemote,
  listUsersRemote,
  revokeSystemAdminByUsernameRemote,
  updateUserPasswordRemote,
  updateUserProfileRemote,
} from "@/auth/remote-users";

function dataDir() {
  return getAppDataDir();
}

function usersFilePath() {
  return path.join(dataDir(), "users.json");
}

type UsersFile = {
  version: 1;
  users: StoredUser[];
};

async function ensureDir() {
  await fs.mkdir(dataDir(), { recursive: true });
}

async function readFile(): Promise<UsersFile> {
  await ensureDir();
  try {
    const raw = await fs.readFile(usersFilePath(), "utf-8");
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
  const file = usersFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function toPublic(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: normalizeStoredRole(user.role),
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeStoredRole(role: unknown): UserRole {
  return role === "admin" ? "admin" : "user";
}

export async function findUserByUsername(
  username: string,
): Promise<StoredUser | null> {
  if (isRemoteDataOnly()) return findUserByUsernameRemote(username);
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
  if (isRemoteDataOnly()) return authenticateUserRemote(username, password);
  const user = await findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return null;
  }
  return toPublic(user);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  if (isRemoteDataOnly()) return getUserByIdRemote(id);
  const file = await readFile();
  const user = file.users.find((u) => u.id === id);
  return user ? toPublic(user) : null;
}

/**
 * Server-only: returns StoredUser including password hash/salt.
 * For clean-start Postgres identity bootstrap — never send to clients or logs.
 */
export async function getStoredUserById(
  id: string,
): Promise<StoredUser | null> {
  if (isRemoteDataOnly()) return getStoredUserByIdRemote(id);
  const file = await readFile();
  return file.users.find((u) => u.id === id) ?? null;
}

export async function listUsers(): Promise<AuthUser[]> {
  if (isRemoteDataOnly()) return listUsersRemote();
  const file = await readFile();
  return file.users.map(toPublic);
}

export async function createUser(params: {
  username: string;
  password: string;
  role?: UserRole;
  displayName?: string;
}): Promise<AuthUser> {
  if (isRemoteDataOnly()) return createUserRemote(params);
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
  // 禁止通过 createUser 直接授予 admin；系统管理员仅能由本机 CLI 授予
  if (params.role === "admin") {
    throw new Error("不能通过创建用户接口授予系统管理员");
  }
  const user: StoredUser = {
    id: randomUUID(),
    username,
    role: "user",
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
  if (isRemoteDataOnly()) return updateUserProfileRemote(userId, patch);
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

export async function updateUserPassword(
  userId: string,
  params: { currentPassword: string; newPassword: string },
): Promise<AuthUser> {
  if (isRemoteDataOnly()) return updateUserPasswordRemote(userId, params);
  const currentPassword = params.currentPassword;
  const newPassword = params.newPassword;

  if (!currentPassword) {
    throw new Error("请输入当前密码");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("新密码至少 6 个字符");
  }
  if (newPassword.length > 128) {
    throw new Error("新密码过长");
  }
  if (newPassword === currentPassword) {
    throw new Error("新密码不能与当前密码相同");
  }

  const file = await readFile();
  const index = file.users.findIndex((u) => u.id === userId);
  if (index < 0) {
    throw new Error("用户不存在");
  }
  const current = file.users[index]!;
  if (
    !verifyPassword(
      currentPassword,
      current.passwordHash,
      current.passwordSalt,
    )
  ) {
    throw new Error("当前密码不正确");
  }

  const { hash, salt } = hashPassword(newPassword);
  const next: StoredUser = {
    ...current,
    passwordHash: hash,
    passwordSalt: salt,
    updatedAt: new Date().toISOString(),
  };
  file.users[index] = next;
  await writeFile(file);
  return toPublic(next);
}

export async function countSystemAdmins(): Promise<number> {
  if (isRemoteDataOnly()) return countSystemAdminsRemote();
  const file = await readFile();
  return file.users.filter((u) => normalizeStoredRole(u.role) === "admin")
    .length;
}

/**
 * 本机 CLI 用：将已存在用户提升为系统管理员（role=admin → SYSTEM_ADMIN）。
 * 幂等；不修改其他用户；不输出哈希。
 */
export async function grantSystemAdminByUsername(
  username: string,
): Promise<{ user: AuthUser; alreadyAdmin: boolean }> {
  if (isRemoteDataOnly()) return grantSystemAdminByUsernameRemote(username);
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error("必须指定 --username");
  }
  const file = await readFile();
  const index = file.users.findIndex(
    (u) => u.username.toLowerCase() === trimmed.toLowerCase(),
  );
  if (index < 0) {
    throw new Error(`用户不存在：${trimmed}`);
  }
  const current = file.users[index]!;
  if (normalizeStoredRole(current.role) === "admin") {
    return { user: toPublic(current), alreadyAdmin: true };
  }
  const adminCount = file.users.filter(
    (u) => normalizeStoredRole(u.role) === "admin",
  ).length;
  if (adminCount >= 1) {
    throw new Error("系统管理员全局只允许存在 1 个，禁止创建第二个系统管理员");
  }
  const next: StoredUser = {
    ...current,
    role: "admin",
    updatedAt: new Date().toISOString(),
  };
  file.users[index] = next;
  await writeFile(file);
  return { user: toPublic(next), alreadyAdmin: false };
}

/**
 * 本机 CLI 用：撤销系统管理员。禁止撤销最后一个系统管理员。
 */
export async function revokeSystemAdminByUsername(
  username: string,
): Promise<{ user: AuthUser; alreadyUser: boolean }> {
  if (isRemoteDataOnly()) return revokeSystemAdminByUsernameRemote(username);
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error("必须指定 --username");
  }
  const file = await readFile();
  const index = file.users.findIndex(
    (u) => u.username.toLowerCase() === trimmed.toLowerCase(),
  );
  if (index < 0) {
    throw new Error(`用户不存在：${trimmed}`);
  }
  const current = file.users[index]!;
  if (normalizeStoredRole(current.role) !== "admin") {
    return { user: toPublic(current), alreadyUser: true };
  }
  const adminCount = file.users.filter(
    (u) => normalizeStoredRole(u.role) === "admin",
  ).length;
  if (adminCount <= 1) {
    throw new Error("不能撤销最后一个系统管理员");
  }
  const next: StoredUser = {
    ...current,
    role: "user",
    updatedAt: new Date().toISOString(),
  };
  file.users[index] = next;
  await writeFile(file);
  return { user: toPublic(next), alreadyUser: false };
}
