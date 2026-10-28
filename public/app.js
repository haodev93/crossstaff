import {
  detectLocale,
  formatDateTime,
  normalizeLocale,
  setLocale,
  t,
} from "./i18n.js";

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");

function migrateLegacyLocalStorage() {
  for (const key of ["roomId", "onboardingStep", "locale"]) {
    const nextKey = `crossstaff.${key}`;
    if (localStorage.getItem(nextKey) !== null) continue;
    for (const legacyKey of [
      `agentstaff.${key}`,
      `huddle.${key}`,
      `agenthub.${key}`,
    ]) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        localStorage.setItem(nextKey, legacyValue);
        break;
      }
    }
  }
}

migrateLegacyLocalStorage();

const state = {
  data: null,
  view: "rooms",
  roomId: localStorage.getItem("crossstaff.roomId"),
  railTab: "workflows",
  modal: null,
  loading: true,
  error: null,
  connection: "connecting",
  sidebarOpen: false,
  refreshTimer: null,
  renderDeferred: false,
  lastMessageKey: "",
  workflowDraft: null,
  workflowMeta: {
    title: "",
    prompt: "",
    acceptanceAgentId: "",
    acceptanceStepName: "",
  },
  workflowStepSeq: 0,
  locale: detectLocale(),
  onboarding: {
    step: Math.min(Math.max(Number(localStorage.getItem("crossstaff.onboardingStep")) || 1, 1), 5),
    roomId: null,
    employeeId: null,
    agentId: null,
  },
};

const ICONS = {
  rooms:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 12h5"/></svg>',
  agents:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 3v4M15 3v4M8 12h.01M16 12h.01M9 16h6"/></svg>',
  devices:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  knowledge:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v18H6.5A2.5 2.5 0 0 0 4 23V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v18h4.5A2.5 2.5 0 0 1 20 23V5.5Z"/></svg>',
  runs:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-7 5 14L17 12h4"/></svg>',
  plus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  play:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>',
  fork:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 7v3a3 3 0 0 0 3 3h6v3M9 18h7"/></svg>',
  memory:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4h1V4H9ZM15 4a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4h-1V4h1Z"/></svg>',
  menu:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  trash:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  send:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>',
  external:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h5v5M10 14 20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>',
};

const VIEW_KEYS = {
  rooms: "rooms",
  agents: "team",
  devices: "devices",
  knowledge: "knowledge",
  runs: "runs",
};

document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);
bootstrap();

async function bootstrap() {
  await loadState();
  connectEventStream();
}

async function loadState({ renderNow = true } = {}) {
  try {
    const query = state.roomId ? `?roomId=${encodeURIComponent(state.roomId)}` : "";
    const data = await api(`/api/state${query}`);
    state.data = data;
    state.roomId = data.selectedRoomId;
    state.locale = setLocale(data.settings?.locale || state.locale);
    document.documentElement.lang = state.locale;
    state.loading = false;
    state.error = null;
    if (state.roomId) localStorage.setItem("crossstaff.roomId", state.roomId);
    else localStorage.removeItem("crossstaff.roomId");
    if (renderNow && !state.modal) render();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    render();
  }
}

function connectEventStream() {
  const source = new EventSource("/api/events");
  source.addEventListener("open", () => {
    state.connection = "online";
    renderConnectionOnly();
  });
  source.addEventListener("error", () => {
    state.connection = "connecting";
    renderConnectionOnly();
  });
  source.addEventListener("state", () => scheduleRefresh());
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(async () => {
    if (state.modal) {
      state.renderDeferred = true;
      return;
    }
    await loadState({ renderNow: true });
  }, 120);
}

