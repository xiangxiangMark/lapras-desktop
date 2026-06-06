# Lapras Desktop — Day 9 执行方案：macOS 菜单栏和 Dock

> 基于 DEVPLAN.md Section 6.1，2026-06-05

---

## 一、需求

| 任务 | 说明 |
|---|---|
| A. 应用菜单 | 完善 macOS 顶部菜单栏：Lapras / 编辑 / 视图 / 窗口 |
| B. Dock 菜单 | 右键 Dock 图标显示播放控制 + 显示窗口 |
| C. Dock 图标弹跳 | AI 回复就绪时 Dock 图标弹跳一次提醒用户 |
| D. 快捷键验证 | Cmd+Q 退出、Cmd+, 设置、Cmd+W 隐藏 |

---

## 二、已有实现 vs DEVPLAN 差距

### 2.1 应用菜单（createApplicationMenu，行1193-1297）

| DEVPLAN 要求 | 当前状态 |
|---|---|
| Lapras 菜单：关于 / 偏好设置 / 隐藏 / 退出 | ✅ 全部实现 |
| Cmd+, → 设置 | ✅ 已实现 |
| Cmd+Q → 退出 | ✅ 已实现 |
| 编辑菜单：复制粘贴全选 | ✅ 全部 role 实现 |
| 视图菜单：紧凑模式切换 | ✅ CmdOrCtrl+M |
| 视图菜单：缩放 | ✅ resetZoom/zoomIn/zoomOut |
| 窗口菜单：最小化 / 缩放 | ⚠️ 有 minimize，缺少 `role: "zoom"` |
| Window 菜单 Bring All to Front | ⚠️ 只有 `role: "front"`，缺少全窗口置前 |

差距很小：窗口菜单缺少 macOS 标准的 "Zoom" 和 "Bring All to Front" 条目，Day 9 补齐即可。

### 2.2 Dock 菜单（updateDockMenu，行1303-1329）

| DEVPLAN 要求 | 当前状态 |
|---|---|
| 播放/暂停 | ✅ |
| 下一首 | ✅ |
| 上一首 | ⚠️ DEVPLAN 没要求但已实现 |
| 显示 Lapras | ✅ |

Dock 菜单完整，无缺失。

### 2.3 媒体键（registerMediaShortcuts，行1331-1349）

| DEVPLAN 要求 | 当前状态 |
|---|---|
| 播放/暂停 | ✅ MediaPlayPause |
| 下一首 | ✅ MediaNextTrack |
| 上一首 | ✅ MediaPreviousTrack |

通过 `globalShortcut` 注册，已实现。

### 2.4 Dock 图标弹跳

**完全未实现**。DEVPLAN 描述："收到重要事件（如 AI 回复就绪）时 Dock 图标弹跳一次提醒用户"。

这是 Day 9 唯一需要从零新增的功能。

### 2.5 窗口关闭行为

- `mainWindow` 关闭 → `preventDefault` + `hide()` ✅
- `settingsWindow` 关闭 → `preventDefault` + `hide()` ✅
- `isQuitting` 状态管理 → 仅在 Cmd+Q 或托盘"Quit"时设为 true ✅
- `app.on("window-all-closed")` → 空函数，不退出 ✅（托盘应用正确行为）

已符合 macOS 应用规范，无需改动。

---

## 三、改动方案

### 3.1 窗口菜单微调（main.ts）

在 Window 菜单中补上 macOS 标准的 "Zoom" 项：

```typescript
// 当前 Window 菜单 submenu（行1263-1282），在 minimize 之后、Hide 之前插入：
{ role: "zoom" },
```

并在 `front` 之前补上 `{ role: "bringAllToFront" }`（macOS 约定）。

### 3.2 Dock 图标弹跳（新增功能）

需要改动三个文件，形成 IPC 链路：**DesktopShell → preload → main → app.dock.bounce()**

**main.ts 新增：**

