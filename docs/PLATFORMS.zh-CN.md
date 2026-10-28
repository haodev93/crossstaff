# 跨平台指南

[English](PLATFORMS.md) · [简体中文](PLATFORMS.zh-CN.md)

CrossStaff 使用 Node.js 24、内置 `node:sqlite`、标准路径 API 和 Node 子进程接口，不依赖原生插件或平台特有的运行时组件。

## 支持范围

| 平台 | 直接运行 Node | API / Mock Adapter | 本地 Command Adapter | 说明 |
| --- | --- | --- | --- | --- |
| Windows 10/11 | 支持 | 支持 | 支持 | 主要开发和实际运行平台 |
| macOS Intel / Apple Silicon | 支持目标 | 支持 | CLI 位于 `PATH` 时支持 | 已加入 macOS CI |
| Linux x64 / arm64 | 支持目标 | 支持 | CLI 位于 `PATH` 时支持 | 已加入 Ubuntu CI |
| Linux/macOS 上的 Docker | 支持 | 支持 | 需要自定义镜像并挂载宿主 CLI | 本地 CLI 建议直接运行 Node |

CI 会在 Ubuntu、macOS 和 Windows 上使用 Node.js 24 运行同一套检查和测试。

## 环境要求

- Node.js 24 或更高版本
- npm
- Git，用于仓库与 Worktree 工作流
- Codex 或其他本地 CLI，仅在使用 Command Adapter 时需要

检查运行时：

```bash
node --version
npm --version
```

## 直接启动

建议所有平台直接运行 Node 进程，因为 Command Adapter 会继承当前终端的 `PATH` 和用户环境。

### macOS 与 Linux

```bash
cp .env.example .env
CROSSSTAFF_DATA_DIR=./data CROSSSTAFF_ALLOW_COMMANDS=1 npm start
```

### Windows PowerShell

```powershell
Copy-Item .env.example .env
$env:CROSSSTAFF_DATA_DIR = ".\data"
$env:CROSSSTAFF_ALLOW_COMMANDS = "1"
npm start
```

打开 <http://localhost:8787>。

## 隔离 Codex CLI

登录脚本会把 Codex 凭据保存在 CrossStaff 数据目录，不修改 Codex 桌面应用使用的配置。

### macOS 与 Linux

```bash
chmod +x scripts/login-codex-cli.sh
./scripts/login-codex-cli.sh
```

也可以显式传入路径：

```bash
./scripts/login-codex-cli.sh /absolute/path/to/crossstaff/data/codex-cli-home
```

### Windows

```powershell
.\scripts\login-codex-cli.ps1
```

macOS/Linux 的 Codex AgentMode 使用绝对路径：

```json
{
  "CODEX_HOME": "/absolute/path/to/crossstaff/data/codex-cli-home"
}
```

Windows：

```json
{
  "CODEX_HOME": "C:\\absolute\\path\\to\\crossstaff\\data\\codex-cli-home",
  "HOME": "C:\\Users\\your-user"
}
```

Codex 必须位于启动 CrossStaff 的同一个 `PATH`：

```bash
command -v codex
codex login status
```

修改 CLI 安装位置或认证状态后，请从同一个终端重新启动 CrossStaff。

## Docker

内置 Dockerfile 可以运行 Web UI、SQLite 以及 API/Mock Adapter：

```bash
docker build -t crossstaff .
docker run --rm -p 8787:8787 -v crossstaff-data:/data crossstaff
```

容器默认无法看到宿主机上的 Codex 或 Claude CLI。需要 Command Adapter 时，应构建包含相应 CLI 的自定义镜像，并且只挂载必需的凭据和配置路径。不要把容器直接暴露到公网。

## 常见问题

### `codex: command not found`

安装 CLI，重新打开终端，确认 `command -v codex` 有输出，然后从该终端启动 CrossStaff。

### `EADDRINUSE`

改用其他本地端口：

```bash
PORT=8788 npm start
```

PowerShell：

```powershell
$env:PORT = "8788"
npm start
```

### SQLite 或数据目录权限错误

把数据目录指向当前用户可写的位置：

```bash
CROSSSTAFF_DATA_DIR="$HOME/.local/share/crossstaff" npm start
```

当前 Alpha 没有身份认证或租户隔离。请保持 localhost 绑定，不要把端口 `8787` 暴露到不可信网络。
