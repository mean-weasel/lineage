import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const LINEAGE_PACKAGE = "@mean-weasel/lineage";
export const DEFAULT_GITHUB_REPO = "mean-weasel/lineage";
export const PLUGIN_ARTIFACT_NAME = "lineage-codex-plugin";
export const PLUGIN_MANIFEST_PATH = ".codex-plugin/plugin.json";

export function parseLineageVersion(output) {
  const text = String(output || "").trim();
  const jsonCandidate = safeJsonParse(text);
  const value = typeof jsonCandidate === "string" ? jsonCandidate : text;
  const match = String(value).match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  if (!match) {
    throw new Error(`Could not parse a Lineage version from output: ${text}`);
  }
  return match[0];
}

export async function resolveLineageVersion({
  version,
  channel = "latest",
  runCommand = runCommandSync,
} = {}) {
  if (version) return parseLineageVersion(version);
  if (!channel) {
    throw new Error("Either version or channel is required.");
  }

  const result = await runCommand("npm", ["view", `${LINEAGE_PACKAGE}@${channel}`, "version", "--json"]);
  if (result.status !== 0) {
    throw new Error(`Failed to resolve ${LINEAGE_PACKAGE}@${channel}: ${result.stderr || result.stdout}`);
  }
  return parseLineageVersion(result.stdout);
}

export async function loadPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_PATH);
  const text = await readFile(manifestPath, "utf8");
  return JSON.parse(text);
}

export function assertPluginManifest(manifest, expectedVersion) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Plugin manifest is missing or invalid.");
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`Plugin version ${manifest.version || "<missing>"} does not match ${expectedVersion}.`);
  }
  if (manifest.lineage?.package !== LINEAGE_PACKAGE) {
    throw new Error(`Plugin lineage package must be ${LINEAGE_PACKAGE}.`);
  }
  if (manifest.lineage?.version !== expectedVersion) {
    throw new Error(
      `Plugin lineage version ${manifest.lineage?.version || "<missing>"} does not match ${expectedVersion}.`,
    );
  }
  return manifest;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertChecksum(buffer, expectedSha256) {
  if (!expectedSha256) return sha256(buffer);
  const actual = sha256(buffer);
  if (actual !== expectedSha256) {
    throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actual}.`);
  }
  return actual;
}

export function parseChecksumText(text) {
  const match = String(text || "").match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) {
    throw new Error("Checksum file does not contain a sha256 hash.");
  }
  return match[0].toLowerCase();
}

export function pluginArtifactFilename(version) {
  return `${PLUGIN_ARTIFACT_NAME}-${version}.tgz`;
}

export function releaseArtifactUrls({
  version,
  githubRepo = DEFAULT_GITHUB_REPO,
  releaseBaseUrl,
} = {}) {
  if (!version) throw new Error("version is required.");
  const base =
    releaseBaseUrl ||
    `https://github.com/${githubRepo}/releases/download/v${version}`;
  const artifactUrl = `${base.replace(/\/$/, "")}/${pluginArtifactFilename(version)}`;
  return {
    artifactUrl,
    checksumUrl: `${artifactUrl}.sha256`,
  };
}

export function defaultTargetRoot() {
  return path.join(homedir(), ".codex", "plugins", "local");
}

export async function installPluginDirectory({
  pluginDir,
  targetRoot = defaultTargetRoot(),
  expectedVersion,
  dryRun = false,
} = {}) {
  if (!pluginDir) throw new Error("pluginDir is required.");
  if (!expectedVersion) throw new Error("expectedVersion is required.");

  const manifest = assertPluginManifest(await loadPluginManifest(pluginDir), expectedVersion);
  const destination = path.join(targetRoot, manifest.name);

  const plan = {
    ok: true,
    dryRun,
    plugin: manifest.name,
    pluginVersion: manifest.version,
    lineagePackage: manifest.lineage.package,
    lineageVersion: manifest.lineage.version,
    source: path.resolve(pluginDir),
    destination,
  };

  if (dryRun) return plan;

  await mkdir(targetRoot, { recursive: true });
  const lock = path.join(targetRoot, `.${manifest.name}.install.lock`);
  const staging = path.join(targetRoot, `.${manifest.name}.staging-${randomUUID()}`);
  const backup = path.join(targetRoot, `.${manifest.name}.install-backup`);
  const lockOwner = `${process.pid}:${randomUUID()}`;
  await acquireInstallLock(lock, lockOwner, manifest.name, targetRoot);
  let movedExisting = false;
  let placedDestination = false;
  try {
    const backupExists = await pathExists(backup);
    const destinationExists = await pathExists(destination);
    if (backupExists && !destinationExists) {
      await rename(backup, destination);
    } else if (backupExists) {
      assertPluginManifest(await loadPluginManifest(destination), expectedVersion);
      await rm(backup, { recursive: true, force: true });
    }
    await cp(pluginDir, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: isAllowedInstallPath,
    });
    assertPluginManifest(await loadPluginManifest(staging), expectedVersion);
    try {
      await rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, destination);
    placedDestination = true;
    assertPluginManifest(await loadPluginManifest(destination), expectedVersion);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (placedDestination) await rm(destination, { recursive: true, force: true });
    if (movedExisting) {
      await rename(backup, destination);
    }
    throw error;
  } finally {
    await releaseInstallLock(lock, lockOwner);
  }

  return plan;
}

