# Web Performance Optimization Delivery — 2026-08-04

## 1. 当前性能问题清单

| ID | 问题 | 严重度 | 状态 |
|----|------|--------|------|
| P0-1 | 壳层重复请求 `/api/auth/me`（Shell + AuthUserMenu + HeroCta） | 高 | 已修 |
| P0-2 | 移动端双挂载 `AuthenticatedNavigation` 导致重复导航请求 | 中 | 已修（memoryFetch 合并） |
| P0-3 | 大工作区 / 画布静态打包阻塞首屏 | 高 | 已修（dynamic import） |
| P0-4 | `/api/projects` 全量返回无分页 | 高 | 已修 |
| P0-5 | BFF→Go `fetch` 无超时 | 高 | 已修 |
| P0-6 | SSDB 每次命令新建 TCP 连接 | 高 | 已修 |
| P0-7 | PostgreSQL 连接池未配置 | 高 | 已修 |
| P0-8 | 文档缓存无 singleflight / 负缓存 / TTL 抖动 | 高 | 已修 |
| P0-9 | 列表接口文档 N+1 读取 | 高 | 已修（批量 GetDocuments） |
| P0-10 | `app_blobs.object_key` 无索引 | 中 | 已修 |
| P0-11 | 无网关 gzip / upstream keep-alive | 中 | 已修（可选 gateway profile） |
| P0-12 | README 误写 localStorage 存布局偏好 | 低 | 已修 |
| P0-13 | Cookie 会话缺 CSRF Origin 校验 | 中 | 已修 |
| P1-1 | Admin 跨项目扫描仍全量 | 中 | 未改（避免改变业务语义，列入后续） |
| P1-2 | 生产环境故意不部署 SSDB（架构门禁） | 信息 | 保持：SSDB 可选；有则启用优化 |

**本地存储扫描结论：** 业务数据未使用 `sessionStorage` / IndexedDB / Service Worker Cache。仅 `AppearanceProvider` 将**主题强调色**写入 `localStorage`（非业务/鉴权数据）。会话为 HttpOnly Cookie `ic_session`。

## 2. 已完成的前端改动

- `AuthSessionProvider`：全站共享 `/api/auth/me`，内存级 in-flight 合并
- `AuthUserMenu` 改为接收 shell `user`，去掉重复 me 请求；`ApiManagePanel` 动态加载
- `HeroCta` 复用会话态，不再点击时打 me
- `memoryFetch`：同 URL GET 请求合并 + AbortSignal
- `AuthenticatedNavigation` 使用 memoryFetch + abort
- `WorkflowEditor` / `EpisodeAssetDesignWorkspace` `next/dynamic` 按需加载
- `/api/projects` 服务端分页（默认 50，最大 100）+ `q` 搜索
- 项目管理页 300ms 防抖后带分页参数请求
- BFF `remoteFetch` 超时（`GO_BACKEND_FETCH_TIMEOUT_MS`，默认 10s）
- `proxy.ts`：API 变更请求 CSRF Origin/Referer 校验；API `Cache-Control: no-store`

## 3. 已完成的 Golang 后端改动

- PostgreSQL `pgxpool` 可配置 Max/Min/Lifetime/Idle/ConnectTimeout
- SSDB 持久连接 + 重连；默认命令超时 500ms
- 文档缓存 `GetOrFetch`：singleflight、负缓存、TTL 抖动、环境前缀键、回源并发上限
- `GetDocuments` 批量读，接入视频生成/工作流/幂等列表
- Migration `0002_app_blobs_object_key_idx`
- HTTP 超时可配置；WriteTimeout 覆盖大 Blob
- remotefile 共享 Transport keep-alive
- 可选 `PPROF_LISTEN_ADDRESS`（环回免 Token）
- Middleware：`Cache-Control: no-store`；审计异步写入
- 日志仍输出 stdout JSON（不写本地日志文件）

## 4. 已完成的 PostgreSQL 改动

- `backend/internal/migrations/0002_app_blobs_object_key_idx.sql`
  - SQL：`create index if not exists app_blobs_object_key_idx on app_blobs(object_key) where object_key is not null`
  - 原因：`BlobObjectReferenced` 按 `object_key` 查询清理引用
  - 写入影响：仅在写入/删除 Blob 元数据时维护部分索引；体量远小于全表索引
- `backend/internal/migrations/scripts/pg_stat_statements_enable.sql`：慢 SQL 排查脚本

## 5. 已完成的 SSDB 改动

- 连接复用、超时、缓存击穿保护、负缓存、TTL 抖动、键规范 `ic:{env}:document:...`
- **生产 Compose 仍不部署 SSDB**（与既有 `architecture:check` 一致）；开发/测试配置 `SSDB_ADDRESS` 即可启用

