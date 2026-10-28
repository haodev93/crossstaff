# CrossStaff Quick Start

[English](QUICKSTART.md) · [简体中文](QUICKSTART.zh-CN.md) · [Platform Guide](PLATFORMS.md)

This guide runs the **first workflow with a real model**. Choose one path:

- **DeepSeek API** — recommended; no local CLI installation.
- **Codex CLI** — uses an installed and authenticated Codex CLI.

The built-in Mock Adapter remains available for free protocol testing, but it is not the default Quick Start path.

## 1. Requirements

- Node.js 24 or newer
- A DeepSeek API key **or** Codex CLI with an authorized login
- Windows, macOS, or Linux

Check Node.js:

```bash
node --version
```

## 2. Prepare a fresh workspace

Clone using the URL shown by the GitHub **Code** button:

```bash
git clone <repository-url>
cd <repository-directory>
```

Create `.env`:

### Windows

```powershell
Copy-Item .env.example .env
notepad .env
```

### macOS / Linux

```bash
cp .env.example .env
${EDITOR:-vi} .env
```

Use a fresh local data directory so old rooms and configuration do not interfere.

## Path A: OpenAI-compatible API

DeepSeek is used as the verified example. The same process works for any provider exposing an OpenAI-compatible `/chat/completions` endpoint.

### A1. Configure the key

For DeepSeek, set in `.env`:

```dotenv
DEEPSEEK_API_KEY=your-real-key
CROSSSTAFF_ALLOW_COMMANDS=0
```

Never send the real key through the CrossStaff UI or HTTP API.

### A2. Start CrossStaff

Windows:

```powershell
$env:CROSSSTAFF_DATA_DIR = ".\data\quickstart-real"
npm start
```

macOS / Linux:

```bash
CROSSSTAFF_DATA_DIR=./data/quickstart-real npm start
```

Open <http://localhost:8787>.

### A3. Complete the setup wizard

Create the first room:

```text
Room name: My first agent team
Description: Verify a real model workflow
```

Create the first employee for the API seat:

```text
Employee name: DeepSeek Guide Agent
Job title: API Assistant
Provider: DeepSeek (or the matching provider)
Authorization: Official API
Seat binding label: Quick Start API Seat
```

In the same wizard, configure the first AgentMode:

```text
Mode name: DeepSeek Guide Mode
Custom role name: researcher
Responsibilities: Give concise, practical, evidence-based answers.
Adapter: API (OpenAI-compatible)
API provider: DeepSeek (or OpenAI-compatible)
Base URL: https://api.deepseek.com
Model: deepseek-flash
API key environment variable: DEEPSEEK_API_KEY
API timeout: 180000
```

For another provider, replace the Base URL, model, and environment variable name. The secret must already exist in the CrossStaff server process or local `.env`.

### A4. Run the first real workflow

Open the project room and select **New workflow**:

```text
Title: Real Quick Start Workflow

Objective:
Explain three checks a reliable code delivery should include. Be concise.
```

Work step:

```text
Step name: Produce delivery checklist
Agent mode: DeepSeek Guide Mode
Dependencies: None
```

Acceptance mode:

```text
DeepSeek Guide Mode
```

Select **Create and run**.

### A5. Expected result

This path was verified with the real DeepSeek API. A successful run produces:

- Real DeepSeek content in the room.
- Work step status `completed`.
- Automatic acceptance step status `completed`.
- Workflow verdict `accepted`.
- A real acceptance score such as `95`.

The model returns a checklist similar to:

```text
- Peer review passed
- Automated checks passed
- Release readiness confirmed
```

API calls may incur provider charges.

## Path B: Codex CLI

### B1. Verify and authenticate Codex

```powershell
codex --version
codex login
codex login status
```

For profile isolation from the Codex desktop app:

Windows:

```powershell
.\scripts\login-codex-cli.ps1
```

macOS / Linux:

```bash
chmod +x scripts/login-codex-cli.sh
./scripts/login-codex-cli.sh
```

Use the same absolute `CODEX_HOME` in the AgentMode environment.

### B2. Start CrossStaff with Command Adapter

Windows:

```powershell
$env:CROSSSTAFF_DATA_DIR = ".\data\quickstart-codex"
$env:CROSSSTAFF_ALLOW_COMMANDS = "1"
npm start
```

macOS / Linux:

```bash
CROSSSTAFF_DATA_DIR=./data/quickstart-codex CROSSSTAFF_ALLOW_COMMANDS=1 npm start
```

Open <http://localhost:8787> and complete the room and employee wizard.

Create the employee as:

```text
Employee name: Codex CLI Agent
Provider: OpenAI
Authorization: Official CLI / OAuth
```

### B3. Configure Codex in the setup wizard

In step 4 of the setup wizard, choose **Local command**:

```text
Mode name: Codex Quickstart Mode
Custom role name: builder
Adapter: Local command
Command: codex
Arguments JSON:
["exec","--sandbox","read-only","--color","never","--ephemeral","-"]
Working directory: absolute path to a test repository
Timeout: 600000
```

For an isolated login on Windows, add:

```json
{
  "CODEX_HOME": "C:\\Users\\you\\Documents\\crossstaff\\data\\codex-cli-home",
  "HOME": "C:\\Users\\you"
}
```

On macOS / Linux:

```json
{
  "CODEX_HOME": "/Users/you/Documents/crossstaff/data/codex-cli-home"
}
```

The read-only sandbox is intentional for the first workflow. Do not use `--dangerously-bypass-approvals-and-sandbox` in public instructions.

### B4. Run the first Codex workflow

Create a workflow:

```text
Title: Codex CLI Quick Start

Objective:
Return a concise three-item checklist for reliable code delivery.
Do not inspect or modify files.
```

Assign `Codex Quickstart Mode` to the work step and as the acceptance mode.

Expected result:

- Real Codex CLI output.
- `completed` work and acceptance steps.
- `accepted` workflow verdict unless Codex output does not satisfy the objective.
- Acceptance score written to the employee performance record.

This path has been verified with an isolated Codex CLI login. Codex CLI may take over a minute to complete a request.

## Optional free smoke test

If you only want to test the workflow protocol without model cost, choose **Mock** as the AgentMode adapter. The Mock path calls no model and modifies no files.

## Troubleshooting

### Port 8787 is already in use

Stop the old CrossStaff process or use another port:

```powershell
$env:PORT = "8788"
npm start
```

On macOS / Linux:

```bash
PORT=8788 npm start
```

### Newly saved `.env` has no effect

CrossStaff reads `.env` only during startup. Restart `npm start`.

### DeepSeek reports a missing key

Check:

- `.env` is in the repository root.
- `DEEPSEEK_API_KEY=` has a non-empty real value.
- The AgentMode key environment is `DEEPSEEK_API_KEY`.
- CrossStaff was restarted after saving `.env`.

### Room chat does not wake an agent

Chat triggers a reply only when the message contains an AgentMode name:

```text
DeepSeek Guide Mode, hello
```

Workflows are started with **New workflow**.

### Codex says the workspace is read-only

The first workflow intentionally uses `--sandbox read-only`. For a later write task, use `workspace-write` and an isolated test repository or worktree. If CrossStaff itself is running inside another restricted sandbox, Codex may inherit a read-only policy.

## Next

- [HTTP API](API.md)
- [Adapters](ADAPTERS.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
