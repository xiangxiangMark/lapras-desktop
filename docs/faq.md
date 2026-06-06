# 常见问题

## 配置相关

### 如何获取 API Key？

Lapras 使用 DeepSeek API 提供 AI 音乐决策能力。

1. 访问 [platform.deepseek.com](https://platform.deepseek.com) 注册账号
2. 在「API Keys」页面创建一个新的 API Key
3. 复制 Key，粘贴到 Lapras 首次启动引导中

DeepSeek 对新用户有免费额度，之后按用量计费。每次音乐对话约消耗数千 token，费用极低。

### 支持哪些 LLM 提供商？

当前支持所有兼容 OpenAI Chat Completions 格式的 API，包括：
- DeepSeek（默认，推荐）
- 通义千问（Qwen）
- 其他兼容提供商（在设置中自定义 Base URL 和 Model）

### 如何连接网易云音乐？

三种方式：

1. **二维码登录**（推荐）：在设置中点击"生成二维码"，用网易云音乐 App 扫码
2. **手机验证码登录**：输入手机号，获取验证码后登录
3. **导入 Cookie**：从浏览器中导出网易云音乐的 Cookie 字符串，粘贴到 Cookie 栏中点击保存

连接网易云后，Lapras 可以同步你的听歌历史和偏好，AI 推荐会更加个性化。不连接也可以正常使用，但音乐数据来自公开搜索结果。

## 使用相关

### 数据和配置文件存储在哪里？

| 平台 | 路径 |
|---|---|
| Windows 11 | `%APPDATA%\Lapras\data\` |
| macOS | `~/Library/Application Support/Lapras/data/` |

`data/` 目录包含：
- `app.db` — SQLite 数据库（播放历史、消息、收藏）
- `profiles/` — 多档案数据
- `logs/` — 运行日志

### 如何备份数据？

复制整个 `data/` 目录即可。在新设备上粘贴到相同位置即可恢复。

### 后端端口被占用怎么办？

Lapras 会自动探测 8790-8799 范围内的可用端口。如果这 10 个端口全部被占用，应用会提示端口冲突。

### 如何切换回网页版？

此版本为桌面专用版。如需网页版，请使用 `lapras-web` 项目。

## 故障排查

### 启动后白屏或卡在加载

1. 检查是否有杀毒软件拦截了 Lapras 的后端进程
2. 尝试以管理员身份运行（Windows）
3. 查看 `data/logs/` 下的日志文件

### 播放没声音

1. 检查系统音量是否静音
2. 在 Lapras 中确认音量不是 0%（播放器右下角音量图标）
3. 网易云部分歌曲可能无版权音频链接，尝试切到下一首

### 无法连接到后端

1. Lapras 会自动启动后端服务，首次启动可能需要 5-10 秒
2. 如果持续显示连接错误，尝试重启 Lapras
3. 检查 8790-8799 端口是否被其他程序占用

### API 请求失败

1. 确认 API Key 正确（在设置中检查 Qwen Provider 配置）
2. 确认 API Key 有剩余额度
3. 确认网络可以访问 DeepSeek API 域名

---

更多问题请在 [GitHub Issues](https://github.com/lapras/issues) 提交。
