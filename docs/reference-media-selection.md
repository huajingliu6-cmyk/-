# 参考素材选择

本文说明视频生成前参考素材的候选收集、自动/手动选择、发送顺序、选择面板与服务端校验。不含密钥、用户素材或本机绝对路径。

## 数据模型

`VideoShotNode.data`：

| 字段 | 含义 |
|------|------|
| `referenceSelectionMode` | `"auto"` \| `"manual"` |
| `selectedReferenceAssetIds` | 手动模式下的选择与发送顺序（Provider / Prompt 图N·视频N 的唯一顺序来源） |

WorkflowDocument **version = 4**。

## 阶段 3C-B（已完成）

浏览器人工验收已通过。UI 复用 3C-A 领域函数，不另造候选收集或选择算法。

### Drawer 入口

1. `VideoShotNode` — 紧凑摘要（由选中后的 `VideoPromptPanel` 回写）
2. `VideoPromptPanel` — 「管理参考素材」
3. `GenerationConfirmationDrawer` — 选择未完成时跳转管理

组件：`ReferenceMediaSelectionDrawer`

组装：`prepareReferenceMediaSelectionBundle` → `collectReferenceMediaCandidates` / `resolveFirstFrame` / `resolveReferenceMediaSelection` / `buildReferenceMediaSelectionView`

### 草稿语义

- 打开时只初始化一次：`draftMode` + `draftSelectedIds`（`key` 会话挂载，非 effect 持续复制 props）
- 勾选 / 上移下移只改草稿
- **取消**：不修改 WorkflowDocument / Store
- **保存**：调用 `setReferenceMediaSelection`（mode + IDs 一次写入）
- 不在每次勾选时写 WorkflowDocument
- 节点切换时关闭 Drawer，旧草稿不写入其他节点
- 后台自动保存响应不覆盖正在编辑的草稿（草稿为组件本地状态）

### 自动模式 UI

- `eligibleCount <= limit`：显示「已自动选择全部 N 项」；**不**把自动结果写入 `selectedReferenceAssetIds`
- `eligibleCount > limit`：**不**显示已选前 M 项；`canGenerate=false`；要求切换 manual
- 从超限 auto 切 manual：**不**擅自勾选前 limit 项（草稿可为空）
- 无 `slice(0, limit)` 或等价静默截断

### 手动模式 UI

- `draftSelectedIds` 顺序 = 发送顺序；空数组保持为空，**不**回退 auto
- 新候选不会自动加入已有 manual 选择
- 达上限后未选项禁用，已选项可取消；不可用不可勾选
- 池外 / 断开 ID 在「失效选择」区显示，阻止保存/生成；「移除失效项」为明确用户操作

### 发送顺序

- 上移 / 下移只改草稿（无拖拽库）；首项不可上移、末项不可下移
- 分组列表仅浏览；「发送顺序」区为最终顺序来源
- UI **不**按角色/场景/图片重排最终发送列表
- 保存后 `selectedReferenceAssetIds` 顺序即 Provider 顺序；刷新后恢复

### 首帧

- 独立区域；不进普通 checkbox；不进 `selectedReferenceAssetIds`；不计入普通 selectedCount
- 受 `maxFirstFrames`；多首帧阻止生成
- 显示「首帧不占普通参考素材名额」「画面比例将由首帧决定」
- 不改变阶段 3B `requestedAspectRatio=null`（有首帧时）语义

### capability 缺失

- 文案：「模型能力尚未加载，暂时无法确认参考素材上限。」
- 禁止保存选择与生成
- UI **不**写死模型上限；**不**用 fallback `5` 作权威上限

### 生成确认抽屉

- 只展示最终 resolved selected 与发送顺序、excluded 及原因、首帧独立区
- 选择未完成时确认禁用，并提供管理入口
- 确认时不改 selected IDs、不静默 slice；改选择后重开显示最新结果

### Store / Undo

- `setReferenceMediaSelection(nodeId, mode, ids)`：原子一次 `updateNodeData` → 一次 `contentEpoch`
- **不**直接 mutate `node.data`；Store **不**写死模型上限
- **全局 Undo/Redo 尚未实现**（工具栏按钮仍为占位）；本阶段**不**提供仅素材选择用的伪 Undo/Redo，也**不**宣称已支持 Undo/Redo

## 候选与领域语义（3C-A）

纯函数：`collectReferenceMediaCandidates` / `resolveReferenceMediaSelection` / `resolveFirstFrame`。
auto 不以 selected 为权威；manual 空数组≠auto；超限不静默截断。服务端权威仍是最新 WorkflowDocument。

## 展示用截断说明

节点卡片上 `attachedAssetIds.slice(0, 4)` 等 **仅用于缩略图展示**，不是生成选择截断。

## 测试

- `src/workflow/__tests__/reference-media-selection-ui.test.ts`（view / draft / store）
- `src/workflow/__tests__/connection-rules.test.ts`（多参考边合法、反向连接禁止等）
- 全量自动化测试当前 **124** 项；浏览器交互以人工验收为准

## 下一阶段

Mock 完整端到端验收与真实 Provider 启用前安全审计。
