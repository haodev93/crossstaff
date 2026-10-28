import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "../src/adapters.js";
import { CrossStaffStore } from "../src/db.js";
import { WorkflowOrchestrator } from "../src/orchestrator.js";

function fixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-workflow-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  const orchestrator = new WorkflowOrchestrator({
    store,
    runtime: new AgentRuntime({ allowCommands: false }),
    events: new EventEmitter(),
  });
  const state = store.getState();
  const builder = state.agentModes.find((agent) => agent.role === "builder");
  const reviewer = state.agentModes.find((agent) => agent.role === "reviewer");
  return {
    tempDir,
    store,
    orchestrator,
    roomId: state.selectedRoomId,
    builder,
    reviewer,
    cleanup() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("workflow starts independent roots in parallel and waits for dependencies", async () => {
  const context = fixture();
  try {
    const workflow = context.store.createWorkflow({
      roomId: context.roomId,
      title: "Parallel implementation and security review",
      prompt: "Implement the task, audit it, and synthesize the final handoff.",
      steps: [
        {
          key: "build",
          name: "Implement",
          agentId: context.builder.id,
          objective: "Produce the implementation needed by the workflow objective.",
          inputRequirements: "Use the workflow brief and repository context.",
          deliverables: "Implementation handoff with files changed and test evidence.",
          forbiddenActions: "Do not change unrelated modules or claim untested results.",
          completionCriteria: "The implementation is reviewable and includes concrete evidence.",
          dependsOn: [],
        },
        {
          key: "audit",
          name: "Audit",
          agentId: context.reviewer.id,
          dependsOn: [],
        },
        {
          key: "synthesize",
          name: "Synthesize",
          agentId: context.builder.id,
          objective: "Combine the implementation and audit findings into one handoff.",
          inputRequirements: "Receive the implementation and audit outputs.",
          deliverables: "A consolidated delivery summary with unresolved risks.",
          forbiddenActions: "Do not discard audit findings or modify the implementation.",
          completionCriteria: "Both upstream outputs are represented and risks are explicit.",
          dependsOn: ["build", "audit"],
        },
      ],
    });

    context.orchestrator.startWorkflow(workflow.id);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const running = context.store.getWorkflow(workflow.id);
    assert.equal(
      running.steps.filter((step) => step.status === "running").length,
      2,
    );

    const settled = await context.orchestrator.waitForWorkflow(workflow.id, 5000);
    assert.equal(settled.status, "completed");
    assert.equal(settled.verdict, "accepted");
    assert.ok(settled.steps.every((step) => step.status === "completed"));
    assert.equal(settled.evaluations.length, 3);

    const runs = context.store.listWorkflowRuns(workflow.id);
    assert.equal(runs.length, 4);
    const synthesizeStep = settled.steps.find((step) => step.name === "Synthesize");
    const synthesizeRun = runs.find((run) => run.stepId === synthesizeStep.id);
    assert.match(
      synthesizeRun.input,
      /Workflow objective \(overall outcome; it governs every step/,
    );
    assert.match(
      synthesizeRun.input,
      /Step objective \(this step's local contribution/,
    );
    assert.match(
      synthesizeRun.input,
      /Combine the implementation and audit findings/,
    );
    assert.match(synthesizeRun.input, /Required inputs for this step:/);
    assert.match(synthesizeRun.input, /Required deliverables:/);
    assert.match(synthesizeRun.input, /Forbidden actions and scope boundaries:/);
    assert.match(synthesizeRun.input, /Completion criteria:/);
    assert.match(synthesizeRun.input, /Completed dependency outputs/);
    assert.match(
      synthesizeRun.input,
      /Step objective: Produce the implementation needed by the workflow objective/,
    );
    assert.match(synthesizeRun.input, /Implementation handoff/);
    assert.match(synthesizeRun.input, /VERDICT: approved/);
    assert.ok(settled.evaluations.every((evaluation) => evaluation.score > 0));
    assert.ok(
      settled.steps.some(
        (step) => step.isAcceptance && step.status === "completed",
      ),
    );
    const acceptanceStep = settled.steps.find((step) => step.isAcceptance);
    const acceptanceRun = runs.find((run) => run.stepId === acceptanceStep.id);
    assert.match(acceptanceRun.input, /Step objective: /);
    assert.match(acceptanceRun.input, /Forbidden actions: /);
    assert.match(acceptanceRun.input, /Completion criteria: /);
    assert.match(
      acceptanceRun.input,
      /both the original workflow objective and that step's own deliverables/,
    );
    const employees = context.store.listEmployees();
    assert.ok(
      employees.some(
        (employee) =>
          employee.performanceSamples > 0 &&
          employee.performanceScore > 0,
      ),
    );
    const messages = context.store.listMessages(context.roomId);
    assert.equal(
      messages.filter((message) => message.kind === "step_result").length,
      4,
    );
    assert.ok(
      messages.some((message) => message.kind === "workflow_result"),
    );
  } finally {
    context.cleanup();
  }
});

test("workflow rejects dependency cycles", () => {
  const context = fixture();
  try {
    assert.throws(
      () =>
        context.store.createWorkflow({
          roomId: context.roomId,
          title: "Cycle",
          prompt: "Invalid workflow",
          steps: [
            {
              key: "a",
              name: "A",
              agentId: context.builder.id,
              dependsOn: ["b"],
            },
            {
              key: "b",
              name: "B",
              agentId: context.reviewer.id,
              dependsOn: ["a"],
            },
          ],
        }),
      /cycle/,
    );
  } finally {
    context.cleanup();
  }
});

test("a failed prerequisite blocks only dependent branches", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-workflow-fail-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  const state = store.getState();
  const builder = state.agentModes.find((agent) => agent.role === "builder");
  const reviewer = state.agentModes.find((agent) => agent.role === "reviewer");
  const failingMode = store.createAgent({
    roomId: state.selectedRoomId,
    employeeId: reviewer.employeeId,
    name: "Failing Mode",
    role: "failing",
    adapter: { type: "mock", behavior: "failing" },
  });
  const runtime = {
    async execute({ agent }) {
      if (agent.id === failingMode.id) throw new Error("simulated failure");
      return `result from ${agent.name}`;
    },
  };
  const orchestrator = new WorkflowOrchestrator({
    store,
    runtime,
    events: new EventEmitter(),
  });

  try {
    const workflow = store.createWorkflow({
      roomId: state.selectedRoomId,
      title: "Failure propagation",
      prompt: "Exercise blocked downstream steps.",
      steps: [
        {
          key: "bad",
          name: "Failing root",
          agentId: failingMode.id,
          dependsOn: [],
        },
        {
          key: "good",
          name: "Healthy root",
          agentId: builder.id,
          dependsOn: [],
        },
        {
          key: "join",
          name: "Dependent join",
          agentId: reviewer.id,
          dependsOn: ["bad", "good"],
        },
      ],
    });

    orchestrator.startWorkflow(workflow.id);
    const settled = await orchestrator.waitForWorkflow(workflow.id, 5000);
    const statuses = Object.fromEntries(
      settled.steps.map((step) => [step.name, step.status]),
    );
    assert.equal(settled.status, "partial");
    assert.equal(statuses["Failing root"], "failed");
    assert.equal(statuses["Healthy root"], "completed");
    assert.equal(statuses["Dependent join"], "blocked");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("acceptance verdict and scores are persisted independently from step completion", async () => {
  const context = fixture();
  try {
    const workflow = context.store.createWorkflow({
      roomId: context.roomId,
      title: "Acceptance changes",
      prompt: "[changes] The acceptance criteria are not met yet.",
      steps: [
        {
          key: "work",
          name: "Work step",
          agentId: context.builder.id,
          dependsOn: [],
        },
      ],
      acceptanceAgentId: context.reviewer.id,
      acceptanceStepName: "Acceptance",
    });
    context.orchestrator.startWorkflow(workflow.id);
    const settled = await context.orchestrator.waitForWorkflow(workflow.id, 5000);
    assert.equal(settled.status, "completed");
    assert.equal(settled.verdict, "changes_requested");
    assert.equal(settled.evaluations.length, 1);
    assert.equal(settled.evaluations[0].verdict, "needs_work");
  } finally {
    context.cleanup();
  }
});
