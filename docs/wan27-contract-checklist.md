# 万相 2.7 官方契约核对清单（阶段 3D-B6-A）

**核对日期**：2026-07-25（本机系统日期）
**适用地域**：华北2（北京）、新加坡
**适用模型**：`wan2.7-t2v-2026-06-12`、`wan2.7-r2v-2026-06-12`
**本阶段未调用真实接口、未产生费用。**

## 官方资料（仅官方）

| 文档标题 | URL / 名称 | 是否属万相 2.7 当前协议 |
|---|---|---|
| 万相2.7文生视频API参考 | https://help.aliyun.com/zh/model-studio/text-to-video-api-reference | 是 |
| 万相2.7-参考生视频-API参考 | https://help.aliyun.com/zh/model-studio/wan-video-to-video-api-reference | 是 |
| 如何查询和取消异步任务 | https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks | 是（通用异步任务） |
| 错误码 | https://help.aliyun.com/zh/model-studio/error-code | 是（百炼通用） |
| 模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 是（价格可能变化） |

## 契约矩阵

| 契约项目 | 当前代码 | 官方文档 | 状态 | 代码位置 | 处理结论 |
|---|---|---|---|---|---|
| 1. 北京 Endpoint | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com` | 同左 | 一致 | `provider/config.ts` `buildDashScopeBaseUrl` | 保持 |
| 2. 新加坡 Endpoint | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` | 同左 | 一致 | 同上 | 保持 |
| 3. Workspace ID 使用位置 | 仅服务端拼 Endpoint 主机名 | 业务空间专属域名中的 `{WorkspaceId}` | 一致 | `config.ts` | 客户端不可指定 |
| 4. API Key 与 Workspace 地域一致性 | 文档与配置校验提示；错误映射含地域不一致 | 必须同一地域 | 一致 | `assertAliyunConfigReady` / error-map | 人工确认 |
| 5. Authorization Header | `Bearer ${apiKey}` | Bearer API Key | 一致 | `aliyun-wan27-provider.ts` | 仅服务端 |
| 6. Content-Type | `application/json` | 必选 application/json | 一致 | 同上 | 保持 |
| 7. X-DashScope-Async | 创建任务固定 `enable` | HTTP 仅支持异步，必须 enable | 一致 | 同上 | 测试覆盖 |
| 8. 文生视频模型 ID | 默认 `wan2.7-t2v-2026-06-12` | 同左（亦有别名 wan2.7-t2v） | 一致 | `.env.example` / config | 以 env 为准 |
| 9. 参考生视频模型 ID | 默认 `wan2.7-r2v-2026-06-12` | 同左 | 一致 | 同上 | 以 env 为准 |
| 10. 创建任务路径 | `/api/v1/services/aigc/video-generation/video-synthesis` | 同左 | 一致 | `wan27-constants.ts` | 保持 |
| 11. 查询任务路径 | `GET /api/v1/tasks/{task_id}` | 同左 | 一致 | provider | 保持 |
| 12. 取消任务路径 | `POST /api/v1/tasks/{task_id}/cancel` | 同左 | 一致 | provider | 保持 |
| 13. 取消允许状态 | 仅 `PENDING` | 仅 PENDING | 一致 | `cancellationStatuses` | 保持 |
| 14. model 字段 | 来自服务端 capability.modelId | 必选 | 一致 | `build-wan27-request.ts` | 客户端不可覆盖 |
| 15. prompt 字段 | `input.prompt` | 必选；T2V/R2V ≤5000 字符 | 一致 | 同上 | 超长由官方截断；本地可再校验 |
| 16. negative_prompt | 可选 | 可选；≤500 字符 | 一致 | 同上 | 保持 |
| 17. resolution | `720P` / `1080P`（无 size） | 同左；默认 1080P | 一致 | parameters | **不得使用旧 size** |
| 18. ratio | 五档；有首帧时不发送 | 同左；有首帧忽略 ratio | 一致 | build + UI | 保持 |
| 19. duration | T2V 2–15；R2V 无参考视频 2–15；有参考视频 2–10 | 同左；默认 5 | 一致 | model-capabilities / validate | 保持 |
| 20. prompt_extend | boolean | 可选；默认 true | 一致 | parameters | 保持 |
| 21. watermark | boolean | 可选；默认 false | 一致 | parameters | 保持 |
| 22. seed | 可选 integer | `[0, 2147483647]` | 一致 | parameters | 范围校验在设置层 |
| 23. 首帧存在时比例规则 | 不发送 ratio | 自动忽略 ratio | 一致 | buildWan27Request | 保持 |
| 24. 参考图片数量限制 | 图+视频 ≤5；至少 1 | 同左 | 一致 | validate-settings | 保持 |
| 25. 参考视频数量限制 | 计入 ≤5；影响最大时长 | 同左 | 一致 | 同上 | 保持 |
| 26. 音频或音色参考规则 | R2V `reference_voice` 已支持；T2V `audio_url` **当前未实现** | T2V 可选 audio_url；R2V 可选 reference_voice | 当前未实现（T2V audio_url） | build-wan27-request | 首次试跑不使用音频 |
| 27. 参考视频存在时最大时长 | 10 秒 | 同左 | 一致 | maxDurationWithReferenceVideoSeconds | 保持 |
| 28. 创建响应 task_id | Schema 校验；缺失安全失败 | 必返回 task_id | 一致 | wan27-response-schema | 已加固 |
| 29. PENDING | → queued | 排队中 | 一致 | mapTaskStatus | 保持 |
| 30. RUNNING | → processing | 处理中 | 一致 | 同上 | 保持 |
| 31. SUCCEEDED | → downloading（再转存） | 成功含 video_url | 一致 | 同上 | 保持 |
| 32. FAILED | → failed | 失败 | 一致 | 同上 | 保持 |
| 33. CANCELED | → cancelled（亦接受 CANCELLED） | CANCELED | 一致 | 同上 | 保持 |
| 34. UNKNOWN | → failed；不新建任务 | 不存在或过期 | 一致 | 同上 + error-map | 保持 |
| 35. 成功结果 video_url | 读取 output.video_url | 仅 SUCCEEDED | 一致 | getGenerationStatus | 经 SSRF 转存 |
| 36. usage 参数 | SR / ratio / output_video_duration / duration | T2V/R2V 文档字段 | 一致 | provider | R2V 另有 input_video_duration |
| 37. task_id 有效期 | 文档与错误提示 24h | 24 小时 | 一致 | constants / error-map | 保持 |
| 38. 结果 URL 有效期 | 约 24h；立即转存 | 24 小时 | 一致 | model-capabilities | 保持 |
| 39. 官方推荐轮询间隔 | 真实 Provider **15s**；Mock 3.5s | 建议约 15 秒 | 已修复 | public config + VideoPromptPanel | 对齐官方 |
| 40. 查询接口频率限制 | 文档记录 RPS=20 | 默认 RPS 20 | 一致 | wan27-constants | 15s 轮询远低于限制 |
| 41. 请求失败是否计费 | 文档：创建失败见错误码；成功按秒计费 | 以官方计费说明为准 | 未确认（细则） | 文档 | 不硬编码计费逻辑 |
| 42. 当前价格和免费额度 | 见下方价格摘录；**可能变化** | 模型价格页 | 一致（核对日） | 仅文档 | **不写入业务代码** |

