# 新 Agent 继续开发交接单（2026-08-02）

> 这是当前最新的继续开发入口。新 Agent 应先完整阅读本文件，再阅读 `docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md`。若旧交接文档与当前代码或本文件冲突，以当前代码和本文件为准。

## 1. 任务目标

继续完成 `infinite-canvas` 的远程持久化迁移与最终联调，目标架构为：

- Next.js：Web 与 BFF。
- Go：内部业务 API。
- PostgreSQL：唯一持久事实源，保存文档、审计和 Blob 元数据。
- SSDB：可随时清空的缓存，不得保存唯一业务事实。
- 独立 blobstore：保存图片、音频和视频二进制。
- 生产环境不得依赖 Next.js 本地磁盘保存业务数据。
- 服务输出结构化 stdout 日志，并通过请求 ID 串联 Go API 与 blobstore。

## 2. 仓库位置与 Git 状态

仓库绝对路径：

```text
C:\Users\江城的助手\Downloads\24\infinite-canvas
```

当前状态（2026-08-02 核对）：

```text
branch: feat/react-flow-migration
HEAD: a8149a0a6e791d9fc2f2ac431a3773ace821870a
```

工作区包含大量未提交、多阶段改动和未跟踪文件。不要把这些内容当作垃圾清理，也不要覆盖或回退其他 Agent 已完成的工作。

## 3. 不可违反的操作边界

未经用户明确授权，绝对不要执行：

- `git reset`
- `git clean`
- `git restore`
- 盲目执行 `git add .`
- 创建提交或推送
- 删除、恢复或重写仓库中的 `data/`
- `npm run db:legacy:import --apply`

测试约束：

- 不占用用户正在使用的 `3000` 端口。
- 不把测试数据写入真实仓库 `data/`。
- 保持 `VIDEO_PROVIDER=mock`。
- 保持 `ALLOW_PAID_GENERATION=false`。
- 保持 `TEXT_LLM_PROVIDER=mock`。
- 不打印真实密码、Token、API Key、Cookie 或用户内容。
- SSDB 只能作为缓存。
- 本地 SSDB 验证不等于生产批准。

## 4. 已完成内容

### 4.1 独立 blobstore

已经新增并验证：

```text
backend/internal/blobstore/store.go
backend/internal/blobstore/fileserver/handler.go
backend/internal/blobstore/remotefile/client.go
backend/internal/blobstore/split/store.go
backend/cmd/blobstore/main.go
backend/Blobstore.Dockerfile
backend/internal/requestcontext/request_context.go
```

当前行为：

- 生产远程驱动为 `remotefile`。
- 本地兼容驱动为 `postgres`。
- PostgreSQL 保存 MIME、长度、SHA-256 和 `object_key`。
- 新远程 Blob 写入的 PostgreSQL `body IS NULL`。
- 历史 PostgreSQL `bytea` Blob 仍可读取。
- blobstore 支持 `GET`、`HEAD`、`PUT`、`DELETE`。
- 使用独立 Docker 卷、临时文件原子重命名、Token 验证和 256 MiB 限制。
- 拒绝路径穿越、反斜杠、空段和点段。
- Go API 的 `X-Request-Id` 会传递到 blobstore 日志。

### 4.2 事务与并发安全

已经完成：

- 相同 `storage_key` 的覆盖、删除和事务复制共用 PostgreSQL advisory lock。
- 文档 CAS 前通过 Blob `HEAD` 检查真实物理对象。
- PostgreSQL Blob 元数据仍在事务内复核。
- Blob 事务复制保留 `object_key`。
- 仍有其他元数据引用时不会删除共享物理对象。
- 元数据写入失败时补偿删除新物理对象。
- 读取时校验长度与 SHA-256。
- SQL 迁移可重复执行。

### 4.3 真实 PostgreSQL 与 blobstore 联调

已通过隔离 Docker 环境验证：

- 真实 `PUT`、`HEAD`、`GET`、`DELETE`。
- 新 Blob 行为元数据存 PostgreSQL、字节存 blobstore 卷。
- PostgreSQL 与 blobstore 重启后仍可读取对象。
- 清理后元数据和物理文件均为零残留。
- 缺少物理 Blob 的文档事务返回 `422`，且 CAS 前没有写入文档。
- `integration-restart-request` 出现在 blobstore 请求日志中。
- API 和 blobstore Docker 镜像均构建成功。
- 隔离测试栈和测试卷在当次验证后已清理。

### 4.4 本地 SSDB 1.9.9

已从官方源码固定构建并安装：

