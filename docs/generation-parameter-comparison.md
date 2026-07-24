# 生成参数对照（requested / provider / actual）

本文说明视频结果界面中三组参数的含义与展示规则。仅用于开发与验收说明，不含密钥或本机路径。

## 三组参数

| 列 | 含义 | 数据来源（只读） |
|---|---|---|
| 用户请求 | 用户确认提交时选择的参数 | `requestedResolution` / `requestedAspectRatio` / `requestedDurationSeconds` |
| Provider 返回 | 远端任务状态中带回的参数 | `providerResolution` / `providerAspectRatio` / `providerDurationSeconds` |
| 实际视频文件 | 本地成片实测 | `actualWidth`×`actualHeight`（比例由 `classifyVideoAspectRatio` 计算）、`actualDurationSeconds` |

**禁止**用 requested 填充 provider 或 actual，也禁止用 provider 填充 actual。

对照视图由纯函数 `buildGenerationParameterComparisonView` 派生，**不持久化**到 GenerationRecord。

## 缺失值显示

- 请求缺失：`未记录请求参数`
- Mock 且 Provider 无字段：`Mock 未提供真实 Provider 参数`
- Mock 且字段为回显：`Mock 参数回显，非真实 Provider 返回`
- 真实任务 Provider 缺失：`Provider 未返回`
- 实际未读到：`等待读取实际视频文件`
- 实际无效：`实际视频参数读取失败`

不得向用户展示 `undefined` / `null` / `NaN` / `0 × 0` / `0 秒`。

## Mock 规则

Mock 结果顶部提示：

> Mock 结果只用于验证应用流程、视频播放和参数记录，不代表真实视频模型会按照这些参数生成。

- `overallStatus` **始终**为 `mockOnly`
- 即使实际文件碰巧与请求一致，也只能表述为「Mock 流程记录一致」
- 不得出现「万相参数验证通过」「真实模型支持」「Provider 输出一致」等措辞

## 时长容差

常量：`DURATION_COMPARISON_TOLERANCE_SECONDS = 0.35`

用于编码与容器时长的小数偏差（例如 5 与 5.02）。明显偏差（如 5.8）必须判为不一致。页面仍显示精确实际时长（最多三位小数）。

## 首帧比例

当 `requestedAspectRatio === null`（有首帧、比例由首帧决定）：

- 请求比例列标记为「不适用」
- 不因请求比例缺失判为 mismatch
- 文案：`已使用首帧，画面比例由首帧决定`

## 元数据来源

- `browser`：浏览器读取，非服务端可信验证
- `provider`：Provider 返回
- `server`：服务端读取
- `none`：尚未验证

## 真实 Provider 验收（人工）

1. 保持 `ALLOW_PAID_GENERATION=false` 与 `VIDEO_PROVIDER=mock` 为日常默认。
2. 仅在人工需要时临时切换真实 Provider（禁止 Agent 自动付费）。
3. 在结果 Drawer 核对三列与差异说明；关闭 Drawer 后播放应停止。
4. 测完立刻改回 mock / 禁止付费。
