import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const NOW = () => new Date().toISOString();
const ID = (prefix) => `${prefix}_${randomUUID()}`;
const SAFE_COMMAND_ENV_KEYS = new Set([
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]);

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function camelizeRow(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function mapAccount(row) {
  if (!row) return null;
  return {
    ...camelizeRow(row),
    metadata: parseJson(row.metadata_json, {}),
  };
}

function mapAgent(row) {
  if (!row) return null;
  return {
    ...camelizeRow(row),
    adapter: parseJson(row.adapter_json, { type: "mock" }),
  };
}

function mapKnowledge(row) {
  return camelizeRow(row);
}

function mapTask(row) {
  return camelizeRow(row);
}

function mapRun(row) {
  return camelizeRow(row);
}

export class CrossStaffStore {
  constructor({
    dataDir = join(process.cwd(), "data"),
    databasePath,
    seedDemo = false,
  } = {}) {
    const preferredDatabasePath = join(dataDir, "crossstaff.db");
    const agentStaffDatabasePath = join(dataDir, "agentstaff.db");
    const huddleDatabasePath = join(dataDir, "huddle.db");
    const agentHubDatabasePath = join(dataDir, "agenthub.db");
    const inferredDatabasePath =
      existsSync(preferredDatabasePath)
        ? preferredDatabasePath
        : existsSync(agentStaffDatabasePath)
          ? agentStaffDatabasePath
          : existsSync(huddleDatabasePath)
            ? huddleDatabasePath
            : existsSync(agentHubDatabasePath)
              ? agentHubDatabasePath
              : preferredDatabasePath;
    const resolvedDatabasePath = databasePath ?? inferredDatabasePath;
    mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
    this.databasePath = resolvedDatabasePath;
    this.db = new DatabaseSync(resolvedDatabasePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
    this.ensureSettings();
    if (seedDemo) {
      this.seedDemo();
      this.updateSettings({ onboardingComplete: true });
    }
    this.markInterruptedWork();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_settings (
        id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'zh-CN',
        onboarding_complete INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        manager_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        offboarded_at TEXT,
        offboard_reason TEXT,
        source_account_id TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS seat_bindings (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        binding_type TEXT NOT NULL DEFAULT 'official',
        label TEXT NOT NULL,
        credential_ref TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS employee_memories (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_employee_memberships (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, employee_id)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        auth_kind TEXT NOT NULL DEFAULT 'official',
        status TEXT NOT NULL DEFAULT 'connected',
        owner TEXT NOT NULL DEFAULT 'local-user',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        role TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        adapter_json TEXT NOT NULL DEFAULT '{"type":"mock"}',
        status TEXT NOT NULL DEFAULT 'ready',
        deleted_at TEXT,
        fork_depth INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        sender_name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'message',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_chat_runs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        seat_binding_id TEXT REFERENCES seat_bindings(id) ON DELETE SET NULL,
        trigger_message_id TEXT,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        writer_agent_id TEXT NOT NULL REFERENCES agents(id),
        reviewer_agent_id TEXT NOT NULL REFERENCES agents(id),
        verdict TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        seat_binding_id TEXT REFERENCES seat_bindings(id) ON DELETE SET NULL,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        verdict TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        name TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        input_requirements TEXT NOT NULL DEFAULT '',
        deliverables TEXT NOT NULL DEFAULT '',
        forbidden_actions TEXT NOT NULL DEFAULT '',
        completion_criteria TEXT NOT NULL DEFAULT '',
        is_acceptance INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_dependencies (
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
        depends_on_step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
        PRIMARY KEY (step_id, depends_on_step_id)
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        seat_binding_id TEXT REFERENCES seat_bindings(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS acceptance_evaluations (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        evaluated_step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        evaluator_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        score REAL NOT NULL,
        verdict TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (evaluated_step_id)
      );

      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        scope TEXT NOT NULL DEFAULT 'room',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        room_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_employee_memberships_employee
        ON room_employee_memberships(employee_id);
      CREATE INDEX IF NOT EXISTS idx_seat_bindings_employee ON seat_bindings(employee_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seat_per_employee
        ON seat_bindings(employee_id) WHERE active = 1;
      CREATE INDEX IF NOT EXISTS idx_employee_memories_employee
        ON employee_memories(employee_id);
      CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_chat_runs_room
        ON agent_chat_runs(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_room_created ON tasks(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_task_created ON runs(task_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_workflows_room_created
        ON workflows(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow
        ON workflow_steps(workflow_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
        ON workflow_runs(workflow_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_acceptance_evaluations_employee
        ON acceptance_evaluations(employee_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_room_created ON knowledge(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `);
    this.migrateV2();
  }

  migrateV2() {
    if (!this.hasColumn("agents", "employee_id")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN employee_id TEXT");
    }
    if (!this.hasColumn("runs", "employee_id")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN employee_id TEXT");
    }
    if (!this.hasColumn("runs", "seat_binding_id")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN seat_binding_id TEXT");
    }
    if (!this.hasColumn("workflows", "verdict")) {
      this.db.exec("ALTER TABLE workflows ADD COLUMN verdict TEXT");
    }
    if (!this.hasColumn("workflow_steps", "is_acceptance")) {
      this.db.exec(
        "ALTER TABLE workflow_steps ADD COLUMN is_acceptance INTEGER NOT NULL DEFAULT 0",
      );
    }
    for (const [column, definition] of [
      ["objective", "TEXT NOT NULL DEFAULT ''"],
      ["input_requirements", "TEXT NOT NULL DEFAULT ''"],
      ["deliverables", "TEXT NOT NULL DEFAULT ''"],
      ["forbidden_actions", "TEXT NOT NULL DEFAULT ''"],
      ["completion_criteria", "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!this.hasColumn("workflow_steps", column)) {
        this.db.exec(`ALTER TABLE workflow_steps ADD COLUMN ${column} ${definition}`);
      }
    }
    if (!this.hasColumn("employees", "offboarded_at")) {
      this.db.exec("ALTER TABLE employees ADD COLUMN offboarded_at TEXT");
    }
    if (!this.hasColumn("employees", "offboard_reason")) {
      this.db.exec("ALTER TABLE employees ADD COLUMN offboard_reason TEXT");
    }
    if (!this.hasColumn("agents", "deleted_at")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN deleted_at TEXT");
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_agents_employee ON agents(employee_id)",
    );

    const accounts = this.db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all();
    const insertEmployee = this.db.prepare(`
      INSERT INTO employees
        (id, name, title, manager_id, status, source_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSeat = this.db.prepare(`
      INSERT INTO seat_bindings
        (id, employee_id, provider, binding_type, label, credential_ref,
         status, active, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const account of accounts) {
      const migrated = this.db
        .prepare("SELECT id FROM employees WHERE source_account_id = ?")
        .get(account.id);
      if (migrated) continue;
      const firstAgent = this.db
        .prepare("SELECT role FROM agents WHERE account_id = ? ORDER BY created_at ASC LIMIT 1")
        .get(account.id);
      const employeeId = `employee_${account.id}`;
      const seatId = `seat_${account.id}`;
      insertEmployee.run(
        employeeId,
        account.label,
        firstAgent?.role || "Digital Employee",
        null,
        account.status === "connected" ? "active" : "paused",
        account.id,
        account.created_at,
        account.created_at,
      );
      insertSeat.run(
        seatId,
        employeeId,
        account.provider,
        account.auth_kind,
        account.label,
        null,
        account.status,
        account.status === "connected" ? 1 : 0,
        account.created_at,
        null,
      );
      this.db
        .prepare("UPDATE agents SET employee_id = ? WHERE account_id = ?")
        .run(employeeId, account.id);
    }

    const unboundAgents = this.db
      .prepare("SELECT * FROM agents WHERE employee_id IS NULL ORDER BY created_at ASC")
      .all();
    for (const agent of unboundAgents) {
      const employeeId = `employee_unbound_${agent.id}`;
      const seatId = `seat_unbound_${agent.id}`;
      insertEmployee.run(
        employeeId,
        agent.name,
        agent.role,
        null,
        "needs_seat",
        null,
        agent.created_at,
        agent.created_at,
      );
      insertSeat.run(
        seatId,
        employeeId,
        agent.provider,
        "unbound",
        "No seat assigned",
        null,
        "disconnected",
        0,
        agent.created_at,
        null,
      );
      this.db
        .prepare("UPDATE agents SET employee_id = ? WHERE id = ?")
        .run(employeeId, agent.id);
    }

    this.db.exec(`
      UPDATE runs
      SET employee_id = (
        SELECT employee_id FROM agents WHERE agents.id = runs.agent_id
      )
      WHERE employee_id IS NULL;

      UPDATE runs
      SET seat_binding_id = (
        SELECT id FROM seat_bindings
        WHERE seat_bindings.employee_id = runs.employee_id
          AND seat_bindings.active = 1
        LIMIT 1
      )
      WHERE seat_binding_id IS NULL;

      INSERT OR IGNORE INTO room_employee_memberships
        (room_id, employee_id, created_at)
      SELECT room_id, employee_id, MIN(created_at)
      FROM agents
      WHERE employee_id IS NOT NULL
      GROUP BY room_id, employee_id;
    `);

    this.db
      .prepare(
        "UPDATE messages SET sender_name = 'CrossStaff' WHERE sender_type = 'system' AND sender_name IN ('AgentHub', 'Huddle', 'AgentStaff')",
      )
      .run();
  }

  hasColumn(tableName, columnName) {
    return this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .some((column) => column.name === columnName);
  }

  ensureSettings() {
    const existing = this.db
      .prepare("SELECT * FROM workspace_settings WHERE id = 'default'")
      .get();
    if (existing) return;

    const roomCount = Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count,
    );
    const now = NOW();
    this.db
      .prepare(`
        INSERT INTO workspace_settings
          (id, locale, onboarding_complete, created_at, updated_at)
        VALUES ('default', 'zh-CN', ?, ?, ?)
      `)
      .run(roomCount > 0 ? 1 : 0, now, now);
  }

  getSettings() {
    const row = this.db
      .prepare("SELECT * FROM workspace_settings WHERE id = 'default'")
      .get();
    return {
      locale: row.locale,
      onboardingComplete: Boolean(row.onboarding_complete),
      updatedAt: row.updated_at,
    };
  }

  updateSettings({ locale, onboardingComplete }) {
    const current = this.getSettings();
    const nextLocale =
      locale === undefined ? current.locale : normalizeLocale(locale);
    const nextOnboarding =
      onboardingComplete === undefined
        ? current.onboardingComplete
        : Boolean(onboardingComplete);

    if (nextOnboarding && !current.onboardingComplete) {
      const roomCount = Number(
        this.db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count,
      );
      const agentCount = Number(
        this.db.prepare("SELECT COUNT(*) AS count FROM agents").get().count,
      );
      const employeeCount = Number(
        this.db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM employees
            WHERE status = 'active'
              AND EXISTS (
                SELECT 1 FROM seat_bindings
                WHERE seat_bindings.employee_id = employees.id
                  AND seat_bindings.active = 1
              )
          `)
          .get().count,
      );
      if (roomCount < 1 || employeeCount < 1 || agentCount < 1) {
        throw new HttpError(
          409,
          "Onboarding requires a room, an active employee seat, and an agent mode",
        );
      }
    }

    const updatedAt = NOW();
    this.db
      .prepare(`
        UPDATE workspace_settings
        SET locale = ?, onboarding_complete = ?, updated_at = ?
        WHERE id = 'default'
      `)
      .run(nextLocale, nextOnboarding ? 1 : 0, updatedAt);
    this.addEvent({
      type: "settings.updated",
      payload: { locale: nextLocale, onboardingComplete: nextOnboarding },
    });
    return {
      locale: nextLocale,
      onboardingComplete: nextOnboarding,
      updatedAt,
    };
  }

  seedDemo() {
    const existing = this.db.prepare("SELECT COUNT(*) AS count FROM rooms").get();
    if (Number(existing.count) > 0) return;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const createdAt = NOW();
      const roomId = "room_agent_workspace";
      const builderId = "agent_codex_builder";
      const reviewerId = "agent_claude_reviewer";
      const builderEmployeeId = "employee_codex_builder";
      const reviewerEmployeeId = "employee_claude_reviewer";

      this.db
        .prepare("INSERT INTO rooms (id, name, description, created_at) VALUES (?, ?, ?, ?)")
        .run(
          roomId,
          "Agent Workspace",
          "A seeded room for testing independent implementation and review.",
          createdAt,
        );

      const employeeInsert = this.db.prepare(`
        INSERT INTO employees
          (id, name, title, manager_id, status, source_account_id, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 'active', NULL, ?, ?)
      `);
      employeeInsert.run(
        builderEmployeeId,
        "Codex Builder",
        "Implementation Engineer",
        createdAt,
        createdAt,
      );
      employeeInsert.run(
        reviewerEmployeeId,
        "Claude Reviewer",
        "Independent Reviewer",
        createdAt,
        createdAt,
      );

      const seatInsert = this.db.prepare(`
        INSERT INTO seat_bindings
          (id, employee_id, provider, binding_type, label, credential_ref,
           status, active, created_at, revoked_at)
        VALUES (?, ?, ?, 'official', ?, NULL, 'connected', 1, ?, NULL)
      `);
      seatInsert.run(
        "seat_codex_builder",
        builderEmployeeId,
        "openai",
        "Codex official account",
        createdAt,
      );
      seatInsert.run(
        "seat_claude_reviewer",
        reviewerEmployeeId,
        "anthropic",
        "Claude official account",
        createdAt,
      );

      const modeInsert = this.db.prepare(`
        INSERT INTO agents
          (id, room_id, employee_id, account_id, parent_id, name, provider, role,
           instructions, adapter_json, status, fork_depth, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      modeInsert.run(
        builderId,
        roomId,
        builderEmployeeId,
        null,
        "Implementer Mode",
        "openai",
        "builder",
        "Implement the assigned task. Return a concise implementation summary, files changed, tests run, and unresolved risks.",
        JSON.stringify({ type: "mock", behavior: "builder" }),
        "ready",
        0,
        createdAt,
      );
      modeInsert.run(
        reviewerId,
        roomId,
        reviewerEmployeeId,
        null,
        "Independent Reviewer",
        "anthropic",
        "reviewer",
        "Review the handoff independently. Return VERDICT: approved or VERDICT: changes_requested, followed by severity-ranked findings.",
        JSON.stringify({ type: "mock", behavior: "reviewer" }),
        "ready",
        0,
        createdAt,
      );

      const memberInsert = this.db.prepare(`
        INSERT OR IGNORE INTO room_employee_memberships
          (room_id, employee_id, created_at)
        VALUES (?, ?, ?)
      `);
      memberInsert.run(roomId, builderEmployeeId, createdAt);
      memberInsert.run(roomId, reviewerEmployeeId, createdAt);

      this.addKnowledge({
        roomId,
        scope: "room",
        title: "Independent review contract",
        content:
          "The reviewer receives the task, implementation result, test evidence, and relevant project facts. It must not modify the implementation branch. A review must state a verdict and cite evidence.",
        source: "seed",
      });
      this.addKnowledge({
        roomId,
        scope: "room",
        title: "Employee and seat rule",
        content:
          "One active organization seat, API identity, or account binding represents one employee. Agent modes share that employee identity but have separate role instructions and private working memory. Independent review requires a different employee.",
        source: "seed",
      });
      this.db
        .prepare(`
          INSERT INTO employee_memories
            (id, employee_id, content, source, created_at)
          VALUES (?, ?, ?, 'seed', ?)
        `)
        .run(
          ID("employee_memory"),
          builderEmployeeId,
          "Prefer small, reversible changes and always report tests.",
          createdAt,
        );
      this.db
        .prepare(`
          INSERT INTO employee_memories
            (id, employee_id, content, source, created_at)
          VALUES (?, ?, ?, 'seed', ?)
        `)
        .run(
          ID("employee_memory"),
          reviewerEmployeeId,
          "Independent review must cite evidence and remain read-only.",
          createdAt,
        );
      this.addMemory({
        agentId: builderId,
        content: "Prefer small, reversible changes and always report tests.",
        source: "seed",
      });
      this.addMemory({
        agentId: reviewerId,
        content: "Require evidence for every blocking finding and keep the review read-only.",
        source: "seed",
      });
      this.addMessage({
        roomId,
        senderType: "system",
        senderName: "CrossStaff",
        kind: "system_event",
        content:
          "Workspace ready. Two employees are available: an implementer and an independent reviewer.",
      });
      this.addEvent({
        type: "workspace.seeded",
        roomId,
        payload: { roomId },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markInterruptedWork() {
    const now = NOW();
    this.db
      .prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'")
      .run(now);
    this.db
      .prepare(
        "UPDATE tasks SET status = 'failed', error = 'Server restarted while the task was running', updated_at = ? WHERE status IN ('running', 'reviewing')",
      )
      .run(now);
    this.db.prepare("UPDATE agents SET status = 'ready' WHERE status = 'running'").run();
    this.db
      .prepare(`
        UPDATE workflow_steps
        SET status = 'interrupted', error = 'Server restarted during execution',
            finished_at = ?
        WHERE status = 'running'
      `)
      .run(now);
    this.db
      .prepare(`
        UPDATE workflows
        SET status = 'failed', error = 'Server restarted while workflow was running',
            finished_at = ?
        WHERE status = 'running'
      `)
      .run(now);
    this.db
      .prepare(`
        UPDATE agent_chat_runs
        SET status = 'interrupted', error = 'Server restarted during chat reply',
            finished_at = ?
        WHERE status = 'running'
      `)
      .run(now);
  }

  close() {
    this.db.close();
  }

  listRooms() {
    return this.db
      .prepare("SELECT * FROM rooms ORDER BY created_at ASC")
      .all()
      .map(camelizeRow);
  }

  getRoom(roomId) {
    return camelizeRow(this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId));
  }

  createRoom({ name, description = "" }) {
    const room = {
      id: ID("room"),
      name: requireText(name, "Room name"),
      description: String(description ?? "").trim(),
      createdAt: NOW(),
    };
    this.db
      .prepare("INSERT INTO rooms (id, name, description, created_at) VALUES (?, ?, ?, ?)")
      .run(room.id, room.name, room.description, room.createdAt);
    this.addEvent({ type: "room.created", roomId: room.id, payload: { name: room.name } });
    return room;
  }

  deleteRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new HttpError(404, "Room not found");
    const rooms = this.listRooms();
    const active = this.db
      .prepare(`
        SELECT (
          (SELECT COUNT(*) FROM agents WHERE room_id = ? AND status = 'running') +
          (SELECT COUNT(*) FROM agent_chat_runs WHERE room_id = ? AND status = 'running') +
          (SELECT COUNT(*) FROM tasks WHERE room_id = ? AND status IN ('running', 'reviewing')) +
          (SELECT COUNT(*) FROM workflows WHERE room_id = ? AND status = 'running')
        ) AS count
      `)
      .get(roomId, roomId, roomId, roomId);
    if (Number(active.count) > 0) {
      throw new HttpError(
        409,
        "Room has active work. Stop or cancel all running agents and workflows before deletion",
      );
    }
    const nextRoomId = rooms.find((candidate) => candidate.id !== roomId)?.id ?? null;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
      this.addEvent({
        type: "room.deleted",
        roomId,
        payload: { name: room.name, nextRoomId },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { deleted: true, roomId, nextRoomId };
  }

  addRoomMember(roomId, employeeId) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO room_employee_memberships
          (room_id, employee_id, created_at)
        VALUES (?, ?, ?)
      `)
      .run(roomId, employeeId, NOW());
    if (Number(result.changes) > 0) {
      this.addEvent({
        type: "room.member_added",
        roomId,
        payload: { employeeId },
      });
    }
    return employee;
  }

  listRoomMembers(roomId) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    const ids = new Set(
      this.db
        .prepare(
          "SELECT employee_id AS employeeId FROM room_employee_memberships WHERE room_id = ?",
        )
        .all(roomId)
        .map((row) => row.employeeId),
    );
    return this.listEmployees().filter((employee) => ids.has(employee.id));
  }

  listRoomMemberIds(roomId) {
    return this.db
      .prepare(
        "SELECT employee_id AS employeeId FROM room_employee_memberships WHERE room_id = ?",
      )
      .all(roomId)
      .map((row) => row.employeeId);
  }

  isRoomMember(roomId, employeeId) {
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM room_employee_memberships
          WHERE room_id = ? AND employee_id = ?
        `)
        .get(roomId, employeeId),
    );
  }

  listEmployees() {
    const employees = this.db
      .prepare("SELECT * FROM employees ORDER BY created_at ASC")
      .all();
    const modes = this.listAgentModes();
    const memoryCounts = new Map(
      this.listEmployeeMemoryCounts().map((item) => [
        item.employeeId,
        Number(item.count),
      ]),
    );
    const runStats = new Map(
      this.db
        .prepare(`
          SELECT employee_id AS employeeId,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM runs
          WHERE employee_id IS NOT NULL
          GROUP BY employee_id
        `)
        .all()
        .map((row) => [row.employeeId, row]),
    );
    const performanceStats = new Map(
      this.db
        .prepare(`
          SELECT employee_id AS employeeId,
                 AVG(score) AS averageScore,
                 COUNT(*) AS sampleCount
          FROM acceptance_evaluations
          GROUP BY employee_id
        `)
        .all()
        .map((row) => [
          row.employeeId,
          {
            averageScore:
              row.averageScore === null
                ? null
                : Math.round(Number(row.averageScore) * 10) / 10,
            sampleCount: Number(row.sampleCount),
          },
        ]),
    );

    return employees.map((employee) => {
      const activeSeat = this.getActiveSeatBinding(employee.id);
      const manager = employee.manager_id
        ? this.db.prepare("SELECT name FROM employees WHERE id = ?").get(employee.manager_id)
        : null;
      const employeeModes = modes.filter((mode) => mode.employeeId === employee.id);
      const stats = runStats.get(employee.id);
      const performance = performanceStats.get(employee.id);
      return {
        ...camelizeRow(employee),
        managerName: manager?.name ?? null,
        activeSeat,
        provider: activeSeat?.provider ?? null,
        bindingType: activeSeat?.bindingType ?? "unbound",
        seatLabel: activeSeat?.label ?? null,
        seatStatus: activeSeat?.status ?? "disconnected",
        modeCount: employeeModes.length,
        activeModeCount: employeeModes.filter((mode) => mode.status === "running").length,
        memoryCount: memoryCounts.get(employee.id) ?? 0,
        runCount: Number(stats?.total ?? 0),
        completedRunCount: Number(stats?.completed ?? 0),
        failedRunCount: Number(stats?.failed ?? 0),
        performanceScore: performance?.averageScore ?? null,
        performanceSamples: performance?.sampleCount ?? 0,
      };
    });
  }

  getEmployee(employeeId) {
    return this.listEmployees().find((employee) => employee.id === employeeId) ?? null;
  }

  createEmployee({
    name,
    title = "",
    managerId = null,
    status = "active",
    provider,
    bindingType = "official",
    label,
    credentialRef = null,
    sourceAccountId = null,
    roomId = null,
  }) {
    if (managerId && !this.getEmployee(managerId)) {
      throw new HttpError(404, "Manager not found");
    }
    if (roomId && !this.getRoom(roomId)) {
      throw new HttpError(404, "Room not found");
    }
    const employeeId = ID("employee");
    const seatId = ID("seat");
    const createdAt = NOW();
    const employeeName = requireText(name, "Employee name");
    const providerName = requireText(provider, "Provider");
    const seatLabel = requireText(label || `${employeeName} seat`, "Seat label");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(`
          INSERT INTO employees
            (id, name, title, manager_id, status, source_account_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          employeeId,
          employeeName,
          String(title || "Team member"),
          managerId,
          String(status || "active"),
          sourceAccountId,
          createdAt,
          createdAt,
        );
      this.db
        .prepare(`
          INSERT INTO seat_bindings
            (id, employee_id, provider, binding_type, label, credential_ref,
             status, active, created_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, 'connected', 1, ?, NULL)
        `)
        .run(
          seatId,
          employeeId,
          providerName,
          String(bindingType || "official"),
          seatLabel,
          credentialRef ? String(credentialRef) : null,
          createdAt,
        );
      if (roomId) {
        this.db
          .prepare(`
            INSERT INTO room_employee_memberships
              (room_id, employee_id, created_at)
            VALUES (?, ?, ?)
          `)
          .run(roomId, employeeId, createdAt);
      }
      this.addEvent({
        type: "employee.created",
        payload: { employeeId, seatId, roomId },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getEmployee(employeeId);
  }

  updateEmployee(employeeId, patch = {}) {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    const next = {
      name: patch.name === undefined ? employee.name : requireText(patch.name, "Employee name"),
      title: patch.title === undefined ? employee.title : String(patch.title || "").trim(),
      managerId:
        patch.managerId === undefined ? employee.managerId : patch.managerId || null,
      status: patch.status === undefined ? employee.status : String(patch.status),
    };
    if (next.managerId) {
      if (next.managerId === employeeId) throw new HttpError(400, "Employee cannot manage itself");
      if (!this.getEmployee(next.managerId)) throw new HttpError(404, "Manager not found");
      let managerId = next.managerId;
      const visited = new Set();
      while (managerId) {
        if (managerId === employeeId) {
          throw new HttpError(400, "Manager assignment would create a cycle");
        }
        if (visited.has(managerId)) break;
        visited.add(managerId);
        managerId = this.getEmployee(managerId)?.managerId ?? null;
      }
    }
    this.db
      .prepare(`
        UPDATE employees
        SET name = ?, title = ?, manager_id = ?, status = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.name,
        next.title,
        next.managerId,
        next.status,
        NOW(),
        employeeId,
      );
    this.addEvent({
      type: "employee.updated",
      payload: { employeeId, status: next.status },
    });
    return this.getEmployee(employeeId);
  }

  deleteEmployee(employeeId) {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    const modes = this.listAgents().filter(
      (mode) => mode.employeeId === employeeId,
    );
    const modeIds = modes.map((mode) => mode.id);
    if (modes.some((mode) => mode.status === "running")) {
      throw new HttpError(409, "Cannot delete an employee with a running mode");
    }

    const placeholders = modeIds.map(() => "?").join(", ");
    const historyChecks = [
      [
        "SELECT 1 FROM workflow_runs WHERE employee_id = ? LIMIT 1",
        [employeeId],
      ],
      [
        "SELECT 1 FROM agent_chat_runs WHERE employee_id = ? LIMIT 1",
        [employeeId],
      ],
      [
        "SELECT 1 FROM acceptance_evaluations WHERE employee_id = ? OR evaluator_employee_id = ? LIMIT 1",
        [employeeId, employeeId],
      ],
    ];
    if (modeIds.length > 0) {
      historyChecks.push([
        "SELECT 1 FROM runs WHERE agent_id IN (" + placeholders + ") LIMIT 1",
        modeIds,
      ]);
      historyChecks.push([
        "SELECT 1 FROM workflow_steps WHERE agent_id IN (" + placeholders + ") LIMIT 1",
        modeIds,
      ]);
      historyChecks.push([
        "SELECT 1 FROM tasks WHERE writer_agent_id IN (" + placeholders + ") OR reviewer_agent_id IN (" + placeholders + ") LIMIT 1",
        [...modeIds, ...modeIds],
      ]);
      historyChecks.push([
        "SELECT 1 FROM messages WHERE sender_id IN (" + placeholders + ") LIMIT 1",
        modeIds,
      ]);
    }
    const hasHistory = historyChecks.some(([sql, params]) =>
      Boolean(this.db.prepare(sql).get(...params)),
    );
    if (hasHistory) {
      throw new HttpError(
        409,
        "Employee has historical records. Use offboarding instead of permanent deletion",
      );
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("UPDATE employees SET manager_id = NULL WHERE manager_id = ?")
        .run(employeeId);
      this.db
        .prepare("DELETE FROM employee_memories WHERE employee_id = ?")
        .run(employeeId);
      this.db
        .prepare("DELETE FROM seat_bindings WHERE employee_id = ?")
        .run(employeeId);
      this.db
        .prepare("DELETE FROM room_employee_memberships WHERE employee_id = ?")
        .run(employeeId);
      for (const modeId of modeIds) {
        this.db.prepare("DELETE FROM memories WHERE agent_id = ?").run(modeId);
      }
      this.db.prepare("DELETE FROM agents WHERE employee_id = ?").run(employeeId);
      this.db.prepare("DELETE FROM employees WHERE id = ?").run(employeeId);
      this.addEvent({
        type: "employee.deleted",
        payload: { employeeId, name: employee.name },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { deleted: true, employeeId };
  }

  offboardEmployee(employeeId, { reason = "" } = {}) {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    if (employee.status === "offboarded") {
      throw new HttpError(409, "Employee is already offboarded");
    }
    const activeMode = this.db
      .prepare(
        "SELECT id FROM agents WHERE employee_id = ? AND status = 'running' LIMIT 1",
      )
      .get(employeeId);
    const activeWorkflowRun = this.db
      .prepare(
        "SELECT id FROM workflow_runs WHERE employee_id = ? AND status = 'running' LIMIT 1",
      )
      .get(employeeId);
    if (activeMode || activeWorkflowRun) {
      throw new HttpError(
        409,
        "Employee has an active run. Stop or cancel it before offboarding",
      );
    }
    const offboardedAt = NOW();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(`
          UPDATE employees
          SET status = 'offboarded', offboarded_at = ?, offboard_reason = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .run(offboardedAt, String(reason || "").slice(0, 2000), offboardedAt, employeeId);
      this.db
        .prepare(`
          UPDATE seat_bindings
          SET active = 0, status = 'revoked', revoked_at = ?
          WHERE employee_id = ? AND active = 1
        `)
        .run(offboardedAt, employeeId);
      this.db
        .prepare("UPDATE agents SET status = 'offboarded' WHERE employee_id = ?")
        .run(employeeId);
      this.db
        .prepare("DELETE FROM room_employee_memberships WHERE employee_id = ?")
        .run(employeeId);
      this.addEvent({
        type: "employee.offboarded",
        payload: { employeeId, reason: String(reason || "") },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getEmployee(employeeId);
  }

  listSeatBindings() {
    return this.db
      .prepare("SELECT * FROM seat_bindings ORDER BY created_at ASC")
      .all()
      .map(camelizeRow);
  }

  getActiveSeatBinding(employeeId) {
    return camelizeRow(
      this.db
        .prepare(
          "SELECT * FROM seat_bindings WHERE employee_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
        )
        .get(employeeId),
    );
  }

  rebindEmployeeSeat(
    employeeId,
    {
      provider,
      bindingType = "official",
      label,
      credentialRef = null,
    },
  ) {
    const employee = this.getEmployee(employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    if (employee.status === "offboarded") {
      throw new HttpError(409, "Offboarded employee cannot receive a new seat");
    }
    const createdAt = NOW();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(`
          UPDATE seat_bindings
          SET active = 0, status = 'revoked', revoked_at = ?
          WHERE employee_id = ? AND active = 1
        `)
        .run(createdAt, employeeId);
      this.db
        .prepare(`
          INSERT INTO seat_bindings
            (id, employee_id, provider, binding_type, label, credential_ref,
             status, active, created_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, 'connected', 1, ?, NULL)
        `)
        .run(
          ID("seat"),
          employeeId,
          requireText(provider, "Provider"),
          String(bindingType || "official"),
          requireText(label, "Seat label"),
          credentialRef ? String(credentialRef) : null,
          createdAt,
        );
      this.addEvent({
        type: "employee.seat_rebound",
        payload: { employeeId },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getEmployee(employeeId);
  }

  listEmployeeMemories(employeeId) {
    return this.db
      .prepare(
        "SELECT * FROM employee_memories WHERE employee_id = ? ORDER BY created_at ASC",
      )
      .all(employeeId)
      .map(camelizeRow);
  }

  addEmployeeMemory({ employeeId, content, source = "manual" }) {
    if (!this.getEmployee(employeeId)) throw new HttpError(404, "Employee not found");
    const memory = {
      id: ID("employee_memory"),
      employeeId,
      content: requireText(content, "Employee memory"),
      source: String(source || "manual"),
      createdAt: NOW(),
    };
    this.db
      .prepare(`
        INSERT INTO employee_memories
          (id, employee_id, content, source, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        memory.id,
        memory.employeeId,
        memory.content,
        memory.source,
        memory.createdAt,
      );
    this.addEvent({
      type: "employee.memory_created",
      payload: { employeeId, memoryId: memory.id },
    });
    return memory;
  }

  listEmployeeMemoryCounts() {
    return this.db
      .prepare(`
        SELECT employee_id AS employeeId, COUNT(*) AS count
        FROM employee_memories
        GROUP BY employee_id
      `)
      .all();
  }

  listAccounts() {
    return this.db
      .prepare("SELECT * FROM accounts ORDER BY created_at ASC")
      .all()
      .map(mapAccount);
  }

  createAccount({ provider, label, authKind = "official", owner = "local-user" }) {
    const account = {
      id: ID("account"),
      provider: requireText(provider, "Provider"),
      label: requireText(label, "Account label"),
      authKind: String(authKind || "official"),
      status: "connected",
      owner: String(owner || "local-user"),
      metadata: { note: "Credential material is managed by the provider or local CLI." },
      createdAt: NOW(),
    };
    this.db
      .prepare(`
        INSERT INTO accounts
          (id, provider, label, auth_kind, status, owner, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        account.id,
        account.provider,
        account.label,
        account.authKind,
        account.status,
        account.owner,
        JSON.stringify(account.metadata),
        account.createdAt,
      );
    const employee = this.createEmployee({
      name: account.label,
      title: "Digital Employee",
      provider: account.provider,
      bindingType: account.authKind,
      label: account.label,
      sourceAccountId: account.id,
    });
    this.addEvent({ type: "account.created", payload: { accountId: account.id } });
    return { ...account, employeeId: employee.id, employee };
  }

  listAgents() {
    return this.db
      .prepare("SELECT * FROM agents ORDER BY created_at ASC")
      .all()
      .map(mapAgent);
  }

  listAgentModes(employeeId = null) {
    if (!employeeId) {
      return this.db
        .prepare("SELECT * FROM agents WHERE deleted_at IS NULL ORDER BY created_at ASC")
        .all()
        .map(mapAgent);
    }
    return this.db
      .prepare(
        "SELECT * FROM agents WHERE employee_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      )
      .all(employeeId)
      .map(mapAgent);
  }

  getAgent(agentId) {
    return mapAgent(this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
  }

  createAgent({
    roomId,
    employeeId = null,
    accountId = null,
    parentId = null,
    name,
    role = "builder",
    instructions = "",
    adapter = { type: "mock" },
    forkDepth = 0,
  }) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    if (!employeeId && accountId) {
      const migratedEmployee = this.db
        .prepare("SELECT id FROM employees WHERE source_account_id = ?")
        .get(accountId);
      employeeId = migratedEmployee?.id ?? null;
    }
    const employee = employeeId ? this.getEmployee(employeeId) : null;
    if (!employee) throw new HttpError(400, "A valid employee is required");
    if (!employee.activeSeat) {
      throw new HttpError(409, "Employee requires an active seat binding before running");
    }
    if (parentId) {
      const parent = this.getAgent(parentId);
      if (!parent) throw new HttpError(404, "Parent agent not found");
      if (parent.deletedAt) throw new HttpError(409, "Deleted agent mode cannot be forked");
    }

    const agent = {
      id: ID("agent"),
      roomId,
      employeeId: employee.id,
      accountId: employee.sourceAccountId ?? null,
      parentId,
      name: requireText(name, "Agent mode name"),
      provider: employee.provider || "custom",
      role: String(role || "builder"),
      instructions: String(instructions || ""),
      adapter: normalizeAdapter(adapter),
      status: "ready",
      forkDepth: Number(forkDepth) || 0,
      createdAt: NOW(),
    };
    this.db
      .prepare(`
        INSERT INTO agents
          (id, room_id, employee_id, account_id, parent_id, name, provider, role,
           instructions, adapter_json, status, fork_depth, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        agent.id,
        agent.roomId,
        agent.employeeId,
        agent.accountId,
        agent.parentId,
        agent.name,
        agent.provider,
        agent.role,
        agent.instructions,
        JSON.stringify(agent.adapter),
        agent.status,
        agent.forkDepth,
        agent.createdAt,
      );
    this.db
      .prepare(`
        INSERT OR IGNORE INTO room_employee_memberships
          (room_id, employee_id, created_at)
        VALUES (?, ?, ?)
      `)
      .run(roomId, employee.id, agent.createdAt);
    this.addEvent({
      type: "agent.created",
      roomId,
      payload: { agentId: agent.id, employeeId: agent.employeeId, role: agent.role, parentId },
    });
    return agent;
  }

  updateAgentMode(
    agentId,
    {
      name,
      role,
      instructions,
      adapter,
    } = {},
  ) {
    const current = this.getAgent(agentId);
    if (!current) throw new HttpError(404, "Agent mode not found");
    if (current.deletedAt) throw new HttpError(410, "Agent mode is deleted");
    if (current.status === "running") {
      throw new HttpError(409, "Cannot edit a running agent mode");
    }
    const next = {
      name: name === undefined ? current.name : requireText(name, "Agent mode name"),
      role: role === undefined ? current.role : String(role || current.role),
      instructions:
        instructions === undefined
          ? current.instructions
          : String(instructions || ""),
      adapter:
        adapter === undefined ? current.adapter : normalizeAdapter(adapter),
    };
    this.db
      .prepare(`
        UPDATE agents
        SET name = ?, role = ?, instructions = ?, adapter_json = ?
        WHERE id = ?
      `)
      .run(
        next.name,
        next.role,
        next.instructions,
        JSON.stringify(next.adapter),
        agentId,
      );
    this.addEvent({
      type: "agent.updated",
      roomId: current.roomId,
      payload: { agentId },
    });
    return this.getAgent(agentId);
  }

  deleteAgentMode(agentId) {
    const current = this.getAgent(agentId);
    if (!current) throw new HttpError(404, "Agent mode not found");
    if (current.deletedAt) return current;
    if (current.status === "running") {
      throw new HttpError(409, "Cannot delete a running agent mode");
    }
    const activeWorkflow = this.db
      .prepare(`
        SELECT 1
        FROM workflow_runs
        WHERE agent_id = ? AND status = 'running'
        LIMIT 1
      `)
      .get(agentId);
    const activeChat = this.db
      .prepare(`
        SELECT 1
        FROM agent_chat_runs
        WHERE agent_id = ? AND status = 'running'
        LIMIT 1
      `)
      .get(agentId);
    if (activeWorkflow || activeChat) {
      throw new HttpError(409, "Cannot delete an agent mode with an active run");
    }
    const deletedAt = NOW();
    this.db
      .prepare(`
        UPDATE agents
        SET status = 'deleted', deleted_at = ?
        WHERE id = ?
      `)
      .run(deletedAt, agentId);
    this.addEvent({
      type: "agent.deleted",
      roomId: current.roomId,
      payload: { agentId },
    });
    return { ...current, status: "deleted", deletedAt };
  }

  forkAgent(parentId, { name, role, instructions } = {}) {
    const parent = this.getAgent(parentId);
    if (!parent) throw new HttpError(404, "Agent not found");
    if (parent.deletedAt) throw new HttpError(410, "Agent mode is deleted");
    if (parent.forkDepth >= 2) throw new HttpError(409, "Maximum fork depth is 2");

    const child = this.createAgent({
      roomId: parent.roomId,
      employeeId: parent.employeeId,
      parentId: parent.id,
      name: name || `${parent.name} branch`,
      role: role || parent.role,
      instructions: instructions || parent.instructions,
      adapter: parent.adapter,
      forkDepth: parent.forkDepth + 1,
    });

    const memories = this.listMemories(parent.id);
    const insert = this.db.prepare(
      "INSERT INTO memories (id, agent_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const memory of memories) {
      insert.run(ID("memory"), child.id, memory.content, `fork:${parent.id}`, NOW());
    }
    this.addMessage({
      roomId: parent.roomId,
      senderType: "system",
      senderName: "CrossStaff",
      kind: "system_event",
      content: `${child.name} forked from ${parent.name} with ${memories.length} private memory item(s).`,
    });
    return child;
  }

  updateAgentStatus(agentId, status) {
    this.db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId);
  }

  addMessage({
    roomId,
    senderType,
    senderId = null,
    senderName,
    kind = "message",
    content,
  }) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    const message = {
      id: ID("message"),
      roomId,
      senderType,
      senderId,
      senderName: requireText(senderName, "Sender name"),
      kind,
      content: requireText(content, "Message content"),
      createdAt: NOW(),
    };
    this.db
      .prepare(`
        INSERT INTO messages
          (id, room_id, sender_type, sender_id, sender_name, kind, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        message.id,
        message.roomId,
        message.senderType,
        message.senderId,
        message.senderName,
        message.kind,
        message.content,
        message.createdAt,
      );
    this.addEvent({
      type: "message.created",
      roomId,
      payload: { messageId: message.id, senderType, kind },
    });
    return message;
  }

  listMessages(roomId, limit = 200) {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(roomId, limit);
    return rows.map(camelizeRow).reverse();
  }

  createAgentChatRun({
    roomId,
    agentId,
    triggerMessageId = null,
    input,
  }) {
    const agent = this.getAgent(agentId);
    if (!agent) throw new HttpError(404, "Agent mode not found");
    const employee = this.getEmployee(agent.employeeId);
    const run = {
      id: ID("chat_run"),
      roomId,
      agentId,
      employeeId: agent.employeeId,
      seatBindingId: employee?.activeSeat?.id ?? null,
      triggerMessageId,
      status: "running",
      input,
      output: "",
      error: null,
      createdAt: NOW(),
      finishedAt: null,
    };
    this.db
      .prepare(`
        INSERT INTO agent_chat_runs
          (id, room_id, agent_id, employee_id, seat_binding_id,
           trigger_message_id, status, input, output, error,
           created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.roomId,
        run.agentId,
        run.employeeId,
        run.seatBindingId,
        run.triggerMessageId,
        run.status,
        run.input,
        run.output,
        run.error,
        run.createdAt,
        run.finishedAt,
      );
    return run;
  }

  finishAgentChatRun(runId, { status, output = "", error = null }) {
    this.db
      .prepare(`
        UPDATE agent_chat_runs
        SET status = ?, output = ?, error = ?, finished_at = ?
        WHERE id = ?
      `)
      .run(status, String(output), error ? String(error) : null, NOW(), runId);
    return camelizeRow(
      this.db
        .prepare("SELECT * FROM agent_chat_runs WHERE id = ?")
        .get(runId),
    );
  }

  addKnowledge({
    roomId = null,
    scope = "room",
    title,
    content,
    source = "manual",
  }) {
    if (scope !== "workspace" && !this.getRoom(roomId)) {
      throw new HttpError(404, "Room not found");
    }
    const createdAt = NOW();
    const entry = {
      id: ID("knowledge"),
      roomId,
      scope,
      title: requireText(title, "Knowledge title"),
      content: requireText(content, "Knowledge content"),
      source: String(source || "manual"),
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare(`
        INSERT INTO knowledge
          (id, room_id, scope, title, content, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.roomId,
        entry.scope,
        entry.title,
        entry.content,
        entry.source,
        entry.createdAt,
        entry.updatedAt,
      );
    this.addEvent({
      type: "knowledge.created",
      roomId,
      payload: { knowledgeId: entry.id, scope },
    });
    return entry;
  }

  listKnowledge(roomId) {
    return this.db
      .prepare(`
        SELECT * FROM knowledge
        WHERE scope = 'workspace' OR room_id = ?
        ORDER BY updated_at DESC
      `)
      .all(roomId)
      .map(mapKnowledge);
  }

  searchKnowledge(roomId, prompt, limit = 5) {
    const entries = this.listKnowledge(roomId);
    const normalizedPrompt = String(prompt).toLowerCase();
    const tokens = normalizedPrompt
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter((token) => token.length >= 2)
      .slice(0, 24);

    return entries
      .map((entry) => {
        const haystack = `${entry.title} ${entry.content}`.toLowerCase();
        const score = tokens.reduce(
          (sum, token) => sum + (haystack.includes(token) ? 1 : 0),
          0,
        );
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  addMemory({ agentId, content, source = "manual" }) {
    if (!this.getAgent(agentId)) throw new HttpError(404, "Agent not found");
    const memory = {
      id: ID("memory"),
      agentId,
      content: requireText(content, "Memory content"),
      source: String(source || "manual"),
      createdAt: NOW(),
    };
    this.db
      .prepare(
        "INSERT INTO memories (id, agent_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(memory.id, memory.agentId, memory.content, memory.source, memory.createdAt);
    this.addEvent({ type: "memory.created", payload: { agentId, memoryId: memory.id } });
    return memory;
  }

  listMemories(agentId) {
    return this.db
      .prepare("SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at ASC")
      .all(agentId)
      .map(camelizeRow);
  }

  memoryCounts() {
    return this.db
      .prepare("SELECT agent_id AS agentId, COUNT(*) AS count FROM memories GROUP BY agent_id")
      .all();
  }

  createTask({ roomId, title, prompt, writerAgentId, reviewerAgentId }) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    const writer = this.getAgent(writerAgentId);
    const reviewer = this.getAgent(reviewerAgentId);
    if (!writer || !reviewer) throw new HttpError(404, "Agent not found");
    if (writer.deletedAt || reviewer.deletedAt) {
      throw new HttpError(409, "Deleted agent modes cannot start a task");
    }
    if (
      !this.isRoomMember(roomId, writer.employeeId) ||
      !this.isRoomMember(roomId, reviewer.employeeId)
    ) {
      throw new HttpError(
        400,
        "Writer and reviewer employees must be members of the selected room",
      );
    }
    if (writer.id === reviewer.id) {
      throw new HttpError(400, "Writer and reviewer must be different agents");
    }
    if (!writer.employeeId || writer.employeeId === reviewer.employeeId) {
      throw new HttpError(
        400,
        "Independent review requires two different employees with separate seat bindings",
      );
    }
    const writerEmployee = this.getEmployee(writer.employeeId);
    const reviewerEmployee = this.getEmployee(reviewer.employeeId);
    if (!writerEmployee?.activeSeat || !reviewerEmployee?.activeSeat) {
      throw new HttpError(409, "Both employees require active seat bindings");
    }
    if (writerEmployee.status !== "active" || reviewerEmployee.status !== "active") {
      throw new HttpError(409, "Both employees must be active");
    }

    const createdAt = NOW();
    const task = {
      id: ID("task"),
      roomId,
      title: requireText(title, "Task title"),
      prompt: requireText(prompt, "Task prompt"),
      status: "draft",
      writerAgentId,
      reviewerAgentId,
      verdict: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare(`
        INSERT INTO tasks
          (id, room_id, title, prompt, status, writer_agent_id, reviewer_agent_id,
           verdict, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.roomId,
        task.title,
        task.prompt,
        task.status,
        task.writerAgentId,
        task.reviewerAgentId,
        task.verdict,
        task.error,
        task.createdAt,
        task.updatedAt,
      );
    this.addMessage({
      roomId,
      senderType: "human",
      senderName: "You",
      kind: "task_update",
      content: `Created review task: ${task.title}`,
    });
    this.addEvent({ type: "task.created", roomId, payload: { taskId: task.id } });
    return task;
  }

  createWorkflow({
    roomId,
    title,
    prompt,
    steps,
    acceptanceAgentId = null,
    acceptanceStepName = "Acceptance review",
  }) {
    if (!this.getRoom(roomId)) throw new HttpError(404, "Room not found");
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 11) {
      throw new HttpError(400, "Workflow requires between 1 and 11 work steps");
    }

    const workSteps = steps.map((step, index) => ({
      key: String(step.key || `step${index + 1}`),
      name: requireText(step.name || `Step ${index + 1}`, "Workflow step name"),
      agentId: requireText(step.agentId, "Workflow step agent"),
      objective: String(step.objective || "").trim(),
      inputRequirements: String(step.inputRequirements || "").trim(),
      deliverables: String(step.deliverables || "").trim(),
      forbiddenActions: String(step.forbiddenActions || "").trim(),
      completionCriteria: String(step.completionCriteria || "").trim(),
      dependsOn: Array.isArray(step.dependsOn)
        ? [...new Set(step.dependsOn.map(String))]
        : [],
      isAcceptance: false,
    }));
    const keys = new Set(workSteps.map((step) => step.key));
    if (keys.has("__acceptance__")) {
      throw new HttpError(400, "Workflow step key __acceptance__ is reserved");
    }
    if (keys.size !== workSteps.length) {
      throw new HttpError(400, "Workflow step keys must be unique");
    }

    for (const step of workSteps) {
      const agent = this.getAgent(step.agentId);
      if (!agent) throw new HttpError(404, `Agent mode not found: ${step.agentId}`);
      if (agent.deletedAt) {
        throw new HttpError(409, "Deleted agent modes cannot join a workflow");
      }
      if (!agent.employeeId || !this.isRoomMember(roomId, agent.employeeId)) {
        throw new HttpError(400, "Every workflow agent mode must belong to a room employee");
      }
      for (const dependency of step.dependsOn) {
        if (!keys.has(dependency)) {
          throw new HttpError(400, `Unknown workflow dependency: ${dependency}`);
        }
        if (dependency === step.key) {
          throw new HttpError(400, "Workflow step cannot depend on itself");
        }
      }
    }
    assertAcyclicWorkflow(workSteps);

    const roomModes = this.listAgentModes().filter((mode) =>
      this.isRoomMember(roomId, mode.employeeId),
    );
    const acceptanceMode =
      (acceptanceAgentId ? this.getAgent(acceptanceAgentId) : null) ??
      roomModes.find((mode) => /review|audit|accept|验收|复核/i.test(mode.role)) ??
      roomModes[roomModes.length - 1];
    if (!acceptanceMode || !this.isRoomMember(roomId, acceptanceMode.employeeId)) {
      throw new HttpError(400, "Workflow requires an acceptance agent mode");
    }
    const normalized = [
      ...workSteps,
      {
        key: "__acceptance__",
        name: requireText(acceptanceStepName, "Acceptance step name"),
        agentId: acceptanceMode.id,
        objective: "",
        inputRequirements: "",
        deliverables: "",
        forbiddenActions: "",
        completionCriteria: "",
        dependsOn: workSteps.map((step) => step.key),
        isAcceptance: true,
      },
    ];

    const workflowId = ID("workflow");
    const createdAt = NOW();
    const stepIdByKey = new Map(
      normalized.map((step) => [step.key, ID("step")]),
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(`
          INSERT INTO workflows
            (id, room_id, title, prompt, status, verdict, error,
             created_at, started_at, finished_at)
          VALUES (?, ?, ?, ?, 'draft', NULL, NULL, ?, NULL, NULL)
        `)
        .run(
          workflowId,
          roomId,
          requireText(title, "Workflow title"),
          requireText(prompt, "Workflow prompt"),
          createdAt,
        );
      const insertStep = this.db.prepare(`
        INSERT INTO workflow_steps
          (id, workflow_id, agent_id, name, objective, input_requirements,
           deliverables, forbidden_actions, completion_criteria,
           is_acceptance, status, output, error, started_at, finished_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, NULL, NULL, ?)
      `);
      const insertDependency = this.db.prepare(`
        INSERT INTO workflow_dependencies
          (workflow_id, step_id, depends_on_step_id)
        VALUES (?, ?, ?)
      `);
      for (const step of normalized) {
        const stepId = stepIdByKey.get(step.key);
        insertStep.run(
          stepId,
          workflowId,
          step.agentId,
          step.name,
          step.objective,
          step.inputRequirements,
          step.deliverables,
          step.forbiddenActions,
          step.completionCriteria,
          step.isAcceptance ? 1 : 0,
          createdAt,
        );
        for (const dependency of step.dependsOn) {
          insertDependency.run(
            workflowId,
            stepId,
            stepIdByKey.get(dependency),
          );
        }
      }
      this.addEvent({
        type: "workflow.created",
        roomId,
        payload: { workflowId, stepCount: normalized.length },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkflow(workflowId);
  }

  getWorkflow(workflowId) {
    const workflow = camelizeRow(
      this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId),
    );
    if (!workflow) return null;
    const dependencies = this.db
      .prepare(`
        SELECT step_id AS stepId, depends_on_step_id AS dependsOnStepId
        FROM workflow_dependencies
        WHERE workflow_id = ?
      `)
      .all(workflowId);
    const dependencyMap = new Map();
    for (const dependency of dependencies) {
      if (!dependencyMap.has(dependency.stepId)) {
        dependencyMap.set(dependency.stepId, []);
      }
      dependencyMap.get(dependency.stepId).push(dependency.dependsOnStepId);
    }
    const steps = this.db
      .prepare(`
        SELECT workflow_steps.*,
               agents.name AS agent_name,
               agents.role AS agent_role,
               employees.name AS employee_name
        FROM workflow_steps
        JOIN agents ON agents.id = workflow_steps.agent_id
        LEFT JOIN employees ON employees.id = agents.employee_id
        WHERE workflow_steps.workflow_id = ?
        ORDER BY workflow_steps.created_at ASC
      `)
      .all(workflowId)
      .map((row) => ({
        ...camelizeRow(row),
        dependsOn: dependencyMap.get(row.id) ?? [],
      }));
    const evaluations = this.listAcceptanceEvaluations(workflowId);
    const evaluationByStep = new Map(
      evaluations.map((evaluation) => [
        evaluation.evaluatedStepId,
        evaluation,
      ]),
    );
    const stepsWithEvaluations = steps.map((step) => ({
      ...step,
      acceptanceEvaluation: evaluationByStep.get(step.id) ?? null,
    }));
    return {
      ...workflow,
      steps: stepsWithEvaluations,
      evaluations,
      completedSteps: stepsWithEvaluations.filter((step) => step.status === "completed").length,
      failedSteps: stepsWithEvaluations.filter((step) =>
        ["failed", "blocked", "canceled", "interrupted"].includes(step.status),
      ).length,
    };
  }

  listWorkflows(roomId, limit = 30) {
    return this.db
      .prepare(
        "SELECT id FROM workflows WHERE room_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(roomId, limit)
      .map((row) => this.getWorkflow(row.id));
  }

  updateWorkflow(workflowId, patch = {}) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new HttpError(404, "Workflow not found");
    const next = {
      status: patch.status ?? workflow.status,
      verdict: patch.verdict === undefined ? workflow.verdict : patch.verdict,
      error: patch.error === undefined ? workflow.error : patch.error,
      startedAt:
        patch.startedAt === undefined ? workflow.startedAt : patch.startedAt,
      finishedAt:
        patch.finishedAt === undefined ? workflow.finishedAt : patch.finishedAt,
    };
    this.db
      .prepare(`
        UPDATE workflows
        SET status = ?, verdict = ?, error = ?, started_at = ?, finished_at = ?
        WHERE id = ?
      `)
      .run(
        next.status,
        next.verdict ?? null,
        next.error ?? null,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        workflowId,
      );
    this.addEvent({
      type: "workflow.updated",
      roomId: workflow.roomId,
      payload: { workflowId, status: next.status },
    });
    return this.getWorkflow(workflowId);
  }

  updateWorkflowStep(stepId, patch = {}) {
    const row = this.db
      .prepare("SELECT * FROM workflow_steps WHERE id = ?")
      .get(stepId);
    if (!row) throw new HttpError(404, "Workflow step not found");
    const current = camelizeRow(row);
    const next = {
      status: patch.status ?? current.status,
      output: patch.output === undefined ? current.output : String(patch.output),
      error: patch.error === undefined ? current.error : patch.error,
      startedAt:
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      finishedAt:
        patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
    };
    this.db
      .prepare(`
        UPDATE workflow_steps
        SET status = ?, output = ?, error = ?, started_at = ?, finished_at = ?
        WHERE id = ?
      `)
      .run(
        next.status,
        next.output,
        next.error ?? null,
        next.startedAt ?? null,
        next.finishedAt ?? null,
        stepId,
      );
    return this.getWorkflow(current.workflowId);
  }

  createWorkflowRun({ workflowId, stepId, agentId, input }) {
    const agent = this.getAgent(agentId);
    const employee = agent ? this.getEmployee(agent.employeeId) : null;
    const run = {
      id: ID("workflow_run"),
      workflowId,
      stepId,
      agentId,
      employeeId: agent?.employeeId ?? null,
      seatBindingId: employee?.activeSeat?.id ?? null,
      status: "running",
      input,
      output: "",
      error: null,
      startedAt: NOW(),
      finishedAt: null,
    };
    this.db
      .prepare(`
        INSERT INTO workflow_runs
          (id, workflow_id, step_id, agent_id, employee_id, seat_binding_id,
           status, input, output, error, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.workflowId,
        run.stepId,
        run.agentId,
        run.employeeId,
        run.seatBindingId,
        run.status,
        run.input,
        run.output,
        run.error,
        run.startedAt,
        run.finishedAt,
      );
    return run;
  }

  finishWorkflowRun(runId, { status, output = "", error = null }) {
    this.db
      .prepare(`
        UPDATE workflow_runs
        SET status = ?, output = ?, error = ?, finished_at = ?
        WHERE id = ?
      `)
      .run(status, String(output), error ? String(error) : null, NOW(), runId);
    return camelizeRow(
      this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId),
    );
  }

  listWorkflowRuns(workflowId) {
    return this.db
      .prepare(
        "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at ASC",
      )
      .all(workflowId)
      .map(camelizeRow);
  }

  saveAcceptanceEvaluations({
    workflowId,
    evaluatorEmployeeId,
    evaluations,
  }) {
    const insert = this.db.prepare(`
      INSERT INTO acceptance_evaluations
        (id, workflow_id, evaluated_step_id, employee_id,
         evaluator_employee_id, score, verdict, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evaluated_step_id) DO UPDATE SET
        score = excluded.score,
        verdict = excluded.verdict,
        comment = excluded.comment,
        evaluator_employee_id = excluded.evaluator_employee_id,
        created_at = excluded.created_at
    `);
    const createdAt = NOW();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const evaluation of evaluations) {
        insert.run(
          ID("acceptance_evaluation"),
          workflowId,
          evaluation.stepId,
          evaluation.employeeId,
          evaluatorEmployeeId,
          evaluation.score,
          evaluation.verdict,
          evaluation.comment,
          createdAt,
        );
      }
      this.addEvent({
        type: "workflow.acceptance_scored",
        payload: {
          workflowId,
          evaluatorEmployeeId,
          evaluationCount: evaluations.length,
        },
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listAcceptanceEvaluations(workflowId) {
    return this.db
      .prepare(`
        SELECT acceptance_evaluations.*,
               employees.name AS employee_name,
               workflow_steps.name AS step_name
        FROM acceptance_evaluations
        LEFT JOIN employees ON employees.id = acceptance_evaluations.employee_id
        LEFT JOIN workflow_steps
          ON workflow_steps.id = acceptance_evaluations.evaluated_step_id
        WHERE acceptance_evaluations.workflow_id = ?
        ORDER BY acceptance_evaluations.created_at ASC
      `)
      .all(workflowId)
      .map(camelizeRow);
  }

  getTask(taskId) {
    return mapTask(this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  }

  updateTask(taskId, patch) {
    const task = this.getTask(taskId);
    if (!task) throw new HttpError(404, "Task not found");
    const next = { ...task, ...patch, updatedAt: NOW() };
    this.db
      .prepare(`
        UPDATE tasks
        SET status = ?, verdict = ?, error = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(next.status, next.verdict ?? null, next.error ?? null, next.updatedAt, taskId);
    this.addEvent({
      type: "task.updated",
      roomId: task.roomId,
      payload: { taskId, status: next.status, verdict: next.verdict ?? null },
    });
    return next;
  }

  listTasks(roomId, limit = 100) {
    return this.db
      .prepare("SELECT * FROM tasks WHERE room_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(roomId, limit)
      .map(mapTask);
  }

  createRun({
    taskId,
    agentId,
    employeeId = null,
    seatBindingId = null,
    accountId = null,
    phase,
    input,
  }) {
    const agent = this.getAgent(agentId);
    const resolvedEmployeeId = employeeId || agent?.employeeId || null;
    const activeSeat = resolvedEmployeeId
      ? this.getActiveSeatBinding(resolvedEmployeeId)
      : null;
    const run = {
      id: ID("run"),
      taskId,
      agentId,
      employeeId: resolvedEmployeeId,
      seatBindingId: seatBindingId || activeSeat?.id || null,
      accountId,
      phase,
      status: "running",
      input,
      output: "",
      error: null,
      startedAt: NOW(),
      finishedAt: null,
    };
    this.db
      .prepare(`
        INSERT INTO runs
          (id, task_id, agent_id, employee_id, seat_binding_id, account_id,
           phase, status, input, output, error, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.taskId,
        run.agentId,
        run.employeeId,
        run.seatBindingId,
        run.accountId,
        run.phase,
        run.status,
        run.input,
        run.output,
        run.error,
        run.startedAt,
        run.finishedAt,
      );
    this.addEvent({
      type: "run.started",
      payload: {
        runId: run.id,
        taskId,
        agentId,
        employeeId: run.employeeId,
        seatBindingId: run.seatBindingId,
        phase,
      },
    });
    return run;
  }

  finishRun(runId, { status, output = "", error = null }) {
    const finishedAt = NOW();
    this.db
      .prepare(
        "UPDATE runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?",
      )
      .run(status, String(output), error ? String(error) : null, finishedAt, runId);
    const run = mapRun(this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId));
    this.addEvent({
      type: "run.finished",
      payload: { runId, taskId: run.taskId, status, error },
    });
    return run;
  }

  listRuns(roomId, limit = 100) {
    return this.db
      .prepare(`
        SELECT runs.* FROM runs
        JOIN tasks ON tasks.id = runs.task_id
        WHERE tasks.room_id = ?
        ORDER BY runs.started_at DESC
        LIMIT ?
      `)
      .all(roomId, limit)
      .map(mapRun);
  }

  listRunsForTask(taskId) {
    return this.db
      .prepare("SELECT * FROM runs WHERE task_id = ? ORDER BY started_at ASC")
      .all(taskId)
      .map(mapRun);
  }

  addEvent({ type, roomId = null, payload = {} }) {
    const event = {
      id: ID("event"),
      type,
      roomId,
      payload,
      createdAt: NOW(),
    };
    this.db
      .prepare(
        "INSERT INTO events (id, type, room_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(event.id, event.type, event.roomId, JSON.stringify(event.payload), event.createdAt);
    return event;
  }

  getState(requestedRoomId) {
    const rooms = this.listRooms();
    const selectedRoomId =
      rooms.find((room) => room.id === requestedRoomId)?.id ?? rooms[0]?.id ?? null;
    const agents = this.listAgentModes();
    const employees = this.listEmployees();
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    const seatBindings = this.listSeatBindings();
    const memoryCounts = new Map(
      this.memoryCounts().map((item) => [item.agentId, Number(item.count)]),
    );
    const enrichedAgents = agents.map((agent) => ({
      ...agent,
      employeeName: employeeMap.get(agent.employeeId)?.name ?? "Unassigned employee",
      employeeTitle: employeeMap.get(agent.employeeId)?.title ?? "",
      activeSeat: employeeMap.get(agent.employeeId)?.activeSeat ?? null,
      memoryCount: memoryCounts.get(agent.id) ?? 0,
    }));

    return {
      generatedAt: NOW(),
      settings: this.getSettings(),
      selectedRoomId,
      rooms,
      employees,
      roomMembers: selectedRoomId ? this.listRoomMembers(selectedRoomId) : [],
      roomMemberIds: selectedRoomId ? this.listRoomMemberIds(selectedRoomId) : [],
      seatBindings,
      accounts: seatBindings
        .filter((seat) => seat.active)
        .map((seat) => ({
          id: seat.id,
          employeeId: seat.employeeId,
          provider: seat.provider,
          label: seat.label,
          authKind: seat.bindingType,
          status: seat.status,
          createdAt: seat.createdAt,
        })),
      agentModes: enrichedAgents,
      agents: enrichedAgents,
      headcount: employees.filter(
        (employee) => employee.status === "active" && employee.activeSeat,
      ).length,
      messages: selectedRoomId ? this.listMessages(selectedRoomId) : [],
      tasks: selectedRoomId ? this.listTasks(selectedRoomId) : [],
      workflows: selectedRoomId ? this.listWorkflows(selectedRoomId) : [],
      runs: selectedRoomId ? this.listRuns(selectedRoomId) : [],
      knowledge: selectedRoomId ? this.listKnowledge(selectedRoomId) : [],
      devices: [
        {
          id: "device_local",
          name: "Local control plane",
          platform: process.platform,
          status: "online",
          agentCount: enrichedAgents.length,
          employeeCount: employees.length,
          connectorVersion: "0.3.0",
          trust: "localhost",
        },
      ],
    };
  }
}

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function normalizeAdapter(adapter) {
  const value = typeof adapter === "string" ? parseJson(adapter, null) : adapter;
  if (!value || typeof value !== "object") return { type: "mock" };

  if (value.type === "api") {
    const provider = String(value.provider || "openai-compatible");
    const baseUrl = normalizeApiBaseUrl(
      value.baseUrl ||
        (provider === "deepseek" ? "https://api.deepseek.com" : ""),
    );
    const apiKeyEnv = String(
      value.apiKeyEnv ||
        (provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"),
    );
    if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
      throw new HttpError(400, "API key environment variable name is invalid");
    }
    return {
      type: "api",
      provider,
      baseUrl,
      model: requireText(value.model, "API model"),
      apiKeyEnv,
      timeoutMs: Math.min(Math.max(Number(value.timeoutMs) || 120000, 1000), 900000),
      maxTokens:
        value.maxTokens === undefined || value.maxTokens === ""
          ? null
          : Math.min(Math.max(Number(value.maxTokens) || 0, 1), 128000),
      temperature:
        value.temperature === undefined || value.temperature === ""
          ? null
          : Math.min(Math.max(Number(value.temperature) || 0, 0), 2),
    };
  }

  if (value.type === "command") {
    return {
      type: "command",
      command: requireText(value.command, "Command executable"),
      args: Array.isArray(value.args) ? value.args.map(String) : [],
      workingDir: value.workingDir ? String(value.workingDir) : process.cwd(),
      timeoutMs: Math.min(Math.max(Number(value.timeoutMs) || 120000, 1000), 900000),
      env: normalizeCommandEnv(value.env),
    };
  }

  return {
    type: "mock",
    behavior: String(value.behavior || "generic"),
  };
}

function normalizeCommandEnv(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Command environment must be a JSON object");
  }
  const env = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!SAFE_COMMAND_ENV_KEYS.has(key)) {
      throw new HttpError(
        400,
        `Environment variable ${key} is not allowed in command adapters`,
      );
    }
    env[key] = String(rawValue ?? "");
  }
  return env;
}

function normalizeApiBaseUrl(value) {
  let url;
  try {
    url = new URL(requireText(value, "API base URL"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "API base URL is invalid");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHosts.has(url.hostname))) {
    throw new HttpError(400, "API adapter requires HTTPS unless using localhost");
  }
  return url.toString();
}

function assertAcyclicWorkflow(steps) {
  const dependencies = new Map(
    steps.map((step) => [step.key, step.dependsOn]),
  );
  const visiting = new Set();
  const visited = new Set();

  const visit = (key) => {
    if (visiting.has(key)) {
      throw new HttpError(400, "Workflow dependencies must not contain a cycle");
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const step of steps) visit(step.key);
}

function requireText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `${label} is required`);
  return text;
}

function normalizeLocale(value) {
  if (!["zh-CN", "en"].includes(value)) {
    throw new HttpError(400, "Locale must be zh-CN or en");
  }
  return value;
}

export function createStore(options) {
  return new CrossStaffStore(options);
}
