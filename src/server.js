import { resolve } from "node:path";
import { createCrossStaffApp } from "./app.js";

try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") {
    console.warn(`Could not load .env: ${error?.message || error}`);
  }
}

const port = Number(process.env.PORT) || 8787;
const dataDir = resolve(
  process.env.CROSSSTAFF_DATA_DIR ||
    process.env.AGENTSTAFF_DATA_DIR ||
    process.env.HUDDLE_DATA_DIR ||
    process.env.AGENTHUB_DATA_DIR ||
    "./data",
);
const allowCommands =
  process.env.CROSSSTAFF_ALLOW_COMMANDS === "1" ||
  process.env.AGENTSTAFF_ALLOW_COMMANDS === "1" ||
  process.env.HUDDLE_ALLOW_COMMANDS === "1" ||
  process.env.AGENTHUB_ALLOW_COMMANDS === "1";
const commandTimeoutMs =
  Number(
    process.env.CROSSSTAFF_COMMAND_TIMEOUT_MS ||
      process.env.AGENTSTAFF_COMMAND_TIMEOUT_MS ||
      process.env.HUDDLE_COMMAND_TIMEOUT_MS ||
      process.env.AGENTHUB_COMMAND_TIMEOUT_MS,
  ) ||
  120000;
const seedDemo =
  process.env.CROSSSTAFF_SEED_DEMO === "1" ||
  process.env.AGENTSTAFF_SEED_DEMO === "1" ||
  process.env.HUDDLE_SEED_DEMO === "1" ||
  process.env.AGENTHUB_SEED_DEMO === "1";

const app = createCrossStaffApp({ dataDir, allowCommands, commandTimeoutMs, seedDemo });

app.server.listen(port, "127.0.0.1", () => {
  console.log(`CrossStaff listening on http://localhost:${port}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Command adapters: ${allowCommands ? "enabled" : "disabled"}`);
  console.log(`Demo workspace: ${seedDemo ? "enabled" : "disabled"}`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("\nShutting down CrossStaff...");
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
