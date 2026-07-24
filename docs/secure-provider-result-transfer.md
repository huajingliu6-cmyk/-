# 真实 Provider 结果安全转存（SSRF 防护）

本文说明 Mock 与真实万相结果转存的隔离、HTTPS / 域名白名单、私网拦截、DNS 与重定向校验、下载限制与 URL 脱敏。不含密钥、签名 URL、本机路径或用户素材。

## Mock 与真实 Provider 分支

转存来源由服务端根据 `GenerationRecord` 派生 `TransferSource`，**禁止**仅根据 URL scheme 自动判定：

| kind | providerId | 条件 |
|------|------------|------|
| `mockFile` | `mock` | `isMock=true` 且 URL 为 `file://` |
| `providerHttps` | `aliyun-wan27` | `isMock=false` 且非 `file://` |

- Mock 只能走本地 `data/generated-videos` 目录边界内的中间文件。
- 真实 Provider **不能**使用 `file://`。
- Mock **不能**用任意 http/https 绕过目录限制。
- 客户端不能构造 `TransferSource`，也不能提交 `remoteVideoUrl`。

## HTTPS 与域名白名单

环境变量（仅服务端）：

```bash
WAN_RESULT_ALLOWED_HOSTS=
```

- 逗号分隔。
- 普通主机名：精确匹配。
- 以 `.` 或 `*.` 开头：后缀规则（`host === base` 或 `host.endsWith("." + base)`），防止 `trusted.example.com.attacker.com` 一类绕过。
- **默认空**：真实结果转存被阻止，错误码 `RESULT_HOST_ALLOWLIST_NOT_CONFIGURED`。
- 禁止 `*` / 任意域名。
- 浏览器不可读该变量。

官方文档说明：结果为临时 OSS URL，**不保证固定域名白名单**（存储可能随业务变更）。因此本仓库不硬编码默认域名；首次人工调用后由管理员确认主机名再写入 `.env.local`。

## 私网与保留 IP

解析到的**全部**地址必须为公网。拒绝包括但不限于：

- IPv4：环回、私网、链路本地、CGNAT、组播、保留、文档网段、云元数据常见地址段
- IPv6：`::`、`::1`、ULA、链路本地、组播、文档、IPv4-mapped 私网等

hostname 本身为 IP 时同样检查。任一私网地址 → 拒绝整个下载。

## DNS 与连接验证

1. 先解析全部 A/AAAA。
2. 校验全部为公网。
3. 使用 Node `https.request` 的 **custom lookup**，只把已验证地址交给连接层。
4. 保留 `rejectUnauthorized` 与 SNI（`servername`），不跳过证书校验。

残余风险：若运行时或依赖在未走 custom lookup 的路径上再次解析，仍可能存在理论 rebinding 窗口。当前实现要求真实下载必须经 `safeDownloadProviderVideoToTempFile`；**不宣称达到绝对生产级零风险 SSRF**，但显著高于默认 `fetch` 跟随重定向。

## 重定向

- 禁止自动跟随；最多 3 次。
- 每一跳重新：协议 / allowlist / DNS+IP。
- 拒绝 http、localhost、私网、白名单外域名、循环、缺少 Location、超限。

## 下载大小与超时

- `MAX_PROVIDER_VIDEO_BYTES` = 200MB
- 整体超时与连接超时均有明确常量
- Content-Length 超限在读 body 前拒绝；chunked 累计超限立即中止
- 失败删除临时文件，不创建 `generatedVideo` AssetRecord，状态 `resultTransferFailed`

## MIME 与 MP4 结构

- 接受 `video/mp4`
- `application/octet-stream` 仅在 ftyp 基础结构检查通过时可接受（官方 CDN 可能返回）
- 拒绝 HTML / JSON / XML / text
- 检查文件头 ftyp；不以扩展名为准

## URL 日志与 API 脱敏

- `redactRemoteUrlForLogs`：去掉 query / fragment
- 服务端 GenerationRecord JSON **可**保留完整 `remoteVideoUrl` 供转存重试（签名 URL 为敏感数据）
- 面向客户端 API 返回 `remoteVideoUrl: null` + `hasRemoteVideo` + `remoteVideoSummary`
- 不写入 WorkflowDocument

## 结构化错误（节选）

`RESULT_HOST_ALLOWLIST_NOT_CONFIGURED`、`RESULT_URL_PROTOCOL_NOT_ALLOWED`、`RESULT_HOST_NOT_ALLOWED`、`RESULT_PRIVATE_ADDRESS_BLOCKED`、`RESULT_DNS_RESOLUTION_FAILED`、`RESULT_REDIRECT_NOT_ALLOWED`、`RESULT_TOO_MANY_REDIRECTS`、`RESULT_DOWNLOAD_TIMEOUT`、`RESULT_FILE_TOO_LARGE`、`RESULT_CONTENT_TYPE_INVALID`、`RESULT_CONTENT_LENGTH_MISMATCH`、`RESULT_VIDEO_STRUCTURE_INVALID`、`TRANSFER_SOURCE_MISMATCH`

## 测试

自动化测试注入 DNS / HTTP transport，**不访问真实互联网**。阶段 3D-B3：**186** 项（Vitest；0 skipped / 0 todo）。

浏览器 Mock 回归已通过：生成、转存、播放、下载、Range、metadata、参数对照；`file://` 分支正常；API 不暴露完整 `remoteVideoUrl`。

## 付费开关

当前 **仍不允许** `ALLOW_PAID_GENERATION=true`。SSRF 转存加固是启用真实 Provider 的必要前提之一，但持久幂等、用户所有权、限流预算等尚未完成。

## 下一阶段

持久幂等与 Provider 任务原子性（3D-B1）。本阶段不开启 `ALLOW_PAID_GENERATION`。