## 6. 已完成的网关和部署改动

- `deploy/gateway/nginx.conf`：gzip、upstream keepalive、超时、API no-store、静态资源长缓存
- `deploy/compose.gateway.yml`：`--profile gateway` 可选启用，不暴露 PG/API/Blobstore

## 7. 删除或替换的本地存储代码

- 无业务 localStorage 删除项（本就不存在）
- README 更正：布局偏好为内存态，非 localStorage
- 会话继续 HttpOnly Cookie；前端不读 Token

## 8. 新增和修改的环境变量

| 变量 | 用途 |
|------|------|
| `GO_BACKEND_FETCH_TIMEOUT_MS` | BFF→Go 超时 |
| `POSTGRES_MAX_CONNS` 等 | PG 池 |
| `SSDB_TIMEOUT_MS` | SSDB 命令超时 |
| `CACHE_TTL_SECONDS` / `CACHE_ENV` / `APP_ENV` | 缓存 |
| `HTTP_*_TIMEOUT` | Go HTTP Server |
| `PPROF_LISTEN_ADDRESS` | 管理内网 pprof |

## 9. 新增数据库 migration / SQL

- `0002_app_blobs_object_key_idx.sql`
- `scripts/pg_stat_statements_enable.sql`

## 10. 主要修改文件列表

前端：`src/shell/AuthSessionProvider.tsx`, `useAuthUser.ts`, `memory-fetch.ts`, `AccountActions.tsx`, `AuthenticatedNavigation.tsx`, `proxy.ts`, `app/layout.tsx`, `auth/AuthUserMenu.tsx`, `auth/csrf.ts`, `persistence/remote-data-client.ts`, `app/api/projects/route.ts`, `app/app/projects/page.tsx`, workflow/assets design pages, tests, README, `.env.example`

后端：`config`, `postgres/store`, `ssdb/client`, `cache/documents`, `migrations/*`, `app`, `cmd/api`, `httpapi/middleware`, `documents`, list handlers, tests

部署：`deploy/gateway/nginx.conf`, `deploy/compose.gateway.yml`

## 11. 关键修改原因（摘要）

- 减少首屏重复鉴权请求与大包阻塞
- 防止 BFF/Go/SSDB 挂死与连接风暴
- 降低文档列表 N+1 与 Blob 引用查询成本
- 补齐 CSRF / no-store / 可选边缘压缩

## 12–15. 性能对比（本机证据边界）

| 指标 | 优化前（代码取证） | 优化后（代码取证） | 实测 |
|------|-------------------|-------------------|------|
| `/app` 壳层 `/api/auth/me` | 2–3 次 | 1 次（共享） | 单元/代码路径验证 |
| 项目列表响应字段 | 全量数组 | page/pageSize≤100 + total | 单测覆盖 |
| SSDB | 每命令 Dial | 长连接复用 | `go test ./internal/ssdb` |
| 文档缓存击穿 | 无合并 | singleflight + 负缓存 | `go test ./internal/cache` |
| PG EXPLAIN | 无基线机 | 索引脚本已提交 | **需在真实 PG 上跑 EXPLAIN** |
| SSDB 命中率 | 无生产 SSDB | 开发可启用 | **未伪造压测数字** |

未在本机伪造 P50/P95 数字。生产压测需在受控 Compose（可选 gateway + 可选 SSDB）上另行执行。

## 16. 测试执行命令及结果

```text
cd backend && gofmt -w ./... && go vet ./... && go test ./...
→ PASS

npx vitest run src/shell/__tests__/memory-fetch.test.ts src/auth/__tests__/csrf.test.ts src/text-generation/__tests__/stale-job.test.ts src/projects/__tests__/projects-api-auth.test.ts
→ PASS（本批相关）

node scripts/check-remote-architecture.mjs
→ PASS
```

## 17. 仍存在的风险

- Admin 历史跨项目扫描仍可能重
- 生产无 SSDB 时缓存层为空操作（符合现行架构门禁）
- CSRF 对无 Origin 的服务端工具依赖 `Sec-Fetch-Site` 宽松分支
- 未跑完整 `npm run build` / 浏览器压测 / 真实 PG EXPLAIN 对比
- 深分页游标尚未替换所有列表（项目列表仍为内存切片分页）

## 18. 回滚方式

```bash
git checkout -- <paths>
# 或回退到标签
git switch --detach V0.2bete
```

网关：不启用 `compose.gateway.yml` 即可。Migration `0002` 使用 `IF NOT EXISTS`，回滚可 `DROP INDEX IF EXISTS app_blobs_object_key_idx;`。
