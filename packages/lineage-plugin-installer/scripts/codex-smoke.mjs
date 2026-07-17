#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(installerRoot, "../..");
const cli = path.join(installerRoot, "bin", "lineage-plugin-installer.mjs");
const pluginDir = path.join(repoRoot, "plugins", "lineage-codex-plugin");
const packageInfo = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const pluginId = "lineage-codex-plugin@lineage";
const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-smoke-"));
const codexHome = path.join(temp, "codex-home");
const isolatedHome = path.join(temp, "home");
const childEnv = { ...process.env, HOME: isolatedHome, CODEX_HOME: codexHome };

try {
  await mkdir(isolatedHome, { recursive: true });
  const installArgs = [
    cli,
    "install",
    "--plugin",
    pluginDir,
    "--version",
    packageInfo.version,
    "--codex-home",
    codexHome,
    "--json",
  ];

  const dryRun = runJson(process.execPath, [...installArgs, "--dry-run"], childEnv);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.activated, false);
  await assert.rejects(stat(codexHome), /ENOENT/);

  const installed = runJson(process.execPath, installArgs, childEnv);
  assert.equal(installed.activated, true);
  assert.equal(installed.pluginVersion, packageInfo.version);
  assert.equal(installed.codexHome, codexHome);

  const firstList = runJson("codex", ["plugin", "list", "--json"], childEnv);
  const firstPlugin = firstList.installed.find((candidate) => candidate.pluginId === pluginId);
  assert.equal(firstPlugin?.installed, true);
  assert.equal(firstPlugin?.enabled, true);
  assert.equal(firstPlugin?.version, packageInfo.version);

  const reinstalled = runJson(process.execPath, installArgs, childEnv);
  assert.equal(reinstalled.activated, true);
  const marketplaces = runJson("codex", ["plugin", "marketplace", "list", "--json"], childEnv);
  const lineage = marketplaces.marketplaces.find((candidate) => candidate.name === "lineage");
  assert.equal(realpathSync(lineage.root), realpathSync(installed.marketplaceRoot));

  runJson("codex", ["plugin", "remove", pluginId, "--json"], childEnv);
  runJson("codex", ["plugin", "marketplace", "remove", "lineage", "--json"], childEnv);
  const cleaned = runJson("codex", ["plugin", "list", "--available", "--json"], childEnv);
  assert.equal(
    [...cleaned.installed, ...cleaned.available].some((candidate) => candidate.pluginId === pluginId),
    false,
  );

  await rm(installed.marketplaceRoot, { recursive: true, force: true });
  const realCodex = await resolveExecutable("codex", childEnv);
  const shimDir = path.join(temp, "shim");
  const failureMarker = path.join(temp, "fail-plugin-add-once");
  await mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "codex");
  await writeFile(shimPath, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const result = spawnSync(process.env.LINEAGE_REAL_CODEX, args, { encoding: "utf8" });
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (args[0] === "plugin" && args[1] === "add" && !existsSync(process.env.LINEAGE_FAILURE_MARKER)) {
  writeFileSync(process.env.LINEAGE_FAILURE_MARKER, "failed after real plugin add\\n");
  process.stderr.write("simulated failure after real plugin add\\n");
  process.exit(73);
}
process.exit(result.status ?? 1);
`);
  await chmod(shimPath, 0o755);
  const failureEnv = {
    ...childEnv,
    PATH: `${shimDir}:${childEnv.PATH}`,
    LINEAGE_REAL_CODEX: realCodex,
    LINEAGE_FAILURE_MARKER: failureMarker,
  };
  const failedInstall = spawnSync(process.execPath, installArgs, {
    cwd: repoRoot,
    env: failureEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(failedInstall.status, 1);
  assert.match(failedInstall.stderr, /simulated failure after real plugin add/);
  await assert.rejects(stat(installed.marketplaceRoot), /ENOENT/);
  const rolledBack = runJson("codex", ["plugin", "list", "--available", "--json"], childEnv);
  assert.equal(
    [...rolledBack.installed, ...rolledBack.available].some((candidate) => candidate.pluginId === pluginId),
    false,
  );
  const rolledBackMarketplaces = runJson("codex", ["plugin", "marketplace", "list", "--json"], childEnv);
  assert.equal(rolledBackMarketplaces.marketplaces.some((candidate) => candidate.name === "lineage"), false);

  console.log(JSON.stringify({
    ok: true,
    isolated: true,
    codexHome,
    pluginId,
    version: packageInfo.version,
    dryRunNonMutating: true,
    installedEnabled: true,
    reinstallPassed: true,
    cleanupPassed: true,
    rollbackPassed: true,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

function runJson(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${command} returned non-JSON output: ${result.stdout}`, { cause: error });
  }
}

async function resolveExecutable(command, env) {
  for (const directory of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Keep searching PATH.
    }
  }
  throw new Error(`Could not resolve ${command} from PATH.`);
}
