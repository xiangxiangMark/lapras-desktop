# Lapras Desktop — Day 7 执行方案：Windows 任务栏缩略图按钮

> 基于 DEVPLAN.md Section 5.1，2026-06-05
> 调整：仅保留缩略图工具栏按钮，不做覆盖图标和切歌通知

---

## 一、需求（调整后）

唯一任务：**鼠标悬停 Windows 任务栏图标时，缩略图上显示三个播放控制按钮**（上一首 / 播放暂停 / 下一首），点击按钮能正常控制播放。

不做：
- ~~任务栏覆盖图标~~ — 保持图标简洁
- ~~切歌通知~~ — 保持沉浸体验

---

## 二、现有基础

已具备的能力，无需从零搭建：

| 位置 | 能力 | 用途 |
|---|---|---|
| `main.ts` `sendMediaCommand()` | 向渲染进程发送 `lapras:media-control` 事件 | 缩略图按钮 click 回调直接复用 |
| `main.ts` `buildTrayPng()` | 程序化生成 PNG→NativeImage | 可复用 PNG 结构，换图标形状 |
| `main.ts` 行1607 | `app.setAppUserModelId("com.lapras.music.companion")` 已设置 | 缩略图按钮生效的前置条件 ✓ |
| `preload.cts` `onMediaControl()` | 渲染进程已可接收媒体指令 | 无需新增渲染端响应逻辑 |
| `DesktopShell.tsx` 行539-553 | 已监听 `onMediaControl` 并调用 `toggleAudio`/`nextTrack`/`previousTrack` | 按钮点击 → 播放控制链路完整 |

缺失的只有两点：
1. `main.ts` 从未调用 `setThumbarButtons`，按钮不存在
2. 主进程不知道当前播放/暂停状态，无法在播放和暂停图标间切换

---

## 三、改什么

### 3.1 `main.ts` — 图标生成 + 按钮设置 + 状态响应

**新增函数 `createThumbarIcon(kind)`**：程序化生成 16×16 白色 PNG 图标，形状分别为左三角、右三角、双竖线。复用现有 `buildTrayPng()` 的 PNG 结构（signature + IHDR + IDAT + IEND），只换像素绘制逻辑。

```typescript
function createThumbarIcon(kind: "previous" | "play" | "pause" | "next"): NativeImage {
  // 结构与 buildTrayPng 相同，绘制不同形状的 16×16 白色图标
  // 复用 createPngChunk / deflateSync / crc32 等现有工具
}
```

**新增函数 `updateThumbarState(playing: boolean)`**：读取当前按钮数组，替换中间按钮的图标和 tooltip。

```typescript
function updateThumbarState(playing: boolean) {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
  const buttons = mainWindow.getThumbarButtons();
  if (buttons && buttons.length >= 2) {
    buttons[1].icon = createThumbarIcon(playing ? "pause" : "play");
    buttons[1].tooltip = playingIno ? "暂停" : "播放";
    mainWindow.setThumbarButtons(buttons);
  }
}
```

**在 `createMainWindow()` 中初始化按钮**（`mainWindow` 创建后，`loadRenderer` 之前）：

```typescript
if (process.platform === "win32") {
  mainWindow.setThumbarButtons([
    { tooltip: "上一首", icon: createThumbarIcon("previous"),
      click: () => sendMediaCommand("previous") },
    { tooltip: "播放",     icon: createThumbarIcon("play"),
      click: () => sendMediaCommand("playpause") },
    { tooltip: "下一首", icon: createThumbarIcon("next"),
      click: () => sendMediaCommand("next") },
  ]);
}
```

**新增 IPC handler**（放在 `registerWindowIpc()` 中）：

```typescript
ipcMain.on("lapras:playback-state-changed", (_event, playing: boolean) => {
  updateThumbarState(Boolean(playing));
});
```

### 3.2 `preload.cts` — 新增一个 API

在 `desktopApi` 对象中新增：

```typescript
notifyPlaybackState: (playing: boolean) => {
  ipcRenderer.send("lapras:playback-state-changed", playing);
}
```

不需要 `notifyTrackChange`（不做通知）。

### 3.3 `DesktopShell.tsx` — 新增一个 useEffect

在组件中新增上报播放状态的变化：

```typescript
useEffect(() => {
  if (desktopApi?.notifyPlaybackState) {
    desktopApi.notifyPlaybackState(audioPlaying);
  }
}, [audioPlaying, desktopApi]);
```

`audioPlaying` 这个 state 已经在组件中管理（第155行），`toggleAudio` / `nextTrack` / `previousTrack` 都会正确更新它，包括自动切歌（`audio.onEnded`）和 WebSocket 推送的曲目变化。因此这个 useEffect 覆盖了所有播放状态变化路径。

---

## 四、改动文件清单

| 文件 | 改动量 | 内容 |
|---|---|---|
| `apps/desktop/src/main.ts` | +60行 | 1. `createThumbarIcon()` 四个图标形状<br>2. `updateThumbarState()` 切换播放/暂停图标<br>3. `createMainWindow()` 中 `setThumbarButtons()`<br>4. `registerWindowIpc()` 中新增 `lapras:playback-state-changed` handler |
| `apps/desktop/src/preload.cts` | +3行 | `desktopApi` 新增 `notifyPlaybackState` 方法 |
| `apps/web/src/desktop/DesktopShell.tsx` | +5行 | 新增 `useEffect` 监听 `audioPlaying` 上报到主进程 |

其他文件零改动。

---

## 五、执行步骤

```
Step 1  main.ts: 写 createThumbarIcon()，生成 prev/play/pause/next 四个 NativeImage
Step 2  main.ts: 写 updateThumbarState(playing)
Step 3  main.ts: createMainWindow() 中调用 setThumbarButtons()
Step 4  main.ts: registerWindowIpc() 中注册 lapras:playback-state-changed handler
Step 5  preload.cts: 新增 notifyPlaybackState
Step 6  DesktopShell.tsx: 新增 useEffect 上报 audioPlaying
Step 7  npm run typecheck && npm run build && npm run package:win
Step 8  Windows 11 真机验证
```

---

## 六、验收标准

- [ ] 鼠标悬停 Windows 任务栏图标，缩略图上方出现三个按钮（◁ ▶ ▷）
- [ ] 点击"上一首"按钮 → 切换到上一首
- [ ] 点击"播放/暂停"按钮 → 暂停/恢复播放，按钮图标在 ▶ 和 ⏸ 之间切换
- [ ] 点击"下一首"按钮 → 切换到下一首
- [ ] 后端自动切歌时，播放状态变化会自动同步到按钮图标
- [ ] 非 Windows 平台（macOS）不受影响
- [ ] `npm run typecheck` / `npm run build` / `npm run package:win` 通过

---

## 七、注意事项

1. **图标清晰度**：16×16 像素非常小，形状必须简洁。建议三图标：左三角（◁）、右三角（▶）、双竖线（⏸）。如果程序化渲染效果不佳，考虑用单像素精度的几何路径。

2. **平台守卫**：所有新代码用 `process.platform === "win32"` 包裹，macOS 行为不受影响。

3. **窗口销毁**：`updateThumbarState` 需检查 `mainWindow?.isDestroyed()`，防止窗口关闭后访问。

4. **IPC 方向**：`lapras:playback-state-changed` 是渲染→主进程（`ipcRenderer.send` + `ipcMain.on`），不需要返回值，单向通知即可。
