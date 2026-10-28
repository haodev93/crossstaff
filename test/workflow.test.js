import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "../src/adapters.js";
import { CrossStaffStore } from "../src/db.js";
import { WorkflowOrchestrator, parseVerdict } from "../src/orchestrator.js";

function fixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-flow-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  const orchestrator = new WorkflowOrchestrator({
    store,
    runtime: new AgentRuntime({ allowCommands: false }),
    events: new EventEmitter(),
  });
  const state = store.getState();
  const writer = state.agents.find((agent) => agent.role === "builder");
  const reviewer = state.agents.find((agent) => agent.role === "reviewer");
  return {
    tempDir,
    store,
    orchestrator,
    roomId: state.selectedRoomId,
    writer,
    reviewer,
    cleanup() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("builder -> reviewer workflow records an approved handoff", async () => {
  const context = fixture();
  try {
    const task = context.store.createTask({
      roomId: context.roomId,
      title: "Add request validation",
      prompt: "Validate request payloads and include test evidence.",
      writerAgentId: context.writer.id,
      reviewerAgentId: context.reviewer.id,
    });

    context.orchestrator.startReviewWorkflow(task.id);
    const settled = await context.orchestrator.waitForTask(task.id, 5000);
    assert.equal(settled.status, "completed");
    assert.equal(settled.verdict, "approved");

    const runs = context.store.listRunsForTask(task.id);
    assert.equal(runs.length, 2);
    assert.deepEqual(
      runs.map((run) => run.phase),
      ["implement", "review"],
    );
    assert.ok(runs.every((run) => run.status === "completed"));
    assert.ok(runs.every((run) => run.employeeId));
    assert.ok(runs.every((run) => run.seatBindingId));
    assert.notEqual(runs[0].employeeId, runs[1].employeeId);
    assert.match(runs[0].input, /Employee private memory/);
    assert.match(runs[0].input, /Prefer small, reversible changes/);

    const messages = context.store.listMessages(context.roomId);
    assert.ok(messages.some((message) => message.kind === "handoff"));
    assert.ok(messages.some((message) => message.kind === "review_result"));
  } finally {
    context.cleanup();
  }
});

test("changes request blocks the task instead of silently approving it", async () => {
  const context = fixture();
  try {
    const task = context.store.createTask({
      roomId: context.roomId,
      title: "Review a risky change",
      prompt: "[changes] Explain why the handoff must return to the builder.",
      writerAgentId: context.writer.id,
      reviewerAgentId: context.reviewer.id,
    });

    context.orchestrator.startReviewWorkflow(task.id);
    const settled = await context.orchestrator.waitForTask(task.id, 5000);
    assert.equal(settled.status, "blocked");
    assert.equal(settled.verdict, "changes_requested");
  } finally {
    context.cleanup();
  }
});

test("two modes from the same employee cannot perform independent review", () => {
  const context = fixture();
  try {
    const secondMode = context.store.createAgent({
      roomId: context.roomId,
      employeeId: context.writer.employeeId,
      name: "Same employee reviewer",
      role: "Code Reviewer",
      adapter: { type: "mock", behavior: "reviewer" },
    });

    assert.throws(
      () =>
        context.store.createTask({
          roomId: context.roomId,
          title: "Invalid independent review",
          prompt: "This must require two employees.",
          writerAgentId: context.writer.id,
          reviewerAgentId: secondMode.id,
        }),
      /two different employees/,
    );
  } finally {
    context.cleanup();
  }
});

test("existing employees can join another room without duplicating modes", () => {
  const context = fixture();
  try {
    const room = context.store.createRoom({
      name: "Second room",
      description: "Reuse existing employees",
    });
    context.store.addRoomMember(room.id, context.writer.employeeId);
    context.store.addRoomMember(room.id, context.reviewer.employeeId);

    const task = context.store.createTask({
      roomId: room.id,
      title: "Cross-room review",
      prompt: "Use existing employees in a new room.",
      writerAgentId: context.writer.id,
      reviewerAgentId: context.reviewer.id,
    });

    assert.equal(task.roomId, room.id);
    assert.equal(context.store.listRoomMembers(room.id).length, 2);
    assert.equal(context.store.listAgentModes(context.writer.employeeId).length, 1);
  } finally {
    context.cleanup();
  }
});

test("canceling a workflow stops the active mock run", async () => {
  const context = fixture();
  try {
    const task = context.store.createTask({
      roomId: context.roomId,
      title: "Cancelable task",
      prompt: "This task will be canceled.",
      writerAgentId: context.writer.id,
      reviewerAgentId: context.reviewer.id,
    });

    context.orchestrator.startReviewWorkflow(task.id);
    const settledPromise = context.orchestrator.waitForTask(task.id, 5000);
    context.orchestrator.cancelTask(task.id);
    const settled = await settledPromise;
    assert.equal(settled.status, "canceled");
  } finally {
    context.cleanup();
  }
});

test("verdict parser accepts exact and JSON forms", () => {
  assert.equal(parseVerdict("VERDICT: approved\nNo findings"), "approved");
  assert.equal(parseVerdict('{"verdict":"changes_requested"}'), "changes_requested");
  assert.equal(parseVerdict("Looks fine"), "unknown");
});
