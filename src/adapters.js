import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export class AgentRuntime {
  constructor({
    allowCommands = false,
    defaultTimeoutMs = 120000,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = {}) {
    this.allowCommands = allowCommands;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
  }

  async execute({ agent, prompt, signal }) {
    const adapter = agent.adapter ?? { type: "mock" };
    if (adapter.type === "api") {
      return this.executeApi({ agent, adapter, prompt, signal });
    }
    if (adapter.type === "command") {
      return this.executeCommand({ agent, adapter, prompt, signal });
    }
    return this.executeMock({ agent, adapter, prompt, signal });
  }

  async executeApi({ agent, adapter, prompt, signal }) {
    const apiKey = process.env[adapter.apiKeyEnv];
    if (!apiKey) {
      throw new Error(
        `API credential environment variable ${adapter.apiKeyEnv} is not set`,
      );
    }
    const endpoint = buildChatCompletionsUrl(adapter.baseUrl);
    const timeoutSignal = AbortSignal.timeout(
      Math.min(Math.max(Number(adapter.timeoutMs) || 120000, 1000), 900000),
    );
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: adapter.model,
          messages: [
            {
              role: "system",
              content:
                agent.instructions ||
                "You are a digital employee executing an assigned workflow step.",
            },
            { role: "user", content: prompt },
          ],
          stream: false,
          ...(adapter.maxTokens ? { max_tokens: adapter.maxTokens } : {}),
          ...(adapter.temperature === null
            ? {}
            : { temperature: adapter.temperature }),
        }),
        signal: requestSignal,
      });
    } catch (error) {
      if (error?.name === "AbortError" || requestSignal.aborted) {
        throw createAbortError("API adapter request was canceled or timed out");
      }
      throw new Error(`API adapter request failed: ${error?.message || error}`);
    }
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `API adapter returned HTTP ${response.status}: ${extractApiError(body)}`,
      );
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("API adapter returned invalid JSON");
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("API adapter response did not contain message content");
    }
    return content.trim();
  }

  async executeMock({ agent, adapter, prompt, signal }) {
    await abortableDelay(agent.role === "reviewer" ? 360 : 520, signal);
    const title = extractTaskTitle(prompt);

    if (/acting as the acceptance reviewer/i.test(prompt)) {
      const stepMatches = [
        ...String(prompt).matchAll(
          /stepId=([^;]+); employee=([^;]+); mode=([^;]+); step=([^\n]+)/gi,
        ),
      ];
      const needsChanges = /\[changes\]/i.test(prompt);
      const evaluations = stepMatches.map((match, index) => ({
        stepId: match[1].trim(),
        score: needsChanges ? 72 - index * 3 : 88 - index * 2,
        verdict: needsChanges ? "needs_work" : "passed",
        comment: needsChanges
          ? "The acceptance contract requested a changes review."
          : "The step produced a reviewable result consistent with the mock workflow.",
      }));
      return JSON.stringify(
        {
          verdict: needsChanges ? "changes_requested" : "accepted",
          summary: needsChanges
            ? "The workflow needs another pass before acceptance."
            : "All workflow steps meet the simulated acceptance criteria.",
          evaluations,
        },
        null,
        2,
      );
    }

    if (agent.role === "reviewer" || adapter.behavior === "reviewer") {
      if (/\[changes\]/i.test(prompt)) {
        return [
          "VERDICT: changes_requested",
          "",
          "Summary",
          "The simulated handoff includes an intentional change request.",
          "",
          "Findings",
          "1. HIGH — Verify the implementation against the acceptance criteria before merge.",
          "   Evidence: the mock task requested a changes review.",
          "   Recommendation: return the task to the builder and rerun tests.",
        ].join("\n");
      }

      return [
        "VERDICT: approved",
        "",
        `Review target: ${title}`,
        "",
        "Findings",
        "- No blocking issues were found in this simulated review.",
        "- The handoff is clearly attributed to one builder agent and one provider account.",
        "- Real CLI output will replace this mock result when a command adapter is configured.",
      ].join("\n");
    }

    return [
      `Implementation handoff: ${title}`,
      "",
      "Summary",
      "- Interpreted the requested change and prepared a review-ready handoff.",
      "- Listed the key implementation and test evidence in this simulated run.",
      "- No production files were modified by the mock adapter.",
      "",
      "Tests",
      "- Mock validation: PASS",
      "",
      "Open risks",
      "- This response is generated by the built-in demo adapter.",
    ].join("\n");
  }

  async executeCommand({ agent, adapter, prompt, signal }) {
    if (!this.allowCommands) {
      throw new Error(
        "Command adapters are disabled. Set CROSSSTAFF_ALLOW_COMMANDS=1 after reviewing the security model.",
      );
    }

    const workingDir = resolve(adapter.workingDir || process.cwd());
    if (!existsSync(workingDir) || !statSync(workingDir).isDirectory()) {
      throw new Error(`Command working directory does not exist: ${workingDir}`);
    }

    const timeoutMs = Math.min(
      Math.max(Number(adapter.timeoutMs) || this.defaultTimeoutMs, 1000),
      900000,
    );

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let outputBytes = 0;
      let stdout = "";
      let stderr = "";

      const child = spawn(adapter.command, adapter.args ?? [], {
        cwd: workingDir,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          ...(adapter.env ?? {}),
          CROSSSTAFF_AGENT_ID: agent.id,
          CROSSSTAFF_AGENT_ROLE: agent.role,
          AGENTSTAFF_AGENT_ID: agent.id,
          AGENTSTAFF_AGENT_ROLE: agent.role,
          HUDDLE_AGENT_ID: agent.id,
          HUDDLE_AGENT_ROLE: agent.role,
          AGENTHUB_AGENT_ID: agent.id,
          AGENTHUB_AGENT_ROLE: agent.role,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };

      const terminate = (reason) => {
        if (!child.killed) child.kill();
        finish(rejectPromise, createAbortError(reason));
      };

      const onAbort = () => terminate("Agent run canceled");
      signal?.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => terminate(`Agent command timed out after ${timeoutMs}ms`), timeoutMs);

      const capture = (chunk, target) => {
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          terminate(`Agent output exceeded ${this.maxOutputBytes} bytes`);
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };

      child.stdout.on("data", (chunk) => capture(chunk, "stdout"));
      child.stderr.on("data", (chunk) => capture(chunk, "stderr"));
      child.on("error", (error) => {
        finish(rejectPromise, new Error(`Failed to start command adapter: ${error.message}`));
      });
      child.on("close", (code, exitSignal) => {
        if (settled) return;
        if (code === 0) {
          finish(resolvePromise, stdout.trim());
          return;
        }
        const detail = stderr.trim() || stdout.trim();
        finish(
          rejectPromise,
          new Error(
            `Agent command exited with ${code ?? exitSignal ?? "unknown status"}${detail ? `: ${detail}` : ""}`,
          ),
        );
      });

      child.stdin.end(prompt);
    });
  }
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(createAbortError("Agent run canceled"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(createAbortError("Agent run canceled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function extractTaskTitle(prompt) {
  const match = /Task:\s*([^\n]+)/i.exec(prompt);
  return match?.[1]?.trim() || "Untitled task";
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function buildChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith("/chat/completions")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  }
  return url.toString();
}

function extractApiError(body) {
  try {
    const payload = JSON.parse(body);
    return (
      payload?.error?.message ||
      payload?.message ||
      body.slice(0, 500) ||
      "Unknown API error"
    );
  } catch {
    return body.slice(0, 500) || "Unknown API error";
  }
}