## 价格核对摘录（2026-07-25，可能变化）

来源：官方「模型价格」页 · 万相-文生视频 / 参考生视频（华北2 北京）：

| 模型 | 分辨率 | 单价（北京） | 免费额度说明 |
|---|---|---|---|
| wan2.7-t2v-2026-06-12 | 720P | 0.6 元/秒 | 50 秒（仅北京有免费额度说明） |
| wan2.7-t2v-2026-06-12 | 1080P | 1 元/秒 | 同上页 |
| wan2.7-r2v-2026-06-12 | 720P | 0.6 元/秒 | 50 秒 |
| wan2.7-r2v-2026-06-12 | 1080P | 1 元/秒 | 同上页 |

新加坡国际价更高。UI 只显示：`预计费用请以阿里云百炼当前价格和控制台实际结算为准。`

最低成本试跑估算（仅文档）：北京 · T2V · 720P · 2 秒 → 约 **1.2 元**（若无免费额度可用）；**以测试当天控制台为准**。

## 未确认 / 未实现

- T2V `audio_url` 请求字段：当前未实现（首次试跑不使用）。
- 请求失败在何种边界是否计费：以控制台账单为准，代码不猜测。
- 结果视频 OSS 固定域名：官方不承诺；allowlist 默认空。

## 本阶段交付

- Provider Readiness Report（不联网；`readyForPaidSubmission` 恒 false）
- Dry Run 脱敏摘要（不联网、不创建 generation）
- 错误码中文映射扩展
- 响应 Schema 校验
- 首次最低成本测试文档：`docs/wan27-first-paid-test.md`
