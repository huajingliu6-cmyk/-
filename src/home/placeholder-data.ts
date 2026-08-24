import type {
  HomeCreditsPlaceholder,
  HomeNavItem,
  ShowcaseItem,
} from "@/home/types";

export const HOME_NAV_ITEMS: HomeNavItem[] = [
  { id: "home", label: "首页", href: "/" },
  // TODO: 项目管理路由尚未落地
  { id: "projects", label: "项目管理" },
  { id: "asset-market", label: "素材市场", href: "/app/asset-market" },
  { id: "workspace", label: "工作台", href: "/app/workspace" },
  // TODO: 作品展示独立页尚未落地（首屏底部条作为临时展示）
  { id: "showcase", label: "作品展示", href: "#home-showcase" },
  // TODO: 创作指引路由尚未落地
  { id: "guide", label: "创作指引" },
  // TODO: 团队管理路由尚未落地
  { id: "team", label: "团队管理" },
];

/** TODO: 接入真实积分体系后删除占位 */
export const HOME_CREDITS_PLACEHOLDER: HomeCreditsPlaceholder = {
  available: 0,
  label: "可用积分",
};

/** TODO: 有项目/作品列表 API 后改为真实数据；封面优先用真实资源 */
export const HOME_SHOWCASE_PLACEHOLDERS: ShowcaseItem[] = [
  {
    id: "sc-1",
    title: "雨夜追光",
    kind: "短剧",
    status: "成片",
    gradient:
      "linear-gradient(160deg, #3b1d6e 0%, #7c3aed 42%, #ec4899 78%, #1e1b4b 100%)",
  },
  {
    id: "sc-2",
    title: "星际驿站",
    kind: "科幻",
    status: "分镜",
    gradient:
      "linear-gradient(160deg, #0f172a 0%, #2563eb 40%, #22d3ee 70%, #312e81 100%)",
  },
  {
    id: "sc-3",
    title: "古城回响",
    kind: "历史",
    status: "成片",
    gradient:
      "linear-gradient(160deg, #1c1917 0%, #b45309 38%, #f43f5e 72%, #3b0764 100%)",
  },
  {
    id: "sc-4",
    title: "潮汐信使",
    kind: "奇幻",
    status: "生成中",
    gradient:
      "linear-gradient(160deg, #083344 0%, #0891b2 36%, #a855f7 68%, #4c1d95 100%)",
  },
  {
    id: "sc-5",
    title: "镜中舞台",
    kind: "剧情",
    status: "成片",
    gradient:
      "linear-gradient(160deg, #2e1065 0%, #db2777 45%, #6366f1 80%, #0f172a 100%)",
  },
  {
    id: "sc-6",
    title: "霓虹速递",
    kind: "赛博",
    status: "草稿",
    gradient:
      "linear-gradient(160deg, #111827 0%, #4f46e5 35%, #e11d48 65%, #155e75 100%)",
  },
  {
    id: "sc-7",
    title: "山海卷",
    kind: "国风",
    status: "成片",
    gradient:
      "linear-gradient(160deg, #14532d 0%, #7c3aed 40%, #f472b6 75%, #1e1b4b 100%)",
  },
  {
    id: "sc-8",
    title: "静默舱",
    kind: "悬疑",
    status: "分镜",
    gradient:
      "linear-gradient(160deg, #020617 0%, #1d4ed8 38%, #c026d3 70%, #701a75 100%)",
  },
];
