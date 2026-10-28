# CrossStaff 中文快速开始

[English](QUICKSTART.md) · [简体中文](QUICKSTART.zh-CN.md) · [跨平台指南](PLATFORMS.zh-CN.md)

这份指南默认使用**真实模型**跑通第一个工作流。选择一种执行方式：

- **OpenAI-compatible API**：推荐，不需要安装本地 CLI。本文用 DeepSeek 做实测示例。
- **本地 CLI**：使用已安装并登录的 Codex CLI，或其他支持 stdin/stdout 的官方 CLI。

Mock 只是免费协议冒烟测试，不再作为默认 Quick Start。

## 1. 环境要求

- Node.js 24 或更高版本
- 一个 OpenAI-compatible API Key，或已登录的 Codex CLI
- Windows、macOS 或 Linux

检查 Node.js：

```bash
node --version
```

## 2. 准备全新工作区

从 GitHub 的 **Code** 按钮获取仓库地址：

```bash
git clone https://github.com/haodev93/crossstaff.git
cd crossstaff
```

创建 `.env`。

Windows：

```powershell
Copy-Item .env.example .env
notepad .env
```

macOS / Linux：

```bash
cp .env.example .env
${EDITOR:-vi} .env
```

建议使用全新的本地数据目录，避免旧 Room 和配置造成干扰。

## 路径 A：OpenAI-compatible API

DeepSeek 是已经实测通过的示例；其他兼容 `/chat/completions` 的 Provider 配置方式相同。

### A1. 配置 API Key

在 `.env` 中设置：

```dotenv
DEEPSEEK_API_KEY=你的真实Key
CROSSSTAFF_ALLOW_COMMANDS=0
```

不要通过 CrossStaff 页面或 HTTP API 提交真实 Key。

### A2. 启动 CrossStaff

Windows：

```powershell
$env:CROSSSTAFF_DATA_DIR = ".\data\quickstart-real"
npm start
```

macOS / Linux：

```bash
CROSSSTAFF_DATA_DIR=./data/quickstart-real npm start
```

打开：

```text
http://localhost:8787
```

### A3. 完成首次配置

创建第一个 Room：

```text
房间名称：我的第一个 Agent 团队
房间说明：验证真实模型工作流
```

创建第一名员工：

```text
员工姓名：DeepSeek Guide Agent
岗位名称：API Assistant
Provider：DeepSeek
授权方式：官方 API
席位绑定标签：Quick Start API Seat
```

### A4. 在向导中直接创建真实 AgentMode

不需要先创建 Mock，再额外创建真实 Mode。向导第 4 步直接选择：

```text
Mode 名称：DeepSeek Guide Mode
自定义角色名：researcher
职责说明：简洁、实用地回答任务，并给出可核验依据。
Adapter：API（OpenAI-compatible）
API Provider：DeepSeek
Base URL：https://api.deepseek.com
模型：deepseek-flash
API Key 环境变量：DEEPSEEK_API_KEY
API 超时：180000
```

如果使用其他 Provider，只需替换 Base URL、模型名称和 Key 环境变量名。对应密钥必须已经存在 CrossStaff 进程或 `.env` 中。

完成向导第 5 步并进入工作区。

### A5. 运行第一条真实工作流

进入项目 Room，点击 **新建工作流**：

```text
标题：Real Quick Start Workflow

目标：
解释一次可靠的代码交付应包含哪三个检查项，回答要简洁。
```

工作环节：

```text
环节名称：生成交付检查清单
负责 Agent Mode：DeepSeek Guide Mode
前置环节：不选择
```

默认验收者：

```text
DeepSeek Guide Mode
```

点击 **创建并运行**。

### A6. 预期结果

这条路径已经使用真实 DeepSeek API 验证。成功时应看到：

- Room 中出现真实 DeepSeek 内容
- 工作环节状态为 `completed`
- 自动验收环节状态为 `completed`
- 工作流 verdict 为 `accepted`
- 员工获得真实验收评分，例如 `95`

DeepSeek 会返回类似：

```text
- 同行代码审查通过
- 自动化检查全部通过
- 发布与回滚准备完成
```

真实 API 调用可能产生费用。

## 路径 B：本地 CLI

