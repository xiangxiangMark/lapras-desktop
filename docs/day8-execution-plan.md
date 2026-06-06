# Lapras Desktop — Day 8 执行方案：Windows 安装器优化 + 自动启动

> 基于 DEVPLAN.md Section 5.2，2026-06-05

---

## 一、需求

| 任务 | 说明 |
|---|---|
| A. 安装器简体中文 | NSIS 安装器界面语言改为简体中文 |
| B. 许可协议页面 | 安装流程中显示许可协议，需用户同意 |
| C. 安装完成页 | "运行 Lapras"复选框，勾选后安装完成自动启动 |
| D. 开机启动 | NSIS 安装器提供"开机自启"选项；验证应用内 openAtLogin 在 packaged 环境下生效 |
| E. 卸载行为 | 卸载时移除安装目录和快捷方式，弹窗询问是否一并删除用户数据 |

---

## 二、现有状态分析

### 2.1 electron-builder.yml 当前 NSIS 配置

```yaml
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Lapras
  uninstallDisplayName: Lapras
```

缺失项：语言、许可协议、自定义脚本。`runAfterFinish` 未显式声明（默认 `true`，已有"运行"复选框但标签为英文）。

### 2.2 应用内 openAtLogin

`main.ts` 中已有完整实现：

```typescript
// 行837-838: 读取状态
function getOpenAtLogin() { return app.getLoginItemSettings().openAtLogin; }

// 行1128-1135: 设置状态，Electron 会自动写入 Windows 注册表
function setOpenAtLogin(enabled: boolean) {
  app.setLoginItemSettings({ openAtLogin: enabled });
  broadcastDesktopState();
  updateTrayMenu();
}
```

IPC 已暴露 `lapras:open-at-login:get` / `lapras:open-at-login:set`，托盘菜单有开关，设置窗口可切换。但 DEVPLAN 要求 "验证打包后是否生效"——需在 packaged 安装后实际验证。

### 2.3 许可证文件

项目根目录无 LICENSE 文件，需创建。

### 2.4 卸载行为

当前 NSIS 默认卸载行为：删除安装目录 + 快捷方式。用户数据（`%APPDATA%/Lapras`，即 Electron `userData`）默认保留。没有询问用户是否清除数据的弹窗。

---

## 三、改动清单

### 3.1 改动文件

| 文件 | 类型 | 内容 |
|---|---|---|
| `electron-builder.yml` | 修改 | 新增 `language`、`license`、`include`、`deleteAppDataOnUninstall` |
| `build/license.txt` | 新增 | 简体中文许可协议文本 |
| `build/installer.nsh` | 新增 | 自定义 NSIS 脚本：开机启动选项 + 卸载数据清理弹窗 |

应用代码（`main.ts`、`preload.cts`、前端）零改动。

### 3.2 electron-builder.yml 改动

```yaml
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Lapras
  uninstallDisplayName: Lapras
  # ---- Day 8 新增 ----
  language: "2052"                    # 简体中文 (LCID 2052 = 0x0804)
  license: build/license.txt          # 许可协议文件
  runAfterFinish: true                # 安装完成页显示"运行 Lapras"复选框（显式声明）
  deleteAppDataOnUninstall: false     # 默认不删用户数据，由自定义脚本弹窗决定
  include: build/installer.nsh        # 自定义 NSIS 脚本
```

**关于 `language: "2052"`**：

electron-builder 内建 NSIS 的 MUI2 多语言支持。2052 对应简体中文（SimpChinese），安装器标题、按钮、提示文字均会自动切换为中文。无需额外下载语言包。

### 3.3 build/license.txt

在 `build/` 目录下创建纯文本许可协议（UTF-8 编码）。NSIS 默认用系统记事本控件展示 `.txt` 文件；如需加粗/排版可用 `.rtf` 格式。

内容要点：
- 软件名称和版本
- 使用授权范围（个人免费使用）
- 免责声明（音乐版权归平台所有、AI 推荐仅供参考等）
- 隐私说明（API Key 本地存储、不上传服务器）
- 禁止行为（逆向、再分发等）

用 `.txt` 即可，NSIS 的 LicenseForceSelection 控件原生支持纯文本滚动阅读。

### 3.4 build/installer.nsh

这是核心定制文件。electron-builder 在生成 NSIS 脚本时会 `!include` 它，我们可以覆写特定宏来实现自定义行为。

需要定义三个宏：

```nsis
; ============================================================
; build/installer.nsh — Lapras NSIS 自定义脚本
; ============================================================

; --- 1. 安装时创建开机启动快捷方式（如果用户勾选） ---

Var StartWithWindows

; 在安装目录选择页之后插入自定义页面：开机启动复选框
; 这里利用 MUI2 的 finish page 自定义功能
!macro customFinishPage
  ; 在 finish page 上增加一个复选框
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "开机自动启动 Lapras"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateStartupShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

Function CreateStartupShortcut
  CreateShortCut "$SMSTARTUP\Lapras.lnk" "$INSTDIR\Lapras.exe"
FunctionEnd

; --- 2. 卸载时询问是否清除用户数据 ---

!macro customUnInit
  ; 弹窗询问
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除 Lapras 的用户数据？$\r$\n$\r$\n包含：API Key 配置、播放记录、音乐偏好等。$\r$\n如果选择"否"，这些数据将保留在您的电脑上，方便下次安装时继续使用。" \
    /SD IDNO \
    IDYES deleteUserData \
    IDNO skipDelete
  deleteUserData:
    StrCpy $0 "1"
    Goto done
  skipDelete:
    StrCpy $0 "0"
  done:
!macroend

!macro customUnInstall
  ${if} $0 == "1"
    ; 删除 Electron userData 目录
    RMDir /r "$APPDATA\Lapras"
  ${endif}
!macroend
```

