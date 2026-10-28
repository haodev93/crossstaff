# API Provider Guide

[English](API-PROVIDERS.md) · [简体中文](API-PROVIDERS.zh-CN.md)

CrossStaff currently has one direct HTTP contract: **OpenAI-compatible Chat Completions**.

```http
POST {baseUrl}/chat/completions
Authorization: Bearer <runtime API key>
Content-Type: application/json
```

The response must contain the final text at:

```text
choices[0].message.content
```

CrossStaff reads the secret from an environment variable in its own process. AgentMode configuration stores only the environment variable name.

## Compatibility matrix

| Provider/protocol | Direct API Adapter | Recommended path |
| --- | --- | --- |
| OpenAI official | Yes | Chat Completions |
| DeepSeek | Yes | OpenAI-compatible Chat Completions |
| Kimi / Moonshot | Yes when using its OpenAI-compatible endpoint | OpenAI-compatible |
| OpenRouter | Yes | OpenAI-compatible gateway |
| Ollama | Yes for the `/v1` endpoint | Local OpenAI-compatible |
| Azure OpenAI | No in the current adapter | Local bridge or OpenAI-compatible gateway |
| Anthropic Messages API | No | Command Adapter bridge or compatible gateway |
| Google Gemini `generateContent` | No | Command Adapter bridge or compatible gateway |

“Bridge” means a trusted local process that receives CrossStaff's prompt on stdin, calls the provider's native API, and writes final text to stdout.

## OpenAI official API

Create an API key from the [OpenAI API dashboard](https://platform.openai.com/api-keys), then place it only in `.env` or the CrossStaff process environment:

```dotenv
OPENAI_API_KEY=your-openai-api-key
```

AgentMode adapter:

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

OpenAI recommends Responses for new projects. CrossStaff currently calls Chat Completions for compatibility with third-party providers; see the official [Chat Completions overview](https://developers.openai.com/api/reference/chat-completions/overview.md).

Some models reject custom `temperature` or legacy token-limit parameters. Omit optional tuning fields unless the selected model's documentation supports them.

Model availability and aliases change. Confirm the model shown in your account's [API model catalog](https://developers.openai.com/api/docs/models).

## DeepSeek

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

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

CrossStaff appends `/chat/completions` when it is missing.

## Kimi / Moonshot

Use the base URL and model identifier assigned to your Moonshot account and region:

```dotenv
MOONSHOT_API_KEY=your-moonshot-api-key
```

```json
{
  "type": "api",
  "provider": "openai-compatible",
  "baseUrl": "https://api.moonshot.cn/v1",
  "model": "your-kimi-model",
  "apiKeyEnv": "MOONSHOT_API_KEY",
  "timeoutMs": 300000
}
```

For the global platform, use the OpenAI-compatible base URL documented by Moonshot, commonly `https://api.moonshot.ai/v1`. Keep the model identifier exactly as shown in your provider dashboard.

The Kimi Code **CLI** is a separate integration and is documented in [ADAPTERS.md](ADAPTERS.md).

## OpenRouter

OpenRouter exposes an OpenAI-compatible API and can route many providers through one account:

```dotenv
OPENROUTER_API_KEY=your-openrouter-key
```

```json
{
  "type": "api",
  "provider": "openai-compatible",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "provider/model-id",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "timeoutMs": 300000
}
```

Replace `provider/model-id` with an exact model ID available to your account.

## Ollama

Ollama's OpenAI-compatible endpoint usually runs at:

```dotenv
OLLAMA_API_KEY=ollama
```

The value is a non-empty local placeholder; Ollama normally does not validate it.

```json
{
  "type": "api",
  "provider": "openai-compatible",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "model": "qwen3:8b",
  "apiKeyEnv": "OLLAMA_API_KEY",
  "timeoutMs": 300000
}
```

Use the exact local model name from `ollama list`.

## Other OpenAI-compatible providers

Use the same pattern when the provider documents all of the following:

- A base URL that exposes `POST /chat/completions`.
- Bearer token authentication.
- Chat Completions request messages.
- Final text in `choices[0].message.content`.

```json
{
  "type": "api",
  "provider": "openai-compatible",
  "baseUrl": "https://provider.example/v1",
  "model": "provider-model-id",
  "apiKeyEnv": "PROVIDER_API_KEY",
  "timeoutMs": 180000
}
```

Set `PROVIDER_API_KEY` in the CrossStaff process environment before startup.

## Non-compatible APIs

### Anthropic Messages API

Anthropic's native format differs from Chat Completions:

- Path: `/v1/messages`
- Authentication: `x-api-key`
- Additional header: `anthropic-version`
- Final response: text blocks inside a `content` array

Use a small local Command Adapter bridge. A minimal Node.js bridge can follow this shape:

```js
const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const prompt = await readStdin();
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "your-anthropic-model",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  }),
});
if (!response.ok) throw new Error(await response.text());
const payload = await response.json();
process.stdout.write(
  payload.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n"),
);
```

Configure the bridge as a Command Adapter:

```json
{
  "type": "command",
  "command": "node",
  "args": ["C:\\path\\to\\anthropic-bridge.mjs"],
  "timeoutMs": 300000
}
```

Set `ANTHROPIC_API_KEY` in the CrossStaff process environment and start CrossStaff with `CROSSSTAFF_ALLOW_COMMANDS=1`. The wrapper must implement stdin reading and provider-specific response extraction.

### Google Gemini

Gemini's native API uses:

- Path shape: `/v1beta/models/{model}:generateContent`
- Authentication through an API-key header or provider-supported auth
- Response text under `candidates[].content.parts[]`

Use the same Command Adapter bridge pattern, translating the CrossStaff prompt into `contents[].parts[].text` and extracting the final answer from `candidates[].content.parts[]`.

### Azure OpenAI

Azure OpenAI differs in deployment path, `api-version` query parameters, and often `api-key` authentication rather than Bearer authentication. CrossStaff's API Adapter does not implement these overrides.

Recommended options:

1. Put an OpenAI-compatible gateway in front of Azure OpenAI.
2. Use a trusted Command Adapter bridge that constructs the deployment URL and headers.

Do not write Azure keys or other credentials into AgentMode fields.

## Security rules

- Never put a real API key in `apiKeyEnv`; enter only the environment variable name.
- Never commit `.env`.
- Command Adapter bridges are not sandboxed. Review every script and set conservative timeouts.
- Use different API keys for different employees when accounting or revocation requires it.
- Provider rate limits must be paused and resolved; CrossStaff does not rotate credentials to bypass quotas.
