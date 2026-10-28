# HTTP API Guide

CrossStaff exposes a local JSON API for configuring employees, seats, agent modes, room membership, and workflows.

> **Security:** the current alpha has no authentication or tenant isolation. Bind it to localhost only. Never expose port `8787` directly to the public internet.

The API is identical on Windows, macOS, and Linux. Request examples use PowerShell for consistency; on macOS/Linux use `curl`, Insomnia, or any HTTP client.

For provider-specific AgentMode examples, see the [API Provider Guide](API-PROVIDERS.md).

## Start the server

```powershell
cd "C:\path\to\crossstaff"
$env:PORT = "8787"
$env:CROSSSTAFF_DATA_DIR = ".\data"
$env:CROSSSTAFF_ALLOW_COMMANDS = "1"
npm start
```

macOS / Linux:

```bash
cd /path/to/crossstaff
PORT=8787 CROSSSTAFF_DATA_DIR=./data CROSSSTAFF_ALLOW_COMMANDS=1 npm start
```

Base URL:

```text
http://127.0.0.1:8787
```

Portable health check:

```bash
curl --fail http://127.0.0.1:8787/api/health
```

All request bodies use:

```http
Content-Type: application/json
```

## Health and state

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/health"
$state = Invoke-RestMethod "http://127.0.0.1:8787/api/state"
$state
```

`/api/state` returns rooms, employees, active seats, agent modes, room members, workflows, messages, knowledge, and tasks.

Select a room:

```powershell
$state = Invoke-RestMethod "http://127.0.0.1:8787/api/state?roomId=room_agent_workspace"
$roomId = $state.selectedRoomId
```

## Create a room

```powershell
$room = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/rooms" `
  -ContentType "application/json" `
  -Body (@{
    name = "Payments Team"
    description = "Implementation and review for payment services"
  } | ConvertTo-Json)
```

## Delete a room

```powershell
$deleted = Invoke-RestMethod `
  -Method Delete `
  -Uri "http://127.0.0.1:8787/api/rooms/$($room.id)"
```

The response contains `deleted`, `roomId`, and `nextRoomId`. Deletion is permanent and removes the room's messages, tasks, workflows, run history, Agent Modes, room membership, and room-scoped knowledge. Employees, seats, employee memory, workspace knowledge, and other rooms are preserved.

A room with running agents, chats, tasks, or workflows returns `409`. Stop or cancel active work first. If `nextRoomId` is `null`, the workspace has no remaining rooms and the UI can create a new one.

## Hire an employee

An Employee owns one active SeatBinding. The API stores only non-sensitive seat metadata.

```powershell
$employee = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees" `
  -ContentType "application/json" `
  -Body (@{
    name = "Ada"
    title = "Implementation Engineer"
    provider = "openai"
    bindingType = "organization-seat"
    label = "Engineering Codex Seat A"
    managerId = $null
    roomId = $room.id
  } | ConvertTo-Json)
```

`bindingType` values:

- `organization-seat`
- `api`
- `official`

Never send passwords, API keys, cookies, OAuth tokens, or session tokens. Such fields are rejected.

## Add an existing employee to another room

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/rooms/$($room.id)/members" `
  -ContentType "application/json" `
  -Body (@{ employeeId = $employee.id } | ConvertTo-Json)
```

Joining a room does not clone the employee, seat, memory, or agent modes.

## Create an AgentMode

```powershell
$implementer = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)/modes" `
  -ContentType "application/json" `
  -Body (@{
    roomId = $room.id
    name = "Implementation Mode"
    role = "builder"
    instructions = "Implement the task and include concrete test evidence."
    adapter = @{
      type = "mock"
      behavior = "builder"
    }
  } | ConvertTo-Json -Depth 8)
```

### DeepSeek API AgentMode

Set the key in the CrossStaff process environment before starting the server. Do not send the secret through the CrossStaff API:

```powershell
$env:DEEPSEEK_API_KEY = "<set this locally>"
npm start
```

Alternatively, create a local `.env` from `.env.example` and set `DEEPSEEK_API_KEY=` there. The server loads `.env` when it starts; changes require a restart.

Create the employee as an API-backed seat:

```powershell
$deepSeekEmployee = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees" `
  -ContentType "application/json" `
  -Body (@{
    name = "DeepSeek Employee"
    title = "API Research Assistant"
    provider = "deepseek"
    bindingType = "api"
    label = "DeepSeek API Seat A"
    roomId = $room.id
  } | ConvertTo-Json)
```

Create the AgentMode with the API adapter:

```powershell
$deepSeekMode = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($deepSeekEmployee.id)/modes" `
  -ContentType "application/json" `
  -Body (@{
    roomId = $room.id
    name = "DeepSeek Flash"
    role = "researcher"
    instructions = "Analyze the task and cite concrete evidence."
    adapter = @{
      type = "api"
      provider = "deepseek"
      baseUrl = "https://api.deepseek.com"
      model = "deepseek-flash"
      apiKeyEnv = "DEEPSEEK_API_KEY"
      timeoutMs = 180000
    }
  } | ConvertTo-Json -Depth 10)
```

