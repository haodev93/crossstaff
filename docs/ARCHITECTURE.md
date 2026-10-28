# Architecture

## Alpha topology

```text
Browser
  │ HTTP + SSE
  ▼
Node control plane
  ├── HTTP/API
  ├── workflow orchestrator
  ├── SQLite persistence
  ├── event stream
  ├── mock adapter
  └── local command adapter
```

The alpha is deliberately single-process and localhost-only. The abstraction boundaries are still shaped so that the connector and control plane can be separated later.

## Workflow

```text
Create task
   ↓
Load relevant shared knowledge
   ↓
Resolve writer employee + agent mode + active seat
   ↓
Run writer
   ↓
Persist handoff message and run output
   ↓
Resolve a different reviewer employee
   ↓
Build independent reviewer prompt
   ↓
Run reviewer
   ↓
Parse verdict
   ├── approved -> task completed
   └── changes_requested / unknown -> task blocked
```

The reviewer receives the task, the writer handoff, and selected shared knowledge. It does not receive the writer's private memory or the full execution transcript.

### General DAG workflows

`workflows`, `workflow_steps`, and `workflow_dependencies` model custom execution graphs.

- The workflow prompt is the end-to-end objective and shared acceptance baseline.
- Every work step stores an objective, input requirements, required deliverables, forbidden actions, and completion criteria.
- A step objective narrows local responsibility but cannot silently override the workflow objective.
- A step with no dependencies is a root and starts immediately.
- All currently ready root/downstream steps run concurrently.
- A dependent step starts only after every direct prerequisite completes.
- Its prompt includes each direct prerequisite's objective, expected deliverables, and output.
- A failed prerequisite blocks downstream steps while unrelated branches continue.
- Cycles are rejected when the workflow is created.
- A final acceptance step depends on every work step, evaluates each output against both the workflow objective and the step contract, and returns structured per-step scores.
- Accepted scores are written to employee performance; the workflow stores the overall acceptance verdict separately from technical step completion.
- Every completed or blocked step posts a human-readable progress event into the room.

## Persistence

SQLite tables:

- `rooms`
- `room_employee_memberships`
- `workspace_settings`
- `employees`
- `seat_bindings`
- `employee_memories`
- `accounts`
- `agents`
- `messages`
- `tasks`
- `runs`
- `knowledge`
- `memories`
- `events`

Provider account records intentionally contain metadata only. Credential material belongs to the official provider, local CLI, or future encrypted credential vault.

V2 treats `employees` as the stable organizational identity and `seat_bindings` as replaceable credential/seat bindings. A partial unique index allows only one active seat per employee. Existing V1 accounts and agents migrate automatically into employees, seat bindings, and agent modes.

Rooms reference employees through `room_employee_memberships`. Joining another room does not clone the employee, seat, memory, or any agent mode.

```text
Employee 1 ─── 1 active SeatBinding
    │                  │
    │ 1..N             │ binding revision
AgentMode              │
    └────── Run ───────┘
```

Retiring a credential revokes the binding. It does not delete the employee, employee memory, work history, or agent modes.

## Adapter contract

An adapter converts a task prompt into a bounded text result.

Current command adapter behavior:

1. Start a configured executable without a shell.
2. Send the prompt to stdin.
3. Capture bounded stdout/stderr.
4. Enforce timeout and cancellation.
5. Treat exit code zero as success.

This is not an OS sandbox. A future adapter protocol should expose structured events for tool calls, approvals, file changes, usage, and artifacts.

## Memory boundaries

- Employee memory belongs to one stable employee and is available to all of their modes.
- Mode memory belongs to one agent mode.
- Forked modes receive a copied working-memory snapshot with a source label.
- Shared knowledge belongs to a room or workspace.
- Prompt context includes a small lexical retrieval set, not the entire knowledge base.
- Reviewer prompts exclude writer-private memory.
- Reviewer independence requires two different employees, not two modes under the same seat.

## Planned split

```text
Control plane
  ├── identity and workspaces
  ├── rooms and tasks
  ├── policy and approvals
  ├── registry and lineage
  └── traces and usage

Connector gateway
  └── device identity, outbound mTLS, event relay

Device connector
  ├── process supervision
  ├── sandbox
  ├── local secrets
  └── provider adapters
```

Remote Connector work must begin with a threat model and explicit trust boundaries. Adding a public API and arbitrary shell execution to the current alpha would be unsafe.