**设计说明**：

- **开机启动**：利用 MUI2 的 `MUI_FINISHPAGE_SHOWREADME` 机制在完成页加一个复选框。这是最简洁的方式，不需要新开一个页面。NOTE：`MUI_FINISHPAGE_SHOWREADME` 在 finish page 上预设了一个复选框位置，原本用于"显示自述文件"，这里复用为开机启动选项。
- **卸载数据清理**：在卸载初始化阶段弹窗询问。用户选"是"则删除 `%APPDATA%/Lapras`（Electron `userData` 路径），选"否"则保留。

**备选方案**：如果 `MUI_FINISHPAGE_SHOWREADME` 复用不够清晰，可以改用 `!insertmacro MUI_PAGE_COMPONENTS` + 自定义 Section，新增一个完整的"选择组件"页面，其中包含"开机启动"作为可选组件。但这样会增加安装步骤（多一页），用户体验不如 finis h page 上的复选框简洁。

---

## 四、执行步骤

```
Step 1  创建 build/license.txt
        内容：简体中文许可协议（使用条款 + 免责声明 + 隐私说明）

Step 2  创建 build/installer.nsh
        内容：自定义 NSIS 脚本（开机启动复选框 + 卸载数据清理弹窗）

Step 3  修改 electron-builder.yml
        新增 language / license / runAfterFinish / include / deleteAppDataOnUninstall

Step 4  删除旧 release/ 产物（Day6 产物已过时）
        手动删除 release/ 目录，或运行 npm run clean

Step 5  npm run typecheck && npm run build && npm run package:win
        生成新的安装器 release/Lapras Setup 1.0.0.exe

Step 6  Windows 11 安装器验收（见下方验收矩阵）
```

---

## 五、验收矩阵

安装流程：

| 步骤 | 预期 |
|---|---|
| 打开安装器 | 标题栏为中文，欢迎页文字为简体中文 |
| 点击下一步 | 显示许可协议页面，文本为中文，需勾选"我同意"才能继续 |
| 选择安装目录 | 默认 `C:\Users\<name>\AppData\Local\Programs\Lapras`，可更改 |
| 开始安装 | 进度条正常，文件复制到目标目录 |
| 安装完成 | 显示完成页，底部有"运行 Lapras"复选框（已勾选）和"开机自动启动 Lapras"复选框 |
| 勾选"运行 Lapras"，点击完成 | Lapras 自动启动，主窗口显示 |
| 勾选"开机自动启动" | 重启后 Lapras 自动启动 |

应用内开机启动：

| 测试 | 预期 |
|---|---|
| 托盘菜单 → Enable Open at Login | 勾选后，Windows 启动时自动运行 Lapras |
| 托盘菜单 → Disable Open at Login | 取消后，开机不再自动启动 |
| 设置窗口开关 | 与托盘菜单双向同步 |
| 重启电脑 | openAtLogin 状态持久保留 |

卸载流程：

| 操作 | 预期 |
|---|---|
| 控制面板 → 卸载 Lapras | 弹出确认对话框，然后执行卸载 |
| 卸载过程 | 弹窗询问是否删除用户数据，选项"是/否" |
| 选择"否" | `%APPDATA%/Lapras` 保留 |
| 选择"是" | `%APPDATA%/Lapras` 删除 |
| 卸载完成后 | 安装目录已删除，桌面/开始菜单快捷方式已删除 |
| 重新安装 | 如保留了用户数据，之前的 API Key、档案等仍然可用 |

---

## 六、注意事项

1. **NSIS 语言测试**：`language: "2052"` 会让 NSIS 使用内置的 SimpChinese 语言文件。如果个别字符串（如 electron-builder 特有的 "Run" 标签）仍显示英文，需要额外在 `installer.nsh` 中用 `LangString` 覆写。这类问题只能在真机打包后逐一排查。

2. **MUI_FINISHPAGE_SHOWREADME 限制**：这个机制只能提供一个复选框。如果后续需要更多选项（如"创建桌面快捷方式"独立开关），需要改用 `MUI_PAGE_COMPONENTS` 自定义页面。Day 8 先用这个简单方案。

3. **用户数据路径**：Electron 的 `app.getPath("userData")` 在 Windows 上返回 `%APPDATA%/Lapras`（因为 `appId` 是 `com.lapras.music.companion`，实际路径为 `%APPDATA%/lapras-desktop` 或类似，取决于 package.json 的 `name` 字段）。需在真机上确认实际路径后，调整 `installer.nsh` 中的 `RMDir` 路径。**建议打包后在真机先查看 `%APPDATA%` 下 Lapras 的实际文件夹名。**

4. **与 Day 7 的关系**：Day 7（缩略图按钮）和 Day 8 互不依赖，可并行验证。但建议先验证 Day 7 的改动不影响 typecheck/build 后，再做 Day 8 的安装器变更。

5. **旧安装器覆盖安装**：如果机器上已经安装了旧版 Lapras，测试卸载/覆盖安装场景。NSIS 默认会检测已有安装并提示先卸载。
