import { EventEmitter } from "node:events";
import { HttpError } from "./db.js";

export class WorkflowOrchestrator {
  constructor({ store, runtime, events = new EventEmitter() }) {
    this.store = store;
    this.runtime = runtime;
    this.events = events;
    this.activeTasks = new Map();
    this.activeWorkflows = new Map();
  }

  startReviewWorkflow(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) throw new HttpError(404, "Task not found");
    if (this.activeTasks.has(taskId) || ["running", "reviewing"].includes(task.status)) {
      throw new HttpError(409, "Task is already running");
    }

    const controller = new AbortController();
    const active = { controller, currentRunId: null, currentPhase: null, promise: null };
    this.activeTasks.set(taskId, active);
    this.store.updateTask(taskId, { status: "running", verdict: null, error: null });
    this.publish("task.started", task.roomId, { taskId });

    active.promise = this.executeWorkflow(taskId, controller.signal, active).finally(() => {
      this.activeTasks.delete(taskId);
      this.publish("task.settled", task.roomId, { taskId });
    });

    return this.store.getTask(taskId);
  }

  async executeWorkflow(taskId, signal, active) {
    const task = this.store.getTask(taskId);
    const writer = this.store.getAgent(task.writerAgentId);
    const reviewer = this.store.getAgent(task.reviewerAgentId);
    if (!writer || !reviewer) throw new HttpError(404, "Task agents no longer exist");
    const writerEmployee = this.store.getEmployee(writer.employeeId);
    const reviewerEmployee = this.store.getEmployee(reviewer.employeeId);
    if (!writerEmployee || !reviewerEmployee) {
      throw new HttpError(404, "Task employee no longer exists");
    }

    const knowledge = this.store.searchKnowledge(task.roomId, `${task.title} ${task.prompt}`, 5);
    const writerPrompt = buildWriterPrompt({
      task,
      writer,
      writerEmployee,
      employeeMemories: this.store.listEmployeeMemories(writer.employeeId),
      modeMemories: this.store.listMemories(writer.id),
      knowledge,
    });
    let writerOutput = "";
    let reviewerOutput = "";

    try {
      this.store.updateAgentStatus(writer.id, "running");
      const writerRun = this.store.createRun({
        taskId,
        agentId: writer.id,
        employeeId: writer.employeeId,
        seatBindingId: writerEmployee.activeSeat?.id ?? null,
        accountId: writer.accountId,
        phase: "implement",
        input: writerPrompt,
      });
      active.currentRunId = writerRun.id;
      active.currentPhase = "implement";
      this.publish("run.started", task.roomId, { taskId, runId: writerRun.id });

      writerOutput = await this.runtime.execute({
        agent: writer,
        prompt: writerPrompt,
        signal,
      });
      this.store.finishRun(writerRun.id, { status: "completed", output: writerOutput });
      this.store.updateAgentStatus(writer.id, "ready");
      this.store.addMessage({
        roomId: task.roomId,
        senderType: "agent",
        senderId: writer.id,
        senderName: writer.name,
        kind: "handoff",
        content: writerOutput,
      });
      this.publish("handoff.created", task.roomId, {
        taskId,
        runId: writerRun.id,
        agentId: writer.id,
      });

      this.store.updateTask(taskId, { status: "reviewing" });
      const reviewerPrompt = buildReviewerPrompt({
        task,
        reviewer,
        reviewerEmployee,
        writer,
        writerEmployee,
        writerOutput,
        employeeMemories: this.store.listEmployeeMemories(reviewer.employeeId),
        modeMemories: this.store.listMemories(reviewer.id),
        knowledge,
      });

      this.store.updateAgentStatus(reviewer.id, "running");
      const reviewerRun = this.store.createRun({
        taskId,
        agentId: reviewer.id,
        employeeId: reviewer.employeeId,
        seatBindingId: reviewerEmployee.activeSeat?.id ?? null,
        accountId: reviewer.accountId,
        phase: "review",
        input: reviewerPrompt,
      });
      active.currentRunId = reviewerRun.id;
      active.currentPhase = "review";
      this.publish("run.started", task.roomId, { taskId, runId: reviewerRun.id });

      reviewerOutput = await this.runtime.execute({
        agent: reviewer,
        prompt: reviewerPrompt,
        signal,
      });
      this.store.finishRun(reviewerRun.id, { status: "completed", output: reviewerOutput });
      this.store.updateAgentStatus(reviewer.id, "ready");
      this.store.addMessage({
        roomId: task.roomId,
        senderType: "agent",
        senderId: reviewer.id,
        senderName: reviewer.name,
        kind: "review_result",
        content: reviewerOutput,
      });

      const verdict = parseVerdict(reviewerOutput);
      const completed = verdict === "approved";
      this.store.updateTask(taskId, {
        status: completed ? "completed" : "blocked",
        verdict,
        error: completed ? null : "Reviewer requested changes or returned an unknown verdict",
      });
      this.publish("review.completed", task.roomId, {
        taskId,
        verdict,
        runId: reviewerRun.id,
      });
    } catch (error) {
      const canceled = signal.aborted || error?.name === "AbortError";
      const message = canceled ? "Task canceled by user" : normalizeError(error);

      if (active.currentRunId) {
        this.store.finishRun(active.currentRunId, {
          status: canceled ? "canceled" : "failed",
          output: active.currentPhase === "implement" ? writerOutput : "",
          error: message,
        });
      }
      this.store.updateAgentStatus(writer.id, "ready");
      this.store.updateAgentStatus(reviewer.id, "ready");
      this.store.updateTask(taskId, {
        status: canceled ? "canceled" : "failed",
        verdict: reviewerOutput ? parseVerdict(reviewerOutput) : null,
        error: message,
      });
      this.store.addMessage({
        roomId: task.roomId,
        senderType: "system",
        senderName: "CrossStaff",
        kind: "system_event",
        content: `Workflow ${canceled ? "canceled" : "failed"}: ${message}`,
      });
      this.publish(canceled ? "task.canceled" : "task.failed", task.roomId, {
        taskId,
        error: message,
      });
    }
  }

  startChatReply({ roomId, agentId, triggerMessageId }) {
    const agent = this.store.getAgent(agentId);
    const employee = agent ? this.store.getEmployee(agent.employeeId) : null;
    if (!agent || !employee?.activeSeat || employee.status !== "active") {
      throw new HttpError(409, "Agent mode is not available for room replies");
    }
    const messages = this.store.listMessages(roomId, 20);
    const transcript = messages
      .map((message) => `${message.senderName} [${message.kind}]: ${message.content}`)
      .join("\n\n");
    const knowledge = this.store.searchKnowledge(roomId, transcript, 5);
    const prompt = [
      `You are ${employee.name}, a digital employee in room mode "${agent.name}".`,
      `Employee title: ${employee.title}`,
      agent.instructions,
      "",
      "You were mentioned in the room. Respond directly to the latest human message.",
      "Recent room transcript:",
      transcript,
      "",
      formatMemory(
        "Employee private memory",
        this.store.listEmployeeMemories(agent.employeeId),
      ),
      formatMemory("Agent mode private memory", this.store.listMemories(agent.id)),
      "",
      formatKnowledge(knowledge),
      "",
      "Reply concisely as this digital employee. Do not claim actions or tests you did not perform.",
    ].join("\n");
    const run = this.store.createAgentChatRun({
      roomId,
      agentId,
      triggerMessageId,
      input: prompt,
    });
    this.store.updateAgentStatus(agent.id, "running");
    void this.runtime
      .execute({ agent, prompt })
      .then((output) => {
        this.store.finishAgentChatRun(run.id, {
          status: "completed",
          output,
        });
        this.store.addMessage({
          roomId,
          senderType: "agent",
          senderId: agent.id,
          senderName: agent.name,
          kind: "message",
          content: output,
        });
        this.publish("chat.reply.completed", roomId, {
          agentId: agent.id,
          runId: run.id,
        });
      })
      .catch((error) => {
        const message = normalizeError(error);
        this.store.finishAgentChatRun(run.id, {
          status: "failed",
          error: message,
        });
        this.store.addMessage({
          roomId,
          senderType: "system",
          senderName: "CrossStaff",
          kind: "system_event",
          content: `${agent.name} could not reply: ${message}`,
        });
        this.publish("chat.reply.failed", roomId, {
          agentId: agent.id,
          runId: run.id,
          error: message,
        });
      })
      .finally(() => {
        this.store.updateAgentStatus(agent.id, "ready");
        this.publish("chat.reply.settled", roomId, {
          agentId: agent.id,
          runId: run.id,
        });
      });
    return { run, agentId: agent.id };
  }

  startWorkflow(workflowId) {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) throw new HttpError(404, "Workflow not found");
    if (this.activeWorkflows.has(workflowId) || workflow.status === "running") {
      throw new HttpError(409, "Workflow is already running");
    }
    const controller = new AbortController();
    const active = { controller, promise: null };
    this.activeWorkflows.set(workflowId, active);
    this.store.updateWorkflow(workflowId, {
      status: "running",
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    this.publish("workflow.started", workflow.roomId, { workflowId });
    active.promise = this.executeWorkflowGraph(
      workflowId,
      controller.signal,
      active,
    ).finally(() => {
      this.activeWorkflows.delete(workflowId);
      this.publish("workflow.settled", workflow.roomId, { workflowId });
    });
    return this.store.getWorkflow(workflowId);
  }

  async executeWorkflowGraph(workflowId, signal, active) {
    const running = new Map();
    let guard = 0;

    while (guard < 2000) {
      guard += 1;
      const workflow = this.store.getWorkflow(workflowId);
      if (!workflow) throw new HttpError(404, "Workflow not found");
      const stepMap = new Map(workflow.steps.map((step) => [step.id, step]));
      const terminalFailure = new Set([
        "failed",
        "blocked",
        "canceled",
        "interrupted",
      ]);

      for (const step of workflow.steps) {
        if (step.status !== "pending") continue;
        const dependencySteps = step.dependsOn.map((id) => stepMap.get(id));
        if (dependencySteps.some((dependency) => terminalFailure.has(dependency?.status))) {
          this.store.updateWorkflowStep(step.id, {
            status: "blocked",
            error: "A dependency did not complete",
            finishedAt: new Date().toISOString(),
          });
          this.store.addMessage({
            roomId: workflow.roomId,
            senderType: "system",
            senderName: "CrossStaff",
            kind: "system_event",
            content: `Workflow step "${step.name}" was blocked because a prerequisite did not complete.`,
          });
        }
      }

      const refreshed = this.store.getWorkflow(workflowId);
      const ready = refreshed.steps.filter(
        (step) =>
          step.status === "pending" &&
          step.dependsOn.every(
            (dependencyId) =>
              refreshed.steps.find((candidate) => candidate.id === dependencyId)
                ?.status === "completed",
          ),
      );
      for (const step of ready) {
        if (running.has(step.id)) continue;
        this.store.updateWorkflowStep(step.id, {
          status: "running",
          startedAt: new Date().toISOString(),
        });
        const promise = this.executeWorkflowStep({
          workflow: refreshed,
          step,
          active,
          signal,
        }).finally(() => running.delete(step.id));
        running.set(step.id, promise);
      }

      if (running.size > 0) {
        await Promise.race(running.values());
        continue;
      }

      const current = this.store.getWorkflow(workflowId);
      const pending = current.steps.filter((step) => step.status === "pending");
      if (pending.length > 0) {
        for (const step of pending) {
          this.store.updateWorkflowStep(step.id, {
            status: "failed",
            error: "Workflow could not schedule this step",
            finishedAt: new Date().toISOString(),
          });
        }
      }
      break;
    }

    const finalWorkflow = this.store.getWorkflow(workflowId);
    const allCompleted = finalWorkflow.steps.every(
      (step) => step.status === "completed",
    );
    const anyCompleted = finalWorkflow.steps.some(
      (step) => step.status === "completed",
    );
    const status = signal.aborted
      ? "canceled"
      : allCompleted
        ? "completed"
        : anyCompleted
          ? "partial"
          : "failed";
    this.store.updateWorkflow(workflowId, {
      status,
      error:
        status === "completed"
          ? null
          : status === "partial"
            ? "One or more workflow steps failed or were blocked"
            : status === "canceled"
              ? "Workflow canceled by user"
              : "Workflow failed",
      finishedAt: new Date().toISOString(),
    });
    this.store.addMessage({
      roomId: finalWorkflow.roomId,
      senderType: "system",
      senderName: "CrossStaff",
      kind: "workflow_result",
      content: [
        `Workflow "${finalWorkflow.title}" ${status}.`,
        finalWorkflow.verdict
          ? `Acceptance verdict: ${finalWorkflow.verdict}.`
          : "No acceptance verdict was produced.",
      ].join(" "),
    });
    this.publish("workflow.finished", finalWorkflow.roomId, {
      workflowId,
      status,
    });
  }

  async executeWorkflowStep({ workflow, step, active, signal }) {
    const agent = this.store.getAgent(step.agentId);
    if (!agent) {
      this.store.updateWorkflowStep(step.id, {
        status: "failed",
        error: "Agent mode not found",
        finishedAt: new Date().toISOString(),
      });
      return;
    }
    const employee = this.store.getEmployee(agent.employeeId);
    const latestWorkflow = this.store.getWorkflow(workflow.id);
    const dependencySteps = step.dependsOn.map((dependencyId) =>
      latestWorkflow.steps.find((candidate) => candidate.id === dependencyId),
    );
    const knowledge = this.store.searchKnowledge(
      workflow.roomId,
      `${workflow.title} ${workflow.prompt} ${step.name}`,
      5,
    );
    const prompt = buildWorkflowStepPrompt({
      workflow,
      step,
      agent,
      employee,
      dependencySteps,
      employeeMemories: this.store.listEmployeeMemories(agent.employeeId),
      modeMemories: this.store.listMemories(agent.id),
      knowledge,
    });
    const run = this.store.createWorkflowRun({
      workflowId: workflow.id,
      stepId: step.id,
      agentId: agent.id,
      input: prompt,
    });

    try {
      this.store.updateAgentStatus(agent.id, "running");
      const output = await this.runtime.execute({
        agent,
        prompt,
        signal,
      });
      let acceptanceResult = null;
      if (step.isAcceptance) {
        acceptanceResult = parseAcceptanceEvaluation(output);
        const workStepIds = new Set(
          latestWorkflow.steps
            .filter((candidate) => !candidate.isAcceptance)
            .map((candidate) => candidate.id),
        );
        const scoredStepIds = new Set(
          acceptanceResult.evaluations.map((evaluation) => evaluation.stepId),
        );
        if ([...workStepIds].some((stepId) => !scoredStepIds.has(stepId))) {
          throw new Error("Acceptance evaluation did not score every work step");
        }
        this.store.saveAcceptanceEvaluations({
          workflowId: workflow.id,
          evaluatorEmployeeId: agent.employeeId,
          evaluations: acceptanceResult.evaluations
            .filter((evaluation) => workStepIds.has(evaluation.stepId))
            .map((evaluation) => {
              const evaluatedStep = latestWorkflow.steps.find(
                (candidate) => candidate.id === evaluation.stepId,
              );
              return {
                ...evaluation,
                employeeId: this.store.getAgent(evaluatedStep.agentId).employeeId,
              };
            }),
        });
        this.store.updateWorkflow(workflow.id, {
          verdict: acceptanceResult.verdict,
        });
      }
      this.store.finishWorkflowRun(run.id, {
        status: "completed",
        output,
      });
      this.store.updateWorkflowStep(step.id, {
        status: "completed",
        output,
        error: null,
        finishedAt: new Date().toISOString(),
      });
      this.store.addMessage({
        roomId: workflow.roomId,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        kind: "step_result",
        content: buildStepCompletionMessage({
          workflow: this.store.getWorkflow(workflow.id),
          step,
          employee,
          agent,
          output,
          acceptanceResult,
        }),
      });
      this.publish("workflow.step.completed", workflow.roomId, {
        workflowId: workflow.id,
        stepId: step.id,
      });
    } catch (error) {
      const canceled = signal.aborted || error?.name === "AbortError";
      const message = canceled ? "Workflow canceled" : normalizeError(error);
      this.store.finishWorkflowRun(run.id, {
        status: canceled ? "canceled" : "failed",
        error: message,
      });
      this.store.updateWorkflowStep(step.id, {
        status: canceled ? "canceled" : "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      this.store.addMessage({
        roomId: workflow.roomId,
        senderType: "system",
        senderName: "CrossStaff",
        kind: "system_event",
        content: `Workflow step "${step.name}" ${canceled ? "canceled" : "failed"}: ${message}`,
      });
      this.publish(canceled ? "workflow.step.canceled" : "workflow.step.failed", workflow.roomId, {
        workflowId: workflow.id,
        stepId: step.id,
        error: message,
      });
    } finally {
      this.store.updateAgentStatus(agent.id, "ready");
    }
  }

  cancelWorkflow(workflowId) {
    const active = this.activeWorkflows.get(workflowId);
    if (!active) throw new HttpError(409, "Workflow is not currently running");
    active.controller.abort();
    return true;
  }

  async waitForWorkflow(workflowId, timeoutMs = 15000) {
    const active = this.activeWorkflows.get(workflowId);
    if (!active) return this.store.getWorkflow(workflowId);
    let timer;
    try {
      await Promise.race([
        active.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timed out waiting for workflow")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this.store.getWorkflow(workflowId);
  }

  cancelTask(taskId) {
    const active = this.activeTasks.get(taskId);
    if (!active) throw new HttpError(409, "Task is not currently running");
    active.controller.abort();
    return true;
  }

  async waitForTask(taskId, timeoutMs = 10000) {
    const active = this.activeTasks.get(taskId);
    if (!active) return this.store.getTask(taskId);

    let timer;
    try {
      await Promise.race([
        active.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timed out waiting for workflow")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this.store.getTask(taskId);
  }

  publish(type, roomId, payload) {
    const event = { type, roomId, payload, at: new Date().toISOString() };
    this.events.emit("state", event);
  }
}

function buildWorkflowStepPrompt({
  workflow,
  step,
  agent,
  employee,
  dependencySteps,
  employeeMemories,
  modeMemories,
  knowledge,
}) {
  if (step.isAcceptance) {
    return buildAcceptanceStepPrompt({
      workflow,
      step,
      agent,
      employee,
      dependencySteps,
      employeeMemories,
      modeMemories,
      knowledge,
    });
  }
  const dependencyOutputs = dependencySteps.length
    ? dependencySteps
        .map(
          (dependency) =>
            [
              `### ${dependency.name} (${dependency.employeeName || "Employee"} / ${dependency.agentName || "Mode"})`,
              `Step objective: ${dependency.objective || "(not specified)"}`,
              `Expected deliverables: ${dependency.deliverables || "(not specified)"}`,
              "Output:",
              dependency.output || "(no output)",
            ].join("\n"),
        )
        .join("\n\n")
    : "This is a root step. No dependency output is available.";
  return [
    `You are ${employee?.name || "a digital employee"}, executing workflow step "${step.name}" in mode "${agent.name}".`,
    `Employee title: ${employee?.title || "Digital employee"}`,
    agent.instructions,
    "",
    `Workflow: ${workflow.title}`,
    "Workflow objective (overall outcome; it governs every step and cannot be narrowed away):",
    workflow.prompt,
    "",
    "Step:",
    step.name,
    "",
    "Step objective (this step's local contribution to the workflow objective):",
    step.objective || "Complete only this workflow step with a reviewable result.",
    "",
    "Required inputs for this step:",
    step.inputRequirements ||
      "Use the workflow objective, explicit task instructions, and direct dependency outputs.",
    "",
    "Required deliverables:",
    step.deliverables || "A concrete, reviewable result for downstream steps.",
    "",
    "Forbidden actions and scope boundaries:",
    step.forbiddenActions ||
      "Do not perform work outside this step or claim actions that were not completed.",
    "",
    "Completion criteria:",
    step.completionCriteria ||
      "The result satisfies this step's objective and is sufficient for downstream steps.",
    "",
    "Completed dependency outputs:",
    dependencyOutputs,
    "",
    formatMemory("Employee private memory", employeeMemories),
    formatMemory("Agent mode private memory", modeMemories),
    "",
    formatKnowledge(knowledge),
    "",
    "Resolve scope in this order: workflow objective and safety constraints, forbidden actions, step objective, then completion criteria.",
    "If the step contract conflicts with the workflow objective, do not silently ignore the conflict; report it in your result.",
    "Complete only this workflow step. Return a concise, reviewable result for downstream steps.",
    "Do not claim work or test evidence you did not actually perform.",
  ].join("\n");
}

function buildAcceptanceStepPrompt({
  workflow,
  step,
  agent,
  employee,
  dependencySteps,
  employeeMemories,
  modeMemories,
  knowledge,
}) {
  const stepRecords = dependencySteps
    .map(
      (dependency) =>
        [
          `### ${dependency.name}`,
          `stepId=${dependency.id}; employee=${dependency.employeeName}; mode=${dependency.agentName}; step=${dependency.name}`,
          `Step objective: ${dependency.objective || "(not specified)"}`,
          `Required inputs: ${dependency.inputRequirements || "(not specified)"}`,
          `Required deliverables: ${dependency.deliverables || "(not specified)"}`,
          `Forbidden actions: ${dependency.forbiddenActions || "(not specified)"}`,
          `Completion criteria: ${dependency.completionCriteria || "(not specified)"}`,
          "Actual output:",
          dependency.output || "(no output)",
        ].join("\n"),
    )
    .join("\n\n");
  return [
    `You are ${employee?.name || "a digital employee"}, acting as the acceptance reviewer in mode "${agent.name}".`,
    `Employee title: ${employee?.title || "Acceptance reviewer"}`,
    agent.instructions,
    "",
    `Workflow: ${workflow.title}`,
    "Original objective and acceptance criteria:",
    workflow.prompt,
    "",
    "Steps and outputs to evaluate:",
    stepRecords,
    "",
    formatMemory("Acceptance reviewer employee memory", employeeMemories),
    formatMemory("Acceptance mode private memory", modeMemories),
    "",
    formatKnowledge(knowledge),
    "",
    "Evaluate each work step against both the original workflow objective and that step's own deliverables, forbidden actions, and completion criteria.",
    "Return only valid JSON with this shape:",
    JSON.stringify({
      verdict: "accepted",
      summary: "Overall acceptance summary",
      evaluations: dependencySteps.map((dependency) => ({
        stepId: dependency.id,
        score: 0,
        verdict: "passed",
        comment: "Evidence-based assessment",
      })),
    }),
    "Use score from 0 to 100. verdict must be accepted or changes_requested.",
    "Each step verdict must be passed or needs_work.",
    "Include every stepId exactly once. Do not modify files.",
  ].join("\n");
}

function buildStepCompletionMessage({
  workflow,
  step,
  employee,
  agent,
  output,
  acceptanceResult,
}) {
  const workSteps = workflow.steps.filter((candidate) => !candidate.isAcceptance);
  const completedWorkSteps = workSteps.filter(
    (candidate) => candidate.status === "completed",
  ).length;
  if (step.isAcceptance) {
    return [
      `[Acceptance ${acceptanceResult?.verdict || "unknown"}]`,
      `Acceptance reviewer: ${employee?.name || "Employee"} / ${agent.name}`,
      acceptanceResult?.summary || output,
      ...(acceptanceResult?.evaluations || []).map((evaluation) => {
        const evaluatedStep = workflow.steps.find(
          (candidate) => candidate.id === evaluation.stepId,
        );
        return `- ${evaluatedStep?.name || evaluation.stepId}: ${evaluation.score}/100, ${evaluation.verdict}, ${evaluation.comment}`;
      }),
    ].join("\n");
  }
  const stepIndex = workSteps.findIndex((candidate) => candidate.id === step.id) + 1;
  return [
    `[Progress ${completedWorkSteps}/${workSteps.length}] "${step.name}" completed`,
    `Employee: ${employee?.name || "Employee"} / ${agent.name}`,
    "",
    output,
  ].join("\n");
}

function buildWriterPrompt({
  task,
  writer,
  writerEmployee,
  employeeMemories,
  modeMemories,
  knowledge,
}) {
  return [
    `You are ${writerEmployee.name}, a digital employee in role mode "${writer.name}".`,
    `Employee title: ${writerEmployee.title}`,
    writer.instructions,
    "",
    `Task: ${task.title}`,
    task.prompt,
    "",
    formatMemory("Employee private memory", employeeMemories),
    formatMemory("Agent mode private memory", modeMemories),
    "",
    formatKnowledge(knowledge),
    "",
    "Return a concise handoff containing implementation summary, files changed, tests run, and unresolved risks.",
    "Do not claim tests passed unless the evidence is available in your environment.",
  ].join("\n");
}

function buildReviewerPrompt({
  task,
  reviewer,
  reviewerEmployee,
  writer,
  writerEmployee,
  writerOutput,
  employeeMemories,
  modeMemories,
  knowledge,
}) {
  return [
    `You are ${reviewerEmployee.name}, a separate digital employee in role mode "${reviewer.name}".`,
    `Employee title: ${reviewerEmployee.title}`,
    reviewer.instructions,
    "",
    `Task: ${task.title}`,
    "Acceptance brief:",
    task.prompt,
    "",
    `Builder employee: ${writerEmployee.name}`,
    `Builder mode: ${writer.name}`,
    "Implementation handoff:",
    writerOutput,
    "",
    formatMemory("Reviewer employee private memory", employeeMemories),
    formatMemory("Reviewer mode private memory", modeMemories),
    "",
    formatKnowledge(knowledge),
    "",
    "Review only the supplied task and handoff. Do not modify code.",
    "Start with exactly `VERDICT: approved` or `VERDICT: changes_requested`.",
    "Rank every finding by severity and include concrete evidence.",
  ].join("\n");
}

function formatMemory(label, entries) {
  if (!entries.length) return `${label}: none.`;
  return [
    `${label}:`,
    ...entries.map((entry) => `- ${entry.content}`),
  ].join("\n");
}

function formatKnowledge(entries) {
  if (!entries.length) return "Shared project knowledge: none selected.";
  return [
    "Shared project knowledge (reference only):",
    ...entries.map((entry) => `- [${entry.scope}] ${entry.title}: ${entry.content}`),
  ].join("\n");
}

export function parseVerdict(output) {
  const text = String(output ?? "");
  const explicit = /VERDICT:\s*(approved|changes_requested)/i.exec(text);
  if (explicit) return explicit[1].toLowerCase();

  const jsonVerdict = /"verdict"\s*:\s*"(approved|changes_requested)"/i.exec(text);
  if (jsonVerdict) return jsonVerdict[1].toLowerCase();

  return "unknown";
}

export function parseAcceptanceEvaluation(output) {
  const text = String(output ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("Acceptance reviewer did not return valid JSON");
  }
  if (!["accepted", "changes_requested"].includes(parsed.verdict)) {
    throw new Error("Acceptance verdict must be accepted or changes_requested");
  }
  if (!Array.isArray(parsed.evaluations) || !parsed.evaluations.length) {
    throw new Error("Acceptance reviewer returned no step evaluations");
  }
  const evaluations = parsed.evaluations.map((evaluation) => {
    const stepId = String(evaluation.stepId || "").trim();
    const score = Number(evaluation.score);
    if (!stepId || !Number.isFinite(score)) {
      throw new Error("Each acceptance evaluation requires stepId and numeric score");
    }
    const verdict = String(evaluation.verdict || "");
    if (!["passed", "needs_work"].includes(verdict)) {
      throw new Error("Each acceptance evaluation verdict must be passed or needs_work");
    }
    return {
      stepId,
      score: Math.min(Math.max(score, 0), 100),
      verdict,
      comment: String(evaluation.comment || ""),
    };
  });
  return {
    verdict: parsed.verdict,
    summary: String(parsed.summary || ""),
    evaluations,
  };
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