以下以 Codex CLI 为例。其他官方 CLI 只要支持非交互 stdin/stdout，也可以使用同样的 Command Adapter 流程。

### B1. 检查并登录 Codex CLI

```powershell
codex --version
codex login
codex login status
```

如果希望与 Codex 桌面应用使用不同配置：

Windows：

```powershell
.\scripts\login-codex-cli.ps1
```

macOS / Linux：

```bash
chmod +x scripts/login-codex-cli.sh
./scripts/login-codex-cli.sh
```

AgentMode 的 `CODEX_HOME` 必须使用同一个绝对路径。

### B2. 启动 CrossStaff

Windows：

```powershell
$env:CROSSSTAFF_DATA_DIR = ".\data\quickstart-codex"
$env:CROSSSTAFF_ALLOW_COMMANDS = "1"
npm start
```

macOS / Linux：

```bash
CROSSSTAFF_DATA_DIR=./data/quickstart-codex CROSSSTAFF_ALLOW_COMMANDS=1 npm start
```

打开 `http://localhost:8787`，完成 Room 和员工配置：

```text
员工姓名：Codex CLI Agent
岗位名称：Implementation Engineer
Provider：OpenAI
授权方式：官方 CLI / OAuth
```

### B3. 在向导中创建 Codex AgentMode

选择：

```text
Mode 名称：Codex Quickstart Mode
自定义角色名：builder
Adapter：本地命令
Command：codex
Arguments JSON：
["exec","--sandbox","read-only","--color","never","--ephemeral","-"]
Working directory：你的测试仓库绝对路径
Timeout：600000
```

Windows 如果使用隔离配置，在 Environment JSON 中填写：

```json
{
  "CODEX_HOME": "C:\\Users\\you\\Documents\\crossstaff\\data\\codex-cli-home",
  "HOME": "C:\\Users\\you"
}
```

macOS / Linux：

```json
{
  "CODEX_HOME": "/Users/you/Documents/crossstaff/data/codex-cli-home"
}
```

第一条工作流使用 `read-only` 沙箱。不要把 `--dangerously-bypass-approvals-and-sandbox` 写进公开 Quick Start。

### B4. 运行第一条 Codex 工作流

创建：

```text
标题：Codex CLI Quick Start

目标：
返回一份可靠代码交付的三项检查清单。
不要读取或修改文件。
```

将工作环节和默认验收者都设为 `Codex Quickstart Mode`。

预期结果：

- Room 中出现真实 Codex CLI 输出
- 工作环节和验收环节均为 `completed`
- 满足目标时 verdict 为 `accepted`
- 员工绩效记录写入验收分数

Codex CLI 已验证可完成真实请求，单次调用可能需要一分钟以上。

## 可选：免费 Mock 冒烟测试

如果只想验证工作流协议、不调用模型，可以在 AgentMode 中选择 **Mock**。Mock 不产生模型费用，也不修改文件。

## 常见问题

### `EADDRINUSE`

端口 `8787` 已被占用。关闭旧 CrossStaff，或换端口：

```powershell
$env:PORT = "8788"
npm start
```

macOS / Linux：

```bash
PORT=8788 npm start
```

### 修改 `.env` 后没有生效

CrossStaff 只在启动时读取 `.env`。停止并重新运行 `npm start`。

### DeepSeek 返回 Key 未设置

检查：

- `.env` 位于仓库根目录
- `DEEPSEEK_API_KEY=` 后不是空值
- AgentMode 的 API Key 环境变量是 `DEEPSEEK_API_KEY`
- 修改 `.env` 后已经重启 CrossStaff

### Room 聊天没有触发 Agent

普通 Room 消息只有在内容包括 AgentMode 名称时才会触发回复，例如：

```text
DeepSeek Guide Mode，你好
```

工作流通过 **新建工作流** 启动，不依赖聊天点名。

### Codex 提示文件系统只读

Quick Start 第一条任务故意使用 `--sandbox read-only`。后续需要写代码时再使用 `workspace-write` 和隔离仓库/Worktree。如果 CrossStaff 本身运行在另一个受限沙箱中，Codex 也可能继承只读策略。

## 下一步

- [HTTP API](API.md)
- [Adapter 配置](ADAPTERS.md)
- [架构说明](ARCHITECTURE.md)
- [产品路线图](ROADMAP.md)
