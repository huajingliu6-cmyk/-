import type { AuthUser } from "@/auth/types";

export type HomeNavItem = {
  id: string;
  label: string;
  /** 已有路由时填写；否则留空并由 UI 走 TODO 占位交互 */
  href?: string;
};

export type HomeCreditsPlaceholder = {
  /** TODO: 接入真实积分余额接口后替换 */
  available: number;
  label: string;
};

export type ShowcaseItem = {
  id: string;
  title: string;
  kind: string;
  status: string;
  /** 本地封面 URL；无则使用 CSS 渐变占位 */
  coverUrl?: string;
  /** 真实预览视频 URL；无则禁止悬停自动播放 */
  previewVideoUrl?: string;
  gradient: string;
};

export type HomeUserView = {
  user: AuthUser | null;
  /** 头像 URL；当前 AuthUser 无此字段，UI 用首字母占位 */
  avatarUrl: string | null;
  displayLabel: string;
};
