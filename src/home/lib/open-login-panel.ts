export const HOME_OPEN_LOGIN_EVENT = "home:open-login-panel";

export type HomeOpenLoginDetail = {
  /** 登录成功后的跳转，需为站内相对路径 */
  next?: string;
};

/** 打开首页右上角登录卡片（可重复调用） */
export function openHomeLoginPanel(detail: HomeOpenLoginDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HomeOpenLoginDetail>(HOME_OPEN_LOGIN_EVENT, { detail }),
  );
}
