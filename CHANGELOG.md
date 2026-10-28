# Changelog

## 0.3.0

- Established CrossStaff as the public product name, with compatibility for legacy AgentHub and Huddle data.
- Added the CrossStaff penguin mark, app icon, favicon, and installable web manifest.
- Updated English and Chinese product copy with the new local-first digital employee positioning.
- Kept `AGENTSTAFF_*`, `HUDDLE_*`, and `AGENTHUB_*` environment variables and existing workspaces compatible.
- Migrated persisted room, onboarding, and locale browser settings from the legacy prefix.
- Added Windows, macOS, and Linux CI coverage.
- Added a POSIX Codex CLI profile helper and bilingual cross-platform setup guidance.
- Fixed AgentMode editing by submitting the selected mode ID with the form.
- Added permanent Room deletion with active-work protection and next-room selection.
- Added per-step workflow contracts for objectives, inputs, deliverables, forbidden actions, and completion criteria.
- Acceptance now evaluates both the workflow objective and each step's local contract.

## 0.2.0

- Added first-class employees with stable identity, job title, manager, status, memory, and work history.
- Added one-active SeatBinding per employee for organization seats, API identities, and official accounts.
- Migrated V1 accounts into employees and V1 agents into employee-owned agent modes.
- Added employee roster, headcount, seat history, employee memory, and mode-level role profiles.
- Enforced independent review across two different employees, not two modes of the same employee.
- Added reusable room-employee membership; employees can join multiple rooms without duplicating seats, memory, or modes.
- Added allowlisted path environment variables for isolated Codex and Claude CLI profiles.
- Added arbitrary DAG workflows with parallel roots, dependency joins, output handoff, cycle rejection, and cancellation.
- Added a default acceptance step, structured per-step scoring, employee performance aggregation, and room progress updates.
- Updated onboarding to hire the first employee with a seat before configuring the first agent mode.

## 0.1.0

- Initial local-first AgentHub alpha.
- Project rooms, agents, provider account metadata, shared knowledge, and private memory.
- Chinese/English interface with persisted language switching.
- First-run setup for language, room, provider account, and custom-role agent.
- Builder-to-reviewer workflow with approved/changes-requested verdicts.
- Mock agent adapter and opt-in local command adapter.
- SQLite persistence, SSE updates, cancellation, and audit records.
