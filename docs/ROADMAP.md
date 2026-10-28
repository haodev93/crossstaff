# Roadmap

## 0.1 Alpha

- [x] Local project rooms and messages.
- [x] Agent registry, accounts, roles, private memory, and manual forks.
- [x] Shared room/workspace knowledge with lexical retrieval.
- [x] Builder -> reviewer workflow and verdict parsing.
- [x] Run records, SSE updates, and task cancellation.
- [x] Mock adapter and opt-in command adapter.
- [ ] Independent security review.

## 0.2 Employee workforce

- [x] Stable employee identity with job title, manager, status, and memory.
- [x] One active SeatBinding per employee.
- [x] Migrate V1 accounts into employees and agents into agent modes.
- [x] Employee roster, seat history, headcount, and mode-level profiles.
- [x] Enforce independent review across different employees.
- [x] First-run employee/seat onboarding.
- [x] General DAG workflows with parallel roots and dependency output handoff.
- [x] Automatic acceptance step with per-step scores and employee performance aggregation.
- [ ] Employee suspension/offboarding workflow.
- [ ] Evidence-based performance review and feedback cycle.

## 0.3 Adapter foundation

- [ ] Structured adapter protocol with incremental events.
- [ ] Capability discovery and adapter version matrix.
- [ ] Read-only reviewer workspace.
- [ ] Attach git commit, diff, tests, and artifact hashes.
- [ ] Explicit provider adapter examples using official interfaces only.
- [ ] Process-tree cancellation and stronger output limits.

## 0.4 Collaboration

- [ ] Knowledge proposals and review.
- [ ] Git-backed knowledge revisions.
- [ ] Approval policies for write, merge, publish, and spend actions.
- [ ] Workflow retry and manual fix routing.
- [ ] Agent role templates and bounded parallel fan-out.
- [ ] Exportable audit bundle.

## 0.5 Remote control plane

- [ ] Device enrollment and outbound mTLS Connector.
- [ ] Remote task dispatch, heartbeats, and replay-safe events.
- [ ] Authentication, workspace isolation, and RBAC.
- [ ] Secrets broker.
- [ ] Feishu, Teams, and Slack surfaces.

## Product gates

Each milestone should be judged by:

- Verified successful tasks.
- Human intervention rate.
- Time spent repeating context.
- Cost per successful task.
- Failure severity and recoverability.
- Knowledge and tenant isolation.

Agent count and message volume are not success metrics.