function render() {
  if (state.loading) return;
  if (state.error && !state.data) {
    app.innerHTML = renderError();
    return;
  }
  if (!state.data) return;
  if (!state.data.settings?.onboardingComplete) {
    app.innerHTML = renderOnboarding();
    return;
  }

  const scrollPosition = captureScroll();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar ${state.sidebarOpen ? "is-open" : ""}">
        ${renderSidebar()}
      </aside>
      <main class="workspace">
        ${renderTopbar()}
        <section class="view-scroll">
          ${renderView()}
        </section>
      </main>
      ${renderModal()}
    </div>
  `;
  restoreScroll(scrollPosition);
}

function renderSidebar() {
  const roomButtons = state.data.rooms
    .map(
      (room) => `
        <button
          class="room-button ${room.id === state.roomId && state.view === "rooms" ? "is-active" : ""}"
          data-action="switch-room"
          data-room-id="${escapeAttr(room.id)}"
          title="${escapeAttr(room.name)}"
        >
          <span class="room-dot" aria-hidden="true"></span>
          <span>${escapeHtml(room.name)}</span>
        </button>
      `,
    )
    .join("");

  const navItems = ["rooms", "agents", "devices", "knowledge", "runs"]
    .map(
      (view) => `
        <button
          class="nav-button ${state.view === view ? "is-active" : ""}"
          data-action="switch-view"
          data-view="${view}"
        >
          ${ICONS[view]}
          <span>${t(`view.${VIEW_KEYS[view]}.label`)}</span>
        </button>
      `,
    )
    .join("");

  return `
    <div class="brand">
      ${renderBrandMark()}
      <div class="brand-copy">
        <div class="brand-name">CrossStaff</div>
        <div class="brand-tag">${t("app.earlyAlpha")}</div>
      </div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">${t("common.workspace")}</div>
      <nav class="nav-list" aria-label="${escapeAttr(t("common.mainNavigation"))}">${navItems}</nav>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">${t("common.rooms")}</div>
      <div class="room-list">${roomButtons || `<div class="sidebar-note">${t("room.emptyTitle")}</div>`}</div>
      <button class="nav-button" data-action="open-modal" data-modal="room">
        ${ICONS.plus}
        <span>${t("common.newRoom")}</span>
      </button>
    </div>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-footer">
      <div class="local-status">
        <span>${t("common.localControlPlane")}</span>
        <span class="connection" id="connection-status">
          <span class="connection-dot ${state.connection === "online" ? "is-online" : ""}"></span>
          ${state.connection === "online" ? t("common.realtime") : t("common.reconnecting")}
        </span>
      </div>
      <div class="sidebar-note">${t("common.sidebarSecurityNote")}</div>
    </div>
  `;
}

function renderTopbar() {
  const room = currentRoom();
  const workflowReady = roomAgents().length > 0;
  const meta = {
    label: t(`view.${VIEW_KEYS[state.view]}.label`),
    kicker: t(`view.${VIEW_KEYS[state.view]}.kicker`),
  };
  const title =
    state.view === "rooms" ? room?.name || t("view.rooms.label") : meta.label;
  const subtitle =
    state.view === "rooms"
      ? room?.description || t("view.rooms.subtitle")
      : t(`view.${VIEW_KEYS[state.view]}.subtitle`);

  const primaryAction = {
    rooms: `<button class="button button-primary" data-action="open-modal" data-modal="workflow" ${
      workflowReady ? "" : "disabled"
    }>${ICONS.play}<span class="button-label">${t("action.newWorkflow")}</span></button>`,
    agents: `<button class="button button-primary" data-action="open-modal" data-modal="employee">${ICONS.plus}<span class="button-label">${t("action.addEmployee")}</span></button>`,
    devices: `<button class="button button-primary" data-action="open-modal" data-modal="employee">${ICONS.plus}<span class="button-label">${t("action.addEmployee")}</span></button>`,
    knowledge: `<button class="button button-primary" data-action="open-modal" data-modal="knowledge">${ICONS.plus}<span class="button-label">${t("action.addKnowledge")}</span></button>`,
    runs: "",
  }[state.view];

  return `
    <header class="topbar">
      <button class="button button-quiet icon-button mobile-menu" data-action="toggle-sidebar" aria-label="${escapeAttr(t("common.openNavigation"))}">
        ${ICONS.menu}
      </button>
      <div class="topbar-title">
        <p class="topbar-kicker">${meta.kicker}</p>
        <h1>${escapeHtml(title)}</h1>
        <div class="page-subtitle">${escapeHtml(subtitle || "")}</div>
      </div>
      <div class="topbar-actions">
        ${primaryAction || ""}
        ${
          state.view === "rooms" && room
            ? `<button class="button button-quiet icon-button danger-icon" data-action="open-modal" data-modal="delete-room" data-room-id="${escapeAttr(room.id)}" aria-label="${escapeAttr(t("action.deleteRoom"))}" title="${escapeAttr(t("action.deleteRoom"))}">
                ${ICONS.trash}
              </button>`
            : ""
        }
        <button class="button locale-toggle" data-action="toggle-locale" aria-label="${escapeAttr(t("common.switchLanguage"))}" title="${escapeAttr(t("common.switchLanguage"))}">
          ${escapeHtml(t("language.toggleLabel"))}
        </button>
        <button class="button icon-button" data-action="refresh" aria-label="${escapeAttr(t("common.refreshData"))}" title="${escapeAttr(t("common.refresh"))}">
          ${ICONS.refresh}
        </button>
      </div>
    </header>
  `;
}

function renderView() {
  if (state.view === "agents") return renderAgentsPage();
  if (state.view === "devices") return renderDevicesPage();
  if (state.view === "knowledge") return renderKnowledgePage();
  if (state.view === "runs") return renderRunsPage();
  return renderRoomPage();
}

function renderRoomPage() {
  const room = currentRoom();
  if (!room) {
    return `
      <div class="page">
        <div class="empty-state">
          ${t("room.emptyDescription")}
          <div class="modal-actions">
            <button class="button button-primary" data-action="open-modal" data-modal="room">${t("common.newRoom")}</button>
          </div>
        </div>
      </div>
    `;
  }

  const agents = roomAgents();
  const employees = roomEmployees();
  const participants = [
    `<span class="mini-avatar avatar-human" title="${escapeAttr(t("room.you"))}">${escapeHtml(t("room.youAvatar"))}</span>`,
    ...employees.map(
      (employee) =>
        `<span class="mini-avatar avatar-human" title="${escapeAttr(employee.name)}">${escapeHtml(initials(employee.name))}</span>`,
    ),
  ].join("");

  return `
    <div class="room-layout">
      <section class="chat-pane" aria-label="${escapeAttr(t("room.messagesLabel"))}">
        <div class="room-strip">
          <span>${t("room.participantSummary", { employees: employees.length, modes: agents.length, tasks: state.data.tasks.length })}</span>
          <div class="room-strip-actions">
            <button class="button button-small button-quiet" data-action="open-modal" data-modal="member" ${availableRoomEmployees().length ? "" : "disabled"}>${ICONS.plus} ${t("room.addEmployee")}</button>
            <div class="participant-stack" aria-label="${escapeAttr(t("room.participants"))}">${participants}</div>
          </div>
        </div>
        <div class="messages" id="message-list">
          ${renderMessages()}
        </div>
        <form class="composer" id="message-form">
          <div class="composer-box">
            <textarea name="content" rows="1" placeholder="${escapeAttr(t("room.composerPlaceholder"))}" required></textarea>
            <button class="button button-primary icon-button" type="submit" aria-label="${escapeAttr(t("room.sendMessage"))}">
              ${ICONS.send}
            </button>
          </div>
          <div class="composer-hint">${t("room.composerHint")}</div>
        </form>
      </section>
      <aside class="context-rail" aria-label="${escapeAttr(t("room.contextLabel"))}">
        <div class="rail-tabs">
          ${["workflows", "tasks", "agents", "knowledge"]
            .map(
              (tab) => `
                <button class="rail-tab ${state.railTab === tab ? "is-active" : ""}" data-action="rail-tab" data-tab="${tab}">
                  ${tab === "workflows" ? t("room.workflowsTab") : tab === "tasks" ? t("room.tasksTab") : tab === "agents" ? t("room.agentsTab") : t("room.knowledgeTab")}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="rail-content">
          ${renderRail()}
        </div>
      </aside>
    </div>
  `;
}

function renderMessages() {
  const messages = state.data.messages;
  if (!messages.length) {
    return `<div class="empty-state">${t("room.noMessages")}</div>`;
  }

  return messages
    .map((message) => {
      const rowClass =
        message.senderType === "system"
          ? "message-system"
          : message.senderType === "human"
            ? "message-human"
            : "message-agent";
      const avatarClass =
        message.senderType === "human"
          ? "avatar-human"
          : message.senderType === "system"
            ? "avatar-system"
            : agentAvatarClass(findAgent(message.senderId));
      const metaKind = labelKind(message.kind);
      return `
        <article class="message-row ${rowClass} message-${safeClass(message.kind)}">
          <div class="avatar ${avatarClass}" aria-hidden="true">${escapeHtml(initials(message.senderName))}</div>
          <div class="message-main">
            <div class="message-meta">
              <span class="message-author">${escapeHtml(message.senderName)}</span>
              <span>${metaKind}</span>
              <time datetime="${escapeAttr(message.createdAt)}">${formatTime(message.createdAt)}</time>
            </div>
            <div class="message-bubble message-content">${formatMessage(message.content)}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRail() {
  if (state.railTab === "workflows") return renderRailWorkflows();
  if (state.railTab === "agents") return renderRailAgents();
  if (state.railTab === "knowledge") return renderRailKnowledge();
  return renderRailTasks();
}

function renderRailWorkflows() {
  const workflows = state.data.workflows ?? [];
  if (!workflows.length) {
    return `<div class="empty-state">${t("room.noWorkflows")}</div>`;
  }
  return `
    <h3 class="section-heading">${t("room.workflowsTab")} <span>${workflows.length}</span></h3>
    <div class="task-list">
      ${workflows
        .map(
          (workflow) => `
            <article class="context-card workflow-card">
              <div class="task-top">
                <h4 class="context-card-title">${escapeHtml(workflow.title)}</h4>
                ${statusBadge(workflow.verdict || workflow.status)}
              </div>
              <p class="context-card-text">${workflow.completedSteps}/${workflow.steps.length} ${t("modal.workflow.steps")}</p>
              <div class="workflow-step-list">
                ${workflow.steps
                  .map(
                    (step, index) => `
                      <div class="workflow-step-row">
                        <span class="workflow-step-index">${index + 1}</span>
                        <span class="workflow-step-name">${escapeHtml(step.name)}</span>
                        ${
                          step.acceptanceEvaluation
                            ? `<span class="workflow-step-score">${step.acceptanceEvaluation.score}</span>`
                            : ""
                        }
                        ${statusBadge(step.status)}
                      </div>
                      ${renderWorkflowStepContractSummary(step)}
                      ${
                        step.output
                          ? `<details class="workflow-step-output"><summary>${t("runs.viewOutput")}</summary><pre>${escapeHtml(step.output)}</pre></details>`
                          : ""
                      }
                    `,
                  )
                  .join("")}
              </div>
              ${
                workflow.evaluations?.length
                  ? `<div class="workflow-score-summary">${t("workflow.performanceSummary", {
                      score: Math.round(
                        workflow.evaluations.reduce(
                          (sum, evaluation) => sum + Number(evaluation.score || 0),
                          0,
                        ) / workflow.evaluations.length,
                      ),
                      count: workflow.evaluations.length,
                    })}</div>`
                  : ""
              }
              <div class="context-card-meta">
                <span>${formatTime(workflow.createdAt)}</span>
                ${
                  workflow.status === "running"
                    ? `<button class="button button-small button-danger" data-action="cancel-workflow" data-workflow-id="${escapeAttr(workflow.id)}">${t("action.stop")}</button>`
                    : statusBadge(workflow.verdict || workflow.status)
                }
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkflowStepContractSummary(step) {
  if (step.isAcceptance || !step.objective) return "";
  return `
    <p class="workflow-step-objective">${escapeHtml(truncate(step.objective, 180))}</p>
    <details class="workflow-step-contract-details">
      <summary>${t("workflow.stepContract")}</summary>
      <dl>
        <dt>${t("workflow.inputRequirements")}</dt>
        <dd>${escapeHtml(step.inputRequirements || "—")}</dd>
        <dt>${t("workflow.deliverables")}</dt>
        <dd>${escapeHtml(step.deliverables || "—")}</dd>
        <dt>${t("workflow.forbiddenActions")}</dt>
        <dd>${escapeHtml(step.forbiddenActions || "—")}</dd>
        <dt>${t("workflow.completionCriteria")}</dt>
        <dd>${escapeHtml(step.completionCriteria || "—")}</dd>
      </dl>
    </details>
  `;
}

function renderRailTasks() {
  const tasks = state.data.tasks;
  if (!tasks.length) {
    return `<div class="empty-state">${t("room.noTasks")}</div>`;
  }
  return `
    <h3 class="section-heading">${t("room.reviewTasks")} <span>${tasks.length}</span></h3>
    <div class="task-list">
      ${tasks
        .map((task) => {
          const writer = findAgent(task.writerAgentId);
          const reviewer = findAgent(task.reviewerAgentId);
          const canCancel = ["running", "reviewing"].includes(task.status);
          return `
            <article class="context-card">
              <div class="task-top">
                <h4 class="context-card-title">${escapeHtml(task.title)}</h4>
                ${statusBadge(task.verdict || task.status)}
              </div>
              <p class="context-card-text">${escapeHtml(truncate(task.prompt, 130))}</p>
              <div class="flow-line">
                <span>${escapeHtml(writer?.name || t("modal.review.writer"))}</span>
                <span class="flow-arrow">→</span>
                <span>${escapeHtml(reviewer?.name || t("modal.review.reviewer"))}</span>
              </div>
              <div class="context-card-meta">
                <span>${formatTime(task.updatedAt)}</span>
                ${
                  canCancel
                    ? `<button class="button button-small button-danger" data-action="cancel-task" data-task-id="${escapeAttr(task.id)}">${t("action.stop")}</button>`
                    : statusBadge(task.status)
                }
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderRailAgents() {
  const agents = roomAgents();
  return `
    <h3 class="section-heading">${t("room.roomAgents")} <span>${agents.length}</span></h3>
    ${
      agents.length
        ? agents
            .map(
              (agent) => `
                <article class="context-card">
                  <div class="task-top">
                    <h4 class="context-card-title">${escapeHtml(agent.name)}</h4>
                    ${statusBadge(agent.status)}
                  </div>
                  <p class="context-card-text">${escapeHtml(findEmployee(agent.employeeId)?.name || t("common.unbound"))} · ${escapeHtml(agent.role)} · ${t("agents.memoryItems", { count: agent.memoryCount })}</p>
                  <div class="context-card-meta">
                    <span>${escapeHtml(adapterLabel(agent.adapter))}</span>
                    <button class="button button-small button-quiet" data-action="open-modal" data-modal="fork" data-agent-id="${escapeAttr(agent.id)}">${t("common.fork")}</button>
                  </div>
                </article>
              `,
            )
            .join("")
        : `<div class="empty-state">${t("room.noAgents")}</div>`
    }
    <button class="button button-small" data-action="open-modal" data-modal="agent">
      ${ICONS.plus} ${t("action.addMode")}
    </button>
  `;
}

function renderRailKnowledge() {
  const entries = state.data.knowledge;
  return `
    <div class="section-heading">
      ${t("room.sharedKnowledge")} <span>${entries.length}</span>
    </div>
    ${
      entries.length
        ? entries
            .slice(0, 8)
            .map(
              (entry) => `
                <article class="context-card">
                  <h4 class="context-card-title">${escapeHtml(entry.title)}</h4>
                  <p class="context-card-text">${escapeHtml(truncate(entry.content, 180))}</p>
                  <div class="context-card-meta">
                    <span>${escapeHtml(entry.scope)}</span>
                    <span>${escapeHtml(entry.source)}</span>
                  </div>
                </article>
              `,
            )
            .join("")
        : `<div class="empty-state">${t("room.noKnowledge")}</div>`
    }
    <button class="button button-small" data-action="open-modal" data-modal="knowledge">
      ${ICONS.plus} ${t("action.addKnowledge")}
    </button>
  `;
}

function renderAgentsPage() {
  const employees = state.data.employees ?? [];
  const modes = state.data.agentModes ?? [];
  const completedRuns = employees.reduce(
    (sum, employee) => sum + Number(employee.completedRunCount || 0),
    0,
  );

  return `
    <div class="page">
      <div class="page-intro">
        <div>
          <h2>${t("team.pageTitle")}</h2>
          <p>${t("team.pageDescription")}</p>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard(t("team.statEmployees"), state.data.headcount ?? 0, t("team.statEmployeesNote"))}
        ${statCard(t("team.statActive"), employees.filter((employee) => employee.status === "active").length, t("team.statActiveNote"))}
        ${statCard(t("team.statModes"), modes.length, t("team.statModesNote"))}
        ${statCard(t("team.statRuns"), completedRuns, t("team.statRunsNote"))}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("team.roster")}</h2>
            <p class="panel-subtitle">${t("team.rosterDescription")}</p>
          </div>
          <button class="button button-small button-primary" data-action="open-modal" data-modal="employee">${ICONS.plus} ${t("action.addEmployee")}</button>
        </div>
        <div class="panel-body">
          ${
            employees.length
              ? `<div class="agent-grid">${employees.map(renderEmployeeCard).join("")}</div>`
              : `<div class="empty-state">${t("team.emptyEmployees")}</div>`
          }
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("team.modes")}</h2>
            <p class="panel-subtitle">${t("team.modesDescription")}</p>
          </div>
          <button class="button button-small" data-action="open-modal" data-modal="agent" ${employees.length ? "" : "disabled"}>${ICONS.plus} ${t("action.addMode")}</button>
        </div>
        <div class="panel-body">
          ${
            modes.length
              ? `<div class="agent-grid">${modes.map(renderAgentCard).join("")}</div>`
              : `<div class="empty-state">${t("team.emptyModes")}</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderEmployeeCard(employee) {
  const seat = employee.activeSeat;
  const isOffboarded = employee.status === "offboarded";
  const score =
    employee.performanceScore === null ||
    employee.performanceScore === undefined
      ? "—"
      : `${employee.performanceScore}/100`;
  return `
    <article class="agent-card employee-card">
      <div class="agent-card-top">
        <div class="avatar avatar-human">${escapeHtml(initials(employee.name))}</div>
        <div class="agent-card-title">
          <h3>${escapeHtml(employee.name)}</h3>
          <div class="provider">${escapeHtml(employee.title || t("common.employee"))}</div>
        </div>
        ${statusBadge(employee.status)}
      </div>
      <div class="agent-role">
        ${seat ? `${escapeHtml(providerLabel(seat.provider))} · ${escapeHtml(bindingTypeLabel(seat.bindingType))} · ${escapeHtml(seat.label)}` : t("team.noSeat")}
      </div>
      ${
        isOffboarded && employee.offboardReason
          ? `<div class="employee-offboard-note"><strong>${t("team.offboardedReason")}</strong>${escapeHtml(employee.offboardReason)}</div>`
          : ""
      }
      <div class="agent-meta-grid">
        <div><strong>${t("team.manager")}</strong>${escapeHtml(employee.managerName || t("team.noManager"))}</div>
        <div><strong>${t("team.modeCount")}</strong>${employee.modeCount}</div>
        <div><strong>${t("team.memoryCount")}</strong>${employee.memoryCount}</div>
        <div><strong>${t("team.performance")}</strong>${score} · ${t("team.performanceSamples", { count: employee.performanceSamples || 0 })}</div>
      </div>
      <div class="agent-actions">
        ${
          isOffboarded
            ? ""
            : `<button class="button button-small" data-action="open-modal" data-modal="agent" data-employee-id="${escapeAttr(employee.id)}">${ICONS.plus} ${t("team.addMode")}</button>`
        }
        <button class="button button-small button-quiet" data-action="open-modal" data-modal="employee-memory" data-employee-id="${escapeAttr(employee.id)}">${ICONS.memory} ${t("team.employeeMemory")}</button>
        <button class="button button-small button-quiet" data-action="open-modal" data-modal="edit-employee" data-employee-id="${escapeAttr(employee.id)}">${t("common.edit")}</button>
        ${
          isOffboarded
            ? ""
            : `<button class="button button-small button-quiet" data-action="open-modal" data-modal="seat" data-employee-id="${escapeAttr(employee.id)}">${ICONS.devices} ${t("team.rebindSeat")}</button>
               <button class="button button-small button-danger" data-action="open-modal" data-modal="offboard" data-employee-id="${escapeAttr(employee.id)}">${t("team.offboard")}</button>`
        }
        <button class="button button-small button-danger" data-action="open-modal" data-modal="delete-employee" data-employee-id="${escapeAttr(employee.id)}">${t("common.delete")}</button>
      </div>
    </article>
  `;
}

function renderAgentCard(agent) {
  const employee = findEmployee(agent.employeeId);
  const seat = employee?.activeSeat;
  const room = state.data.rooms.find((item) => item.id === agent.roomId);
  const parent = findAgent(agent.parentId);
  return `
    <article class="agent-card">
      <div class="agent-card-top">
        <div class="avatar ${agentAvatarClass(agent)}">${escapeHtml(initials(agent.name))}</div>
        <div class="agent-card-title">
          <h3>${escapeHtml(agent.name)}</h3>
          <div class="provider">${escapeHtml(providerLabel(agent.provider))} · ${escapeHtml(agent.role)}</div>
        </div>
        ${statusBadge(agent.status)}
      </div>
      <div class="agent-role">${escapeHtml(truncate(agent.instructions || t("common.noInstructions"), 120))}</div>
      <div class="agent-meta-grid">
        <div><strong>${t("team.modeEmployee")}</strong>${escapeHtml(employee?.name || t("common.unbound"))}</div>
        <div><strong>${t("agents.memory")}</strong>${agent.memoryCount}</div>
        <div><strong>${t("common.adapter")}</strong>${escapeHtml(adapterLabel(agent.adapter))}</div>
        <div><strong>${t("agents.room")}</strong>${escapeHtml(room?.name || t("common.unknown"))}</div>
        <div><strong>${t("agents.lineage")}</strong>${parent ? escapeHtml(parent.name) : t("common.rootAgent")}</div>
        <div><strong>${t("team.seat")}</strong>${escapeHtml(seat?.label || t("team.noSeat"))}</div>
      </div>
      <div class="agent-actions">
        <button class="button button-small" data-action="open-modal" data-modal="edit-mode" data-agent-id="${escapeAttr(agent.id)}">${t("common.edit")}</button>
        <button class="button button-small" data-action="open-modal" data-modal="fork" data-agent-id="${escapeAttr(agent.id)}">${ICONS.fork} ${t("common.fork")}</button>
        <button class="button button-small button-quiet" data-action="open-modal" data-modal="memory" data-agent-id="${escapeAttr(agent.id)}">${ICONS.memory} ${t("common.memory")}</button>
        <button class="button button-small button-danger" data-action="open-modal" data-modal="delete-mode" data-agent-id="${escapeAttr(agent.id)}">${t("common.delete")}</button>
      </div>
    </article>
  `;
}

function renderDevicesPage() {
  const devices = state.data.devices;
  const employees = state.data.employees ?? [];
  const modes = state.data.agentModes ?? [];
  const seats = state.data.seatBindings ?? [];
  return `
    <div class="page">
      <div class="page-intro">
        <div>
          <h2>${t("devices.pageTitle")}</h2>
          <p>${t("devices.pageDescription")}</p>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard(t("devices.statDevices"), devices.length, t("devices.statDevicesNote"))}
        ${statCard(t("common.headcount"), state.data.headcount ?? 0, t("team.statEmployeesNote"))}
        ${statCard(t("common.seatBinding"), seats.filter((seat) => seat.active).length, t("team.statEmployeesNote"))}
        ${statCard(t("common.modes"), modes.length, t("team.statModesNote"))}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("devices.connected")}</h2>
            <p class="panel-subtitle">${t("devices.connectedDescription")}</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="knowledge-list">
            ${devices
              .map(
                (device) => `
                  <article class="device-card">
                    <div class="task-top">
                      <h3>${escapeHtml(device.name)}</h3>
                      ${statusBadge(device.status)}
                    </div>
                    <p>${t("devices.platform")}: ${escapeHtml(device.platform)} · ${t("devices.connector")} ${escapeHtml(device.connectorVersion)} · ${device.agentCount} ${t("common.agents")}</p>
                    <div class="card-meta">
                      <span>${t("devices.trust")}: ${escapeHtml(device.trust)}</span>
                      <span>${t("devices.boundary")}: ${t("common.localhost")}</span>
                    </div>
                  </article>
                `,
              )
              .join("")}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("team.seatHistory")}</h2>
            <p class="panel-subtitle">${t("devices.providerAccountsDescription")}</p>
          </div>
          <button class="button button-small" data-action="open-modal" data-modal="employee">${ICONS.plus} ${t("action.addEmployee")}</button>
        </div>
        <div class="panel-body">${renderSeatsTable(employees, seats)}</div>
      </section>
      <div class="notice">
        <strong>${t("devices.securityTitle")}</strong>${t("devices.securityBody")}
      </div>
    </div>
  `;
}

function renderKnowledgePage() {
  const entries = state.data.knowledge;
  return `
    <div class="page">
      <div class="page-intro">
        <div>
          <h2>${t("knowledge.pageTitle")}</h2>
          <p>${t("knowledge.pageDescription")}</p>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard(t("knowledge.statShared"), entries.length, t("knowledge.statSharedNote"))}
        ${statCard(t("knowledge.statRoom"), entries.filter((entry) => entry.scope === "room").length, t("knowledge.statRoomNote"))}
        ${statCard(t("knowledge.statWorkspace"), entries.filter((entry) => entry.scope === "workspace").length, t("knowledge.statWorkspaceNote"))}
        ${statCard(t("knowledge.statSources"), new Set(entries.map((entry) => entry.source)).size, t("knowledge.statSourcesNote"))}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("knowledge.entries")}</h2>
            <p class="panel-subtitle">${t("knowledge.entriesDescription")}</p>
          </div>
          <button class="button button-small button-primary" data-action="open-modal" data-modal="knowledge">${ICONS.plus} ${t("action.addKnowledge")}</button>
        </div>
        <div class="panel-body">
          ${
            entries.length
              ? `<div class="knowledge-list">${entries
                  .map(
                    (entry) => `
                      <article class="knowledge-card">
                        <div class="task-top">
                          <h3>${escapeHtml(entry.title)}</h3>
                          <span class="status">${escapeHtml(entry.scope)}</span>
                        </div>
                        <p>${escapeHtml(entry.content)}</p>
                        <div class="card-meta">
                          <span>${t("common.source")}: ${escapeHtml(entry.source)}</span>
                          <span>${t("knowledge.updated", { time: formatTime(entry.updatedAt) })}</span>
                        </div>
                      </article>
                    `,
                  )
                  .join("")}</div>`
              : `<div class="empty-state">${t("knowledge.empty")}</div>`
          }
        </div>
      </section>
      <div class="notice">
        <strong>${t("knowledge.noticeTitle")}</strong>${t("knowledge.noticeBody")}
      </div>
    </div>
  `;
}

function renderRunsPage() {
  const runs = state.data.runs;
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => ["failed", "interrupted"].includes(run.status)).length;
  return `
    <div class="page">
      <div class="page-intro">
        <div>
          <h2>${t("runs.pageTitle")}</h2>
          <p>${t("runs.pageDescription")}</p>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard(t("runs.statRuns"), runs.length, t("runs.statRunsNote"))}
        ${statCard(t("runs.statCompleted"), completed, t("runs.statCompletedNote"))}
        ${statCard(t("runs.statIssues"), failed, t("runs.statIssuesNote"))}
        ${statCard(t("runs.statAgents"), new Set(runs.map((run) => run.agentId)).size, t("runs.statAgentsNote"))}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${t("runs.trail")}</h2>
            <p class="panel-subtitle">${t("runs.trailDescription")}</p>
          </div>
        </div>
        <div class="panel-body">
          ${
            runs.length
              ? `<div class="run-list">${runs
                  .map((run) => {
                    const agent = findAgent(run.agentId);
                    const employee = findEmployee(run.employeeId);
                    const seat = findSeat(run.seatBindingId);
                    const task = state.data.tasks.find((item) => item.id === run.taskId);
                    return `
                      <article class="run-card">
                        <div class="run-top">
                          <div>
                            <h3 class="context-card-title">${escapeHtml(task?.title || t("runs.unknownTask"))}</h3>
                            <div class="card-meta">
                              <span>${t("runs.employee")}: ${escapeHtml(employee?.name || t("common.unknown"))}</span>
                              <span>${t("runs.mode")}: ${escapeHtml(agent?.name || t("runs.unknownAgent"))}</span>
                              <span>${t("runs.seat")}: ${escapeHtml(seat?.label || t("team.noSeat"))}</span>
                              <span>${formatTime(run.startedAt)}</span>
                            </div>
                          </div>
                          ${statusBadge(run.status)}
                        </div>
                        ${
                          run.error
                            ? `<p class="context-card-text">${escapeHtml(run.error)}</p>`
                            : ""
                        }
                        ${
                          run.output
                            ? `<details><summary>${t("runs.viewOutput")}</summary><pre class="run-output">${escapeHtml(run.output)}</pre></details>`
                            : ""
                        }
                      </article>
                    `;
                  })
                  .join("")}</div>`
              : `<div class="empty-state">${t("runs.empty")}</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderSeatsTable(employees, seats) {
  if (!seats.length) return `<div class="empty-state">${t("team.emptyEmployees")}</div>`;
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  return `
    <table class="simple-table">
      <thead>
        <tr><th>${t("common.employee")}</th><th>${t("common.provider")}</th><th>${t("common.seatBinding")}</th><th>${t("common.status")}</th><th>${t("common.modes")}</th></tr>
      </thead>
      <tbody>
        ${seats
          .map(
            (seat) => {
              const employee = employeeMap.get(seat.employeeId);
              return `
              <tr>
                <td>${escapeHtml(employee?.name || seat.employeeId)}</td>
                <td>${escapeHtml(providerLabel(seat.provider))}</td>
                <td>${escapeHtml(seat.label)} · ${escapeHtml(bindingTypeLabel(seat.bindingType))}</td>
                <td>${statusBadge(seat.active ? seat.status : "revoked")}</td>
                <td>${employee?.modeCount ?? 0}</td>
              </tr>
            `;
            },
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderModal() {
  if (!state.modal) return "";
  const { type, payload = {} } = state.modal;
  const modal = {
    room: {
      title: t("modal.room.title"),
      description: t("modal.room.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.room.name"), `<input name="name" placeholder="${escapeAttr(t("modal.room.namePlaceholder"))}" required maxlength="80" />`)}
          ${field(t("modal.room.descriptionLabel"), `<textarea name="description" placeholder="${escapeAttr(t("modal.room.descriptionPlaceholder"))}" maxlength="500"></textarea>`)}
        </div>
      `,
      submit: t("action.createRoom"),
      form: "room",
    },
    "delete-room": {
      title: t("modal.deleteRoom.title"),
      description: t("modal.deleteRoom.description"),
      body: renderRoomDeleteForm(payload.roomId),
      submit: t("modal.deleteRoom.submit"),
      form: "delete-room",
      danger: true,
    },
    employee: {
      title: t("modal.employee.title"),
      description: t("modal.employee.description"),
      body: renderEmployeeForm(),
      submit: t("modal.employee.submit"),
      form: "employee",
    },
    "edit-employee": {
      title: t("modal.editEmployee.title"),
      description: t("modal.editEmployee.description"),
      body: renderEmployeeEditForm(payload.employeeId),
      submit: t("modal.editEmployee.submit"),
      form: "edit-employee",
    },
    "delete-employee": {
      title: t("modal.deleteEmployee.title"),
      description: t("modal.deleteEmployee.description"),
      body: renderEmployeeDeleteForm(payload.employeeId),
      submit: t("modal.deleteEmployee.submit"),
      form: "delete-employee",
      danger: true,
    },
    agent: {
      title: t("modal.mode.title"),
      description: t("modal.mode.description"),
      body: renderAgentForm(payload),
      submit: t("modal.mode.submit"),
      form: "agent",
    },
    "edit-mode": {
      title: t("modal.editMode.title"),
      description: t("modal.editMode.description"),
      body: renderModeEditForm(payload.agentId),
      submit: t("modal.editMode.submit"),
      form: "edit-mode",
    },
    "delete-mode": {
      title: t("modal.deleteMode.title"),
      description: t("modal.deleteMode.description"),
      body: renderModeDeleteForm(payload.agentId),
      submit: t("modal.deleteMode.submit"),
      form: "delete-mode",
      danger: true,
    },
    knowledge: {
      title: t("modal.knowledge.title"),
      description: t("modal.knowledge.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.knowledge.titleLabel"), `<input name="title" placeholder="${escapeAttr(t("modal.knowledge.titlePlaceholder"))}" required maxlength="120" />`)}
          ${field(t("modal.knowledge.content"), `<textarea name="content" placeholder="${escapeAttr(t("modal.knowledge.contentPlaceholder"))}" required maxlength="12000"></textarea>`)}
          <div class="form-row">
            ${field(t("modal.knowledge.scope"), `<select name="scope"><option value="room">${t("modal.knowledge.roomScope")}</option><option value="workspace">${t("modal.knowledge.workspaceScope")}</option></select>`)}
            ${field(t("modal.knowledge.source"), '<input name="source" value="manual" maxlength="80" />')}
          </div>
        </div>
      `,
      submit: t("action.addKnowledge"),
      form: "knowledge",
    },
    member: {
      title: t("modal.member.title"),
      description: t("modal.member.description"),
      body: (
        availableRoomEmployees().length
          ? `<div class="form-grid">${field(t("modal.member.employee"), renderAvailableEmployeeSelect())}</div>`
          : `<div class="empty-state">${t("room.noAvailableEmployees")}</div>`
      ),
      submit: t("modal.member.submit"),
      form: "member",
    },
    memory: {
      title: t("modal.memory.title"),
      description: t("modal.memory.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.memory.agent"), renderAgentSelect("agentId", state.data.agents, payload.agentId))}
          ${field(t("modal.memory.content"), `<textarea name="content" placeholder="${escapeAttr(t("modal.memory.placeholder"))}" required maxlength="4000"></textarea>`)}
        </div>
      `,
      submit: t("action.saveMemory"),
      form: "memory",
    },
    "employee-memory": {
      title: t("modal.employeeMemory.title"),
      description: t("modal.employeeMemory.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.employeeMemory.employee"), renderEmployeeSelect("employeeId", payload.employeeId))}
          ${field(t("modal.employeeMemory.content"), `<textarea name="content" placeholder="${escapeAttr(t("modal.employeeMemory.placeholder"))}" required maxlength="4000"></textarea>`)}
        </div>
      `,
      submit: t("action.saveMemory"),
      form: "employee-memory",
    },
    seat: {
      title: t("modal.seat.title"),
      description: t("modal.seat.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.seat.employee"), renderEmployeeSelect("employeeId", payload.employeeId))}
          <div class="form-row">
            ${field(
              t("modal.seat.provider"),
              `<select name="provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="google">Google</option><option value="custom">${t("provider.custom")}</option></select>`,
            )}
            ${field(
              t("modal.seat.bindingType"),
              `<select name="bindingType"><option value="organization-seat">${t("modal.account.seat")}</option><option value="api">${t("modal.account.api")}</option><option value="official">${t("modal.account.official")}</option></select>`,
            )}
          </div>
          ${field(t("modal.seat.label"), `<input name="label" placeholder="${escapeAttr(t("modal.seat.labelPlaceholder"))}" required maxlength="120" />`)}
        </div>
      `,
      submit: t("modal.seat.submit"),
      form: "seat",
    },
    offboard: {
      title: t("modal.offboard.title"),
      description: t("modal.offboard.description"),
      body: renderOffboardForm(payload.employeeId),
      submit: t("modal.offboard.submit"),
      form: "offboard",
      danger: true,
    },
    workflow: {
      title: t("modal.workflow.title"),
      description: t("modal.workflow.description"),
      body: renderWorkflowForm(),
      submit: t("modal.workflow.submit"),
      form: "workflow",
    },
    fork: {
      title: t("modal.fork.title"),
      description: t("modal.fork.description"),
      body: `
        <div class="form-grid">
          ${field(t("modal.fork.parent"), renderAgentSelect("parentId", state.data.agents, payload.agentId))}
          ${field(t("modal.fork.name"), `<input name="name" placeholder="${escapeAttr(t("modal.fork.namePlaceholder"))}" maxlength="80" />`)}
          <div class="form-row">
            ${field(t("common.role"), `<select name="role"><option value="">${t("modal.inheritRole")}</option><option value="builder">${t("role.builder")}</option><option value="reviewer">${t("role.reviewer")}</option><option value="researcher">${t("role.researcher")}</option><option value="tester">${t("role.tester")}</option></select>`)}
            ${field(t("modal.agent.instructions"), `<input name="instructions" placeholder="${escapeAttr(t("modal.fork.instructionsPlaceholder"))}" maxlength="1000" />`)}
          </div>
          <div class="notice">${t("modal.fork.notice")}</div>
        </div>
      `,
      submit: t("action.createBranch"),
      form: "fork",
    },
    review: {
      title: t("modal.review.title"),
      description: t("modal.review.description"),
      body: renderReviewForm(),
      submit: t("action.startWorkflow"),
      form: "review",
    },
  }[type];

  if (!modal) return "";
  return `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-header">
          <div>
            <h2 id="modal-title">${escapeHtml(modal.title)}</h2>
            <p>${escapeHtml(modal.description)}</p>
          </div>
          <button class="button button-quiet icon-button" type="button" data-action="close-modal" aria-label="${escapeAttr(t("common.close"))}">
            ${ICONS.close}
          </button>
        </header>
        <div class="modal-body">
          <form data-form="${modal.form}">
            ${modal.body}
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">${t("common.cancel")}</button>
              <button class="button ${modal.danger ? "button-danger" : "button-primary"}" type="submit">${escapeHtml(modal.submit)}</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderAgentForm(payload = {}) {
  return `
    <div class="form-grid">
      <div class="form-row">
        ${field(t("modal.agent.employee"), renderEmployeeSelect("employeeId", payload.employeeId || state.data.employees?.[0]?.id))}
        ${field(t("modal.mode.name"), `<input name="name" placeholder="${escapeAttr(t("modal.agent.namePlaceholder"))}" required maxlength="80" />`)}
      </div>
      <div class="form-row">
        ${field(t("modal.mode.role"), `<input name="role" list="agent-role-options" value="builder" placeholder="${escapeAttr(t("modal.agent.rolePlaceholder"))}" required maxlength="80" />`, t("modal.agent.roleHint"))}
      </div>
      ${renderRoleDatalist()}
      ${field(t("modal.mode.instructions"), `<textarea name="instructions" placeholder="${escapeAttr(t("modal.agent.instructionsPlaceholder"))}" maxlength="4000"></textarea>`)}
      ${field(
        t("modal.agent.adapter"),
        `<select name="adapterType" data-adapter-type><option value="mock">${t("modal.agent.mockAdapter")}</option><option value="command">${t("modal.agent.commandAdapter")}</option><option value="api">${t("modal.agent.apiAdapter")}</option></select>`,
      )}
      <section class="adapter-panel" data-adapter-panel="mock">
        <div class="notice">${t("modal.agent.mockNotice")}</div>
      </section>
      <section class="adapter-panel" data-adapter-panel="command" hidden>
        <div class="form-row">
          ${field(t("modal.agent.command"), `<input name="command" placeholder="${escapeAttr(t("modal.agent.commandPlaceholder"))}" />`)}
          ${field(t("modal.agent.args"), '<input name="args" value="[]" spellcheck="false" />')}
        </div>
        ${field(t("modal.agent.environment"), `<textarea name="environment" placeholder="${escapeAttr(t("modal.agent.environmentPlaceholder"))}" spellcheck="false">{}</textarea>`, t("modal.agent.environmentHint"))}
        <div class="form-row">
          ${field(t("modal.agent.workingDir"), `<input name="workingDir" placeholder="${escapeAttr(t("modal.agent.workingDirPlaceholder"))}" />`)}
          ${field(t("modal.agent.timeout"), '<input name="timeoutMs" type="number" min="1000" max="900000" value="120000" />')}
        </div>
        <div class="notice"><strong>${t("modal.agent.security")}</strong>${t("modal.agent.securityBody")}</div>
      </section>
      <section class="adapter-panel" data-adapter-panel="api" hidden>
        <div class="form-row">
          ${field(
            t("modal.agent.apiProvider"),
            `<select name="apiProvider"><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select>`,
          )}
          ${field(t("modal.agent.apiModel"), '<input name="apiModel" value="deepseek-flash" placeholder="deepseek-flash" spellcheck="false" />')}
        </div>
        ${field(t("modal.agent.apiBaseUrl"), '<input name="apiBaseUrl" value="https://api.deepseek.com" spellcheck="false" />')}
        <div class="form-row">
          ${field(t("modal.agent.apiKeyEnv"), '<input name="apiKeyEnv" value="DEEPSEEK_API_KEY" spellcheck="false" />', t("modal.agent.apiKeyHint"))}
          ${field(t("modal.agent.apiTimeout"), '<input name="apiTimeoutMs" type="number" min="1000" max="900000" value="180000" />')}
        </div>
      </section>
    </div>
  `;
}

function renderModeEditForm(agentId) {
  const agent = findAgent(agentId);
  if (!agent) return `<div class="empty-state">${t("common.unknown")}</div>`;
  return `
    <div class="form-grid">
      <input type="hidden" name="agentId" value="${escapeAttr(agentId)}" />
      <div class="form-row">
        ${field(t("modal.mode.name"), `<input name="name" value="${escapeAttr(agent.name)}" required maxlength="80" />`)}
        ${field(t("team.modeEmployee"), `<input value="${escapeAttr(agent.employeeName || findEmployee(agent.employeeId)?.name || "—")}" disabled />`)}
      </div>
      ${field(t("modal.mode.role"), `<input name="role" value="${escapeAttr(agent.role)}" required maxlength="80" />`)}
      ${field(t("modal.mode.instructions"), `<textarea name="instructions" maxlength="4000">${escapeHtml(agent.instructions || "")}</textarea>`)}
      ${renderModeAdapterEditor(agent.adapter)}
    </div>
  `;
}

function renderRoomDeleteForm(roomId) {
  const room = findRoom(roomId);
  return `
    <div class="form-grid">
      <div class="offboard-target">
        <div class="avatar avatar-system">${escapeHtml(initials(room?.name || "?"))}</div>
        <div>
          <strong>${escapeHtml(room?.name || t("common.unknown"))}</strong>
          <span>${escapeHtml(room?.description || t("modal.deleteRoom.targetFallback"))}</span>
        </div>
      </div>
      <input type="hidden" name="roomId" value="${escapeAttr(roomId)}" />
      <div class="notice notice-danger">${t("modal.deleteRoom.notice")}</div>
    </div>
  `;
}

function renderModeAdapterEditor(adapter = { type: "mock" }) {
  const type = ["mock", "command", "api"].includes(adapter.type)
    ? adapter.type
    : "mock";
  return `
    ${field(
      t("modal.agent.adapter"),
      `<select name="adapterType" data-adapter-type>
        <option value="mock" ${type === "mock" ? "selected" : ""}>${t("modal.agent.mockAdapter")}</option>
        <option value="command" ${type === "command" ? "selected" : ""}>${t("modal.agent.commandAdapter")}</option>
        <option value="api" ${type === "api" ? "selected" : ""}>${t("modal.agent.apiAdapter")}</option>
      </select>`,
    )}
    <section class="adapter-panel" data-adapter-panel="mock" ${type === "mock" ? "" : "hidden"}>
      <div class="notice">${t("modal.agent.mockNotice")}</div>
    </section>
    <section class="adapter-panel" data-adapter-panel="command" ${type === "command" ? "" : "hidden"}>
      <div class="form-row">
        ${field(t("modal.agent.command"), `<input name="command" value="${escapeAttr(adapter.command || "")}" />`)}
        ${field(t("modal.agent.args"), `<input name="args" value="${escapeAttr(JSON.stringify(adapter.args || []))}" spellcheck="false" />`)}
      </div>
      ${field(t("modal.agent.environment"), `<textarea name="environment" spellcheck="false">${escapeHtml(JSON.stringify(adapter.env || {}, null, 2))}</textarea>`, t("modal.agent.environmentHint"))}
      <div class="form-row">
        ${field(t("modal.agent.workingDir"), `<input name="workingDir" value="${escapeAttr(adapter.workingDir || "")}" />`)}
        ${field(t("modal.agent.timeout"), `<input name="timeoutMs" type="number" min="1000" max="900000" value="${Number(adapter.timeoutMs) || 120000}" />`)}
      </div>
    </section>
    <section class="adapter-panel" data-adapter-panel="api" ${type === "api" ? "" : "hidden"}>
      <div class="form-row">
        ${field(
          t("modal.agent.apiProvider"),
          `<select name="apiProvider">
            <option value="deepseek" ${adapter.provider === "deepseek" ? "selected" : ""}>DeepSeek</option>
            <option value="openai" ${adapter.provider === "openai" ? "selected" : ""}>OpenAI</option>
            <option value="openai-compatible" ${adapter.provider === "openai-compatible" ? "selected" : ""}>OpenAI-compatible</option>
          </select>`,
        )}
        ${field(t("modal.agent.apiModel"), `<input name="apiModel" value="${escapeAttr(adapter.model || "")}" spellcheck="false" />`)}
      </div>
      ${field(t("modal.agent.apiBaseUrl"), `<input name="apiBaseUrl" value="${escapeAttr(adapter.baseUrl || "")}" spellcheck="false" />`)}
      <div class="form-row">
        ${field(t("modal.agent.apiKeyEnv"), `<input name="apiKeyEnv" value="${escapeAttr(adapter.apiKeyEnv || "")}" spellcheck="false" />`, t("modal.agent.apiKeyHint"))}
        ${field(t("modal.agent.apiTimeout"), `<input name="apiTimeoutMs" type="number" min="1000" max="900000" value="${Number(adapter.timeoutMs) || 180000}" />`)}
      </div>
    </section>
  `;
}

function renderModeDeleteForm(agentId) {
  const agent = findAgent(agentId);
  return `
    <div class="form-grid">
      <div class="offboard-target">
        <div class="avatar ${agentAvatarClass(agent)}">${escapeHtml(initials(agent?.name || "?"))}</div>
        <div>
          <strong>${escapeHtml(agent?.name || t("common.unknown"))}</strong>
          <span>${escapeHtml(agent?.employeeName || t("common.employee"))} · ${escapeHtml(agent?.role || "—")}</span>
        </div>
      </div>
      <input type="hidden" name="agentId" value="${escapeAttr(agentId)}" />
      <div class="notice">${t("modal.deleteMode.notice")}</div>
    </div>
  `;
}

function renderEmployeeForm() {
  return `
    <div class="form-grid">
      <div class="form-row">
        ${field(t("modal.employee.name"), `<input name="name" placeholder="${escapeAttr(t("modal.employee.namePlaceholder"))}" required maxlength="80" />`)}
        ${field(t("modal.employee.titleLabel"), `<input name="title" placeholder="${escapeAttr(t("modal.employee.titlePlaceholder"))}" required maxlength="120" />`)}
      </div>
      ${field(t("modal.employee.manager"), renderManagerSelect())}
      <div class="form-row">
        ${field(
          t("modal.employee.provider"),
          `<select name="provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="google">Google</option><option value="custom">${t("provider.custom")}</option></select>`,
        )}
        ${field(
          t("modal.employee.bindingType"),
          `<select name="bindingType"><option value="organization-seat">${t("modal.account.seat")}</option><option value="api">${t("modal.account.api")}</option><option value="official">${t("modal.account.official")}</option></select>`,
        )}
      </div>
      ${field(t("modal.employee.seatLabel"), `<input name="label" placeholder="${escapeAttr(t("modal.employee.seatLabelPlaceholder"))}" required maxlength="120" />`)}
      <div class="notice">${t("modal.employee.description")}</div>
    </div>
  `;
}

function renderEmployeeEditForm(employeeId) {
  const employee = findEmployee(employeeId);
  if (!employee) return `<div class="empty-state">${t("common.unknown")}</div>`;
  return `
    <div class="form-grid">
      <input type="hidden" name="employeeId" value="${escapeAttr(employeeId)}" />
      <div class="form-row">
        ${field(t("modal.employee.name"), `<input name="name" value="${escapeAttr(employee.name)}" required maxlength="80" />`)}
        ${field(t("modal.employee.titleLabel"), `<input name="title" value="${escapeAttr(employee.title || "")}" required maxlength="120" />`)}
      </div>
      ${field(t("modal.employee.manager"), renderManagerSelect("managerId", employee.managerId || "", employee.id))}
      <div class="notice">${t("modal.editEmployee.description")}</div>
    </div>
  `;
}

function renderEmployeeDeleteForm(employeeId) {
  const employee = findEmployee(employeeId);
  return `
    <div class="form-grid">
      <div class="offboard-target">
        <div class="avatar avatar-human">${escapeHtml(initials(employee?.name || "?"))}</div>
        <div>
          <strong>${escapeHtml(employee?.name || t("common.unknown"))}</strong>
          <span>${escapeHtml(employee?.title || "—")} · ${escapeHtml(employee?.activeSeat?.label || t("team.noSeat"))}</span>
        </div>
      </div>
      <input type="hidden" name="employeeId" value="${escapeAttr(employeeId)}" />
      <div class="notice">${t("modal.deleteEmployee.notice")}</div>
    </div>
  `;
}

function renderOffboardForm(employeeId) {
  const employee = findEmployee(employeeId);
  return `
    <div class="form-grid">
      <div class="offboard-target">
        <div class="avatar avatar-human">${escapeHtml(initials(employee?.name || "?"))}</div>
        <div>
          <strong>${escapeHtml(employee?.name || t("common.employee"))}</strong>
          <span>${escapeHtml(employee?.title || "—")} · ${escapeHtml(employee?.activeSeat?.label || t("team.noSeat"))}</span>
        </div>
      </div>
      <input type="hidden" name="employeeId" value="${escapeAttr(employeeId)}" />
      ${field(t("modal.offboard.reason"), `<textarea name="reason" placeholder="${escapeAttr(t("modal.offboard.reasonPlaceholder"))}" maxlength="2000"></textarea>`)}
      <div class="notice">${t("modal.offboard.notice")}</div>
    </div>
  `;
}

function renderRoleDatalist() {
  return `
    <datalist id="agent-role-options">
      <option value="builder">${t("role.builder")}</option>
      <option value="reviewer">${t("role.reviewer")}</option>
      <option value="researcher">${t("role.researcher")}</option>
      <option value="tester">${t("role.tester")}</option>
    </datalist>
  `;
}

function buildAdapterFromPayload(payload) {
  let args = [];
  let environment = {};
  if (payload.adapterType === "command") {
    try {
      args = JSON.parse(payload.args || "[]");
    } catch {
      throw new Error(t("toast.jsonArray"));
    }
    if (!Array.isArray(args)) throw new Error(t("toast.jsonArray"));
    try {
      environment = JSON.parse(payload.environment || "{}");
    } catch {
      throw new Error(t("toast.jsonObject"));
    }
    if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
      throw new Error(t("toast.jsonObject"));
    }
    return {
      type: "command",
      command: payload.command,
      args,
      env: environment,
      workingDir: payload.workingDir || undefined,
      timeoutMs: Number(payload.timeoutMs) || 120000,
    };
  }
  if (payload.adapterType === "api") {
    if (!payload.apiBaseUrl || !payload.apiModel || !payload.apiKeyEnv) {
      throw new Error(t("toast.apiFieldsRequired"));
    }
    return {
      type: "api",
      provider: payload.apiProvider || "openai-compatible",
      baseUrl: payload.apiBaseUrl,
      model: payload.apiModel,
      apiKeyEnv: payload.apiKeyEnv,
      timeoutMs: Number(payload.apiTimeoutMs) || 180000,
    };
  }
  return { type: "mock", behavior: payload.role };
}

function renderReviewForm() {
  const agents = roomAgents();
  const preferredWriter = agents.find((agent) => agent.role === "builder") ?? agents[0];
  const preferredReviewer =
    agents.find(
      (agent) =>
        agent.role === "reviewer" && agent.employeeId !== preferredWriter?.employeeId,
    ) ??
    agents.find((agent) => agent.employeeId !== preferredWriter?.employeeId);
  const reviewerOptions = agents.filter(
    (agent) => agent.employeeId !== preferredWriter?.employeeId,
  );
  return `
    <div class="form-grid">
      ${field(t("modal.review.taskTitle"), `<input name="title" placeholder="${escapeAttr(t("modal.review.taskTitlePlaceholder"))}" required maxlength="120" />`)}
      ${field(t("modal.review.prompt"), `<textarea name="prompt" placeholder="${escapeAttr(t("modal.review.promptPlaceholder"))}" required maxlength="12000"></textarea>`)}
      <div class="form-row">
        ${field(t("modal.review.writer"), renderAgentSelect("writerAgentId", agents, preferredWriter?.id))}
        ${field(t("modal.review.reviewer"), renderAgentSelect("reviewerAgentId", reviewerOptions, preferredReviewer?.id))}
      </div>
      <div class="notice">${t("modal.review.notice")} ${t("modal.review.employeeRule")}</div>
    </div>
  `;
}

function nextWorkflowStepKey() {
  state.workflowStepSeq += 1;
  return `step_${state.workflowStepSeq}`;
}

function defaultWorkflowStepContract(variant = "work") {
  const prefix = `modal.workflow.contractDefaults.${variant}`;
  return {
    objective: t(`${prefix}.objective`),
    inputRequirements: t(`${prefix}.inputs`),
    deliverables: t(`${prefix}.deliverables`),
    forbiddenActions: t(`${prefix}.forbidden`),
    completionCriteria: t(`${prefix}.completion`),
  };
}

function createDefaultWorkflowDraft() {
  const agents = roomAgents();
  if (!agents.length) return [];
  const first =
    agents.find((agent) => agent.role === "builder") ?? agents[0];
  const second =
    agents.find((agent) => agent.role === "reviewer") ??
    agents.find((agent) => agent.id !== first.id);
  const firstStep = {
    key: nextWorkflowStepKey(),
    name: t("modal.workflow.defaultExecute"),
    agentId: first.id,
    ...defaultWorkflowStepContract("work"),
    dependsOn: [],
  };
  if (!second) return [firstStep];
  return [
    firstStep,
    {
      key: nextWorkflowStepKey(),
      name: t("modal.workflow.defaultReview"),
      agentId: second.id,
      ...defaultWorkflowStepContract("review"),
      dependsOn: [firstStep.key],
    },
  ];
}

function defaultAcceptanceAgent() {
  const agents = roomAgents();
  return (
    agents.find((agent) => /review|audit|accept|验收|复核/i.test(agent.role)) ??
    agents[agents.length - 1] ??
    null
  );
}

function renderWorkflowForm() {
  const agents = roomAgents();
  if (!agents.length) {
    return `<div class="empty-state">${t("modal.workflow.empty")}</div>`;
  }
  if (!state.workflowDraft) state.workflowDraft = createDefaultWorkflowDraft();
  return `
    <div class="form-grid workflow-builder" data-workflow-form>
      ${field(t("modal.workflow.taskTitle"), `<input name="workflowTitle" value="${escapeAttr(state.workflowMeta.title)}" placeholder="${escapeAttr(t("modal.workflow.taskTitlePlaceholder"))}" required maxlength="140" />`)}
      ${field(
        t("modal.workflow.objective"),
        `<textarea name="workflowPrompt" placeholder="${escapeAttr(t("modal.workflow.objectivePlaceholder"))}" required maxlength="16000">${escapeHtml(state.workflowMeta.prompt)}</textarea>`,
        t("modal.workflow.objectiveHint"),
      )}
      <div class="workflow-builder-heading">
        <h3>${t("modal.workflow.steps")}</h3>
        <button class="button button-small" type="button" data-action="add-workflow-step" ${state.workflowDraft.length >= 8 ? "disabled" : ""}>${ICONS.plus} ${t("modal.workflow.addStep")}</button>
      </div>
      <div class="workflow-builder-steps">
        ${state.workflowDraft.map((step, index) => renderWorkflowStepEditor(step, index, agents)).join("")}
      </div>
      <div class="workflow-acceptance-editor">
        ${field(
          t("modal.workflow.acceptanceAgent"),
          renderAgentSelect(
            "acceptanceAgentId",
            agents,
            state.workflowMeta.acceptanceAgentId || defaultAcceptanceAgent()?.id,
          ),
        )}
        <div class="field-hint">${t("modal.workflow.acceptanceHint")}</div>
      </div>
      <div class="notice">${t("modal.workflow.notice")}</div>
    </div>
  `;
}

function renderWorkflowStepEditor(step, index, agents) {
  const dependencies = state.workflowDraft.filter(
    (candidate) => candidate.key !== step.key,
  );
  return `
    <section class="workflow-builder-step" data-workflow-step="${escapeAttr(step.key)}">
      <div class="workflow-builder-step-header">
        <span class="workflow-step-index">${index + 1}</span>
        <strong>${escapeHtml(step.name || `${t("modal.workflow.steps")} ${index + 1}`)}</strong>
        <button class="button button-small button-quiet" type="button" data-action="remove-workflow-step" data-step-key="${escapeAttr(step.key)}" ${state.workflowDraft.length <= 1 ? "disabled" : ""}>${t("modal.workflow.remove")}</button>
      </div>
      <div class="form-row">
        ${field(t("modal.workflow.stepName"), `<input name="workflow_step_${escapeAttr(step.key)}_name" value="${escapeAttr(step.name)}" placeholder="${escapeAttr(t("modal.workflow.stepNamePlaceholder"))}" required maxlength="100" />`)}
        ${field(t("modal.workflow.agentMode"), renderAgentSelect(`workflow_step_${step.key}_agent`, agents, step.agentId))}
      </div>
      <div class="workflow-dependency-field">
        <div class="workflow-dependency-heading">
          <div>
            <label>${t("modal.workflow.dependsOn")}</label>
            <span>${t("modal.workflow.dependsOnHint")}</span>
          </div>
          <span class="workflow-dependency-mark">${ICONS.fork}</span>
        </div>
        ${
          dependencies.length
            ? `<div class="workflow-dependency-list">
                ${dependencies
                  .map(
                    (candidate) => {
                      const candidateIndex =
                        state.workflowDraft.findIndex(
                          (item) => item.key === candidate.key,
                        ) + 1;
                      return `
                      <label class="workflow-dependency-option">
                        <input type="checkbox" class="workflow-dependency" name="workflow_dep_${escapeAttr(step.key)}_${escapeAttr(candidate.key)}" data-dependent-key="${escapeAttr(step.key)}" ${step.dependsOn.includes(candidate.key) ? "checked" : ""} />
                        <span class="workflow-dependency-check" aria-hidden="true"></span>
                        <span class="workflow-dependency-copy">
                          <span>${t("modal.workflow.dependencyStep", { number: candidateIndex })}</span>
                          <strong>${escapeHtml(candidate.name || `${t("modal.workflow.steps")} ${candidateIndex}`)}</strong>
                        </span>
                      </label>
                    `;
                    },
                  )
                  .join("")}
              </div>`
            : `<div class="workflow-dependency-empty">
                <span class="workflow-dependency-flow" aria-hidden="true">⇉</span>
                <span>
                  <strong>${t("modal.workflow.parallelTitle")}</strong>
                  <small>${t("modal.workflow.parallelHint")}</small>
                </span>
              </div>`
        }
      </div>
      <div class="workflow-step-contract">
        <div class="workflow-step-contract-heading">
          <strong>${t("modal.workflow.stepContract")}</strong>
          <span>${t("modal.workflow.stepContractHint")}</span>
        </div>
        <div class="workflow-step-contract-grid">
          ${field(
            t("modal.workflow.stepObjective"),
            `<textarea name="workflow_step_${escapeAttr(step.key)}_objective" rows="2" maxlength="3000" required placeholder="${escapeAttr(t("modal.workflow.stepObjectivePlaceholder"))}">${escapeHtml(step.objective || "")}</textarea>`,
          )}
          ${field(
            t("modal.workflow.inputRequirements"),
            `<textarea name="workflow_step_${escapeAttr(step.key)}_inputs" rows="3" maxlength="3000" required placeholder="${escapeAttr(t("modal.workflow.inputRequirementsPlaceholder"))}">${escapeHtml(step.inputRequirements || "")}</textarea>`,
          )}
          ${field(
            t("modal.workflow.deliverables"),
            `<textarea name="workflow_step_${escapeAttr(step.key)}_deliverables" rows="3" maxlength="3000" required placeholder="${escapeAttr(t("modal.workflow.deliverablesPlaceholder"))}">${escapeHtml(step.deliverables || "")}</textarea>`,
          )}
          ${field(
            t("modal.workflow.forbiddenActions"),
            `<textarea name="workflow_step_${escapeAttr(step.key)}_forbidden" rows="3" maxlength="3000" required placeholder="${escapeAttr(t("modal.workflow.forbiddenActionsPlaceholder"))}">${escapeHtml(step.forbiddenActions || "")}</textarea>`,
          )}
          ${field(
            t("modal.workflow.completionCriteria"),
            `<textarea name="workflow_step_${escapeAttr(step.key)}_completion" rows="3" maxlength="3000" required placeholder="${escapeAttr(t("modal.workflow.completionCriteriaPlaceholder"))}">${escapeHtml(step.completionCriteria || "")}</textarea>`,
          )}
        </div>
      </div>
    </section>
  `;
}

function captureWorkflowDraftFromForm() {
  const form = document.querySelector('[data-workflow-form]')?.closest("form");
  if (!form || !state.workflowDraft) return;
  const formData = new FormData(form);
  state.workflowMeta = {
    title: String(formData.get("workflowTitle") ?? state.workflowMeta.title),
    prompt: String(formData.get("workflowPrompt") ?? state.workflowMeta.prompt),
    acceptanceAgentId: String(
      formData.get("acceptanceAgentId") ??
        state.workflowMeta.acceptanceAgentId ??
        "",
    ),
    acceptanceStepName:
      state.workflowMeta.acceptanceStepName ||
      t("modal.workflow.defaultAcceptance"),
  };
  state.workflowDraft = state.workflowDraft.map((step) => ({
    ...step,
    name: String(
      formData.get(`workflow_step_${step.key}_name`) ?? step.name,
    ),
    objective: String(
      formData.get(`workflow_step_${step.key}_objective`) ?? step.objective ?? "",
    ),
    inputRequirements: String(
      formData.get(`workflow_step_${step.key}_inputs`) ??
        step.inputRequirements ??
        "",
    ),
    deliverables: String(
      formData.get(`workflow_step_${step.key}_deliverables`) ??
        step.deliverables ??
        "",
    ),
    forbiddenActions: String(
      formData.get(`workflow_step_${step.key}_forbidden`) ??
        step.forbiddenActions ??
        "",
    ),
    completionCriteria: String(
      formData.get(`workflow_step_${step.key}_completion`) ??
        step.completionCriteria ??
        "",
    ),
    agentId: String(
      formData.get(`workflow_step_${step.key}_agent`) ?? step.agentId,
    ),
    dependsOn: state.workflowDraft
      .filter(
        (candidate) =>
          candidate.key !== step.key &&
          formData.has(`workflow_dep_${step.key}_${candidate.key}`),
      )
      .map((candidate) => candidate.key),
  }));
}

function renderOnboarding() {
  const room = state.data.rooms[0] ?? null;
  const employee = state.data.employees?.[0] ?? null;
  const agent = state.data.agents[0] ?? null;

  let step = state.onboarding.step;
  if (!room) step = Math.min(step, 2);
  else if (!employee) step = Math.max(3, Math.min(step, 3));
  else if (!agent) step = Math.max(4, Math.min(step, 4));
  else step = 5;
  state.onboarding.step = step;

  let body = "";
  if (step === 1) {
    body = `
      <div class="onboarding-step-copy">
        <span class="onboarding-eyebrow">01</span>
        <h2>${t("onboarding.language.title")}</h2>
        <p>${t("onboarding.language.description")}</p>
      </div>
      <div class="language-choice-grid">
        <button class="language-choice ${state.locale === "zh-CN" ? "is-selected" : ""}" data-action="select-locale" data-locale="zh-CN">
          <span class="language-code">中</span>
          <span><strong>${t("onboarding.language.zh")}</strong><small>Simplified Chinese</small></span>
        </button>
        <button class="language-choice ${state.locale === "en" ? "is-selected" : ""}" data-action="select-locale" data-locale="en">
          <span class="language-code">EN</span>
          <span><strong>${t("onboarding.language.en")}</strong><small>English</small></span>
        </button>
      </div>
      <div class="onboarding-actions">
        <button class="button button-primary" data-action="onboarding-next" data-step="2">${t("onboarding.language.continue")}</button>
      </div>
    `;
  } else if (step === 2) {
    body = `
      <div class="onboarding-step-copy">
        <span class="onboarding-eyebrow">02</span>
        <h2>${t("onboarding.room.title")}</h2>
        <p>${t("onboarding.room.description")}</p>
      </div>
      <form data-form="onboarding-room" class="form-grid">
        ${field(t("onboarding.room.name"), `<input name="name" placeholder="${escapeAttr(t("onboarding.room.namePlaceholder"))}" required maxlength="80" autofocus />`)}
        ${field(t("onboarding.room.descriptionLabel"), `<textarea name="description" placeholder="${escapeAttr(t("onboarding.room.descriptionPlaceholder"))}" maxlength="500"></textarea>`)}
        <div class="onboarding-actions">
          <button class="button button-primary" type="submit">${t("onboarding.room.submit")}</button>
        </div>
      </form>
    `;
  } else if (step === 3) {
    body = `
      <div class="onboarding-step-copy">
        <span class="onboarding-eyebrow">03</span>
        <h2>${t("onboarding.account.title")}</h2>
        <p>${t("onboarding.account.description")}</p>
      </div>
      <form data-form="onboarding-account" class="form-grid">
        <div class="form-row">
          ${field(t("onboarding.account.name"), `<input name="name" placeholder="${escapeAttr(t("onboarding.account.namePlaceholder"))}" required maxlength="80" />`)}
          ${field(t("onboarding.account.titleLabel"), `<input name="title" placeholder="${escapeAttr(t("onboarding.account.titlePlaceholder"))}" required maxlength="120" />`)}
        </div>
        <div class="form-row">
          ${field(
            t("onboarding.account.provider"),
            `<select name="provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="google">Google</option><option value="custom">${t("provider.custom")}</option></select>`,
          )}
          ${field(
            t("onboarding.account.auth"),
            `<select name="bindingType"><option value="organization-seat">${t("onboarding.account.seat")}</option><option value="api">${t("onboarding.account.api")}</option><option value="official">${t("onboarding.account.official")}</option></select>`,
          )}
        </div>
        ${field(t("onboarding.account.label"), `<input name="label" placeholder="${escapeAttr(t("onboarding.account.labelPlaceholder"))}" required maxlength="120" />`)}
        <div class="notice"><strong>${t("devices.securityTitle")}</strong>${t("modal.account.notice")}</div>
        <div class="onboarding-actions">
          <button class="button button-primary" type="submit">${t("onboarding.account.submit")}</button>
        </div>
      </form>
    `;
  } else if (step === 4) {
    body = `
      <div class="onboarding-step-copy">
        <span class="onboarding-eyebrow">04</span>
        <h2>${t("onboarding.agent.title")}</h2>
        <p>${t("onboarding.agent.description")}</p>
      </div>
      <form data-form="onboarding-agent" class="form-grid">
        <div class="form-row">
          ${field(t("onboarding.agent.name"), `<input name="name" placeholder="${escapeAttr(t("onboarding.agent.namePlaceholder"))}" required maxlength="80" />`)}
          ${field(t("onboarding.agent.account"), renderEmployeeSelect("employeeId", employee.id))}
        </div>
        <div class="form-row">
          ${field(t("onboarding.agent.role"), `<input name="role" list="onboarding-role-options" value="builder" placeholder="${escapeAttr(t("onboarding.agent.rolePlaceholder"))}" required maxlength="80" />`, t("onboarding.agent.roleHint"))}
          ${field(t("team.title"), `<input value="${escapeAttr(employee.title || "—")}" disabled />`)}
        </div>
        <datalist id="onboarding-role-options">
          <option value="builder">${t("role.builder")}</option>
          <option value="reviewer">${t("role.reviewer")}</option>
          <option value="researcher">${t("role.researcher")}</option>
          <option value="tester">${t("role.tester")}</option>
        </datalist>
        ${field(t("onboarding.agent.instructions"), `<textarea name="instructions" placeholder="${escapeAttr(t("onboarding.agent.instructionsPlaceholder"))}" maxlength="4000"></textarea>`)}
        ${field(
          t("modal.agent.adapter"),
          `<select name="adapterType" data-adapter-type><option value="api" selected>${t("modal.agent.apiAdapter")}</option><option value="command">${t("modal.agent.commandAdapter")}</option><option value="mock">${t("modal.agent.mockAdapter")}</option></select>`,
        )}
        <section class="adapter-panel" data-adapter-panel="api">
          <div class="form-row">
            ${field(
              t("modal.agent.apiProvider"),
              `<select name="apiProvider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI-compatible</option></select>`,
            )}
            ${field(t("modal.agent.apiModel"), '<input name="apiModel" value="deepseek-flash" spellcheck="false" />')}
          </div>
          ${field(t("modal.agent.apiBaseUrl"), '<input name="apiBaseUrl" value="https://api.deepseek.com" spellcheck="false" />')}
          <div class="form-row">
            ${field(t("modal.agent.apiKeyEnv"), '<input name="apiKeyEnv" value="DEEPSEEK_API_KEY" spellcheck="false" />', t("modal.agent.apiKeyHint"))}
            ${field(t("modal.agent.apiTimeout"), '<input name="apiTimeoutMs" type="number" min="1000" max="900000" value="180000" />')}
          </div>
        </section>
        <section class="adapter-panel" data-adapter-panel="command" hidden>
          <div class="form-row">
            ${field(t("modal.agent.command"), `<input name="command" placeholder="${escapeAttr(t("modal.agent.commandPlaceholder"))}" />`)}
            ${field(t("modal.agent.args"), '<input name="args" value="[]" spellcheck="false" />')}
          </div>
          ${field(t("modal.agent.environment"), `<textarea name="environment" placeholder="${escapeAttr(t("modal.agent.environmentPlaceholder"))}" spellcheck="false">{}</textarea>`, t("modal.agent.environmentHint"))}
          <div class="form-row">
            ${field(t("modal.agent.workingDir"), `<input name="workingDir" placeholder="${escapeAttr(t("modal.agent.workingDirPlaceholder"))}" />`)}
            ${field(t("modal.agent.timeout"), '<input name="timeoutMs" type="number" min="1000" max="900000" value="600000" />')}
          </div>
        </section>
        <section class="adapter-panel" data-adapter-panel="mock" hidden>
          <div class="notice">${t("onboarding.agent.mockNotice")}</div>
        </section>
        <div class="onboarding-actions">
          <button class="button button-primary" type="submit">${t("onboarding.agent.submit")}</button>
        </div>
      </form>
    `;
  } else {
    body = `
      <div class="onboarding-step-copy">
        <span class="onboarding-eyebrow">05</span>
        <h2>${t("onboarding.review.title")}</h2>
        <p>${t("onboarding.review.description")}</p>
      </div>
      <div class="setup-summary">
        <div><span>${t("onboarding.review.room")}</span><strong>${escapeHtml(room?.name || "—")}</strong></div>
        <div><span>${t("onboarding.review.account")}</span><strong>${escapeHtml(employee?.name || t("onboarding.noAccount"))}</strong></div>
        <div><span>${t("team.seat")}</span><strong>${escapeHtml(employee?.activeSeat?.label || t("team.noSeat"))}</strong></div>
        <div><span>${t("onboarding.review.agent")}</span><strong>${escapeHtml(agent?.name || "—")}</strong></div>
        <div><span>${t("onboarding.review.role")}</span><strong>${escapeHtml(agent?.role || "—")}</strong></div>
        <div><span>${t("onboarding.review.language")}</span><strong>${state.locale === "zh-CN" ? t("onboarding.language.zh") : t("onboarding.language.en")}</strong></div>
      </div>
      <div class="notice">${t("onboarding.review.security")}</div>
      <div class="onboarding-actions">
        <button class="button button-primary" data-action="onboarding-finish">${t("onboarding.review.finish")}</button>
      </div>
    `;
  }

  return `
    <div class="onboarding-shell">
      <header class="onboarding-header">
        <div class="brand onboarding-brand">
          ${renderBrandMark()}
          <div class="brand-copy">
            <div class="brand-name">CrossStaff</div>
            <div class="brand-tag">${t("app.earlyAlpha")}</div>
          </div>
        </div>
        <div class="onboarding-progress" aria-label="${escapeAttr(t("onboarding.step", { current: step, total: 5 }))}">
          ${[1, 2, 3, 4, 5]
            .map(
              (item) =>
                `<span class="${item <= step ? "is-complete" : ""} ${item === step ? "is-current" : ""}"></span>`,
            )
            .join("")}
        </div>
      </header>
      <main class="onboarding-main">
        <div class="onboarding-kicker">${t("onboarding.brand")} · ${t("onboarding.step", { current: step, total: 5 })}</div>
        <section class="onboarding-card">
          ${body}
        </section>
        <p class="onboarding-intro">${t("onboarding.intro")}</p>
      </main>
    </div>
  `;
}

function setOnboardingStep(step) {
  state.onboarding.step = Math.min(Math.max(Number(step), 1), 5);
  localStorage.setItem("crossstaff.onboardingStep", String(state.onboarding.step));
  render();
}

async function handleSubmit(event) {
  const value = event.target;
  if (!(value instanceof HTMLFormElement)) return;
  event.preventDefault();

  if (value.id === "message-form") {
    const formData = new FormData(value);
    const content = String(formData.get("content") || "").trim();
    if (!content || !state.roomId) return;
    const submitButton = value.querySelector('button[type="submit"]');
    setButtonBusy(submitButton, true);
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({ roomId: state.roomId, content }),
      });
      value.reset();
      await loadState();
    } catch (error) {
      showToast(error.message, true);
      setButtonBusy(submitButton, false);
    }
    return;
  }

  const formType = value.dataset.form;
  if (!formType) return;
  const formData = new FormData(value);
  const payload = Object.fromEntries(formData.entries());
  const submitButton = value.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true);

  try {
    let response;
    if (formType === "onboarding-room") {
      response = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
        }),
      });
      state.roomId = response.id;
      state.onboarding.roomId = response.id;
      setOnboardingStep(3);
      await loadState();
      showToast(formSuccessMessage(formType));
      return;
    } else if (formType === "onboarding-account") {
      response = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          title: payload.title,
          provider: payload.provider,
          label: payload.label,
          bindingType: payload.bindingType,
          roomId: state.roomId,
        }),
      });
      state.onboarding.employeeId = response.id;
      setOnboardingStep(4);
      await loadState();
      showToast(formSuccessMessage(formType));
      return;
    } else if (formType === "onboarding-agent") {
      response = await api("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.roomId,
          employeeId: payload.employeeId,
          name: payload.name,
          role: payload.role,
          instructions: payload.instructions,
          adapter: buildAdapterFromPayload(payload),
        }),
      });
      state.onboarding.agentId = response.id;
      setOnboardingStep(5);
      await loadState();
      showToast(formSuccessMessage(formType));
      return;
    } else if (formType === "room") {
      response = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.roomId = response.id;
      state.view = "rooms";
    } else if (formType === "delete-room") {
      response = await api(`/api/rooms/${encodeURIComponent(payload.roomId)}`, {
        method: "DELETE",
      });
      state.roomId = response.nextRoomId || null;
      state.view = "rooms";
      state.railTab = "workflows";
    } else if (formType === "employee") {
      await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          title: payload.title,
          managerId: payload.managerId || null,
          provider: payload.provider,
          bindingType: payload.bindingType,
          label: payload.label,
        }),
      });
    } else if (formType === "edit-employee") {
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          title: payload.title,
          managerId: payload.managerId || null,
        }),
      });
    } else if (formType === "delete-employee") {
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}`, {
        method: "DELETE",
      });
    } else if (formType === "employee-memory") {
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}/memories`, {
        method: "POST",
        body: JSON.stringify({ content: payload.content }),
      });
    } else if (formType === "member") {
      await api(`/api/rooms/${encodeURIComponent(state.roomId)}/members`, {
        method: "POST",
        body: JSON.stringify({ employeeId: payload.employeeId }),
      });
    } else if (formType === "seat") {
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}/seats`, {
        method: "POST",
        body: JSON.stringify({
          provider: payload.provider,
          bindingType: payload.bindingType,
          label: payload.label,
        }),
      });
    } else if (formType === "offboard") {
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}/offboard`, {
        method: "POST",
        body: JSON.stringify({ reason: payload.reason }),
      });
    } else if (formType === "knowledge") {
      await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.roomId,
          title: payload.title,
          content: payload.content,
          scope: payload.scope,
          source: payload.source,
        }),
      });
    } else if (formType === "memory") {
      await api(`/api/agents/${encodeURIComponent(payload.agentId)}/memories`, {
        method: "POST",
        body: JSON.stringify({ content: payload.content }),
      });
    } else if (formType === "fork") {
      await api(`/api/agents/${encodeURIComponent(payload.parentId)}/fork`, {
        method: "POST",
        body: JSON.stringify({
          name: payload.name || undefined,
          role: payload.role || undefined,
          instructions: payload.instructions || undefined,
        }),
      });
    } else if (formType === "agent") {
      const adapter = buildAdapterFromPayload(payload);
      await api(`/api/employees/${encodeURIComponent(payload.employeeId)}/modes`, {
        method: "POST",
        body: JSON.stringify({
          roomId: state.roomId,
          name: payload.name,
          role: payload.role,
          instructions: payload.instructions,
          adapter,
        }),
      });
    } else if (formType === "edit-mode") {
      await api(`/api/agent-modes/${encodeURIComponent(payload.agentId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          role: payload.role,
          instructions: payload.instructions,
          adapter: buildAdapterFromPayload(payload),
        }),
      });
    } else if (formType === "delete-mode") {
      await api(`/api/agent-modes/${encodeURIComponent(payload.agentId)}`, {
        method: "DELETE",
      });
    } else if (formType === "workflow") {
      captureWorkflowDraftFromForm();
      await api("/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.roomId,
          title: payload.workflowTitle,
          prompt: payload.workflowPrompt,
          acceptanceAgentId:
            state.workflowMeta.acceptanceAgentId || payload.acceptanceAgentId,
          acceptanceStepName: state.workflowMeta.acceptanceStepName,
          steps: state.workflowDraft.map((step) => ({
            key: step.key,
            name: step.name,
            agentId: step.agentId,
          objective: step.objective,
          inputRequirements: step.inputRequirements,
          deliverables: step.deliverables,
          forbiddenActions: step.forbiddenActions,
          completionCriteria: step.completionCriteria,
            dependsOn: step.dependsOn,
          })),
        }),
      });
      state.view = "rooms";
      state.railTab = "workflows";
    } else if (formType === "review") {
      await api("/api/workflows/review", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.roomId,
          title: payload.title,
          prompt: payload.prompt,
          writerAgentId: payload.writerAgentId,
          reviewerAgentId: payload.reviewerAgentId,
        }),
      });
      state.view = "rooms";
      state.railTab = "tasks";
    }

    closeModal({ renderNow: false });
    await loadState();
    showToast(formSuccessMessage(formType));
  } catch (error) {
    showToast(error.message, true);
    setButtonBusy(submitButton, false);
  }
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  const action = target.dataset.action;

  if (action === "switch-view") {
    state.view = target.dataset.view;
    state.sidebarOpen = false;
    render();
    return;
  }

  if (action === "switch-room") {
    state.roomId = target.dataset.roomId;
    state.view = "rooms";
    state.sidebarOpen = false;
    localStorage.setItem("crossstaff.roomId", state.roomId);
    loadState();
    return;
  }

  if (action === "rail-tab") {
    state.railTab = target.dataset.tab;
    render();
    return;
  }

  if (action === "toggle-sidebar") {
    state.sidebarOpen = !state.sidebarOpen;
    render();
    return;
  }

  if (action === "refresh") {
    loadState();
    return;
  }

  if (action === "toggle-locale") {
    changeLocale(state.locale === "zh-CN" ? "en" : "zh-CN");
    return;
  }

  if (action === "select-locale") {
    changeLocale(normalizeLocale(target.dataset.locale));
    return;
  }

  if (action === "onboarding-next") {
    setOnboardingStep(target.dataset.step);
    return;
  }

  if (action === "onboarding-finish") {
    finishOnboarding(target);
    return;
  }

  if (action === "open-modal") {
    if (target.dataset.modal === "workflow") {
      state.workflowDraft = null;
      state.workflowMeta = {
        title: "",
        prompt: "",
        acceptanceAgentId: defaultAcceptanceAgent()?.id ?? "",
        acceptanceStepName: t("modal.workflow.defaultAcceptance"),
      };
      state.workflowStepSeq = 0;
      state.workflowDraft = createDefaultWorkflowDraft();
    }
    state.modal = {
      type: target.dataset.modal,
      payload: {
        agentId: target.dataset.agentId,
        employeeId: target.dataset.employeeId,
        roomId: target.dataset.roomId,
      },
    };
    render();
    requestAnimationFrame(() => {
      document.querySelector(".modal input, .modal textarea, .modal select")?.focus();
    });
    return;
  }

  if (action === "add-workflow-step") {
    captureWorkflowDraftFromForm();
    const agents = roomAgents();
    if (agents.length && state.workflowDraft.length < 8) {
      state.workflowDraft.push({
        key: nextWorkflowStepKey(),
        name: `${t("modal.workflow.steps")} ${state.workflowDraft.length + 1}`,
        agentId: agents[0].id,
        ...defaultWorkflowStepContract("work"),
        dependsOn: [],
      });
    }
    render();
    return;
  }

  if (action === "remove-workflow-step") {
    captureWorkflowDraftFromForm();
    const stepKey = target.dataset.stepKey;
    if (state.workflowDraft.length > 1) {
      state.workflowDraft = state.workflowDraft
        .filter((step) => step.key !== stepKey)
        .map((step) => ({
          ...step,
          dependsOn: step.dependsOn.filter(
            (dependency) => dependency !== stepKey,
          ),
        }));
    }
    render();
    return;
  }

  if (action === "close-modal") {
    closeModal();
    return;
  }

  if (action === "close-modal-backdrop" && target === event.target) {
    closeModal();
    return;
  }

  if (action === "cancel-task") {
    cancelTask(target.dataset.taskId);
    return;
  }

  if (action === "cancel-workflow") {
    cancelWorkflow(target.dataset.workflowId);
  }
}

