# InfiniteCanvas 迭代交接单

> 更新时间：2026-08-29  
> 分支：`feat/react-flow-migration`（已推送 `origin`）  
> 版本标签：`V0.46`（内部通道 web 镜像 `deploy-web:V0.46`）
> 基线提交：见本 tag 指向的 commit  
> 远程：`https://github.com/huajingliu6-cmyk/-.git`

---

## 1. 给新 Agent 的一句话指令

> 阅读本文件；**确认 Docker Desktop 已运行**；执行 `.\deploy\start-lan.ps1 -ForceRecreate` 拉起内部通道；`.\deploy\check-lan.ps1` 通过后验收。  
> 分镜提示词生成已改为「仅时长/完整性硬阻断」，人物/资产/站位等问题只出 warning、仍写入提示词。历史 `generationError` 不会自动消失，需用户点击「重新生成分镜提示词」验证。

---

## 2. 本轮已完成（已提交 `36ac84f`）

### 2.1 分镜提示词校验：硬阻断 vs 软警告

**业务规则（当前生效）**

| 类型 | 规则 |
|------|------|
| **硬阻断** | Clip 总时长 13/14/15 秒；内部单段 1–6 秒；空提示词；时间轴无法解析；镜头 ID 丢失；裸 `assetId`；占位模板；JSON 解析失败 |
| **软警告（不阻止保存）** | 无人物设计/未入库/无参考图/无挂载行/无图片引用/无站位/提示词未出现人物名/缺场景道具/缺连续性声音/镜头数建议不符/时间轴空档重叠等 |

**关键文件**

| 文件 | 职责 |
|------|------|
| `storyboard-clip-types.ts` | `BLOCKING_CLIP_VALIDATION_CODES` / `SOFT_CLIP_WARNING_CODES` + `partitionClipValidationIssues` |
| `storyboard-prompt-validation.ts` | 渲染后文本校验；`validateShotPromptPartitioned` |
| `storyboard-clip-validator.ts` | 结构化 Clip 校验；人物绑定只进 warning |
| `storyboard-clip-pipeline.ts` | 仅硬错误 `ok: false`；软问题合并进 `warnings` 并 `prompts.set` |
| `storyboard-prompt-llm.ts` | LLM 后二次校验只对硬错误抛 `STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED` |
| `generate-storyboard-episode.ts` | 成功时 `generationError: null` 或软提示文案；状态 `storyboard_incomplete` |
| `StoryboardProductionPanel.tsx` | 软提示黄色 banner，不再标红 `generation_failed` |

**软提示文案**：`提示词已生成，部分镜头缺少人物参考图，将使用文字描述生成`

**验收要点**

- 无人物资产 / 人物未设计 / 无站位 / 无参考图 → 成功写入提示词 + warning
- Clip 12s 或 16s / 单段 >6s → 失败，不写入
- 截图旧错误需重新点击「重新生成分镜提示词」才会清空

### 2.2 资产提取 runner 恢复 & 名单选择

- `extraction/runner-lease.ts`、`resume.ts`、`cancel-task.ts`
- `RosterSelectionDialog.tsx`、`roster-selection.ts`
- 任务状态 `awaiting_roster_selection` → 用户确认后进 detail 提取

### 2.3 剧本下游 pipeline & 分镜生成引导

- `script-downstream-pipeline.ts` + API route
- `generate-storyboard-episode.ts`、`ensure-storyboard-workspace.ts`
- `StoryboardEpisodeStagePanel.tsx`、`episode-downstream-state.ts`

### 2.4 人物音色 & 一栈式 Shell

- `CharacterVoiceSettings.tsx`、`VoicePickerPanel.tsx`、`/api/voices/*`
- `ProjectFlowHeaderShell.tsx`、`ShellGlobalAccountBar.tsx`、`project-flow.ts`

### 2.5 测试

已通过（本轮相关）：

