# Mock 完整端到端人工验收清单（阶段 3D-A）

本清单用于浏览器人工验收 Mock 全链路。不含密钥、用户素材、运行时任务数据或本机绝对路径。

**阶段状态：3D-A 已完成；浏览器人工验收已通过。**

自动化测试数量以 Vitest 为准：**138** 项（0 skipped / 0 todo）。

前置：

- `VIDEO_PROVIDER=mock`（默认）
- `ALLOW_PAID_GENERATION=false`（默认）
- 已按 `docs/mock-video-setup.md` 配置可播放 Mock 源
- `npm run dev` 已启动

## 实现语义备忘

| 项 | 说明 |
|---|---|
| 防连点 | `submittingRef` 同步锁 + 确认按钮 `submitting` 禁用 |
| 幂等键 | 确认会话内稳定；`crypto.randomUUID()`；业务失败后可重新开确认再试；网络异常可短时保留键 |
| 服务端幂等 | Provider 提交前登记；进程内 Map ≈8s；**非生产级防重复计费** |
| 转存幂等 | 已有合法 generatedVideo 不重复复制；单进程 `transferInFlight`；多实例需共享锁 |
| completed | 须 localVideoAssetId + resultAsset + id 一致 + generatedVideo + 合法 MIME + sizeBytes>0 |
| retry 生成 | 新 generationId / 新幂等键 / 最新工作流；与 retryTransfer 不同 |
| Undo/Redo | **尚未实现** |

## A. 成功主路径（已通过）

1. 打开或创建项目。
2. 创建角色 / 场景 / 图片节点并上传素材。
3. 创建视频镜头并连接素材。
4. auto ≤ 上限时使用全部合法素材。
5. 设置说明、分辨率、比例、时长。
6. 确认抽屉显示最终素材、顺序、excluded、首帧、Mock 提示。
7. 运行 Mock；进度文案含 `Mock ·`。
8. completed 后播放 / 下载 MP4。
9. Range：200 / 206。
10. metadata PATCH；参数对照 requested / provider / actual；mockOnly。
11. 刷新后节点、选择、任务、actual 恢复。
12. Console 无红错；无阿里云 / 付费请求。

## B. 超限与手动选择（已通过）

- auto 超限阻止且不静默截断；manual 勾选与顺序；空数组不回退 auto。

## C. 取消 / 重试 / 防连点（已通过）

- 连续快速点击不创建重复任务。
- queued 可取消；processing 不伪装取消成功。
- 明确重新生成开新确认会话与新幂等键。
- resultTransferFailed 可重试转存（非重新生成 Provider）。

## D. 明确不在本阶段

- 真实阿里云 / 付费
- 全局 Undo/Redo
- 生产对象存储与生产级幂等

## 下一阶段

真实 Provider 启用前安全审计。