function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
    return;
  }
  if (target.matches("[data-adapter-type]")) {
    updateAdapterPanels(target.closest("form"), target.value);
  }
  if (target.matches('[name="apiProvider"]')) {
    const form = target.closest("form");
    const baseUrl = form?.querySelector('[name="apiBaseUrl"]');
    const model = form?.querySelector('[name="apiModel"]');
    const keyEnv = form?.querySelector('[name="apiKeyEnv"]');
    if (target.value === "deepseek") {
      if (baseUrl) baseUrl.value = "https://api.deepseek.com";
      if (model) model.value = "deepseek-flash";
      if (keyEnv) keyEnv.value = "DEEPSEEK_API_KEY";
    } else if (target.value === "openai") {
      if (baseUrl) baseUrl.value = "https://api.openai.com/v1";
      if (keyEnv) keyEnv.value = "OPENAI_API_KEY";
    } else {
      if (baseUrl) baseUrl.value = "";
      if (model) model.value = "";
      if (keyEnv) keyEnv.value = "";
    }
  }
}

function updateAdapterPanels(scope, adapterType) {
  if (!scope) return;
  for (const panel of scope.querySelectorAll("[data-adapter-panel]")) {
    panel.hidden = panel.dataset.adapterPanel !== adapterType;
  }
}

