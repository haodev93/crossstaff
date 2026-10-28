import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "../src/adapters.js";

test("command adapter sends the prompt over stdin without a shell", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-adapter-"));
  try {
    const runtime = new AgentRuntime({ allowCommands: true });
    const output = await runtime.execute({
      agent: {
        id: "agent_test",
        role: "builder",
        adapter: {
          type: "command",
          command: process.execPath,
          args: ["-e", "process.stdin.pipe(process.stdout)"],
          workingDir: tempDir,
          timeoutMs: 3000,
        },
      },
      prompt: "round-trip prompt",
    });
    assert.equal(output, "round-trip prompt");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("command adapter is disabled by default", async () => {
  const runtime = new AgentRuntime();
  await assert.rejects(
    runtime.execute({
      agent: {
        id: "agent_test",
        role: "builder",
        adapter: {
          type: "command",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          workingDir: process.cwd(),
        },
      },
      prompt: "should not run",
    }),
    /disabled/,
  );
});

test("command adapter applies allowlisted path environment variables", async () => {
  const runtime = new AgentRuntime({ allowCommands: true });
  const isolatedHome = "C:\\isolated\\codex-home";
  const output = await runtime.execute({
    agent: {
      id: "agent_env",
      role: "builder",
      adapter: {
        type: "command",
        command: process.execPath,
        args: ["-e", "console.log(process.env.CODEX_HOME)"],
        workingDir: process.cwd(),
        timeoutMs: 3000,
        env: { CODEX_HOME: isolatedHome },
      },
    },
    prompt: "unused",
  });
  assert.equal(output, isolatedHome);
});

test("command adapter exposes CrossStaff and legacy agent context variables", async () => {
  const runtime = new AgentRuntime({ allowCommands: true });
  const output = await runtime.execute({
    agent: {
      id: "agent_env",
      role: "reviewer",
      adapter: {
        type: "command",
        command: process.execPath,
        args: [
          "-e",
          "console.log([process.env.CROSSSTAFF_AGENT_ID, process.env.CROSSSTAFF_AGENT_ROLE, process.env.AGENTSTAFF_AGENT_ID, process.env.AGENTSTAFF_AGENT_ROLE, process.env.HUDDLE_AGENT_ID, process.env.HUDDLE_AGENT_ROLE, process.env.AGENTHUB_AGENT_ID, process.env.AGENTHUB_AGENT_ROLE].join('|'))",
        ],
        workingDir: process.cwd(),
        timeoutMs: 3000,
      },
    },
    prompt: "unused",
  });
  assert.equal(
    output,
    "agent_env|reviewer|agent_env|reviewer|agent_env|reviewer|agent_env|reviewer",
  );
});

test("API adapter calls an OpenAI-compatible endpoint without storing the secret", async () => {
  let receivedAuthorization = "";
  let receivedBody = null;
  const server = createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization || "";
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: "DEEPSEEK_ADAPTER_OK" } }],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const envName = "CROSSSTAFF_TEST_DEEPSEEK_KEY";
  process.env[envName] = "test-secret";

  try {
    const runtime = new AgentRuntime({ allowCommands: false });
    const output = await runtime.execute({
      agent: {
        id: "agent_deepseek",
        role: "builder",
        instructions: "Answer concisely.",
        adapter: {
          type: "api",
          provider: "deepseek",
          baseUrl: `http://127.0.0.1:${address.port}`,
          model: "deepseek-flash",
          apiKeyEnv: envName,
          timeoutMs: 5000,
        },
      },
      prompt: "Return DEEPSEEK_ADAPTER_OK",
    });
    assert.equal(output, "DEEPSEEK_ADAPTER_OK");
    assert.equal(receivedAuthorization, "Bearer test-secret");
    assert.equal(receivedBody.model, "deepseek-flash");
    assert.equal(receivedBody.messages[0].role, "system");
    assert.equal(receivedBody.messages[1].content, "Return DEEPSEEK_ADAPTER_OK");
  } finally {
    delete process.env[envName];
    await new Promise((resolve) => server.close(resolve));
  }
});
