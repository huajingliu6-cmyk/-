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

async function getNavigation() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const user = session.user;
  const systemRole = getSystemRole(user);
  const ownsAny = await userOwnsAnyProject(user.id);
  const memberships = await listMembershipsForUser(user.id);
  const isCardEngineerOnly =
    systemRole === "USER" && !ownsAny && memberships.length > 0;

  let navigation: ShellNavItem[];
  if (systemRole === "SYSTEM_ADMIN") {
    navigation = AUTH_NAV_ITEMS;
  } else if (isCardEngineerOnly) {
    navigation = AUTH_NAV_ITEMS.filter((item) =>
      (CARD_ENGINEER_NAV_IDS as readonly string[]).includes(item.id),
    );
  } else if (ownsAny) {
    navigation = AUTH_NAV_ITEMS;
  } else {
    navigation = AUTH_NAV_ITEMS;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      systemRole,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    navigation,
    flags: {
      canAccessProjectManagement: canAccessProjectManagementNav(
        systemRole,
        ownsAny,
        memberships.length,
      ),
      canCreateProject: systemRole === "SYSTEM_ADMIN",
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
