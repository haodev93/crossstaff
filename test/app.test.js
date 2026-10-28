import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCrossStaffApp } from "../src/app.js";

test("GET workflow API returns a workflow or a JSON 404", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-workflow-api-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const state = app.store.getState();
    const workflow = app.store.createWorkflow({
      roomId: state.selectedRoomId,
      title: "Workflow API test",
      prompt: "Verify workflow retrieval.",
      steps: [
        {
          key: "implementation",
          name: "Implementation",
          agentId: state.agentModes[0].id,
        },
      ],
      acceptanceAgentId: state.agentModes[1].id,
    });

    const response = await fetch(`${baseUrl}/api/workflows/${workflow.id}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), workflow);

    const missingResponse = await fetch(
      `${baseUrl}/api/workflows/does-not-exist`,
    );
    assert.equal(missingResponse.status, 404);
    assert.match(missingResponse.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await missingResponse.json(), {
      error: "Workflow not found",
    });
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API serves state and rejects credential material", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-http-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const healthData = await health.json();
    assert.equal(healthData.version, "0.3.0");
    assert.equal(healthData.commandAdapters, "disabled");

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.rooms.length, 1);
    assert.equal(state.agents.length, 2);
    assert.equal(state.employees.length, 2);
    assert.equal(state.headcount, 2);
    assert.equal(state.settings.onboardingComplete, true);

    const mentionedMode = state.agentModes[0];
    const messageResponse = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: state.selectedRoomId,
        content: `${mentionedMode.name}，你好`,
      }),
    });
    assert.equal(messageResponse.status, 201);
    assert.equal((await messageResponse.json()).replyQueued, true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const repliedState = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.ok(
      repliedState.messages.some(
        (message) =>
          message.senderType === "agent" &&
          message.senderId === mentionedMode.id,
      ),
    );

    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    assert.equal(settingsResponse.status, 200);
    assert.equal((await settingsResponse.json()).locale, "en");

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /CrossStaff/);
    assert.match(pageHtml, /digital employees/);

    const manifestResponse = await fetch(`${baseUrl}/site.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, "CrossStaff");
    assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));

    const iconResponse = await fetch(`${baseUrl}/assets/crossstaff-app-icon.svg`);
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get("content-type"), "image/svg+xml");

    const rejected = await fetch(`${baseUrl}/api/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Unsafe employee",
        provider: "openai",
        label: "Unsafe",
        apiKey: "must-not-be-stored",
      }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("fresh workspace can complete onboarding with a custom agent role", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-onboarding-"));
  const app = createCrossStaffApp({ dataDir: tempDir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const post = (path, body, method = "POST") =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const initial = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(initial.settings.onboardingComplete, false);
    assert.equal(initial.rooms.length, 0);

    const tooEarly = await post("/api/settings", { onboardingComplete: true }, "PATCH");
    assert.equal(tooEarly.status, 409);

    const roomResponse = await post("/api/rooms", {
      name: "First room",
      description: "Setup test",
    });
    assert.equal(roomResponse.status, 201);
    const room = await roomResponse.json();

    const employeeResponse = await post("/api/employees", {
      name: "First employee",
      title: "Code reviewer",
      provider: "openai",
      label: "Official test seat",
      bindingType: "organization-seat",
    });
    assert.equal(employeeResponse.status, 201);
    const employee = await employeeResponse.json();

    const agentResponse = await post(`/api/employees/${employee.id}/modes`, {
      roomId: room.id,
      name: "First mode",
      role: "Code Review Lead",
      instructions: "Review independently.",
      adapter: { type: "mock", behavior: "reviewer" },
    });
    assert.equal(agentResponse.status, 201);
    const agent = await agentResponse.json();
    assert.equal(agent.role, "Code Review Lead");
    assert.equal(agent.employeeId, employee.id);

    const secondRoomResponse = await post("/api/rooms", {
      name: "Second room",
      description: "Reuse the first employee",
    });
    const secondRoom = await secondRoomResponse.json();
    const memberResponse = await post(`/api/rooms/${secondRoom.id}/members`, {
      employeeId: employee.id,
    });
    assert.equal(memberResponse.status, 201);
    const secondRoomState = await (
      await fetch(`${baseUrl}/api/state?roomId=${secondRoom.id}`)
    ).json();
    assert.equal(secondRoomState.roomMembers.length, 1);
    assert.equal(secondRoomState.roomMembers[0].id, employee.id);

    const completed = await post("/api/settings", { onboardingComplete: true }, "PATCH");
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).onboardingComplete, true);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("employee offboarding API revokes access but keeps history", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-offboard-api-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const post = (path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    const employee = await post("/api/employees", {
      name: "Offboard Test",
      title: "Temporary Engineer",
      provider: "custom",
      bindingType: "official",
      label: "Temporary Seat",
      roomId: state.selectedRoomId,
    }).then((response) => response.json());
    await post(`/api/employees/${employee.id}/memories`, {
      content: "Keep this memory after offboarding.",
    });
    const response = await post(`/api/employees/${employee.id}/offboard`, {
      reason: "Pilot completed",
    });
    assert.equal(response.status, 200);
    const offboarded = await response.json();
    assert.equal(offboarded.status, "offboarded");
    assert.equal(offboarded.activeSeat, null);
    assert.equal(offboarded.offboardReason, "Pilot completed");
    assert.equal(offboarded.memoryCount, 1);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent mode API supports editing and soft deletion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-mode-api-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    const mode = state.agentModes[0];
    const patchResponse = await fetch(
      `${baseUrl}/api/agent-modes/${mode.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Edited API Mode",
          role: "Custom Role",
          instructions: "Edited instructions",
          adapter: { type: "mock", behavior: "builder" },
        }),
      },
    );
    assert.equal(patchResponse.status, 200);
    assert.equal((await patchResponse.json()).name, "Edited API Mode");

    const deleteResponse = await fetch(
      `${baseUrl}/api/agent-modes/${mode.id}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    const after = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(
      after.agentModes.some((item) => item.id === mode.id),
      false,
    );
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("room deletion API selects the next room and the mode editor submits its id", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-room-api-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    const roomToDelete = state.rooms[0];
    const createResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Next room" }),
    });
    const nextRoom = await createResponse.json();

    const deleteResponse = await fetch(
      `${baseUrl}/api/rooms/${roomToDelete.id}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json();
    assert.equal(deleted.nextRoomId, nextRoom.id);

    const after = await (
      await fetch(`${baseUrl}/api/state?roomId=${roomToDelete.id}`)
    ).json();
    assert.equal(after.selectedRoomId, nextRoom.id);
    assert.equal(after.rooms.some((room) => room.id === roomToDelete.id), false);

    const missing = await fetch(`${baseUrl}/api/rooms/${roomToDelete.id}`, {
      method: "DELETE",
    });
    assert.equal(missing.status, 404);

    const appSource = await (await fetch(`${baseUrl}/app.js`)).text();
    const editFormStart = appSource.indexOf("function renderModeEditForm");
    const editFormEnd = appSource.indexOf("function renderRoomDeleteForm");
    assert.ok(editFormStart >= 0 && editFormEnd > editFormStart);
    assert.match(
      appSource.slice(editFormStart, editFormEnd),
      /<input type="hidden" name="agentId"/,
    );
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("employee API supports profile editing and guarded permanent deletion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-employee-api-"));
  const app = createCrossStaffApp({ dataDir: tempDir, seedDemo: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    const employee = await (
      await fetch(`${baseUrl}/api/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "API Employee",
          title: "Engineer",
          provider: "custom",
          bindingType: "official",
          label: "API Edit Seat",
        }),
      })
    ).json();

    const patchResponse = await fetch(
      `${baseUrl}/api/employees/${employee.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Edited Employee",
          title: "Senior Engineer",
          managerId: null,
        }),
      },
    );
    assert.equal(patchResponse.status, 200);
    assert.equal((await patchResponse.json()).name, "Edited Employee");

    const deleteResponse = await fetch(
      `${baseUrl}/api/employees/${employee.id}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);

    const seeded = state.employees[0];
    const seededMode = state.agentModes.find(
      (mode) => mode.employeeId === seeded.id,
    );
    app.store.addMessage({
      roomId: state.selectedRoomId,
      senderType: "agent",
      senderId: seededMode.id,
      senderName: seededMode.name,
      kind: "message",
      content: "Historical output",
    });
    const historicalDelete = await fetch(
      `${baseUrl}/api/employees/${seeded.id}`,
      { method: "DELETE" },
    );
    assert.equal(historicalDelete.status, 409);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