```powershell
npx vitest run src/projects/storyboard/__tests__/storyboard-clip-pipeline.test.ts
npx vitest run src/projects/storyboard/__tests__/storyboard-prompt-validation.test.ts
npx vitest run src/projects/storyboard/__tests__/storyboard-prompt-llm.test.ts
```

---

## 3. 工作区未提交改动（小量）

```
M  src/projects/script/__tests__/script-downstream-pipeline.test.ts
M  src/shell/__tests__/generation-busy-navigation.test.ts
?? deploy/*.log
?? tmp/
```

**勿提交**：`tmp/`、`deploy/*.log`、`.env.lan`

---

## 4. 内部通道（LAN）部署

### 4.1 启动步骤

```powershell
Set-Location E:\DevWorkspace\projects\InfiniteCanvas\code\infinite-canvas

# 1. 确认 Docker Desktop 已运行（否则 start-lan 会失败）
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"  # 如未启动
# 等待 docker info 成功后再继续

# 2. 重建并启动
.\deploy\start-lan.ps1 -ForceRecreate

# 3. 健康检查
.\deploy\check-lan.ps1
```

### 4.2 访问信息

| 项 | 值 |
|----|-----|
| 端口 | `3080`（`deploy/.env.lan` 中 `WEB_PORT`） |
| 本机 WLAN IP | `192.168.31.106`（以 `check-lan.ps1` 输出为准） |
| 访问地址 | `http://192.168.31.106:3080/` |
| build-revision | `36ac84f-dirty`（含未提交测试改动时带 `-dirty`） |
| compose | `compose.remote.yml` + `compose.lan.override.yml` |

### 4.3 仅重启（不重建镜像）

```powershell
.\deploy\start-lan.ps1 -ForceRecreate -SkipBuild
```

### 4.4 严格重建（无缓存）

```powershell
.\deploy\start-lan.ps1 -Strict
```

---

## 5. 已知问题 / 待办

### P0 — 验证分镜软校验上线

1. 拉起 LAN 后硬刷新（Ctrl+F5）
2. 进入分镜页 →「重新生成分镜提示词」
3. 确认：人物缺失只出黄色 warning，不再 `generation_failed`
4. 故意 12s Clip 仍应失败

### P1 — 企业空间副本

`infinite-canvas-enterprise-spaces` 为独立 worktree，**未同步**本轮分镜校验改动；若企业空间也跑分镜生成，需手动 cherry-pick 或合并 `36ac84f`。

### P2 — 预存测试失败（历史）

- `workspace-permission-routes.test.ts`
- `route-wiring.test.ts`
- `asset-library-split-layout.test.ts`

---

## 6. 关键路径速查

```
src/projects/storyboard/services/
  storyboard-clip-types.ts          # 硬/软 code 分区
  storyboard-clip-validator.ts
  storyboard-clip-pipeline.ts
  storyboard-prompt-validation.ts
  storyboard-prompt-llm.ts
  generate-storyboard-episode.ts

src/projects/storyboard/components/
  StoryboardProductionPanel.tsx     # 生成状态 UI

deploy/
  start-lan.ps1                     # 拉起内部通道
  check-lan.ps1                     # 健康检查
  HANDOVER.md                       # 本文件
```

---

## 7. Git

```
分支: feat/react-flow-migration
远程: origin → https://github.com/huajingliu6-cmyk/-.git
HEAD: 36ac84f (已 push)
```

---

## 8. 验收清单

- [ ] Docker Desktop 运行中
- [ ] `.\deploy\start-lan.ps1 -ForceRecreate` 成功
- [ ] `.\deploy\check-lan.ps1` 通过
- [ ] 浏览器访问 `http://<LAN IP>:3080/` 可登录
- [ ] 分镜：无人物资产仍可生成提示词（warning only）
- [ ] 分镜：12s/16s 或单段 >6s 仍失败
- [ ] 重新生成后历史红色 `generationError` 被清空

---

*交接单路径：`deploy/HANDOVER.md`*
