# AGENT_CONTINUE_HANDOFF — 给下一位 Agent 的项目交接单

> **生成时间**：2026-08-01 Asia/Shanghai  
> **用途**：新对话优先打开本文件，再按阅读顺序读基线；不要把旧报告当当前真相。  
> **本文件角色**：续作入口 + 现状快照 + 未完成优先级 + 可复制开场。  
> **完整技术基线仍是**：[`CURRENT_PROJECT_MASTER_HANDOFF.md`](./CURRENT_PROJECT_MASTER_HANDOFF.md)（冲突时以 [`H1_CLOSE_HANDOFF_PATCH.md`](./H1_CLOSE_HANDOFF_PATCH.md) 为准）。

---

## 0. 30 秒结论

| 项 | 值 |
|----|-----|
| 产品 | Lumina Story（分镜创作工作台） |
| 路径 | `c:\Users\江城的助手\Downloads\24\infinite-canvas` |
| 分支 | `feat/react-flow-migration` |
| HEAD | `a8149a0a6e791d9fc2f2ac431a3773ace821870a` |
| 工作区 | **Dirty YES**（约 **162** 行 `git status --short`；含大量未提交 H1/H2/SD2 成果） |
| Node / npm | v24.18.0 / 11.16.0 |
| Next / React | 16.2.11 / 19.2.4 |
| H1 功能 | **COMPLETE**；总状态 **PARTIAL**（仅历史 `data/` 追溯） |
| H2-AI-CONTROL | **COMPLETE**（不以 data 哈希 PARTIAL） |
| SD2 / 人物校验 / 任务规则接线 | 代码已落地；**真机联调未在本机跑通**（需用户配 URL+Key） |
| `data/` | 在用业务库；**OPEN / NON-BLOCKING**；2026-08-01 观测 **970** / `40a80ff68e1642489d1b2923bcef5d3eb6a30fff02189b2ca25938eabb21d045`（**非**干净基线） |
| 默认策略 | `VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`TEXT_LLM_PROVIDER=mock`、`PERSISTENCE_DRIVER=file` |

**最近专题交接（续作前必读其一）：**

- [`SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`](./SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md)（2026-07-31，任务规则 / 文生图规则 / 设计人物校验 / SD2 方言）
- [`STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`](./STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md)（方舟真人预检 + omit）

相关 transcript：[`fcc46b3e-4279-4f10-a925-3e966c7f447d`](../../.cursor/projects/c-Users-Downloads-24-infinite-canvas/agent-transcripts/fcc46b3e-4279-4f10-a925-3e966c7f447d)

---

## 1. 新对话开场（直接复制）

### A. Cursor 实现助手

```text
先读 docs/AGENT_CONTINUE_HANDOFF.md，再按其中「阅读顺序」读基线。
分支 feat/react-flow-migration，工作区 Dirty：禁止 reset/clean/restore/盲目 add/删 data/自动 commit/push。
按交接单「未完成 / 建议下一步」继续；不要重复已确认事实；不要改付费默认。
测试必须隔离 APP_DATA_DIR；Smoke 用非 3000 端口；不杀/复用用户 :3000。
```

### B. 规划助手

```text
先读 docs/AGENT_CONTINUE_HANDOFF.md 与 docs/CURRENT_PROJECT_MASTER_HANDOFF.md。
用极短篇幅复述：已完成 / 未完成 / 安全红线 / data 原则。
然后只输出可直接复制给 Cursor 的「本批次指令」。
不要重新询问已确认产品决策。
```

---

## 2. 阅读顺序（冲突以靠前为准）

1. **本文件** `docs/AGENT_CONTINUE_HANDOFF.md`
2. `docs/H1_CLOSE_HANDOFF_PATCH.md`（状态分层与 data 原则）
3. `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`（完整基线；与补丁冲突时以补丁为准）
4. `docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`（若做视频/设计/任务规则）
5. `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`（若做方舟预检/omit）
6. `docs/AI_TASK_RULES_ARCHITECTURE.md`（H2 任务规则架构）
7. `docs/CURRENT_PROJECT_HANDOFF.md`（中文概览）
8. `docs/CURRENT_CODE_AND_BUTTON_MAP.md` / `docs/AI_BUTTON_API_CONFIG_AUDIT.md`（需要按钮/API 地图时）

**不要把** `docs/agent-handoff.md` **当当前真相**（历史追溯）。

---

## 3. 已确认事实（禁止再当未知 / 再问用户）

1. 历史数据迁移**已取消**；PostgreSQL 未来干净起步；**禁止** `npm run db:legacy:import --apply`。
2. 工作台 `/app/workspace` 与项目管理 `/app/projects` **已分离**；视频画布 `/workflow` 独立，分镜页**不**自动跳转画布。
3. 项目管理写操作必须 `requireActualProjectOwner`；**非 owner 的 SYSTEM_ADMIN 拒绝项目内容**。
4. **CARD_ENGINEER** 可操作已分配项目工作台 **assets（design + library）**；不可进项目管理业务。  
   （旧文档若写「CE 不可 design」→ **已否决**，以 H1_CLOSE 补丁为准。）
5. 分镜两步流程；独立资产匹配页已删。
6. `script.split.generate` **已 active**；`script.episodes.generate` / `script.continue.generate` 仍 **planned**（E2 暂停）。
7. PDF **产品不支持**（非待开发）。
8. H2：modelConnection、ai-task-rules、`resolveAiExecutionPlan` 单次 Provider 调用、Admin 双 Tab — **COMPLETE**。
9. 文生图已接**已发布**任务规则（`buildAssembledImagePrompt`）；草稿不进线上。
10. 方舟真人审核：预检 + 自动 omit 人物参考；SD2 线路：**不 omit**，走真人认证 `asset://`。
11. 设计素材「人物校验」= 移动 SD2 真人认证上传；`ok` 绿盾锁定；`failed/blocked`→疑似真人。
12. `npm run dev` 监听 `0.0.0.0:3000`（修复过 IPv4 `ERR_CONNECTION_REFUSED`）。
13. 不得向聊天贴完整 API Key；配置落本地 `data/`（gitignore）+ 尽量加密。
14. `data/` 全目录哈希仅为时间点观测；**不得**把 844/847/970 任一写成永久干净基线。
15. 不得写：H2 因 data 哈希 PARTIAL、必须恢复 844、H2 污染了真实 data/。

