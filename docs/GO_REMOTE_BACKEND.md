# Go 远端数据后端

## 当前架构

- Web：Next.js，负责页面、登录态、权限和业务边界校验。
- API：Go Web 服务，监听内网地址，使用 `X-Internal-Token` 鉴权。
- 持久化：PostgreSQL 保存 JSON 文档、二进制对象和审计事件。
- 缓存：SSDB，仅作为可失效缓存；PostgreSQL 始终是事实来源。
- 日志：Go 服务向 stdout 输出 JSON 请求日志；审计事件写 PostgreSQL。
- 本地存储：生产或 `REMOTE_DATA_ONLY=true` 时禁止服务端文件持久化；浏览器不使用 Web Storage 或 IndexedDB 保存业务数据。

## 内网部署变量

Web 服务需要：

```env
REMOTE_DATA_ONLY=true
GO_BACKEND_INTERNAL_URL=http://api:8080
INTERNAL_API_TOKEN=<shared-secret>
```

Go 服务需要：

```env
BACKEND_LISTEN_ADDRESS=0.0.0.0:8080
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>
SSDB_ADDRESS=ssdb:8888
SSDB_PASSWORD=<optional-password>
INTERNAL_API_TOKEN=<shared-secret>
```

`INTERNAL_API_TOKEN` 必须由部署系统注入，不得使用 `NEXT_PUBLIC_` 前缀或提交真实值。PostgreSQL 与 SSDB 不暴露公网端口；参考 `deploy/compose.remote.yml`。SSDB 镜像必须由运维明确批准并通过 `SSDB_IMAGE` 提供。

生产 Web 启动时会通过 `src/instrumentation.ts` 校验运行契约：必须显式设置 `REMOTE_DATA_ONLY=true`，必须提供 `GO_BACKEND_INTERNAL_URL` 和 `INTERNAL_API_TOKEN`，且 Go 地址不得使用 `localhost` 或环回 IP。配置不满足时 Web 服务拒绝启动，不会回退到本地数据路径。

## 数据接口

- `GET|PUT|DELETE /v1/documents/{namespace}/{key}`：带 revision 的 JSON 文档。
- `GET|PUT|DELETE /v1/blobs/{storageKey}`：二进制对象。
- `GET /health/live`：进程存活。
- `GET /health/ready`：PostgreSQL 与 SSDB 就绪。

数据库迁移的唯一来源是 `backend/internal/migrations/`，由 Go 服务启动时执行。

## 当前迁移边界

目前工作流、项目管理核心接口、用户身份目录、项目成员分配、故事草稿、文本成稿版本、剧本草稿、资产草稿、管理端按集资产设计文档、工作区资产数据、资产审批只读文档、用户通知、文本生成积分账本、积分预留、底层生成 API 配置、模型连接目录和 AI 任务规则已切到 Go/PostgreSQL/SSDB。工作区资产数据分为管理端上游快照、工作区资产覆盖和工作区按集资产设计三类远端文档，避免把同步数据与用户编辑混写。资产草稿包括人物、场景、道具、音频元数据，以及资产图片/音频 Blob；远端模式不会创建本地资产文件。管理→工作区快照同步已恢复，工作区支持资产与按集设计的列表、详情、保存和应用已生成的设计文本。资产审批支持工作区候选读取、项目审批列表、审批详情和管理员跨项目审批队列读取；候选媒体存在性通过远端 Blob 查询。通知按用户隔离为远端文档，支持列表、未读计数、去重创建、标记已读和删除已完成通知；并发修改通过 revision CAS 冲突后重新读取并重放变更。文本积分按用户隔离账户，生成预留按 generation 隔离，并由 Go `/v1/text-credits` 通过 PostgreSQL 多文档原子事务完成余额初始化、扣减、预留创建和结算退款；Web 不再直接操作积分通用文档；并发预留不会超额消费，重复预留和重复结算保持幂等。生成 API 配置将 profile、能力绑定和审计保存在远端文档中，并由 Go `/v1/generation-api-configs` 负责并发合并、审计去重和 CAS 重试；Web 仅在内存中完成输入校验及 API Key 加密/解密后调用内网接口；模型连接目录将真实连接与槽位绑定保存为独立远端文档，并由 Go `/v1/model-connections` 在最新 PostgreSQL 文档上重放连接与槽位增量、执行 CAS 重试；Web 仅负责连接参数校验、API Key 加密/解密及 legacy 虚拟连接兼容。两者写入前继续使用 AES-256-GCM 密封 API Key，并在 revision 冲突后按 profile、connection ID 和槽位重放独立变更，不向公开接口返回明文密钥。AI 任务规则按 capability 保存为 `ai-task-rules/{capabilityId}` 独立文档，并由 Go `/v1/ai-task-rules` 专用业务接口负责草稿 revision、发布、回滚、幂等与切回 builtin；Web 只通过 `remote-task-rules-store.ts` 调用内网接口；能力集合来自静态 `AI_CAPABILITIES`，因此不需要额外索引。缺失规则只使用内存 builtin，不产生读时写入。草稿 revision、发布与回滚幂等键、历史版本和恢复 builtin 的业务语义保持不变；同 capability 的过期写入映射为既有 `AI_TASK_RULE_REVISION_CONFLICT`，发布、回滚和 use-builtin 冲突不自动重放，不会覆盖并发版本链；不同 capability 可独立并发更新，planned capability 的激活保护保持不变。登录、资料修改、密码修改、管理员 CLI 和抽卡工程师权限解析均使用远端目录。