```typescript
function bounceDock() {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.bounce("informational");
}
```

在 `registerWindowIpc()` 中新增 handler：

```typescript
ipcMain.on("lapras:dock-bounce", () => {
  bounceDock();
});
```

**preload.cts 新增：**

```typescript
bounceDock: () => {
  ipcRenderer.send("lapras:dock-bounce");
},
```

**DesktopShell.tsx 触发时机：**

在已有的"新 assistant 消息追加"useEffect 中（行488-513），当检测到新增 assistant bubble 时触发弹跳：

```typescript
// 在 setChatBubbles 回调中，创建新 bubble 后：
if (desktopApi?.bounceDock && items.length > 0 && last?.role !== "assistant") {
  desktopApi.bounceDock();
}
```

但更清晰的做法：在同一个 useEffect 中，当 `lastDecisionSignature` 变化且属于新的 assistant reply 时，调用 `bounceDock()`。需注意去重——同一 decision 不重复弹跳。

实际实现：在 useEffect 末尾增加一个判断，当 `state?.lastDecision?.reason` 有内容且是新产生的 assistant 回复时触发。

简洁方案——在已有的 useEffect（行488-513）return 之前增加：

```typescript
// 新 assistant 回复产生时，Dock 弹跳提醒
if (desktopApi?.bounceDock && state?.lastDecision?.reason) {
  desktopApi.bounceDock();
}
```

---

## 四、改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `apps/desktop/src/main.ts` | 修改 | 1. Window 菜单补 `role: "zoom"` + `role: "bringAllToFront"`<br>2. 新增 `bounceDock()` 函数<br>3. registerWindowIpc 新增 `lapras:dock-bounce` handler |
| `apps/desktop/src/preload.cts` | 修改 | desktopApi 新增 `bounceDock` 方法 |
| `apps/web/src/desktop/DesktopShell.tsx` | 修改 | 在 assistant bubble 产生时触发 bounceDock |

总计 ~20 行新代码。

---

## 五、执行步骤

```
Step 1  main.ts: Window 菜单补 zoom + bringAllToFront
Step 2  main.ts: 新增 bounceDock() 函数
Step 3  main.ts: registerWindowIpc 新增 lapras:dock-bounce handler
Step 4  preload.cts: desktopApi 新增 bounceDock 方法
Step 5  DesktopShell.tsx: AI 回复产生时调用 bounceDock()
Step 6  npm run typecheck && npm run build （Windows 主机可验证编译通过）
```

**注意**：macOS 真机验证（安装 DMG → 验证菜单/Dock/弹跳）无法在 Windows 主机完成，需在 macOS 13+ arm64 环境进行。当前 Windows 主机只做源码编译验证。

---

## 六、验收标准

- [ ] 菜单栏有完整 Lapras / 编辑 / 视图 / 窗口 / 帮助
- [ ] Dock 右键菜单有播放控制 + 显示窗口
- [ ] Cmd+Q 正确退出应用
- [ ] Cmd+, 打开设置窗口
- [ ] Cmd+W 隐藏主窗口（不退出）
- [ ] AI 回复到达时 Dock 图标弹跳一次
- [ ] `npm run typecheck` / `npm run build` 在 Windows 主机通过
- [ ] macOS 13+ arm64 真机安装验证通过

---

## 七、注意

1. **Dock 弹跳频率**：`app.dock.bounce("informational")` 只弹跳一次然后自动停止；`"critical"` 会持续弹跳直到应用获得焦点。Day 9 使用 `"informational"` 避免过度打扰。

2. **非 macOS 环境**：`bounceDock()` 内部有 `process.platform !== "darwin"` 守卫，不影响 Windows。preload API 在所有平台均可调用，非 macOS 上为 no-op。

3. **与 Day 7-8 的关系**：Day 7/8（Windows 专项）和 Day 9（macOS 专项）互不干扰，分属不同平台分支。并行开发无冲突。
