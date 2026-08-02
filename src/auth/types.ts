export type UserRole = "admin" | "user";

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredUser = AuthUser & {
  passwordHash: string;
  passwordSalt: string;
};

export type SessionPayload = {
  userId: string;
  username: string;
  role: UserRole;
  displayName: string;
  exp: number;
};

export const SESSION_COOKIE = "ic_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
