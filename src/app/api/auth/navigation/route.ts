import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { getSystemRole, canAccessProjectManagementNav } from "@/auth/roles";
import { userOwnsAnyProject } from "@/auth/effective-role";
import {
  AUTH_NAV_ITEMS,
  CARD_ENGINEER_NAV_IDS,
  type ShellNavItem,
} from "@/shell/nav";
import { listMembershipsForUser } from "@/auth/project-members";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import type { AuthUser } from "@/auth/types";

function navigationUserPayload(user: AuthUser, systemRole: ReturnType<typeof getSystemRole>) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    systemRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function getNavigation() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const user = session.user;
  const systemRole = getSystemRole(user);

  const withoutAdmin = AUTH_NAV_ITEMS.filter((item) => item.id !== "admin");

  // Admins do not need membership lookups to decide nav — avoid 503 wiping the shell.
  if (systemRole === "SYSTEM_ADMIN") {
    return NextResponse.json({
      user: navigationUserPayload(user, systemRole),
      navigation: AUTH_NAV_ITEMS,
      flags: {
        canAccessProjectManagement: true,
        canCreateProject: true,
        isCardEngineerOnly: false,
        ownsAnyProject: true,
        assignedProjectCount: 0,
      },
    });
  }

  const ownsAny = await userOwnsAnyProject(user.id);
  const memberships = await listMembershipsForUser(user.id);
  const isCardEngineerOnly =
    systemRole === "USER" && !ownsAny && memberships.length > 0;

  const navigation: ShellNavItem[] = isCardEngineerOnly
    ? withoutAdmin.filter((item) =>
        (CARD_ENGINEER_NAV_IDS as readonly string[]).includes(item.id),
      )
    : withoutAdmin;

  return NextResponse.json({
    user: navigationUserPayload(user, systemRole),
    navigation,
    flags: {
      canAccessProjectManagement: canAccessProjectManagementNav(
        systemRole,
        ownsAny,
        memberships.length,
      ),
      canCreateProject: false,
      isCardEngineerOnly,
      ownsAnyProject: ownsAny,
      assignedProjectCount: memberships.length,
    },
  });
}

export async function GET() {
  try {
    return await getNavigation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
