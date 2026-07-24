# 阿里云百炼 · 万相 2.7 视频 Provider

本项目接入说明。默认使用 Mock，**不会自动发起付费请求**。

官方契约核对日期：**2026-07-25**。详见 `docs/wan27-contract-checklist.md`。

## 支持的模式

| 模式 | 模型环境变量 | 何时选用 |
|---|---|---|
| 文生视频 (T2V) | `WAN_T2V_MODEL_ID` | 无参考图 / 参考视频 / 首帧 |
| 参考生视频 (R2V) | `WAN_R2V_MODEL_ID` | 存在任一参考图、参考视频或首帧 |

模式由服务端 `selectWanGenerationMode` 判定，客户端不能绕过。
默认模型 ID：`wan2.7-t2v-2026-06-12` / `wan2.7-r2v-2026-06-12`。

## 环境变量

见仓库根目录 `.env.example`：

- `VIDEO_PROVIDER=mock`（默认）或 `aliyun-wan27`
- `ALLOW_PAID_GENERATION=false`（默认必须为 false）
- `DASHSCOPE_API_KEY`（仅服务端）
- `DASHSCOPE_WORKSPACE_ID`（仅服务端）
- `DASHSCOPE_REGION=cn-beijing` 或 `ap-southeast-1`
- `WAN_T2V_MODEL_ID` / `WAN_R2V_MODEL_ID`
- `WAN_RESULT_ALLOWED_HOSTS`（仅服务端；默认空）

**禁止**使用 `NEXT_PUBLIC_` 暴露 API Key。浏览器不得传入 Endpoint。

## 北京与新加坡地域

官方要求：**模型、Endpoint、API Key 必须同一地域**。

- 北京：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`
- 新加坡：`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`

## 请求契约要点

- Header：`Authorization: Bearer …`、`Content-Type: application/json`、创建时 `X-DashScope-Async: enable`
- 使用 `resolution` + `ratio`，**不使用**旧版 `size`
- 有首帧时不发送 `ratio`
- 响应经 Zod Schema 校验；缺 `task_id` / 非 JSON → 安全失败
- 错误经 `mapWan27ProviderError` 转为中文；不回传完整 Provider 响应或密钥

## 分辨率 / 比例 / 时长

- 分辨率：`720P`、`1080P`
- 比例：`16:9`、`9:16`、`1:1`、`4:3`、`3:4`
- 时长：T2V 2–15；R2V 无参考视频 2–15；含参考视频 2–10

像素映射见 `src/video-generation/dimensions.ts`。

## 状态与轮询

| 官方 | 应用 |
|---|---|
| PENDING | queued |
| RUNNING | processing |
| SUCCEEDED | downloading → 转存 → completed |
| FAILED | failed |
| CANCELED | cancelled |
| UNKNOWN | failed（不自动新建任务） |

- 真实 Provider 客户端轮询约 **15 秒**（官方建议）
- Mock 约 3.5 秒
- 页面离开停止轮询；恢复后继续查同一任务
- 取消仅 PENDING；查询接口官方默认 RPS 20

## Readiness 与 Dry Run

- `buildWan27ProviderReadinessReport()`：不联网；检查 mock/付费门闩/密钥布尔/地域/模型/allowlist/幂等/SSRF 等。
  **本阶段 `readyForPaidSubmission` 恒为 `false`**
- `buildWan27DryRunPreview()`：脱敏请求摘要；不创建任务、不产生费用
- `GET /api/generations` 返回 `readiness`（打开页面不创建任务）

## 费用

- **不要**把单价硬编码进业务代码
- UI：`预计费用请以阿里云百炼当前价格和控制台实际结算为准。`
- 价格页名称：模型价格（大模型服务平台百炼）
- 2026-07-25 摘录（可能变化）：北京 T2V 720P **0.6 元/秒**，1080P **1 元/秒**；免费额度说明见官方页（北京曾列 50 秒）

## 结果 URL 与 allowlist

- `video_url` 约 24 小时有效；成功后立即转存
- 官方不保证固定 OSS 域名 → `WAN_RESULT_ALLOWED_HOSTS` 默认空
- 首次域名审批与 `retryTransfer`：见 `docs/wan27-first-paid-test.md`、`docs/secure-provider-result-transfer.md`

## 切回 Mock

```env
VIDEO_PROVIDER=mock
ALLOW_PAID_GENERATION=false
```

## 首次付费测试

见 `docs/wan27-first-paid-test.md`。**3D-B6-A 只准备文档，不执行付费。**

## 异步接口（百炼）与本应用封装

百炼：

- 创建：`POST …/video-synthesis`
- 查询：`GET …/tasks/{task_id}`
- 取消：`POST …/tasks/{task_id}/cancel`

本应用：

- `POST /api/generations`
- `GET /api/generations`（config + capabilities + readiness）
- `GET /api/generations/[id]`
- `POST /api/generations/[id]/cancel`
- `POST /api/generations/[id]/retry`（新任务，可能重新计费）
- `POST /api/generations/[id]/transfer`（仅转存，不调 Provider）
- `POST /api/generations/[id]/reconcile`（仅对账）
