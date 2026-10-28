import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRuntime } from "./adapters.js";
import { CrossStaffStore, HttpError } from "./db.js";
import { WorkflowOrchestrator } from "./orchestrator.js";

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;

export function createCrossStaffApp({
  dataDir,
  databasePath,
  publicDir = DEFAULT_PUBLIC_DIR,
  allowCommands = false,
  commandTimeoutMs = 120000,
  seedDemo = false,
} = {}) {
  const store = new CrossStaffStore({ dataDir, databasePath, seedDemo });
  const events = new EventEmitter();
  events.setMaxListeners(100);
  const runtime = new AgentRuntime({ allowCommands, defaultTimeoutMs: commandTimeoutMs });
  const orchestrator = new WorkflowOrchestrator({ store, runtime, events });
  const resolvedPublicDir = resolve(publicDir);

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        await handleApi({
          request,
          response,
          url,
          store,
          events,
          orchestrator,
          allowCommands,
        });
        return;
      }
      await serveStatic({ request, response, pathname: url.pathname, publicDir: resolvedPublicDir });
    } catch (error) {
      sendError(response, error);
    }
  });

  return {
    server,
    store,
    orchestrator,
    events,
    async close() {
      await closeServer(server);
      store.close();
    },
  };
}

async function handleApi({
  request,
  response,
  url,
  store,
  events,
  orchestrator,
  allowCommands,
}) {
  const { pathname } = url;
  const method = request.method ?? "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      version: "0.3.0",
      commandAdapters: allowCommands ? "enabled" : "disabled",
      now: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, store.getState(url.searchParams.get("roomId")));
    return;
  }

  if (method === "GET" && pathname === "/api/settings") {
    sendJson(response, 200, store.getSettings());
    return;
  }

  if (method === "PATCH" && pathname === "/api/settings") {
    const body = await readJson(request);
    const settings = store.updateSettings(body);
    notify(events, "settings.updated", null, settings);
    sendJson(response, 200, settings);
    return;
  }

  if (method === "GET" && pathname === "/api/events") {
    openEventStream({ request, response, events });
    return;
  }

  if (method === "POST" && pathname === "/api/rooms") {
    const body = await readJson(request);
    const room = store.createRoom(body);
    notify(events, "room.created", room.id, { roomId: room.id });
    sendJson(response, 201, room);
    return;
  }

  const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(pathname);
  if (method === "DELETE" && roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    const deleted = store.deleteRoom(roomId);
    notify(events, "room.deleted", null, {
      roomId,
      nextRoomId: deleted.nextRoomId,
    });
    sendJson(response, 200, deleted);
    return;
  }

  if (method === "POST" && pathname === "/api/accounts") {
    const body = await readJson(request);
    rejectCredentialFields(body);
    const account = store.createAccount(body);
    notify(events, "account.created", null, { accountId: account.id });
    sendJson(response, 201, account);
    return;
  }

  if (method === "POST" && pathname === "/api/employees") {
    const body = await readJson(request);
    rejectCredentialFields(body);
    const employee = store.createEmployee({
      name: body.name,
      title: body.title,
      managerId: body.managerId || null,
      provider: body.provider,
      bindingType: body.bindingType,
      label: body.label,
      roomId: body.roomId || null,
    });
    notify(events, "employee.created", null, { employeeId: employee.id });
    sendJson(response, 201, employee);
    return;
  }

  const employeeMatch = /^\/api\/employees\/([^/]+)$/.exec(pathname);
  if (method === "PATCH" && employeeMatch) {
    const body = await readJson(request);
    const employee = store.updateEmployee(decodeURIComponent(employeeMatch[1]), {
      name: body.name,
      title: body.title,
      managerId: body.managerId,
      status: body.status,
    });
    notify(events, "employee.updated", null, { employeeId: employee.id });
    sendJson(response, 200, employee);
    return;
  }
  if (method === "DELETE" && employeeMatch) {
    const employeeId = decodeURIComponent(employeeMatch[1]);
    const deleted = store.deleteEmployee(employeeId);
    notify(events, "employee.deleted", null, { employeeId });
    sendJson(response, 200, deleted);
    return;
  }

  const employeeOffboardMatch = /^\/api\/employees\/([^/]+)\/offboard$/.exec(pathname);
  if (method === "POST" && employeeOffboardMatch) {
    const body = await readJson(request);
    const employee = store.offboardEmployee(
      decodeURIComponent(employeeOffboardMatch[1]),
      { reason: body.reason || "" },
    );
    notify(events, "employee.offboarded", null, { employeeId: employee.id });
    sendJson(response, 200, employee);
    return;
  }

  const employeeModesMatch = /^\/api\/employees\/([^/]+)\/modes$/.exec(pathname);
  if (method === "POST" && employeeModesMatch) {
    const body = await readJson(request);
    if (body.adapter?.type === "command" && !allowCommands) {
      throw new HttpError(
        403,
        "Command adapters are disabled. Set CROSSSTAFF_ALLOW_COMMANDS=1 to enable local command execution.",
      );
    }
    const mode = store.createAgent({
      ...body,
      employeeId: decodeURIComponent(employeeModesMatch[1]),
    });
    notify(events, "agent.created", mode.roomId, {
      agentId: mode.id,
      employeeId: mode.employeeId,
    });
    sendJson(response, 201, mode);
    return;
  }

  const employeeMemoriesMatch = /^\/api\/employees\/([^/]+)\/memories$/.exec(pathname);
  if (method === "GET" && employeeMemoriesMatch) {
    const employeeId = decodeURIComponent(employeeMemoriesMatch[1]);
    if (!store.getEmployee(employeeId)) throw new HttpError(404, "Employee not found");
    sendJson(response, 200, store.listEmployeeMemories(employeeId));
    return;
  }
  if (method === "POST" && employeeMemoriesMatch) {
    const body = await readJson(request);
    const employeeId = decodeURIComponent(employeeMemoriesMatch[1]);
    const memory = store.addEmployeeMemory({ ...body, employeeId });
    notify(events, "employee.memory.created", null, { employeeId });
    sendJson(response, 201, memory);
    return;
  }

  const employeeSeatsMatch = /^\/api\/employees\/([^/]+)\/seats$/.exec(pathname);
  if (method === "POST" && employeeSeatsMatch) {
    const body = await readJson(request);
    rejectCredentialFields(body);
    const employee = store.rebindEmployeeSeat(
      decodeURIComponent(employeeSeatsMatch[1]),
      {
        provider: body.provider,
        bindingType: body.bindingType,
        label: body.label,
      },
    );
    notify(events, "employee.seat_rebound", null, { employeeId: employee.id });
    sendJson(response, 200, employee);
    return;
  }

  if (method === "POST" && pathname === "/api/agents") {
    const body = await readJson(request);
    if (body.adapter?.type === "command" && !allowCommands) {
      throw new HttpError(
        403,
        "Command adapters are disabled. Set CROSSSTAFF_ALLOW_COMMANDS=1 to enable local command execution.",
      );
    }
    const agent = store.createAgent(body);
    notify(events, "agent.created", agent.roomId, { agentId: agent.id });
    sendJson(response, 201, agent);
    return;
  }

  const agentModeMatch = /^\/api\/agent-modes\/([^/]+)$/.exec(pathname);
  if (method === "PATCH" && agentModeMatch) {
    const body = await readJson(request);
    if (body.adapter?.type === "command" && !allowCommands) {
      throw new HttpError(
        403,
        "Command adapters are disabled. Set CROSSSTAFF_ALLOW_COMMANDS=1 to enable local command execution.",
      );
    }
    const agent = store.updateAgentMode(
      decodeURIComponent(agentModeMatch[1]),
      {
        name: body.name,
        role: body.role,
        instructions: body.instructions,
        adapter: body.adapter,
      },
    );
    notify(events, "agent.updated", agent.roomId, { agentId: agent.id });
    sendJson(response, 200, agent);
    return;
  }
  if (method === "DELETE" && agentModeMatch) {
    const agent = store.deleteAgentMode(
      decodeURIComponent(agentModeMatch[1]),
    );
    notify(events, "agent.deleted", agent.roomId, { agentId: agent.id });
    sendJson(response, 200, agent);
    return;
  }

  const roomMembersMatch = /^\/api\/rooms\/([^/]+)\/members$/.exec(pathname);
  if (method === "POST" && roomMembersMatch) {
    const body = await readJson(request);
    const roomId = decodeURIComponent(roomMembersMatch[1]);
    const employee = store.addRoomMember(roomId, body.employeeId);
    notify(events, "room.member_added", roomId, { employeeId: employee.id });
    sendJson(response, 201, employee);
    return;
  }

  const forkMatch = /^\/api\/(?:agents|agent-modes)\/([^/]+)\/fork$/.exec(pathname);
  if (method === "POST" && forkMatch) {
    const body = await readJson(request);
    const child = store.forkAgent(decodeURIComponent(forkMatch[1]), body);
    notify(events, "agent.forked", child.roomId, {
      agentId: child.id,
      parentId: child.parentId,
    });
    sendJson(response, 201, child);
    return;
  }

  const memoryMatch = /^\/api\/agents\/([^/]+)\/memories$/.exec(pathname);
  if (method === "GET" && memoryMatch) {
    const agentId = decodeURIComponent(memoryMatch[1]);
    if (!store.getAgent(agentId)) throw new HttpError(404, "Agent not found");
    sendJson(response, 200, store.listMemories(agentId));
    return;
  }
  if (method === "POST" && memoryMatch) {
    const body = await readJson(request);
    const agentId = decodeURIComponent(memoryMatch[1]);
    const memory = store.addMemory({ ...body, agentId });
    const agent = store.getAgent(agentId);
    notify(events, "memory.created", agent.roomId, { agentId, memoryId: memory.id });
    sendJson(response, 201, memory);
    return;
  }

  if (method === "POST" && pathname === "/api/messages") {
    const body = await readJson(request);
    const message = store.addMessage({
      roomId: body.roomId,
      senderType: "human",
      senderName: body.senderName || "You",
      kind: "message",
      content: body.content,
    });
    notify(events, "message.created", message.roomId, { messageId: message.id });
    const mentionedMode = findMentionedRoomMode(
      store,
      message.roomId,
      message.content,
    );
    const reply = mentionedMode
      ? orchestrator.startChatReply({
          roomId: message.roomId,
          agentId: mentionedMode.id,
          triggerMessageId: message.id,
        })
      : null;
    sendJson(response, 201, {
      ...message,
      replyQueued: Boolean(reply),
      replyAgentId: reply?.agentId ?? null,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/knowledge") {
    const body = await readJson(request);
    const knowledge = store.addKnowledge(body);
    notify(events, "knowledge.created", knowledge.roomId, {
      knowledgeId: knowledge.id,
    });
    sendJson(response, 201, knowledge);
    return;
  }

  if (method === "POST" && pathname === "/api/workflows") {
    const body = await readJson(request);
    const workflow = store.createWorkflow(body);
    const started = orchestrator.startWorkflow(workflow.id);
    sendJson(response, 202, started);
    return;
  }

  const workflowMatch = /^\/api\/workflows\/([^/]+)$/.exec(pathname);
  if (method === "GET" && workflowMatch) {
    const workflow = store.getWorkflow(decodeURIComponent(workflowMatch[1]));
    if (!workflow) throw new HttpError(404, "Workflow not found");
    sendJson(response, 200, workflow);
    return;
  }

  const workflowCancelMatch = /^\/api\/workflows\/([^/]+)\/cancel$/.exec(pathname);
  if (method === "POST" && workflowCancelMatch) {
    const workflowId = decodeURIComponent(workflowCancelMatch[1]);
    orchestrator.cancelWorkflow(workflowId);
    sendJson(response, 202, { ok: true, workflowId });
    return;
  }

  if (method === "POST" && pathname === "/api/workflows/review") {
    const body = await readJson(request);
    const task = store.createTask(body);
    const started = orchestrator.startReviewWorkflow(task.id);
    sendJson(response, 202, started);
    return;
  }

  const cancelMatch = /^\/api\/tasks\/([^/]+)\/cancel$/.exec(pathname);
  if (method === "POST" && cancelMatch) {
    const taskId = decodeURIComponent(cancelMatch[1]);
    orchestrator.cancelTask(taskId);
    sendJson(response, 202, { ok: true, taskId });
    return;
  }

  throw new HttpError(404, "API route not found");
}

function openEventStream({ request, response, events }) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 2000\n\n");

  const listener = (event) => {
    response.write(`event: state\ndata: ${JSON.stringify(event)}\n\n`);
  };
  events.on("state", listener);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    events.off("state", listener);
  };
  request.on("close", cleanup);
  response.on("close", cleanup);
}