The adapter sends an OpenAI-compatible request to:

```text
https://api.deepseek.com/chat/completions
```

The key is resolved from `process.env.DEEPSEEK_API_KEY` when the run starts. It is never stored in the employee, seat, mode, workflow, or API request body.

### Codex Command Adapter

Use an isolated CLI profile so CrossStaff does not modify the ChatGPT App profile:

```powershell
$codexMode = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)/modes" `
  -ContentType "application/json" `
  -Body (@{
    roomId = $room.id
    name = "Codex Implementer"
    role = "builder"
    instructions = "Implement the requested change and report tests."
    adapter = @{
      type = "command"
      command = "codex"
      args = @(
        "exec",
        "--sandbox",
        "workspace-write",
        "--color",
        "never",
        "--ephemeral",
        "-"
      )
      workingDir = "C:\path\to\your\repo"
      timeoutMs = 600000
      env = @{
        CODEX_HOME = "C:\path\to\crossstaff\data\codex-cli-home"
        HOME = $env:USERPROFILE
      }
    }
  } | ConvertTo-Json -Depth 12)
```

For macOS or Linux, run `./scripts/login-codex-cli.sh` and use the native path:

```json
{
  "CODEX_HOME": "/absolute/path/to/crossstaff/data/codex-cli-home"
}
```

Allowed environment keys are:

```text
CODEX_HOME
CLAUDE_CONFIG_DIR
XDG_CONFIG_HOME
HOME
USERPROFILE
APPDATA
LOCALAPPDATA
```

Only official CLI/API access is supported. CrossStaff does not perform credential pooling or account rotation.

## Edit or delete an AgentMode

Update an existing mode:

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://127.0.0.1:8787/api/agent-modes/$($mode.id)" `
  -ContentType "application/json" `
  -Body (@{
    name = "Updated Mode"
    role = "reviewer"
    instructions = "Review changes and cite evidence."
    adapter = @{
      type = "mock"
      behavior = "reviewer"
    }
  } | ConvertTo-Json -Depth 10)
```

Delete a mode:

```powershell
Invoke-RestMethod `
  -Method Delete `
  -Uri "http://127.0.0.1:8787/api/agent-modes/$($mode.id)"
```

Deletion is a safe retirement:

- The mode disappears from employee cards and room/workflow selectors.
- Running modes cannot be deleted or edited.
- Historical messages, workflow runs, and audit references remain.
- The employee and SeatBinding are not deleted.

### Create an independent reviewer employee

```powershell
$reviewerEmployee = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees" `
  -ContentType "application/json" `
  -Body (@{
    name = "Lin"
    title = "Independent Reviewer"
    provider = "anthropic"
    bindingType = "organization-seat"
    label = "Security Review Seat A"
    roomId = $room.id
  } | ConvertTo-Json)

$reviewerMode = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($reviewerEmployee.id)/modes" `
  -ContentType "application/json" `
  -Body (@{
    roomId = $room.id
    name = "Security Reviewer"
    role = "reviewer"
    instructions = "Audit the implementation and return evidence-backed findings."
    adapter = @{ type = "mock"; behavior = "reviewer" }
  } | ConvertTo-Json -Depth 8)
```

## Employee memory

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)/memories" `
  -ContentType "application/json" `
  -Body (@{
    content = "Always include regression test evidence."
  } | ConvertTo-Json)
```

## Rebind an employee seat

The employee ID, memory, history, and modes are preserved.

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)/seats" `
  -ContentType "application/json" `
  -Body (@{
    provider = "openai"
    bindingType = "organization-seat"
    label = "Engineering Codex Seat B"
  } | ConvertTo-Json)
```

## Create and run a DAG workflow

```powershell
$workflow = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/workflows" `
  -ContentType "application/json" `
  -Body (@{
    roomId = $room.id
    title = "Implement and independently audit login limits"
    prompt = "Implement the change, add tests, and audit security risks."
    acceptanceAgentId = $reviewerMode.id
    acceptanceStepName = "Acceptance and performance review"
    steps = @(
      @{
        key = "implementation"
        name = "Implementation"
        agentId = $codexMode.id
        objective = "Implement login rate limiting and produce reviewable evidence."
        inputRequirements = "Use the workflow objective and repository constraints."
        deliverables = "Code changes, test evidence, and implementation notes."
        forbiddenActions = "Do not change unrelated modules or claim tests that were not run."
        completionCriteria = "The change is complete, tested, and ready for independent review."
        dependsOn = @()
      },
      @{
        key = "security"
        name = "Security audit"
        agentId = $reviewerMode.id
        objective = "Identify security regressions in the proposed implementation."
        inputRequirements = "Receive the workflow objective and implementation handoff."
        deliverables = "Prioritized findings with evidence and a clear verdict."
        forbiddenActions = "Do not modify the implementation while reviewing it."
        completionCriteria = "Every finding is evidence-backed and the verdict is explicit."
        dependsOn = @()
      },
      @{
        key = "synthesis"
        name = "Synthesize findings"
        agentId = $codexMode.id
        objective = "Combine implementation and audit evidence into the final handoff."
        inputRequirements = "Receive both implementation and security outputs."
        deliverables = "A consolidated result with unresolved risks called out."
        forbiddenActions = "Do not discard security findings or alter review evidence."
        completionCriteria = "Both inputs are represented and residual risks are explicit."
        dependsOn = @("implementation", "security")
      }
    )
  } | ConvertTo-Json -Depth 12)
```

