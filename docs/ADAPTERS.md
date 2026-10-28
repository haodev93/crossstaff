# API and Command Adapter Guide

CrossStaff's current Command Adapter starts a configured executable without a shell, sends the complete task prompt to stdin, reads stdout as the result, and treats exit code `0` as success.

See the [Platform Guide](PLATFORMS.md) for direct Node versus Docker behavior.

Enable it only after reviewing the security implications:

macOS / Linux:

```bash
CROSSSTAFF_ALLOW_COMMANDS=1 npm start
```

Windows:

```powershell
$env:CROSSSTAFF_ALLOW_COMMANDS = "1"
npm start
```

## OpenAI-compatible HTTP API

CrossStaff supports direct non-streaming Chat Completions API calls. The API key is referenced by environment variable name; the secret remains in the CrossStaff server process.

### OpenAI official

```dotenv
OPENAI_API_KEY=your-openai-api-key
```

```json
{
  "type": "api",
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-6.1-sol",
  "apiKeyEnv": "OPENAI_API_KEY",
  "timeoutMs": 180000
}
```

OpenAI recommends Responses for new projects. CrossStaff currently calls Chat Completions for compatibility with third-party providers. Confirm model availability in the [official API model catalog](https://developers.openai.com/api/docs/models).

Some OpenAI models reject custom `temperature` or legacy token-limit parameters. Omit optional tuning fields unless that model's documentation confirms them.

### DeepSeek

Start CrossStaff after setting the key locally:

macOS / Linux:

```bash
CROSSSTAFF_ALLOW_COMMANDS=0 DEEPSEEK_API_KEY="<set locally>" npm start
```

Windows:

```powershell
$env:DEEPSEEK_API_KEY = "<set locally>"
npm start
```

AgentMode adapter:

```json
{
  "type": "api",
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-flash",
  "apiKeyEnv": "DEEPSEEK_API_KEY",
  "timeoutMs": 180000
}
```

DeepSeek's official API is OpenAI-compatible and uses `https://api.deepseek.com` as its OpenAI base URL. The endpoint invoked by CrossStaff is `/chat/completions`.

Never put the actual key in `apiKeyEnv`; it accepts only an environment variable name.

### Kimi, OpenRouter, Ollama, and other compatible APIs

Use the same API Adapter when the provider exposes Bearer-authenticated `POST /chat/completions` and returns final text in `choices[0].message.content`.

The complete provider matrix, Kimi/Moonshot and OpenRouter examples, local Ollama setup, and native Anthropic/Gemini/Azure bridge patterns are in the [API Provider Guide](API-PROVIDERS.md).

## Kimi Code

Kimi Code CLI uses a prompt argument rather than a bare stdin prompt. In testing, `kimi -p -` reads the prompt from stdin.

Verify installation and account access:

```powershell
kimi --version
kimi doctor
kimi -p "Return exactly KIMI_OK" --output-format text
```

### Windows `.cmd` configuration

The npm-installed `kimi` command is commonly a `.cmd` shim. Use a fixed command line through `cmd.exe` so the prompt still travels over stdin:

```text
Command:
C:\Windows\System32\cmd.exe

Arguments JSON:
["/d","/s","/c","kimi -p - --output-format text"]

Working directory:
C:\path\to\your\repo

Timeout:
600000
```

The command itself is fixed. CrossStaff does not interpolate the Prompt into the command line.

When `kimi` resolves to a directly executable binary on another platform:

```text
Command:
kimi

Arguments JSON:
["-p","-","--output-format","text"]
```

Do not add `--auto` to unattended examples unless the workspace and permissions have been deliberately constrained.

If Kimi returns:

```text
provider.auth_error: 403 Your current subscription does not have access to Kimi Code
```

the Adapter and stdin handoff worked; the remaining blocker is Kimi account entitlement rather than CrossStaff.

## Codex

### Isolate Codex CLI from the ChatGPT app

Use a separate `CODEX_HOME` for CrossStaff's Codex adapters. This prevents CLI login/config changes from replacing the profile used by the desktop app.

Windows:

```powershell
.\scripts\login-codex-cli.ps1
```

macOS / Linux:

```bash
chmod +x scripts/login-codex-cli.sh
./scripts/login-codex-cli.sh
```

The default isolated home is:

```text
<repository>\data\codex-cli-home
```

On macOS/Linux the equivalent is `<repository>/data/codex-cli-home`. When configuring the AgentMode, set:

```json
{
  "CODEX_HOME": "C:\\absolute\\path\\to\\crossstaff\\data\\codex-cli-home",
  "HOME": "C:\\Users\\your-user"
}
```

For macOS or Linux:

```json
{
  "CODEX_HOME": "/absolute/path/to/crossstaff/data/codex-cli-home"
}
```

Only path-oriented environment variables are accepted. API keys, cookies, and access tokens are rejected.

Verify the installed CLI and authentication first:

```bash
codex --version
codex login
codex exec --help
```

Working directories in the examples below are platform-specific. Use an absolute native path, such as `C:\src\project` on Windows or `/Users/you/src/project` on macOS.

### Codex writer mode

```text
Command:
codex

Arguments JSON:
["exec","--sandbox","workspace-write","--color","never","--ephemeral","-"]

Working directory:
C:\path\to\your\repo

Timeout:
600000
```

### Codex reviewer mode

Use a different Employee from the writer:

```text
Command:
codex

Arguments JSON:
["exec","--sandbox","read-only","--color","never","--ephemeral","-"]

Working directory:
C:\path\to\your\repo

Timeout:
600000
```

Add `--skip-git-repo-check` only when intentionally testing a non-Git directory.

Do not use `--dangerously-bypass-approvals-and-sandbox` in CrossStaff examples.

The Codex `-` prompt argument means "read the prompt from stdin." CrossStaff supplies stdin automatically.

## Claude Code

Verify installation:

macOS / Linux:

```bash
command -v claude
claude --version
```

Windows:

```powershell
where.exe claude
claude --version
```

The official non-interactive mode uses `-p` / `--print`, reads stdin, and returns output according to `--output-format`.

### Claude Code reviewer mode

```text
Command:
claude

Arguments JSON:
["-p","--output-format","text","--tools","Read","--allowedTools","Read"]

Working directory:
C:\path\to\your\repo

Timeout:
600000
```

`--tools Read` restricts the built-in tool set. `--allowedTools Read` avoids an approval prompt for that read-only tool.

### Claude Code writer mode

Use an isolated worktree and a separate Employee:

```text
Command:
claude

Arguments JSON:
["-p","--output-format","text","--tools","Read,Edit,Bash","--allowedTools","Read,Edit,Bash"]

Working directory:
C:\path\to\your\repo

Timeout:
600000
```

Without `--bare`, Claude Code loads project and user hooks, MCP configuration, plugins, auto memory, and `CLAUDE.md`. Only run this in a trusted repository. `--bare` is recommended for scripted API-key usage, but it does not use the normal subscription OAuth login. Read the official bare-mode guidance before adding it.

## Windows `.cmd` wrapper

If `where.exe claude` returns `claude.cmd`, Node's shell-free spawn may not execute it directly. Use a fixed, trusted wrapper:

```js
import { spawn } from "node:child_process";

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

const isWindows = process.platform === "win32";
const command = isWindows ? (process.env.ComSpec || "cmd.exe") : "claude";
const args = isWindows
  ? [
      "/d",
      "/s",
      "/c",
      'claude -p --output-format text --tools "Read" --allowedTools "Read"',
    ]
  : ["-p", "--output-format", "text", "--tools", "Read", "--allowedTools", "Read"];

const child = spawn(command, args, {
  stdio: ["pipe", "inherit", "inherit"],
  windowsHide: true,
});

child.stdin.end(prompt);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
```

Configure:

```text
Command:
node

Arguments JSON:
["C:\\absolute\\path\\to\\claude-reviewer-wrapper.mjs"]
```

The wrapper command is fixed. User or model input stays on stdin and is never interpolated into the shell command.

## Employee and seat isolation

A Command Adapter selects the execution mechanism, not the account. CrossStaff does not currently inject per-mode credentials.

- Authenticate the executable under the intended account before starting CrossStaff.
- Use separate operating-system users, configuration roots, or trusted wrappers when two Employees require different credentials.
- Never store passwords, API keys, cookies, or OAuth tokens in Employee or AgentMode fields.
- One active SeatBinding represents one Employee. Two modes of the same Employee are not independent review identities.

## Room membership

Employees are organization-level objects and can join multiple Rooms. AgentModes are not copied when an Employee joins another Room; all of that Employee's modes become available through the membership.

## Smoke test without a model

Use this configuration to test the Adapter protocol without spending model quota:

```text
Command:
node

Arguments JSON:
["-e","process.stdin.pipe(process.stdout)"]
```

The complete prompt should appear in the CrossStaff run output.