export async function installFromOptions(options = {}) {
  const expectedVersion = await resolveLineageVersion(options);
  if (options.pluginDir) {
    return installPluginDirectory({
      pluginDir: options.pluginDir,
      targetRoot: options.targetRoot,
      expectedVersion,
      dryRun: options.dryRun,
    });
  }

  return installPluginArtifact({
    artifactFile: options.artifactFile,
    checksumFile: options.checksumFile,
    artifactUrl: options.artifactUrl,
    checksumUrl: options.checksumUrl,
    releaseBaseUrl: options.releaseBaseUrl,
    githubRepo: options.githubRepo,
    targetRoot: options.targetRoot,
    expectedVersion,
    dryRun: options.dryRun,
    fetchBytes: options.fetchBytes,
  });
}

export async function installPluginArtifact({
  artifactFile,
  checksumFile,
  artifactUrl,
  checksumUrl,
  releaseBaseUrl,
  githubRepo,
  targetRoot,
  expectedVersion,
  dryRun = false,
  fetchBytes = fetchBytesFromUrl,
} = {}) {
  if (!expectedVersion) throw new Error("expectedVersion is required.");

  const resolvedUrls =
    artifactUrl || artifactFile
      ? { artifactUrl, checksumUrl }
      : releaseArtifactUrls({ version: expectedVersion, githubRepo, releaseBaseUrl });
  const artifactBytes = await readArtifactBytes({
    artifactFile,
    artifactUrl: resolvedUrls.artifactUrl,
    fetchBytes,
  });
  const expectedSha256 = await readExpectedChecksum({
    checksumFile,
    checksumUrl: resolvedUrls.checksumUrl,
    fetchBytes,
  });
  const checksum = assertChecksum(artifactBytes, expectedSha256);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lineage-plugin-artifact-"));

  try {
    const artifactPath = path.join(tempRoot, pluginArtifactFilename(expectedVersion));
    await writeFile(artifactPath, artifactBytes);
    assertSafeTarballEntries(artifactPath);
    extractTarball(artifactPath, tempRoot);
    const pluginDir = path.join(tempRoot, "package");
    const result = await installPluginDirectory({
      pluginDir,
      targetRoot,
      expectedVersion,
      dryRun,
    });
    return {
      ...result,
      checksum,
      artifact: artifactFile ? path.resolve(artifactFile) : resolvedUrls.artifactUrl,
      checksumSource: checksumFile ? path.resolve(checksumFile) : resolvedUrls.checksumUrl,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function fetchBytesFromUrl(url) {
  if (!url) throw new Error("url is required.");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readArtifactBytes({ artifactFile, artifactUrl, fetchBytes }) {
  if (artifactFile) return readFile(artifactFile);
  if (artifactUrl) return fetchBytes(artifactUrl);
  throw new Error("artifactFile or artifactUrl is required.");
}

async function readExpectedChecksum({ checksumFile, checksumUrl, fetchBytes }) {
  if (checksumFile) return parseChecksumText(await readFile(checksumFile, "utf8"));
  if (checksumUrl) return parseChecksumText((await fetchBytes(checksumUrl)).toString("utf8"));
  throw new Error("checksumFile or checksumUrl is required.");
}

function extractTarball(artifactPath, destination) {
  const result = spawnSync("tar", ["-xzf", artifactPath, "-C", destination], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract plugin artifact: ${result.stderr || result.stdout}`);
  }
}

function assertSafeTarballEntries(artifactPath) {
  const result = spawnSync("tar", ["-tzf", artifactPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect plugin artifact: ${result.stderr || result.stdout}`);
  }

  const unsafe = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => {
      const normalized = entry.split(path.sep).join("/");
      return (
        path.isAbsolute(entry) ||
        normalized.split("/").includes("..") ||
        /(^|\/)(node_modules|docs\/goals|\.git|\.asset-scratch|.*\.sqlite|.*\.db)(\/|$)/.test(normalized)
      );
    });

  if (unsafe.length > 0) {
    throw new Error(`Plugin artifact contains unsafe entries: ${unsafe.join(", ")}`);
  }
}

export function runCommandSync(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function acquireInstallLock(lock, owner, pluginName, targetRoot) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await symlink(owner, lock);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existingOwner;
      try {
        existingOwner = await readlink(lock);
      } catch (readError) {
        throw new Error(`Another ${pluginName} install is already active at ${targetRoot}.`, { cause: readError });
      }
      const pid = Number.parseInt(existingOwner.split(":", 1)[0], 10);
      if (!Number.isInteger(pid) || pid <= 0 || isProcessAlive(pid)) {
        throw new Error(`Another ${pluginName} install is already active at ${targetRoot}.`, { cause: error });
      }
      await rm(lock, { force: true });
    }
  }
  throw new Error(`Could not acquire the ${pluginName} install lock at ${targetRoot}.`);
}

async function releaseInstallLock(lock, owner) {
  try {
    if ((await readlink(lock)) === owner) await rm(lock, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isAllowedInstallPath(source) {
  const normalized = source.split(path.sep).join("/");
  return !/(^|\/)(node_modules|docs\/goals|\.git|\.asset-scratch)(\/|$)/.test(normalized);
}
