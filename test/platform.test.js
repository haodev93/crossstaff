import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const isPosix = process.platform !== "win32";

test("POSIX Codex helper isolates the CLI profile", { skip: !isPosix }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "crossstaff-posix-login-"));
  const binDir = join(tempDir, "bin");
  const cliHome = join(tempDir, "isolated codex home");
  const commandLog = join(tempDir, "commands.log");
  const codexPath = join(binDir, "codex");
  const helperPath = fileURLToPath(
    new URL("../scripts/login-codex-cli.sh", import.meta.url),
  );

  try {
    assert.equal(existsSync(helperPath), true);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      codexPath,
      [
        "#!/usr/bin/env sh",
        'printf "%s|%s\\n" "$*" "$CODEX_HOME" >> "$CROSSSTAFF_TEST_LOG"',
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(codexPath, 0o755);

    const result = spawnSync("sh", [helperPath, cliHome], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
        CROSSSTAFF_TEST_LOG: commandLog,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const isolatedHome = result.stdout.match(/Isolated Codex CLI home: (.+)/)?.[1]?.trim();
    assert.ok(isolatedHome, result.stdout);
    assert.equal(existsSync(isolatedHome), true);
    const calls = readFileSync(commandLog, "utf8").trim().split(/\r?\n/);
    assert.deepEqual(calls, [
      `login|${isolatedHome}`,
      `login status|${isolatedHome}`,
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