Execution rules:

- `workflow.prompt` is the overall objective and shared acceptance baseline for every step.
- Each step's `objective` defines only its local contribution to that overall objective.
- `inputRequirements`, `deliverables`, `forbiddenActions`, and `completionCriteria` define the step contract used by execution and acceptance.
- If a step contract conflicts with the workflow objective, the agent must report the conflict instead of silently dropping a requirement.
- Steps without dependencies start in parallel.
- A step starts after all selected dependencies complete.
- Direct dependency outputs and their step objectives are inserted into the downstream prompt.
- Failed prerequisites block only their dependent branches.
- The acceptance step is appended automatically and depends on every work step.
- Acceptance evaluates every output against both the original workflow objective and that step's contract, returning per-step `0-100` scores and an overall verdict.

Poll:

```powershell
$result = Invoke-RestMethod "http://127.0.0.1:8787/api/state?roomId=$($room.id)"
$result.workflows
```

Cancel:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/workflows/$($workflow.id)/cancel" `
  -ContentType "application/json" `
  -Body "{}"
```

## Offboard an employee

Offboarding:

- Changes employee status to `offboarded`.
- Revokes every active SeatBinding.
- Disables all AgentModes.
- Removes room memberships.
- Retains run history, acceptance scores, and employee memory.

```powershell
$offboarded = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)/offboard" `
  -ContentType "application/json" `
  -Body (@{
    reason = "Project completed"
  } | ConvertTo-Json)
```

The request is rejected while the employee has an active run.

### Edit and delete employees

Edit the employee profile without changing identity, seat, memory, modes, or history:

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)" `
  -ContentType "application/json" `
  -Body (@{
    name = "Updated Name"
    title = "Senior Engineer"
    managerId = $null
  } | ConvertTo-Json)
```

Permanent deletion is intentionally restricted:

```powershell
Invoke-RestMethod `
  -Method Delete `
  -Uri "http://127.0.0.1:8787/api/employees/$($employee.id)"
```

An employee with tasks, runs, messages, workflow references, or performance evaluations cannot be deleted permanently. Use offboarding instead so the audit trail remains intact.

## Endpoint reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and adapter status |
| GET | `/api/state?roomId=` | Full workspace state |
| GET | `/api/events` | SSE live events |
| PATCH | `/api/settings` | Locale and onboarding settings |
| POST | `/api/rooms` | Create room |
| DELETE | `/api/rooms/:id` | Permanently delete a room and its scoped records |
| POST | `/api/rooms/:id/members` | Add existing employee to room |
| POST | `/api/employees` | Create employee + seat |
| PATCH | `/api/employees/:id` | Update name, title, manager, status |
| POST | `/api/employees/:id/seats` | Rebind seat |
| POST | `/api/employees/:id/offboard` | Offboard employee |
| DELETE | `/api/employees/:id` | Permanently delete a clean employee |
| POST | `/api/employees/:id/modes` | Create AgentMode |
| PATCH | `/api/agent-modes/:id` | Edit AgentMode |
| DELETE | `/api/agent-modes/:id` | Soft-delete AgentMode |
| GET/POST | `/api/employees/:id/memories` | List/add employee memory |
| POST | `/api/agents/:id/fork` | Fork an AgentMode |
| POST | `/api/workflows` | Create and run DAG workflow |
| GET | `/api/workflows/:id` | Get a workflow; returns `404` JSON if it does not exist |
| POST | `/api/workflows/:id/cancel` | Cancel workflow |
| POST | `/api/messages` | Add a human room message |
| POST | `/api/knowledge` | Add shared knowledge |

Get a workflow by ID:

```powershell
$workflow = Invoke-RestMethod "http://127.0.0.1:8787/api/workflows/$($workflowId)"
$workflow
```

On success, the endpoint returns the workflow JSON object. An unknown ID returns HTTP `404` with `{"error":"Workflow not found"}`.

## Current limitations

- No authentication.
- No tenant isolation.
- No workflow edit/versioning API after creation.
- No automatic retry policy for failed steps.
- No fine-grained secret vault; API keys must stay in the official CLI/provider environment.
