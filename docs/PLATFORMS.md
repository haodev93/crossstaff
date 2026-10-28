# Platform Guide

[English](PLATFORMS.md) · [简体中文](PLATFORMS.zh-CN.md)

CrossStaff uses Node.js 24, the built-in `node:sqlite` module, standard path APIs, and Node child processes. The application does not contain native add-ons or platform-specific runtime dependencies.

## Support matrix

| Platform | Direct Node process | API and Mock adapters | Local Command adapters | Notes |
| --- | --- | --- | --- | --- |
| Windows 10/11 | Supported | Supported | Supported | Primary development target |
| macOS Intel / Apple Silicon | Supported target | Supported | Supported when the CLI is on `PATH` | Covered by the macOS CI job |
| Linux x64 / arm64 | Supported target | Supported | Supported when the CLI is on `PATH` | Covered by the Ubuntu CI job |
| Docker on Linux/macOS | Supported | Supported | Requires a custom image and mounted host CLIs | Direct Node execution is recommended for local CLIs |

CI runs the same checks and tests on Ubuntu, macOS, and Windows with Node.js 24.

## Requirements

- Node.js 24 or newer
- npm
- Git for repository workflows
- Codex or another local CLI only when using a Command Adapter

Verify the runtime:

```bash
node --version
npm --version
```

## Start directly

Direct execution is the recommended mode on every platform because Command Adapters inherit the terminal's `PATH` and user context.

### macOS and Linux

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

Open <http://localhost:8787>.

## Isolate Codex CLI

The helper stores Codex credentials under CrossStaff's data directory without changing the Codex desktop app profile.

### macOS and Linux

```bash
chmod +x scripts/login-codex-cli.sh
./scripts/login-codex-cli.sh
```

Use an explicit path when needed:

```bash
./scripts/login-codex-cli.sh /absolute/path/to/crossstaff/data/codex-cli-home
```

### Windows

```powershell
.\scripts\login-codex-cli.ps1
```

For a Unix Codex AgentMode, use an absolute `CODEX_HOME`:

```json
{
  "CODEX_HOME": "/absolute/path/to/crossstaff/data/codex-cli-home"
}
```

For Windows:

```json
{
  "CODEX_HOME": "C:\\absolute\\path\\to\\crossstaff\\data\\codex-cli-home",
  "HOME": "C:\\Users\\your-user"
}
```

The CLI must be available on the same `PATH` that launched CrossStaff:

```bash
command -v codex
codex login status
```

Restart CrossStaff from that same shell after changing CLI installation or authentication.

## Docker

The included Dockerfile supports the Web UI, SQLite, and API/Mock adapters:

```bash
docker build -t crossstaff .
docker run --rm -p 8787:8787 -v crossstaff-data:/data crossstaff
```

A container cannot see host Codex or Claude CLIs by default. To use Command Adapters in Docker, build a custom image containing the CLI and mount only the required credential/config paths. Do not expose the container directly to the public internet.

## Troubleshooting

### `codex: command not found`

Install the CLI, open a new shell, verify it with `command -v codex`, then start CrossStaff from that shell.

### `EADDRINUSE`

Use another local port:

```bash
PORT=8788 npm start
```

On PowerShell:

```powershell
$env:PORT = "8788"
npm start
```

### SQLite or data permissions

Point CrossStaff to a writable directory:

```bash
CROSSSTAFF_DATA_DIR="$HOME/.local/share/crossstaff" npm start
```

The current alpha has no authentication or tenant isolation. Keep it bound to localhost and do not expose port `8787` to an untrusted network.
