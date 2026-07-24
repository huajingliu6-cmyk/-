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

/** 默认管理员（可被环境变量覆盖密码） */
export const DEFAULT_ADMIN_USERNAME = "admin";
export const DEFAULT_ADMIN_PASSWORD = "Admin@123456";