---

## 4. 模块完成度（摘要）

| 模块 | 状态 |
|------|------|
| 登录 / 权限 / 成员 / 工作台·管理分离 | ✅ |
| 故事生成 + 大纲 | ✅ |
| 剧本 TXT/DOCX/MD + 智能分集 `script.split` | ✅ |
| 根据大纲生成剧集 / 续写 | 🔴 planned |
| 剧本/故事导出 Word | 🔴 Stub |
| AI 配置中心 + H2 任务规则 | ✅ |
| 资产双模块 + 按集设计（G1）+ G1-UI | ✅ |
| G1-R 完整浏览器 smoke | 🟡 未闭环 |
| 分镜两步 + Mock 视频 | ✅ |
| 方舟 Seedance 预检 + omit | ✅ 代码；真机视配置 |
| 移动 SD2 方言 + 设计人物校验 | ✅ 代码；**真机联调未完** |
| React Flow 画布 | ✅ |
| PostgreSQL | ⚠️ 可选 CRUD；Engine/测试**未验证** |
| 团队 / 企业库 / 展示 / 指引 | 🔴 Stub |

---

## 5. 未完成 / 建议下一步（按优先级）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| **P0（续作热点）** | SD2 真机联调 | 真实平台 URL+Key：普通上传 / 真人→active / 创建视频 / 下载；设计「人物校验」绿盾；对照桌面文档 `C:\Users\江城的助手\Desktop\Seedance2.0API接口文档.md` |
| P0′ | G1-R 浏览器 smoke | extract→edit→save→confirm→stale→empty→cancel→非法 JSON 恢复；隔离 `APP_DATA_DIR`；非 3000；**勿把 API smoke 冒充 browser** |
| P1 | PostgreSQL 验证 | `docker compose` + `npm run test:postgres` |
| P2 | E2 恢复 | `script.episodes.generate` active 化（仅产品明确恢复时） |
| P3 | 剧集续写 | `script.continue.generate` |
| P4 | 导出 Word / Stub 模块 | 择一落地 |
| P5 | Dirty 工作区按主题拆 commit | **仅用户明确要求时**；禁止盲目 `git add .` |
| — | PDF | **不做** |

若用户未指定批次：优先问清是 **SD2 联调** 还是 **G1-R smoke** / 产品功能批；默认可按 P0 SD2 联调或用户最新指令执行。

---

## 6. 安全红线（违反即停）

