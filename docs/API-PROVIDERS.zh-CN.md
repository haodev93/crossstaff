# API Provider 指南

[English](API-PROVIDERS.md) · [简体中文](API-PROVIDERS.zh-CN.md)

CrossStaff 当前的直连 HTTP 合同只有一种：**OpenAI-compatible Chat Completions**。

```http
POST {baseUrl}/chat/completions
Authorization: Bearer <运行时 API Key>
Content-Type: application/json
```

响应中的最终文本必须位于：

```text
choices[0].message.content
```

CrossStaff 只从自身进程环境读取密钥，AgentMode 配置只保存环境变量名称。

## 兼容性矩阵

| Provider / 协议 | API Adapter 直连 | 推荐方式 |
| --- | --- | --- |
| OpenAI 官方 | 支持 | Chat Completions |
| DeepSeek | 支持 | OpenAI-compatible Chat Completions |
| Kimi / Moonshot | 其 OpenAI-compatible 接口支持 | OpenAI-compatible |
| OpenRouter | 支持 | OpenAI-compatible Gateway |
| Ollama | `/v1` 接口支持 | 本地 OpenAI-compatible |
| Azure OpenAI | 当前 Adapter 不支持 | 本地 Bridge 或兼容网关 |
| Anthropic Messages API | 不支持 | Command Adapter Bridge 或兼容网关 |
| Google Gemini `generateContent` | 不支持 | Command Adapter Bridge 或兼容网关 |

“Bridge”指一个可信的本地进程：从 stdin 接收 CrossStaff Prompt，调用 Provider 原生 API，再把最终文本写入 stdout。

## OpenAI 官方 API

从 [OpenAI API 控制台](https://platform.openai.com/api-keys)创建 Key，只放在 `.env` 或 CrossStaff 进程环境：

```dotenv
OPENAI_API_KEY=your-openai-api-key
```

AgentMode adapter：

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

OpenAI 官方建议新项目优先使用 Responses；CrossStaff 当前为了兼容第三方 Provider 使用 Chat Completions。参见官方 [Chat Completions Overview](https://developers.openai.com/api/reference/chat-completions/overview.md)。

部分 OpenAI 模型不接受自定义 `temperature` 或旧式 token 上限参数。除非所选模型的官方文档明确支持，否则不要添加这些可选字段。

模型名称和可用性会变化，请在账号的 [API Model Catalog](https://developers.openai.com/api/docs/models) 中确认。

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

如果 Base URL 未包含 `/chat/completions`，CrossStaff 会自动追加。

## Kimi / Moonshot

使用 Moonshot 账号和区域对应的 Base URL 与模型 ID：

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

国际平台通常使用 Moonshot 文档提供的 `https://api.moonshot.ai/v1`；模型 ID 必须与 Provider 控制台完全一致。

Kimi Code **CLI** 是另一种接入方式，见 [ADAPTERS.md](ADAPTERS.md)。

## OpenRouter

OpenRouter 提供 OpenAI-compatible 接口，可用一个账号路由多个 Provider：

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

把 `provider/model-id` 替换为账号可用的准确模型 ID。

## Ollama

Ollama 的 OpenAI-compatible 接口通常位于：

```dotenv
OLLAMA_API_KEY=ollama
```

这个值只是本地占位符，必须非空；Ollama 通常不会验证它。

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

模型名称以 `ollama list` 为准。

## 其他 OpenAI-compatible API

如果 Provider 同时满足以下条件，可以直接使用同一个配置模式：

- Base URL 提供 `POST /chat/completions`。
- 使用 Bearer Token。
- 接受 Chat Completions `messages`。
- 最终文本位于 `choices[0].message.content`。

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

启动 CrossStaff 前，在进程环境中设置 `PROVIDER_API_KEY`。

## 非兼容 API

### Anthropic Messages API

Anthropic 原生协议与 Chat Completions 不同：

- 路径：`/v1/messages`
- 鉴权：`x-api-key`
- 额外 Header：`anthropic-version`
- 最终文本位于 `content` 数组的 text block 中

建议使用可信的本地 Command Adapter Bridge。一个最小 Node.js Bridge 的结构如下：

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

配置为 Command Adapter：

```json
{
  "type": "command",
  "command": "node",
  "args": ["C:\\path\\to\\anthropic-bridge.mjs"],
  "timeoutMs": 300000
}
```

在 CrossStaff 进程环境中设置 `ANTHROPIC_API_KEY`，并使用 `CROSSSTAFF_ALLOW_COMMANDS=1` 启动。脚本需要自行实现 stdin 读取和 Provider 响应解析。

### Google Gemini

Gemini 原生接口使用：

- 路径形式：`/v1beta/models/{model}:generateContent`
- API Key Header 或 Provider 支持的鉴权
- 最终文本位于 `candidates[].content.parts[]`

使用同样的 Command Adapter Bridge 模式，把 CrossStaff Prompt 映射为 `contents[].parts[].text`，再从 `candidates[].content.parts[]` 提取结果。

### Azure OpenAI

Azure OpenAI 的 deployment 路径、`api-version` 查询参数以及常见的 `api-key` 鉴权都与标准 OpenAI API 不同。当前 CrossStaff API Adapter 不支持这些覆盖。

推荐方式：

1. 在 Azure OpenAI 前配置 OpenAI-compatible Gateway。
2. 使用可信的 Command Adapter Bridge 构造 deployment URL 和 Header。

不要把 Azure Key 或其他凭据填写到 AgentMode 字段中。

## 安全规则

- `apiKeyEnv` 只填写环境变量名称，绝不填写真实 Key。
- 不要提交 `.env`。
- Command Adapter Bridge 不受沙箱保护；必须审查脚本并设置保守的超时。
- 需要独立计量或撤销时，为不同员工使用不同 API Key。
- Provider 限流时应暂停任务并等待恢复；CrossStaff 不使用凭据轮换绕过配额。
