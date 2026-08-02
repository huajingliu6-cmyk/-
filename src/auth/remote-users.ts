import "server-only";

import type { AuthUser, StoredUser, UserRole } from "@/auth/types";
import { requestRemoteData } from "@/persistence/remote-data-client";

type UserResponse<T> = { user: T };
type UsersResponse = { users: AuthUser[] };

async function userRequest<T>(
  path: string,
  init: RequestInit = {},
  options?: { notFoundAsNull?: boolean; unauthorizedAsNull?: boolean },
): Promise<T | null> {
  const response = await requestRemoteData(path, init);
  if (options?.notFoundAsNull && response.status === 404) return null;
  if (options?.unauthorizedAsNull && response.status === 401) return null;
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error || `REMOTE_USER_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function findUserByUsernameRemote(
  username: string,
): Promise<StoredUser | null> {
  const result = await userRequest<UserResponse<StoredUser>>(
    `/v1/users/by-username/${encodeURIComponent(username.trim())}?stored=true`,
    {},
    { notFoundAsNull: true },
  );
  return result?.user ?? null;
}

export async function authenticateUserRemote(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const result = await userRequest<UserResponse<AuthUser>>(
    "/v1/users/authenticate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    { unauthorizedAsNull: true },
  );
  return result?.user ?? null;
}

export async function getUserByIdRemote(id: string): Promise<AuthUser | null> {
  const result = await userRequest<UserResponse<AuthUser>>(
    `/v1/users/${encodeURIComponent(id)}`,
    {},
    { notFoundAsNull: true },
  );
  return result?.user ?? null;
}

export async function getStoredUserByIdRemote(
  id: string,
): Promise<StoredUser | null> {
  const result = await userRequest<UserResponse<StoredUser>>(
    `/v1/users/${encodeURIComponent(id)}?stored=true`,
    {},
    { notFoundAsNull: true },
  );
  return result?.user ?? null;
}

export async function listUsersRemote(): Promise<AuthUser[]> {
  const result = await userRequest<UsersResponse>("/v1/users");
  return result?.users ?? [];
}

export async function createUserRemote(params: {
  username: string;
  password: string;
  role?: UserRole;
  displayName?: string;
}): Promise<AuthUser> {
  const result = await userRequest<UserResponse<AuthUser>>("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!result) throw new Error("REMOTE_USER_CREATE_EMPTY");
  return result.user;
}

export async function updateUserProfileRemote(
  userId: string,
  patch: { displayName?: string },
): Promise<AuthUser> {
  const result = await userRequest<UserResponse<AuthUser>>(
    `/v1/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!result) throw new Error("REMOTE_USER_UPDATE_EMPTY");
  return result.user;
}

export async function updateUserPasswordRemote(
  userId: string,
  params: { currentPassword: string; newPassword: string },
): Promise<AuthUser> {
  const result = await userRequest<UserResponse<AuthUser>>(
    `/v1/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    },
  );
  if (!result) throw new Error("REMOTE_USER_UPDATE_EMPTY");
  return result.user;
}

export async function countSystemAdminsRemote(): Promise<number> {
  const result = await userRequest<{ count: number }>("/v1/users/admin/count");
  return result?.count ?? 0;
}

export async function grantSystemAdminByUsernameRemote(
  username: string,
): Promise<{ user: AuthUser; alreadyAdmin: boolean }> {
  const result = await userRequest<{
    user: AuthUser;
    alreadyAdmin: boolean;
  }>("/v1/users/admin/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!result) throw new Error("REMOTE_USER_ADMIN_UPDATE_EMPTY");
  return result;
}

export async function revokeSystemAdminByUsernameRemote(
  username: string,
): Promise<{ user: AuthUser; alreadyUser: boolean }> {
  const result = await userRequest<{
    user: AuthUser;
    alreadyUser: boolean;
  }>("/v1/users/admin/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!result) throw new Error("REMOTE_USER_ADMIN_UPDATE_EMPTY");
  return result;
}