剧本、资产或资产设计变更现在会刷新远端工作区快照；但剧本变更后的分镜失效和资产变更后的人物语音同步仍依赖未迁移数据域，因此远端模式只暂缓这些附加链路。管理端按集资产设计确认已恢复远程模式：设计记录与资产库通过同一笔 revision CAS 事务更新，冲突后重新读取两份文档并重放转换，重复确认保持幂等且不会创建本地文件。管理端和工作区的设计图片人物预检也已恢复远程模式，预检直接从 Go Blob 服务读取图片，校验结果写回远端设计与资产文档，不创建本地媒体文件。文本生成任务历史已按项目迁移为远端文档，并由 Go `/v1/text-generation-jobs` 负责任务新增、同 generation 状态覆盖、按生成 ID 查询、运行中任务查询、幂等键查询和 revision 冲突重试；Web 不再直接操作任务目录文档。 视频生成任务记录及全局索引已由 Go `/v1/video-generations` 负责读取、保存、状态补丁和列表；首次保存通过 PostgreSQL 多文档事务原子创建任务与索引，后续覆盖与状态补丁使用 revision CAS 重试，补丁冲突后会在最新记录上重新应用，Web 不再直接操作视频任务与索引通用文档。管理员跨项目历史列表继续基于各项目目录汇总。管理端和工作区的设计提示词生成路由现已恢复远程模式：继续使用现有文本模型策略，将生成任务历史和更新后的设计对话、提示词历史分别写入远端文档，并由统一守卫将内网数据服务异常映射为 `503`。设计图片生成也已恢复远程模式：Mock 或 HTTP 图片字节直接写入 Go Blob 服务，生成媒体历史写入对应的管理端或工作区设计文档；若设计文档因 revision 或指纹冲突未保存，刚生成的 Blob 会补偿删除，避免遗留孤立媒体。分镜生产工作区文档现已迁移到 PostgreSQL/SSDB 文档服务；读取时携带服务端 document revision，后续整文档保存使用单次 CAS，过期副本直接冲突而不会自动重试覆盖其他请求的新修改。视频画布工作流文档也已统一迁移：每个项目使用独立 `workflow-documents/{projectId}` 文档，`workflow-index/all` 支持项目摘要列表；缺失读取只返回默认工作流而不自动写盘，首次保存原子写入工作流与索引，业务 revision 保持现有前端协议，服务端 document revision 单独用于 CAS，过期整画布保存会冲突而不会覆盖其他实例的新编辑，列表会跳过索引中的缺失或损坏文档。普通 workflow 图片和音频读取也已接通 Go Blob：远端 GET 必须提供 `projectId`，并先在对应工作流文档中校验 AssetRecord 的项目、assetId、资产类型和 MIME，再读取 `workflow-assets/{assetId}`；Blob MIME 与记录不一致、缺失 Blob、非法 ID 或缺失上下文均拒绝，generatedVideo 继续使用原 generation/project 安全分支。视频生成任务记录也已迁移：每个 generation 使用独立远端文档，另以紧凑全局索引支持扫描；首次保存原子写入任务和索引，轮询状态 patch 使用 revision CAS，冲突后重新读取并重放 patch，不会创建本地 generation JSON。视频生成幂等预留也已迁移到 Go `/v1/video-generation-idempotency`：幂等键经 SHA-256 后作为独立远端文档键，首次预留与扫描索引原子写入；Web 不再直接操作幂等记录与索引通用文档。状态流转、安全重预留和安全释放均由 Go 使用 revision CAS，竞争冲突后重新读取，不会让两个 Web 实例同时获得同一键的新预留。unknownOutcome、Provider 已接单和 committed 状态仍禁止安全释放；损坏文档会拒绝覆盖。生成视频二进制现已迁移到 Go Blob：真实 Provider 结果经原有 DNS、SSRF、重定向、大小和 MP4 结构规则校验后在内存中转存到 `workflow-assets/{assetId}`，不创建本地下载临时文件或最终资产文件；播放接口继续校验 generation/project 上下文，并从 Blob 字节支持完整响应和单 Range 响应，删除资产也会删除远端 Blob。远端 Mock 只读取并再次校验明确配置的只读 Mock 源，不再为每个任务复制本地 `generated-videos` 中间文件。工作区直接确认入正式库仍按产品安全规则保持 `403`，必须走提交审批和主理人审批链路。Go 后端现已提供受 revision 保护的多文档 PostgreSQL 原子写接口，并支持 Blob 复制和 Blob 存在性校验；源 Blob 不存在时整笔事务回滚并返回 `422`，revision 冲突返回 `409`。资产审批提交、通过和驳回现均已恢复远程模式。提交原子写入审批与负责人通知；驳回原子更新审批、提交人通知及负责人通知；通过会将所选条目整批转换并在一次事务内更新审批、管理资产、管理设计、工作区快照、工作区资产、工作区设计和相关用户通知，同时校验全部生成媒体 Blob 存在。任一文档冲突或媒体缺失均不会留下半晋升状态；冲突后会重新读取全部相关文档并重新执行校验和转换。重复提交、重复通过和重复驳回均保持幂等。远程审批写链路不使用只适用于单进程的本地审批锁。其他生成状态仍需继续逐个迁移。