async function cancelTask(taskId) {
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: "{}",
    });
    await loadState();
    showToast(t("toast.stopRequested"));
  } catch (error) {
    showToast(error.message, true);
  }
}

async function changeLocale(locale, { notify = true } = {}) {
  const previousLocale = state.locale;
  const normalized = setLocale(locale);
  state.locale = normalized;
  document.documentElement.lang = normalized;
  try {
    const settings = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ locale: normalized }),
    });
    if (state.data) state.data.settings = settings;
    localStorage.setItem("crossstaff.locale", normalized);
    render();
    if (notify) showToast(t("toast.languageChanged"));
  } catch (error) {
    state.locale = setLocale(previousLocale);
    document.documentElement.lang = state.locale;
    render();
    showToast(error.message, true);
  }
}

async function finishOnboarding(button) {
  setButtonBusy(button, true);
  try {
    const settings = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ onboardingComplete: true }),
    });
    state.data.settings = settings;
    localStorage.removeItem("crossstaff.onboardingStep");
    await loadState();
    showToast(t("toast.onboardingComplete"));
  } catch (error) {
    showToast(error.message, true);
    setButtonBusy(button, false);
  }
}

async function cancelWorkflow(workflowId) {
  try {
    await api(`/api/workflows/${encodeURIComponent(workflowId)}/cancel`, {
      method: "POST",
      body: "{}",
    });
    await loadState();
    showToast(t("toast.workflowCanceled"));
  } catch (error) {
    showToast(error.message, true);
  }
}

