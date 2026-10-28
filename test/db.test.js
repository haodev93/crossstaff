import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CrossStaffStore } from "../src/db.js";

test("employee seats, mode memory fork, and knowledge search", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-db-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });

  try {
    const state = store.getState();
    assert.equal(state.rooms.length, 1);
    assert.equal(state.agents.length, 2);
    assert.equal(state.employees.length, 2);
    assert.equal(state.headcount, 2);
    assert.equal(state.roomMembers.length, 2);
    assert.equal(state.seatBindings.filter((seat) => seat.active).length, 2);
    assert.equal(state.settings.onboardingComplete, true);

    const parent = state.agents.find((agent) => agent.role === "builder");
    assert.ok(parent);
    store.addMemory({
      agentId: parent.id,
      content: "Always attach test evidence to implementation handoffs.",
      source: "test",
    });

    const child = store.forkAgent(parent.id, { name: "Builder branch" });
    assert.equal(child.parentId, parent.id);
    assert.equal(child.forkDepth, 1);
    const childMemories = store.listMemories(child.id);
    assert.ok(childMemories.some((memory) => memory.content.includes("test evidence")));

    const matches = store.searchKnowledge(
      state.selectedRoomId,
      "independent review contract evidence",
      3,
    );
    assert.ok(matches.length > 0);
    assert.match(matches[0].title, /review contract/i);

    const employee = store.createEmployee({
      name: "Second engineer",
      title: "Security auditor",
      provider: "openai",
      label: "Security seat A",
      bindingType: "organization-seat",
    });
    store.addEmployeeMemory({
      employeeId: employee.id,
      content: "Security reviews must cite evidence.",
    });
    const agent = store.createAgent({
      roomId: state.selectedRoomId,
      employeeId: employee.id,
      name: "Auditor mode",
      role: "Security Auditor",
      adapter: { type: "mock", behavior: "reviewer" },
    });
    assert.equal(agent.employeeId, employee.id);
    assert.equal(store.getEmployee(employee.id).memoryCount, 1);
    assert.throws(
      () =>
        store.createAgent({
          roomId: state.selectedRoomId,
          employeeId: employee.id,
          name: "Unsafe environment mode",
          role: "builder",
          adapter: {
            type: "command",
            command: process.execPath,
            env: { OPENAI_API_KEY: "must-not-be-stored" },
          },
        }),
      /not allowed/,
    );

    const secondRoom = store.createRoom({
      name: "Cross-room project",
      description: "Reuse an existing employee",
    });
    assert.equal(store.listRoomMembers(secondRoom.id).length, 0);
    store.addRoomMember(secondRoom.id, employee.id);
    assert.equal(store.listRoomMembers(secondRoom.id).length, 1);
    assert.equal(store.listRoomMembers(secondRoom.id)[0].id, employee.id);

    const rebound = store.rebindEmployeeSeat(employee.id, {
      provider: "openai",
      bindingType: "organization-seat",
      label: "Security seat B",
    });
    assert.equal(rebound.activeSeat.label, "Security seat B");
    assert.equal(rebound.id, employee.id);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("fresh workspace has onboarding settings and validates locale", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-settings-"));
  const store = new CrossStaffStore({ dataDir: tempDir });

  try {
    assert.deepEqual(store.getSettings().locale, "zh-CN");
    assert.equal(store.getSettings().onboardingComplete, false);
    assert.equal(store.updateSettings({ locale: "en" }).locale, "en");
    assert.throws(() => store.updateSettings({ locale: "fr" }), /zh-CN or en/);
    assert.throws(
      () => store.updateSettings({ onboardingComplete: true }),
      /requires a room/,
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V1 accounts and agents migrate into employees, seats, and agent modes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-v1-"));
  const databasePath = join(tempDir, "v1.db");
  const legacy = new DatabaseSync(databasePath);
  const now = new Date().toISOString();
  legacy.exec(`
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      auth_kind TEXT NOT NULL DEFAULT 'official',
      status TEXT NOT NULL DEFAULT 'connected',
      owner TEXT NOT NULL DEFAULT 'local-user',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      account_id TEXT,
      parent_id TEXT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      role TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      adapter_json TEXT NOT NULL DEFAULT '{"type":"mock"}',
      status TEXT NOT NULL DEFAULT 'ready',
      fork_depth INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  legacy
    .prepare("INSERT INTO rooms (id, name, description, created_at) VALUES (?, ?, '', ?)")
    .run("room_legacy", "Legacy room", now);
  legacy
    .prepare(`
      INSERT INTO accounts
        (id, provider, label, auth_kind, status, owner, metadata_json, created_at)
      VALUES ('account_legacy', 'openai', 'Legacy account', 'organization-seat',
              'connected', 'local-user', '{}', ?)
    `)
    .run(now);
  legacy
    .prepare(`
      INSERT INTO agents
        (id, room_id, account_id, parent_id, name, provider, role, instructions,
         adapter_json, status, fork_depth, created_at)
      VALUES ('agent_legacy', 'room_legacy', 'account_legacy', NULL, 'Legacy mode',
              'openai', 'builder', '', '{"type":"mock"}', 'ready', 0, ?)
    `)
    .run(now);
  legacy.close();

  const store = new CrossStaffStore({ databasePath });
  try {
    const state = store.getState();
    assert.equal(state.employees.length, 1);
    assert.equal(state.headcount, 1);
    assert.equal(state.agents.length, 1);
    assert.equal(state.agents[0].employeeId, state.employees[0].id);
    assert.equal(state.employees[0].activeSeat.label, "Legacy account");
    assert.equal(state.employees[0].activeSeat.bindingType, "organization-seat");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("offboarding revokes access while retaining employee history and memory", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-offboard-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  const state = store.getState();
  const employee = state.employees.find((item) => item.name === "Codex Builder");

  try {
    store.addEmployeeMemory({
      employeeId: employee.id,
      content: "Retain this lesson after offboarding.",
    });
    const offboarded = store.offboardEmployee(employee.id, {
      reason: "Project completed",
    });

    assert.equal(offboarded.status, "offboarded");
    assert.equal(offboarded.offboardReason, "Project completed");
    assert.equal(offboarded.activeSeat, null);
    assert.equal(offboarded.modeCount, 1);
    assert.ok(
      store
        .listAgentModes(employee.id)
        .every((mode) => mode.status === "offboarded"),
    );
    assert.ok(
      store
        .listEmployeeMemories(employee.id)
        .some((memory) => memory.content.includes("Retain this lesson")),
    );
    assert.ok(
      store
        .listRoomMembers(state.selectedRoomId)
        .every((member) => member.id !== employee.id),
    );
    assert.equal(store.getState().headcount, state.headcount - 1);
    assert.throws(
      () =>
        store.createAgent({
          roomId: state.selectedRoomId,
          employeeId: employee.id,
          name: "Should not run",
          role: "builder",
        }),
      /active seat/,
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent modes can be edited and safely retired", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-mode-edit-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  try {
    const state = store.getState();
    const mode = state.agentModes.find((item) => item.role === "builder");
    const updated = store.updateAgentMode(mode.id, {
      name: "Renamed Builder",
      role: "Lead Builder",
      instructions: "Return a detailed handoff.",
      adapter: { type: "mock", behavior: "builder" },
    });
    assert.equal(updated.name, "Renamed Builder");
    assert.equal(updated.role, "Lead Builder");
    assert.equal(updated.instructions, "Return a detailed handoff.");

    store.updateAgentStatus(mode.id, "running");
    assert.throws(
      () => store.deleteAgentMode(mode.id),
      /Cannot delete a running agent mode/,
    );
    store.updateAgentStatus(mode.id, "ready");

    const deleted = store.deleteAgentMode(mode.id);
    assert.equal(deleted.status, "deleted");
    assert.ok(deleted.deletedAt);
    assert.equal(
      store.listAgentModes().some((item) => item.id === mode.id),
      false,
    );
    assert.equal(store.getAgent(mode.id).status, "deleted");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("employees can be edited and clean records deleted, while history requires offboarding", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-employee-edit-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  try {
    const state = store.getState();
    const first = store.createEmployee({
      name: "Editable Employee",
      title: "Engineer",
      provider: "custom",
      label: "Edit Seat",
    });
    const second = store.createEmployee({
      name: "Manager Employee",
      title: "Manager",
      provider: "custom",
      label: "Manager Seat",
    });
    const edited = store.updateEmployee(first.id, {
      name: "Edited Employee",
      title: "Senior Engineer",
      managerId: second.id,
    });
    assert.equal(edited.name, "Edited Employee");
    assert.equal(edited.managerId, second.id);
    assert.throws(
      () => store.updateEmployee(second.id, { managerId: first.id }),
      /cycle/,
    );

    const clean = store.createEmployee({
      name: "Clean Employee",
      title: "Temporary",
      provider: "custom",
      label: "Temporary Seat",
    });
    assert.equal(store.deleteEmployee(clean.id).deleted, true);
    assert.equal(store.getEmployee(clean.id), null);

    const seeded = state.employees[0];
    const seededMode = store.listAgentModes(seeded.id)[0];
    store.addMessage({
      roomId: state.selectedRoomId,
      senderType: "agent",
      senderId: seededMode.id,
      senderName: seededMode.name,
      kind: "message",
      content: "Historical employee output",
    });
    assert.throws(
      () => store.deleteEmployee(seeded.id),
      /Use offboarding/,
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("room deletion removes room-scoped work while preserving employees and seats", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-room-delete-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  try {
    const state = store.getState();
    const historicalRoom = state.rooms[0];
    const replacementRoom = store.createRoom({
      name: "Replacement room",
      description: "Selected after deletion",
    });
    const employeeCount = state.employees.length;
    const activeSeatCount = state.seatBindings.filter((seat) => seat.active).length;

    const deleted = store.deleteRoom(historicalRoom.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.nextRoomId, replacementRoom.id);
    assert.equal(store.getRoom(historicalRoom.id), null);

    const after = store.getState(replacementRoom.id);
    assert.deepEqual(after.rooms.map((room) => room.id), [replacementRoom.id]);
    assert.equal(after.messages.length, 0);
    assert.equal(after.tasks.length, 0);
    assert.equal(after.workflows.length, 0);
    assert.equal(after.knowledge.length, 0);
    assert.equal(after.employees.length, employeeCount);
    assert.equal(
      after.seatBindings.filter((seat) => seat.active).length,
      activeSeatCount,
    );
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("room deletion is blocked while room work is running", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-room-active-"));
  const store = new CrossStaffStore({ dataDir: tempDir, seedDemo: true });
  try {
    const state = store.getState();
    const room = store.createRoom({ name: "Active room" });
    const employee = state.employees[0];
    store.addRoomMember(room.id, employee.id);
    const mode = store.createAgent({
      roomId: room.id,
      employeeId: employee.id,
      name: "Active mode",
      role: "builder",
      adapter: { type: "mock", behavior: "builder" },
    });
    store.updateAgentStatus(mode.id, "running");
    assert.throws(
      () => store.deleteRoom(room.id),
      /active work/,
    );
    store.updateAgentStatus(mode.id, "ready");
    assert.equal(store.deleteRoom(room.id).deleted, true);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("interim AgentStaff databases remain discoverable after the CrossStaff rename", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-agentstaff-db-"));
  const legacyPath = join(tempDir, "agentstaff.db");
  const legacyStore = new CrossStaffStore({ databasePath: legacyPath });
  legacyStore.close();

  const reopened = new CrossStaffStore({ dataDir: tempDir });
  try {
    assert.equal(reopened.databasePath, legacyPath);
  } finally {
    reopened.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("interim Huddle databases remain discoverable after the CrossStaff rename", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-huddle-db-"));
  const legacyPath = join(tempDir, "huddle.db");
  const legacyStore = new CrossStaffStore({ databasePath: legacyPath });
  legacyStore.close();

  const reopened = new CrossStaffStore({ dataDir: tempDir });
  try {
    assert.equal(reopened.databasePath, legacyPath);
  } finally {
    reopened.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("original AgentHub databases remain discoverable after the CrossStaff rename", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-legacy-db-"));
  const legacyPath = join(tempDir, "agenthub.db");
  const legacyStore = new CrossStaffStore({ databasePath: legacyPath });
  legacyStore.close();

  const reopened = new CrossStaffStore({ dataDir: tempDir });
  try {
    assert.equal(reopened.databasePath, legacyPath);
  } finally {
    reopened.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