## 安全约束

远端或生产模式不会提供 legacy 本地生成视频文件：`/api/generated-videos/{fileName}` 固定返回 `404`，不会读取服务器文件系统；远端生成视频统一经受项目与 generation 上下文校验的 Blob 播放接口返回。

桌面“本地音频库”同样只保留给 legacy 本地开发模式。远端或生产模式不会枚举、解析或读取 Web 服务器的 `LOCAL_VOICE_LIBRARY_DIR`，`/api/local-voices` 返回空目录标识与空列表；项目业务音频继续统一使用 PostgreSQL 元数据和 Go Blob。真实 Provider 解析角色绑定音色时，会先从远端项目资产草稿确认 `projectId + assetId` 对应的音频元数据，再读取 `projects/{projectId}/asset-audio/{assetId}` Blob；元数据项目不匹配、记录缺失、元数据 MIME 非法、Blob MIME 与元数据不一致、Blob 缺失或超过 50MB 均拒绝，且不会回退本地路径。

视频 Provider 解析项目草稿参考图时，远端模式直接读取 `projects/{projectId}/asset-images/{storageKey}` Go Blob 并在内存中转换为受大小与 MIME 校验的数据 URL；缺失 Blob 明确失败，不回退读取 Web 服务器的 `APP_DATA_DIR`。

方舟人物参考图预检的资产图和 `gen_*` 设计媒体读取也统一使用同一 Go Blob；远端缺失或读取失败保持既有 `check_failed`/空结果语义，不回退服务器本地文件。

HTTP 视频 Provider 对需要 API Key 才能下载的结果，不把密钥或本地路径写入 generation 记录。Web 实例完成鉴权下载后先写入不可猜测的 `video-provider-results/{resultId}` Go 临时 Blob，generation 只保存 `remote-blob:` 内部引用；统一转存层再次校验大小、MIME、HTML/JSON 伪响应、MP4 `ftyp` 结构和禁用占位哈希，再写最终 `workflow-assets/{assetId}` Blob，并在成功后删除临时 Blob。远端模式不创建 `generated-videos` 文件。