function closeModal({ renderNow = true } = {}) {
  if (state.modal?.type === "workflow") {
    state.workflowDraft = null;
    state.workflowMeta = {
      title: "",
      prompt: "",
      acceptanceAgentId: "",
      acceptanceStepName: "",
    };
  }
  state.modal = null;
  if (renderNow) render();
  if (state.renderDeferred) {
    state.renderDeferred = false;
    loadState();
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function currentRoom() {
  return state.data?.rooms.find((room) => room.id === state.roomId) ?? null;
}

function findRoom(roomId) {
  return state.data?.rooms.find((room) => room.id === roomId) ?? null;
}

function roomAgents() {
  const employeeIds = new Set(roomEmployees().map((employee) => employee.id));
  return (
    state.data?.agentModes.filter((agent) => employeeIds.has(agent.employeeId)) ?? []
  );
}

function roomEmployees() {
  return state.data?.roomMembers ?? [];
}

function availableRoomEmployees() {
  const memberIds = new Set(
    (state.data?.roomMemberIds ?? []).map((employeeId) => employeeId),
  );
  return (state.data?.employees ?? []).filter(
    (employee) => !memberIds.has(employee.id),
  );
}

function findAgent(agentId) {
  return state.data?.agents.find((agent) => agent.id === agentId) ?? null;
}

function findEmployee(employeeId) {
  return state.data?.employees.find((employee) => employee.id === employeeId) ?? null;
}

function findSeat(seatBindingId) {
  return state.data?.seatBindings.find((seat) => seat.id === seatBindingId) ?? null;
}

function renderAgentSelect(name, agents, selectedId) {
  return `<select name="${name}" required>${agents
    .map(
      (agent) =>
        `<option value="${escapeAttr(agent.id)}" ${agent.id === selectedId ? "selected" : ""}>${escapeHtml(agent.employeeName || findEmployee(agent.employeeId)?.name || "—")} · ${escapeHtml(agent.name)} · ${escapeHtml(agent.role)}</option>`,
    )
    .join("")}</select>`;
}

function renderEmployeeSelect(name = "employeeId", selectedId = "") {
  return `<select name="${escapeAttr(name)}" required>${(state.data.employees ?? [])
    .map((employee) => {
      const seat = employee.activeSeat;
      return `<option value="${escapeAttr(employee.id)}" ${employee.id === selectedId ? "selected" : ""}>${escapeHtml(employee.name)} · ${escapeHtml(employee.title || t("common.employee"))}${seat ? ` · ${escapeHtml(providerLabel(seat.provider))}` : ` · ${t("team.noSeat")}`}</option>`;
    })
    .join("")}</select>`;
}

function renderAvailableEmployeeSelect(name = "employeeId") {
  const employees = availableRoomEmployees();
  return `<select name="${escapeAttr(name)}" required>${employees
    .map((employee) => {
      const seat = employee.activeSeat;
      return `<option value="${escapeAttr(employee.id)}">${escapeHtml(employee.name)} · ${escapeHtml(employee.title || t("common.employee"))}${seat ? ` · ${escapeHtml(providerLabel(seat.provider))}` : ` · ${t("team.noSeat")}`}</option>`;
    })
    .join("")}</select>`;
}

function renderManagerSelect(name = "managerId", selectedId = "", excludedId = "") {
  return `<select name="${escapeAttr(name)}"><option value="">${t("modal.employee.noManager")}</option>${(state.data.employees ?? [])
    .filter((employee) => employee.id !== excludedId)
    .map(
      (employee) =>
        `<option value="${escapeAttr(employee.id)}" ${employee.id === selectedId ? "selected" : ""}>${escapeHtml(employee.name)} · ${escapeHtml(employee.title || t("common.employee"))}</option>`,
    )
    .join("")}</select>`;
}

function field(label, control, hint = "") {
  return `<div class="field"><label>${escapeHtml(label)}</label>${control}${
    hint ? `<div class="field-hint">${escapeHtml(hint)}</div>` : ""
  }</div>`;
}

function statCard(label, value, note) {
  return `
    <article class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(String(value))}</strong>
      <span class="stat-note">${escapeHtml(note)}</span>
    </article>
  `;
}

function statusBadge(status) {
  const value = String(status || "unknown");
  return `<span class="status status-${safeClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
}

function statusLabel(value) {
  const key = `status.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

function labelKind(kind) {
  const key = `message.kind.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}

function agentAvatarClass(agent) {
  if (!agent) return "avatar-system";
  if (agent.role === "reviewer") return "avatar-reviewer";
  if (agent.role === "builder") return "avatar-builder";
  return "avatar-agent";
}

function providerLabel(provider) {
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    google: "Google",
    custom: t("provider.custom"),
  };
  return labels[String(provider).toLowerCase()] || provider;
}

function bindingTypeLabel(bindingType) {
  const key = `binding.${bindingType}`;
  const translated = t(key);
  return translated === key ? bindingType : translated;
}

function adapterLabel(adapter) {
  if (!adapter) return t("adapter.unknown");
  if (adapter.type === "api") {
    return t("adapter.api", {
      provider: providerLabel(adapter.provider),
      model: adapter.model,
    });
  }
  if (adapter.type === "command") {
    return t("adapter.command", { command: adapter.command });
  }
  return t("adapter.mock", { behavior: adapter.behavior || "generic" });
}

function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts.at(-1)?.[0] || ""}`.toUpperCase();
}

function formatTime(value) {
  return formatDateTime(value);
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatMessage(content) {
  const source = String(content ?? "");
  const segments = [];
  const pattern = /```(?:[\w-]+)?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) {
      segments.push(escapeHtml(source.slice(cursor, match.index)).replace(/\n/g, "<br>"));
    }
    segments.push(`<pre><code>${escapeHtml(match[1].trim())}</code></pre>`);
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) {
    segments.push(escapeHtml(source.slice(cursor)).replace(/\n/g, "<br>"));
  }
  return segments.join("") || "&nbsp;";
}

function safeClass(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = t("common.processing");
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "is-error" : ""}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function formSuccessMessage(formType) {
  return (
    {
      room: t("toast.roomCreated"),
      agent: t("toast.agentRegistered"),
      account: t("toast.accountAdded"),
      employee: t("toast.employeeHired"),
      "edit-employee": t("toast.employeeUpdated"),
      "delete-employee": t("toast.employeeDeleted"),
      "employee-memory": t("toast.employeeMemorySaved"),
      member: t("toast.memberAdded"),
      seat: t("toast.seatRebound"),
      offboard: t("toast.employeeOffboarded"),
      knowledge: t("toast.knowledgeAdded"),
      memory: t("toast.memorySaved"),
      fork: t("toast.forkCreated"),
      review: t("toast.reviewStarted"),
      workflow: t("toast.workflowStarted"),
      "edit-mode": t("toast.agentUpdated"),
      "delete-mode": t("toast.agentDeleted"),
      "delete-room": t("toast.roomDeleted"),
      "onboarding-room": t("toast.roomCreated"),
      "onboarding-account": t("toast.employeeHired"),
      "onboarding-agent": t("toast.agentRegistered"),
    }[formType] || t("toast.saved")
  );
}

function renderError() {
  return `
    <div class="error-screen">
      ${renderBrandMark()}
      <h1>${t("error.loadTitle")}</h1>
      <p>${escapeHtml(state.error || t("error.unknown"))}</p>
      <button class="button button-primary" data-action="refresh">${t("common.retry")}</button>
    </div>
  `;
}

function renderBrandMark() {
  return `
    <div class="brand-mark" aria-hidden="true">
      <img src="/assets/crossstaff-app-icon.svg" alt="" />
    </div>
  `;
}

function renderConnectionOnly() {
  const element = document.querySelector("#connection-status");
  if (!element) return;
  element.innerHTML = `
    <span class="connection-dot ${state.connection === "online" ? "is-online" : ""}"></span>
    ${state.connection === "online" ? t("common.realtime") : t("common.reconnecting")}
  `;
}

function captureScroll() {
  const element = document.querySelector("#message-list");
  if (!element) return null;
  return {
    top: element.scrollTop,
    nearBottom: element.scrollHeight - element.scrollTop - element.clientHeight < 90,
  };
}

function restoreScroll(previous) {
  const element = document.querySelector("#message-list");
  if (!element) return;
  const key = state.data?.messages.at(-1)?.id || "";
  if (!previous || previous.nearBottom || key !== state.lastMessageKey) {
    element.scrollTop = element.scrollHeight;
  } else {
    element.scrollTop = previous.top;
  }
  state.lastMessageKey = key;
}