```text
image tag: infinite-canvas/ssdb:1.9.9-local
image ID: sha256:3b2f7d62df87e373ef2a64b9a5958e8ccb5c9d5e3a79e0a9f4109dcb6bc9ef6a
source commit: 3e556e4bf4cee96d2577e3c3002f00c540e4ba10
compose project: ic-ssdb-199-local
```

相关文件：

```text
deploy/ssdb/Dockerfile
deploy/ssdb/ssdb.conf
deploy/ssdb/README.md
deploy/compose.local-ssdb.yml
```

已验证：

- 原生 SSDB `SET`、`GET`、`DELETE` 协议。
- 重启后测试值可以读回。
- 测试键已删除。
- 容器以 UID/GID `65532:65532` 运行。
- 未发布宿主机端口。
- 仅连接内部 Docker 网络。

当前本地容器在交接时处于运行状态。检查命令：

```powershell
docker-compose -p ic-ssdb-199-local -f deploy/compose.local-ssdb.yml ps
```

注意：官方 `1.9.9` 标签里的源码 `version` 文件仍是 `1.9.8`，所以启动日志显示 `ssdb-server 1.9.8`。实际来源以固定提交和 OCI 标签为准。

该镜像只允许本地开发测试，尚未获得生产运维批准。

## 5. 已通过的代码质量验证

此前反复通过：

```powershell
go test ./...
go vet ./...
go build ./cmd/api
go build ./cmd/blobstore
```

同时通过：

- Go 格式检查。
- `git diff --check`。
- blobstore 文件服务、远程客户端和 split store 测试。
- 请求 ID 传播测试。
- Blob 驱动配置测试。
- Docker API 镜像与 blobstore 镜像构建。

Go 可执行文件位置：

```text
C:\Temp\go1.24.12-portable\go\bin\go.exe
```

主机测试如需下载模块，之前使用：

```powershell
$env:GOPROXY='https://goproxy.cn,direct'
$env:GOSUMDB='sum.golang.google.cn'
```

## 6. 尚未完成的关键工作

### 6.1 第一优先级：运行 Go API 协议级集成测试

测试文件已经存在，但新增后尚未在真实 PostgreSQL 与 blobstore 上正式运行：

```text
backend/internal/app/app_integration_test.go
```

该测试使用：

- 真实 PostgreSQL。
- 真实 blobstore。
- 测试进程内的 SSDB 协议服务器。

它必须验证：

- `App.New` 成功。
- `/health/ready` 返回 `200`。
- Blob `PUT`、`GET`、`DELETE` 通过 Go API 完成。
- PostgreSQL 行为 `body IS NULL` 且 `object_key` 非空。
- 请求 ID `integration-api-request` 出现在 blobstore 日志。

这只是 SSDB 协议级集成，不是真实 SSDB 生产验证，文档中必须明确区分。

测试读取以下环境变量：

```text
TEST_INTEGRATION_DATABASE_URL
TEST_INTEGRATION_BLOBSTORE_URL
TEST_INTEGRATION_BLOBSTORE_TOKEN
```

建议用独立 Compose 项目只启动 `postgres`、`blobstore-init`、`blobstore`，不要复用真实数据卷。然后在 `backend` 目录执行带 `integration` 标签的指定测试。

### 6.2 第二优先级：真实本地 SSDB 四服务联调

协议级测试通过后，使用刚构建的本地镜像做 PostgreSQL、SSDB、blobstore、Go API 四服务联调。

本地联调可以让远程 Compose 使用：

```text
SSDB_IMAGE=infinite-canvas/ssdb:1.9.9-local
```

但不要修改生产语义，也不要把该值写成已批准的生产默认值。

验证目标：

1. PostgreSQL、真实 SSDB、blobstore 和 Go API 全部启动。
2. Go `/health/ready` 返回 `200`。
3. 通过 Go API 执行一次 Blob `PUT`、`GET`、`DELETE`。
4. PostgreSQL Blob 行保持 `body IS NULL` 且有 `object_key`。
5. 同一个 `X-Request-Id` 同时出现在 Go API 与 blobstore 日志。
6. 清理所有联调测试记录和物理对象。
7. 删除联调专用容器、网络和卷；不要删除 `ic-ssdb-199-local` 的已安装本地开发实例，除非用户要求。

四服务联调结果只能标记为“本地开发验证通过”。

### 6.3 第三优先级：最终质量门

联调完成后重新运行：

