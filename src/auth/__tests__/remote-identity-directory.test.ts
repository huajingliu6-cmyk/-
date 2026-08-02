import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  documents: new Map<string, { revision: number; value: unknown }>(),
  members: [] as Array<{ id: string; projectId: string; userId: string; role: "CARD_ENGINEER"; createdAt: string; createdBy: string }>, 
  users: [] as Array<{
    id: string; username: string; role: "admin" | "user"; displayName: string;
    password: string; createdAt: string; updatedAt: string;
  }>,
}));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: () => false,
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const doc = state.documents.get(`${namespace}/${key}`);
    return doc ? { namespace, key, revision: doc.revision, value: structuredClone(doc.value), updatedAt: new Date().toISOString() } : null;
  }),
  putRemoteDocument: vi.fn(async (input: { namespace: string; key: string; expectedRevision?: number; value: unknown }) => {
    const identity = `${input.namespace}/${input.key}`;
    const current = state.documents.get(identity);
    if ((input.expectedRevision ?? -1) !== (current?.revision ?? 0)) throw new Error("REVISION_CONFLICT");
    const next = { revision: (current?.revision ?? 0) + 1, value: structuredClone(input.value) };
    state.documents.set(identity, next);
    return { namespace: input.namespace, key: input.key, revision: next.revision, value: structuredClone(next.value), updatedAt: new Date().toISOString() };
  }),
  isRemoteRevisionConflict: (error: unknown) => error instanceof Error && error.message === "REVISION_CONFLICT",
  requestRemoteData: vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const publicUser = (user: (typeof state.users)[number]) => ({ id: user.id, username: user.username, role: user.role, displayName: user.displayName, createdAt: user.createdAt, updatedAt: user.updatedAt });
    if (path === "/v1/users" && init?.method === "POST") {
      if (body.role === "admin") return Response.json({ error: "不能通过创建用户接口授予系统管理员" }, { status: 400 });
      if (state.users.some((user) => user.username.toLowerCase() === body.username.toLowerCase())) return Response.json({ error: "用户名已存在" }, { status: 400 });
      const now = new Date().toISOString();
      const user = { id: `user-${state.users.length + 1}`, username: body.username, role: "user" as const, displayName: body.displayName || body.username, password: body.password, createdAt: now, updatedAt: now };
      state.users.push(user);
      return Response.json({ user: publicUser(user) }, { status: 201 });
    }
    if (path === "/v1/users/authenticate") {
      const user = state.users.find((candidate) => candidate.username.toLowerCase() === body.username.toLowerCase() && candidate.password === body.password);
      return user ? Response.json({ user: publicUser(user) }) : Response.json({ error: "invalid credentials" }, { status: 401 });
    }
    if (path === "/v1/users/admin/count") return Response.json({ count: state.users.filter((user) => user.role === "admin").length });
    if (path === "/v1/users/admin/grant" || path === "/v1/users/admin/revoke") {
      const user = state.users.find((candidate) => candidate.username.toLowerCase() === body.username.toLowerCase());
      if (!user) return Response.json({ error: "用户不存在" }, { status: 400 });
      if (path.endsWith("grant")) { const alreadyAdmin = user.role === "admin"; user.role = "admin"; return Response.json({ user: publicUser(user), alreadyAdmin }); }
      if (user.role !== "admin") return Response.json({ user: publicUser(user), alreadyUser: true });
      if (state.users.filter((candidate) => candidate.role === "admin").length <= 1) return Response.json({ error: "不能撤销最后一个系统管理员" }, { status: 400 });
      user.role = "user"; return Response.json({ user: publicUser(user), alreadyUser: false });
    }
    if (path.startsWith("/v1/users/") && init?.method === "PATCH") {
      const user = state.users.find((candidate) => candidate.id === decodeURIComponent(path.slice(10)));
      if (!user) return Response.json({ error: "用户不存在" }, { status: 400 });
      if (typeof body.displayName === "string") user.displayName = body.displayName.trim();
      if (typeof body.newPassword === "string") { if (user.password !== body.currentPassword) return Response.json({ error: "当前密码不正确" }, { status: 400 }); user.password = body.newPassword; }
      return Response.json({ user: publicUser(user) });
    }
    if (path.startsWith("/v1/project-members")) {
      const url = new URL(path, "http://internal");
      const projectId = url.searchParams.get("projectId");
      const userId = url.searchParams.get("userId");
      if (!init?.method || init.method === "GET") {
        return Response.json({
          members: state.members.filter(
            (member) =>
              (!projectId || member.projectId === projectId) &&
              (!userId || member.userId === userId),
          ),
        });
      }
      if (init.method === "POST") {
        if (
          state.members.some(
            (member) =>
              member.projectId === body.projectId && member.userId === body.userId,
          )
        ) {
          return Response.json(
            { error: "该用户已是本项目的抽卡工程师" },
            { status: 409 },
          );
        }
        const member = {
          id: `pm-${state.members.length + 1}`,
          projectId: body.projectId,
          userId: body.userId,
          role: "CARD_ENGINEER" as const,
          createdAt: new Date().toISOString(),
          createdBy: body.createdBy,
        };
        state.members.push(member);
        return Response.json({ member }, { status: 201 });
      }
      const before = state.members.length;
      state.members = state.members.filter(
        (member) =>
          !(member.projectId === projectId && member.userId === userId),
      );
      return Response.json({ removed: state.members.length !== before });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }),
}));