async function serveStatic({ request, response, pathname, publicDir }) {
  if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
    throw new HttpError(405, "Method not allowed");
  }

  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(publicDir, relative);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) {
    throw new HttpError(403, "Invalid path");
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch {
    throw new HttpError(404, "File not found");
  }

  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": content.length,
    "Cache-Control": "no-cache",
  });
  if (request.method === "HEAD") response.end();
  else response.end(content);
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] || "");
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function rejectCredentialFields(body) {
  const forbidden = [
    "password",
    "token",
    "apiKey",
    "api_key",
    "cookie",
    "session",
    "refreshToken",
    "accessToken",
  ];
  const keys = Object.keys(body ?? {}).map((key) => key.toLowerCase());
  if (forbidden.some((field) => keys.includes(field.toLowerCase()))) {
    throw new HttpError(
      400,
      "CrossStaff does not accept passwords, cookies, or access tokens through the account API.",
    );
  }
}

function notify(events, type, roomId, payload) {
  events.emit("state", {
    type,
    roomId: roomId ?? null,
    payload,
    at: new Date().toISOString(),
  });
}

function findMentionedRoomMode(store, roomId, content) {
  const normalized = String(content || "").toLowerCase();
  if (!normalized) return null;
  const members = new Set(
    store.listRoomMembers(roomId).map((employee) => employee.id),
  );
  const candidates = store
    .listAgentModes()
    .filter((mode) => members.has(mode.employeeId))
    .map((mode) => ({ mode, label: mode.name.toLowerCase() }))
    .filter((candidate) => candidate.label.length >= 2)
    .sort((a, b) => b.label.length - a.label.length);
  return candidates.find((candidate) => normalized.includes(candidate.label))?.mode ?? null;
}

function setSecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response, statusCode, data) {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendError(response, error) {
  if (response.headersSent) {
    response.end();
    return;
  }
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message =
    statusCode >= 500 ? "Internal server error" : error instanceof Error ? error.message : "Error";
  if (statusCode >= 500) console.error(error);
  sendJson(response, statusCode, { error: message });
}

function contentTypeFor(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close(() => resolvePromise());
    server.closeAllConnections?.();
  });
}
