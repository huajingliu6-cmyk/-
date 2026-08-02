export type ProjectCreationSource = "story" | "script-upload";

export type ProjectMode = "canvas" | "full-stack";

/** 项目生命周期状态（列表摘要可覆盖为工作流派生状态） */
export type ProjectLifecycleStatus = "draft";

/** 持久化项目元数据（不含密码原文） */
export type ProjectRecord = {
  projectId: string;
  /**
   * 项目根容器 ID。
   * 当前工程以项目本身为根文件夹，故 rootFolderId === projectId，不另建实体。
   */
  rootFolderId: string;
  name: string;
  ownerId: string;
  creationSource: ProjectCreationSource;
  projectMode: ProjectMode;
  status: ProjectLifecycleStatus;
  /** 可选项目要点 */
  highlights: string;
  passwordEnabled: boolean;
  /** scrypt 哈希；passwordEnabled 为 false 时为 null */
  passwordHash: string | null;
  passwordSalt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 对外安全视图：永不包含 hash/salt */
export type ProjectPublic = {
  projectId: string;
  rootFolderId: string;
  name: string;
  ownerId: string;
  creationSource: ProjectCreationSource;
  projectMode: ProjectMode;
  status: ProjectLifecycleStatus;
  highlights: string;
  passwordEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  name: string;
  creationSource: ProjectCreationSource;
  projectMode: ProjectMode;
  highlights?: string;
  passwordEnabled: boolean;
  /** 仅当 passwordEnabled 时提交；服务端哈希后丢弃原文 */
  projectPassword?: string | null;
  /** 防重复创建 */
  idempotencyKey?: string;
};

export type CreateProjectAdvancePayload = {
  project: ProjectPublic;
  creationSource: ProjectCreationSource;
  projectMode: ProjectMode;
};
