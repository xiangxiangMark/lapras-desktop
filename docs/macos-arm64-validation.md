# macOS 13+ arm64 验收记录

> 目标产物：`release/Lapras-1.0.0-arm64.dmg`
> 验收环境：Apple Silicon Mac，macOS 13 或更高版本

## 构建

- [ ] 在 Apple Silicon 环境执行 `npm ci`
- [ ] 执行 `npm run typecheck` 通过
- [ ] 执行 `npm run package:mac` 通过
- [ ] 产物文件名为 `release/Lapras-1.0.0-arm64.dmg`

## 安装

- [ ] DMG 可正常挂载
- [ ] DMG 打开后显示拖拽到 Applications 的视觉引导
- [ ] 将 Lapras 拖入 Applications 成功
- [ ] 首次启动时按 `docs/macos-install.md` 说明完成手动许可

## 运行

- [ ] 主窗口可见且不白屏
- [ ] 后端自动启动，`/health` 正常
- [ ] 首次引导可配置 DeepSeek API Key
- [ ] 网易云连接步骤可跳过，跳过后主界面可用
- [ ] API 通信正常，AI 对话和 mock 播放降级可用
- [ ] 托盘图标可见
- [ ] 菜单栏包含 Lapras / Edit / View / Window / Help
- [ ] Cmd+Q 正确退出应用
- [ ] Cmd+, 打开设置窗口
- [ ] Cmd+W 隐藏主窗口而不退出
- [ ] Dock 右键菜单包含播放控制和显示窗口
- [ ] 系统媒体键或全局媒体快捷键可控制播放/上一首/下一首

## 记录

- 验收人：
- 验收日期：
- macOS 版本：
- 设备型号：
- 产物 SHA256：
- 备注：
