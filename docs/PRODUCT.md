# Product Brief

CrossStaff is a local-first workspace for managing, collaborating with, and evaluating digital employees. The initial product hypothesis is:

> Teams that already use multiple agents need a reliable way to hand work between them, preserve independent review, share project facts, and audit what happened without copying context between terminals.

In V2, the management unit is a digital employee:

- One stable employee identity.
- One active organization seat, API identity, or official account binding.
- One or more role-specific agent modes.
- Employee memory shared by modes; working memory isolated per mode.
- Independent review requires a different employee.

## Primary users

- Developers using two or more coding agents.
- Small engineering and automation teams managing multiple machines.
- Agent-heavy research or operations teams that need task and memory boundaries.

## First workflow

```text
Employee A / writer mode -> handoff -> Employee B / reviewer mode -> verdict
```

General workflows can run steps sequentially or in parallel. A default final acceptance mode evaluates every work step and stores a 0-100 performance score with evidence in the employee profile.

The first release tests whether this workflow saves time, improves review independence, and makes agent work easier to supervise. A general agent group chat is not the initial goal.

The setup experience supports Chinese and English, persists workspace language, creates the first room, hires the first employee with one seat binding, and configures an agent mode with a free-form role name.

## Product boundaries

- Project rooms are coordination surfaces, not the source of truth.
- Tasks, run outputs, evidence, and verdicts are structured records.
- Private memory and shared knowledge are separate.
- Agent review is read-only by role contract; OS enforcement is future work.
- Multiple provider accounts are metadata and routing entities, not a credential pool.
- The project must not share consumer account passwords or cookies, evade rate limits, or automatically rotate personal accounts.

## Core entities

- **Room**: project collaboration boundary.
- **Employee**: stable identity, job title, manager, status, memory, and performance history.
- **SeatBinding**: one active organization seat/API identity/account binding per employee.
- **AgentMode**: role-specific instructions, adapter, working memory, and lineage under an employee.
- **Task**: acceptance brief and workflow state.
- **Run**: one agent invocation with input, output, status, and attribution.
- **Knowledge**: explicit room/workspace facts with source.
- **Memory**: employee-wide context plus mode-private working context.

## Alpha non-goals

- Enterprise authentication and tenant isolation.
- Remote internet-facing Connector.
- Unlimited recursive agent forking.
- Autonomous merge, production deployment, or spending.
- Agent marketplace or cross-organization collaboration.

This public brief intentionally excludes detailed internal planning, business analysis, and unreleased roadmap material.