```powershell
& 'C:\Temp\go1.24.12-portable\go\bin\go.exe' test ./...
& 'C:\Temp\go1.24.12-portable\go\bin\go.exe' vet ./...
& 'C:\Temp\go1.24.12-portable\go\bin\go.exe' build ./cmd/api
& 'C:\Temp\go1.24.12-portable\go\bin\go.exe' build ./cmd/blobstore
git diff --check
```

命令应在 `backend` 或对应仓库目录执行，先做指定测试，再扩大到完整测试。不要修复与本任务无关的历史问题。

### 6.4 第四优先级：更新文档

将新证据继续写入：

```text
docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md
```

必须记录：

- 协议级 Go API 集成测试结果。
- 真实本地 SSDB 四服务联调结果。
- 测试项目名称、请求 ID、清理状态。
- 明确声明本地验证不等于生产批准。

## 7. 生产环境仍然存在的阻塞项

本地镜像不是生产批准镜像。最终生产完成仍要求：

1. 将固定源码构建物推送到内部镜像仓库。
2. 运维和安全负责人审查基础镜像、源码提交、漏洞扫描结果与运行配置。
3. 通过不可变摘要批准，例如：

```text
<internal-registry>/infinite-canvas/ssdb@sha256:<approved-digest>
```

4. 使用该批准摘要完成生产等价四服务验证。
5. 验证 PostgreSQL 与 blobstore 卷作为同一恢复单元的备份和恢复流程。

在以上工作完成前，不得写“生产 SSDB 已批准”或“生产迁移全部完成”。

## 8. 关键部署文件

```text
deploy/compose.remote.yml
deploy/compose.local-ssdb.yml
deploy/ssdb/Dockerfile
deploy/ssdb/ssdb.conf
deploy/ssdb/README.md
.env.example
```

远程 Compose 当前要求显式提供：

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
DATABASE_URL
SSDB_IMAGE
INTERNAL_API_TOKEN
BLOBSTORE_INTERNAL_TOKEN
```

不要在交接文档、命令输出或聊天里放入真实秘密值。

## 9. 工具与环境说明

- Docker Desktop 已安装并运行。
- 当前环境可使用独立命令 `docker-compose`。
- `docker compose` 子命令此前不可用。
- Docker legacy builder 会提示缺少 buildx，但现有镜像构建成功。
- 内部 Docker 网络按设计禁止外部 DNS。
- 若在内部网络运行 Go 测试容器，应挂载主机 Go module cache 并设置 `GOPROXY=off`、`GOSUMDB=off`。

Go module cache：

```text
C:\Users\江城的助手\AppData\Local\TeamoRouter\agent\codex-homes\task-1785594422295-583219\go\pkg\mod
```

如果 `apply_patch.bat` 因中文用户名编码失败，应使用当前环境提供的 `apply_patch` 接口或已验证的 Teamo engine UTF-8 参数方式，不要用不安全的文件覆盖替代。

## 10. 工作方式要求

用户明确要求：

- 一部分一部分向下推进。
- 稳定优先，不要一次做过多改动。
- 每完成一步都说明“刚完成什么”。
- 每次都说明“接下来做什么”。
- 遇到失败先定位原因，再小步修复。
- 不重复已经有真实证据的 PostgreSQL/blobstore 基础验证。

## 11. 新 Agent 第一条执行指令

可以将下面内容直接发给新 Agent：

```text
请先完整阅读 docs/NEW_AGENT_CONTINUE_2026-08-02.md 和 docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md，然后检查当前 git 与 Docker 状态。不要清理或回退工作区，不要触碰真实 data/，不要占用 3000 端口，不要提交或推送。先用独立 PostgreSQL/blobstore 测试栈运行 backend/internal/app/app_integration_test.go，验证 Go API readiness、Blob PUT/GET/DELETE、PostgreSQL body IS NULL/object_key 和 blobstore 请求 ID。完成后汇报结果，再使用 infinite-canvas/ssdb:1.9.9-local 做真实 SSDB 四服务本地联调。每完成一步告诉我做完了什么以及下一步做什么。本地 SSDB 结果不得描述为生产批准。
```

## 12. 完成标准

本轮本地开发任务只有在以下全部满足后才可标记完成：

- Go API 协议级集成测试通过。
- 真实本地 SSDB 四服务联调通过。
- Blob 元数据与二进制分离再次得到 API 级证据。
- 请求 ID 日志关联通过。
- 测试数据和临时测试栈清理干净。
- Go 测试、vet、两个构建、格式和 diff 检查通过。
- 最新交接文档已更新。

生产目标仍需等待运维批准的 SSDB 内部镜像摘要和备份恢复验证。