1. 禁止：`git reset` / `clean` / `restore .` / 盲目 `git add .` / 删 `data/` / 自动 commit / push / 破坏性 git。
2. 禁止：`npm run db:legacy:import --apply`。
3. 禁止改默认：`VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` / `TEXT_LLM_PROVIDER`（仓库默认保持 mock/false/mock）。
4. Vitest / API Smoke / Browser Smoke：**必须**隔离 `APP_DATA_DIR`；自动化须拒绝指向仓库真实 `data/`；Smoke **非 3000**；不杀/复用用户 `:3000`。
5. 不在真实 `data/` 造测试项目/用户/Mock 配置；发现污染 → **立即停批定位**。
6. 不删真实 `script.json` / `workspace/snapshot.json` 或来源不明文件；不尝试整库恢复到 844。
7. 工作台不得反向写管理正式数据；Mock 不冒充付费；planned 不伪装 active。
8. 后台 AI 配置不能绕过 `ALLOW_PAID_GENERATION=false`。
9. 文档/聊天不写：密码、完整 API Key、passwordHash、用户剧本全文。
10. SD2：不要 invent 第二套视觉预检；不要把 SD2 折进 `legacy-sync` / 误伤 `openai-videos`；客户响应勿回传 `provider_*` / `realPeopleAssetId`。

---

## 7. 关键路径速查

| 主题 | 路径 |
|------|------|
| 权限 / 有效角色 | `src/auth/effective-role.ts`、`src/auth/permissions.ts` |
| AI capability / 执行计划 | `src/ai-config/*` |
| 任务规则 Admin UI | `src/auth/ai-admin/CapabilityRuleCard.tsx` |
| 文生图规则拼装 | `src/ai-config/prompt-assembly.ts` |
| 设计素材 / 人物校验 | `src/projects/assets/episode-design/*`、`DesignAssetModal.tsx` |
| 分镜视频提交 / omit·SD2 | `src/projects/storyboard/services/storyboard-video-generate.ts` |
| 方舟预检 | `src/video-generation/ark-image-safety-precheck.ts` |
| SD2 方言 / 客户端 | `src/video-generation/provider/http-video-dialect.ts`、`sd2-platform-client.ts`、`http-video-provider.ts` |
| 视频用户可读错误 | `src/video-generation/user-facing-error.ts` |
| 持久化根 | `src/persistence/`；运行时数据 `data/`（勿删） |
| 哈希观测 | `npx tsx scripts/hash-app-data.ts` |

### 常用命令

```powershell
cd C:\Users\江城的助手\Downloads\24\infinite-canvas
npm run dev
# 0.0.0.0:3000

npm test
npx vitest run src/video-generation/__tests__/http-video-dialect.test.ts src/video-generation/__tests__/sd2-http-video-provider.test.ts src/video-generation/__tests__/user-facing-error.test.ts src/projects/assets/episode-design/__tests__/design-asset-image.test.ts src/projects/assets/episode-design/__tests__/design-media-video-ref-precheck.test.ts

npx tsx scripts/hash-app-data.ts
```

### SD2 联调配置提示（勿把 Key 贴进聊天）

- 管理 API「移动 SD2 平台」或 `.env.local`：`SD2_PLATFORM_API_URL` / `SD2_PLATFORM_API_KEY`
- 可选强制方言：`VIDEO_SHOT_HTTP_DIALECT=sd2`
- 示例根地址曾用：`http://36.212.37.227:3099`（以运营最新为准）

---

## 8. 工作区 Dirty 说明

- HEAD 仍停在 `a8149a0`（local paid gate 等已提交历史）。
- **大量未提交改动**覆盖：认证/权限、项目管理与工作台、资产设计、AI 配置、分镜、视频 Provider（含 SD2）、React Flow、prisma、docs、smoke scripts 等。
- 另有临时提取文件（勿当产品代码提交）：`.9d06-*.txt`、`.extract-*.txt`、`_fix_lines.js` 等。
- `data/` 下运行时文件多为业务存档；测试用隔离目录，**禁止**为干净而盲删真实 `data/`。

---

## 9. 三个产品表面（勿混淆）

| 表面 | 前缀 | 要点 |
|------|------|------|
| 平台工作台 | `/app/workspace…` | CE 主入口；无剧本/成员管理 |
| 项目管理 | `/app/projects…` | 仅实际 owner 操作内容 |
| 视频画布 | `/workflow` | React Flow；不是工作台 |

---

## 10. 交接自检（新 Agent 开场应能回答）

- [ ] 当前分支与 Dirty 约束？
- [ ] H1 / H2 / data 事件状态分层？
- [ ] CE 能否进工作台 design？（能）
- [ ] `script.split` vs `script.episodes` 状态？
- [ ] 方舟 omit vs SD2 不 omit？
- [ ] 下一批默认优先做什么？
- [ ] 测试如何隔离 `APP_DATA_DIR`？

若以上任一项答错，先重读本文件第 3–6 节，再动手。
