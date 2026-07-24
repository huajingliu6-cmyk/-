# 阿里云百炼 · 万相 2.7 视频 Provider

本项目阶段 1 接入说明。默认使用 Mock，**不会自动发起付费请求**。

## 支持的模式

| 模式 | 模型环境变量 | 何时选用 |
|---|---|---|
| 文生视频 (T2V) | `WAN_T2V_MODEL_ID` | 无参考图 / 参考视频 / 首帧 |
| 参考生视频 (R2V) | `WAN_R2V_MODEL_ID` | 存在任一参考图、参考视频或首帧 |

模式由服务端 `selectWanGenerationMode` 判定，客户端不能绕过。

## 环境变量

见仓库根目录 `.env.example`：

- `VIDEO_PROVIDER=mock`（默认）或 `aliyun-wan27`
- `ALLOW_PAID_GENERATION=false`（默认必须为 false）
- `DASHSCOPE_API_KEY`（仅服务端）
- `DASHSCOPE_WORKSPACE_ID`（仅服务端）
- `DASHSCOPE_REGION=cn-beijing` 或 `ap-southeast-1`
- `WAN_T2V_MODEL_ID` / `WAN_R2V_MODEL_ID`

**禁止**使用 `NEXT_PUBLIC_` 暴露 API Key。浏览器不得传入 Endpoint。

## 北京与新加坡地域

官方要求：**模型、Endpoint、API Key 必须同一地域**。

- 北京：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`
- 新加坡：`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`

Workspace ID 可在阿里云百炼控制台「业务空间」详情页查看。

## 如何配置 API Key（仅服务端）

1. 在百炼控制台创建 API Key（与目标地域一致）。
2. 写入本机 `.env.local`（已被 gitignore），**不要提交**。
3. 重启 `npm run dev`。
4. 确认页面「生成确认」抽屉显示密钥已配置（不展示明文）。

## 分辨率 / 比例 / 时长（官方文档基线）

- 分辨率：`720P`、`1080P`
- 比例：`16:9`、`9:16`、`1:1`、`4:3`、`3:4`
- 时长：
  - 文生视频：2–15 秒整数
  - 参考生视频（无参考视频）：2–15 秒
  - 参考生视频（含参考视频）：2–10 秒

像素映射见 `src/video-generation/dimensions.ts`（与官方表格一致）。

## 首帧与比例

存在 `first_frame` 时：

- 请求 **不发送** `ratio`
- UI 禁用比例选择
- 提示：「已连接首帧，视频比例将根据首帧图片自动确定」

## 参考素材限制

- `reference_image` + `reference_video` ≤ 5
- `first_frame` ≤ 1
- 参考生视频至少需要 1 个 reference_image 或 reference_video
- **不得静默截断**；超过限制时禁止提交并在确认面板列出素材

## 费用与输出 URL

- 真实调用按秒计费，请在百炼控制台查看[模型价格](https://help.aliyun.com/zh/model-studio/models)。
- 成功返回的 `video_url` **约 24 小时有效**，服务端会立即转存。

## 开发环境转存

成功后下载到 `data/generated-videos/`（已 gitignore），并登记 `generatedVideo` 资产。

**仅适合本地开发。** 生产环境必须改为 OSS / 对象存储。

## 切回 Mock

```env
VIDEO_PROVIDER=mock
ALLOW_PAID_GENERATION=false
```

## 首次付费测试（必须人工执行）

本仓库的自动测试与 Cursor 代理 **禁止** 将 `ALLOW_PAID_GENERATION` 设为 true，也禁止联网生成。

人工步骤：

1. 配置同一地域的 Key / Workspace / Region。
2. 手动将 `.env.local` 中 `VIDEO_PROVIDER=aliyun-wan27` 与 `ALLOW_PAID_GENERATION=true`。
3. 重启服务。
4. 在生成确认抽屉点击「确认付费生成」。
5. 测完后立刻改回 `ALLOW_PAID_GENERATION=false` 与 `VIDEO_PROVIDER=mock`。

## 异步接口

- 创建：`POST /api/v1/services/aigc/video-generation/video-synthesis`（`X-DashScope-Async: enable`）
- 查询：`GET /api/v1/tasks/{task_id}`
- 取消：`POST /api/v1/tasks/{task_id}/cancel`（仅 PENDING）

本应用封装为：

- `POST /api/generations`
- `GET /api/generations/[id]`
- `POST /api/generations/[id]/cancel`
- `POST /api/generations/[id]/retry`
- `POST /api/generations/[id]/transfer`