- 保持 `VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`TEXT_LLM_PROVIDER=mock`。
- 日志不得记录密码、Token、API Key、Cookie、请求正文或用户内容。远端模式的视频出站诊断只向 stdout 输出单行脱敏 JSON 元数据；本地开发模式仍兼容隔离目录下的 TXT 调试日志。
- 测试必须把 `APP_DATA_DIR` 指向独立临时目录。
- Smoke 使用非 `3000` 端口，不停止或复用用户的 `:3000` 服务。

文本生成积分账户也已迁移为远端文档：用户账户保存余额、流水与活动预留，generation 预留使用独立文档；预扣和结算均通过两文档 revision CAS 原子事务执行，多实例并发不会超扣，重复预留、重复结算和退款保持幂等，远端模式不创建 `credits.json`。

本机一次性付费测试 guard 在远端模式由 Go `/v1/local-paid-test-guard` 管理，并保存为 `local-paid-test-guard/{live|simulation}` revision CAS 文档；Web 不再直接操作 Guard 通用文档，也不会创建本地 guard JSON。Go 负责 arm、提交中、Provider 已接单、转存待处理、完成、提交前失败、未知结果和已消费状态转换；并发旧版本写入会安全拒绝，不会覆盖已进入提交状态的记录。记录只包含状态、generation/task 标识、请求指纹和 arm nonce 哈希，不保存原始 nonce、token、API Key、提示词或 URL。此迁移不改变任何付费开关或门禁，默认仍是 `ALLOW_PAID_GENERATION=false`。
> BLOB STORAGE UPDATE: read docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md. New production binary bytes use the independent internal blobstore; PostgreSQL stores metadata and retains legacy bytea compatibility only.


## 2026-08-02 ????????

- Next.js Web ? Go ?????????? Web ??? `GO_BACKEND_INTERNAL_URL` ? `INTERNAL_API_TOKEN` ???? Go API?
- ????????????AI ???????????????????????????????????? `/v1/*` API??????????? `/v1/documents` ??? 0?
- Go ? PostgreSQL ?????????SSDB ???????????????????? Blobstore ???
- ?? Web ??????SSDB ?????????????? `scripts/validate-production-web-env.mjs` ??????????????
- `deploy/compose.remote.yml` ?? Web ???????Go?PostgreSQL?SSDB?Blobstore ??? internal network???????? root ????????????? `tmpfs`?
- Next.js ?? standalone ??????? `tsconfig.build.json` ?????????????????????
- `npm run architecture:check` ?????????????Web ??????????????????????????????
- ???????????`VIDEO_PROVIDER=mock`?`ALLOW_PAID_GENERATION=false`?`TEXT_LLM_PROVIDER=mock`???????????????????????????????????
- ??????? 183 ?????? 1082 ????????? TypeScript?Next.js ?????Go `test`/`vet`??? Compose ?????


## Current acceptance boundary

The remote-only architecture is enforced for production Web: Next.js keeps authentication, authorization, request validation, response shaping, and calls to dedicated Go APIs. PostgreSQL is the source of truth, SSDB is cache-only, production Web rejects direct database, cache, local-file, blobstore, OSS, S3, and MinIO configuration, and the remote Compose deployment keeps data services on the internal network.

The browser video metadata write-back command is implemented in Go at POST /v1/video-generations/browser-metadata. It validates generation and asset identity, generated-video MIME, browser metadata, idempotency, revision CAS, and cache invalidation. The generation idempotency reconciliation command is implemented in Go at POST /v1/video-generation-idempotency/reconcile; it never replays a Provider request and atomically repairs the idempotency and generation documents when required. The corresponding Next routes are BFFs only and sanitize remote video URLs before returning data to clients.

The target architecture is not yet fully complete. The main generation submission path, polling/status refresh, cancellation, retry, transfer, storyboard video generation, text generation execution, character/scene generation, and some asset-generation paths still contain Next.js orchestration. Moving those paths requires first implementing the Go equivalent of the existing encrypted model-connection format (enc:v1:, AES-256-GCM) and preserving each Provider request, response, cancellation, transfer, and safe-default behavior. Until that work is complete, this document must not be read as claiming that all business orchestration has moved to Go.
