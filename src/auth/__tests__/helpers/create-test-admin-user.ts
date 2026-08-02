/**
 * Test-only fixture. Never import from production app routes or middleware.
 */
import type { AuthUser } from "@/auth/types";
import { createUser, grantSystemAdminByUsername } from "@/auth/users";

export async function createTestAdminUser(params?: {
  username?: string;
  password?: string;
  displayName?: string;
}): Promise<AuthUser> {
  const username = params?.username ?? `test_admin_${Date.now()}`;
  const password = params?.password ?? "TestAdmin@123456";
  await createUser({
    username,
    password,
    displayName: params?.displayName ?? username,
  });
  const granted = await grantSystemAdminByUsername(username);
  return granted.user;
}