import { authenticateUser, countSystemAdmins, createUser, grantSystemAdminByUsername, revokeSystemAdminByUsername, updateUserPassword, updateUserProfile } from "@/auth/users";
import { addCardEngineer, findProjectMember, listMembershipsForUser, removeCardEngineer } from "@/auth/project-members";

describe("remote identity and project member directories", () => {
  beforeEach(() => { state.documents.clear(); state.members = []; state.users = []; });
  it("creates, authenticates and updates a remote user", async () => {
    const user = await createUser({ username: "remote_user", password: "Password123", displayName: "Remote User" });
    expect(await authenticateUser("REMOTE_USER", "Password123")).toMatchObject({ id: user.id, role: "user" });
    expect((await updateUserProfile(user.id, { displayName: "Updated" })).displayName).toBe("Updated");
    await updateUserPassword(user.id, { currentPassword: "Password123", newPassword: "Password456" });
    expect(await authenticateUser("remote_user", "Password123")).toBeNull();
    expect(await authenticateUser("remote_user", "Password456")).toBeTruthy();
  });
  it("preserves system-admin grant and last-admin protection", async () => {
    const first = await createUser({ username: "admin_one", password: "Password123" });
    await grantSystemAdminByUsername(first.username); expect(await countSystemAdmins()).toBe(1);
    await expect(revokeSystemAdminByUsername(first.username)).rejects.toThrow("不能撤销最后一个系统管理员");
    const second = await createUser({ username: "admin_two", password: "Password123" });
    await grantSystemAdminByUsername(second.username); expect((await revokeSystemAdminByUsername(second.username)).alreadyUser).toBe(false);
  });
  it("rejects duplicate users and direct admin creation", async () => {
    await createUser({ username: "member", password: "Password123" });
    await expect(createUser({ username: "MEMBER", password: "Password123" })).rejects.toThrow("用户名已存在");
    await expect(createUser({ username: "forged", password: "Password123", role: "admin" })).rejects.toThrow("不能通过创建用户接口授予系统管理员");
  });
  it("keeps project member document behavior", async () => {
    const member = await addCardEngineer({ projectId: "p_1", userId: "u_1", createdBy: "owner_1" });
    expect(await findProjectMember("p_1", "u_1")).toEqual(member);
    expect(await listMembershipsForUser("u_1")).toEqual([member]);
    expect(await removeCardEngineer("p_1", "u_1")).toBe(true);
  });
});