#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assertPluginManifest, loadPluginManifest } from "../src/installer.mjs";

if (isCliEntry()) {
  const { values } = parseArgs({
    options: {
      plugin: { type: "string" },
      version: { type: "string" },
      "out-dir": { type: "string", default: "dist" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  try {
    const result = await packPlugin({
      plugin: values.plugin,
      version: values.version,
      outDir: values["out-dir"],
      dryRun: values["dry-run"],
    });
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.dryRun ? "Would pack" : "Packed"} ${result.artifactName}`);
    }
  } catch (error) {
    if (values.json) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

export async function packPlugin({
  plugin,
  version,
  outDir = "dist",
  dryRun = false,
} = {}) {
  if (!plugin) throw new Error("--plugin is required.");
  if (!version) throw new Error("--version is required.");

  const pluginDir = path.resolve(plugin);
  const manifest = assertPluginManifest(await loadPluginManifest(pluginDir), version);
  const args = ["pack", "--json"];
  if (dryRun) {
    args.push("--dry-run");
  } else {
    await mkdir(path.resolve(outDir), { recursive: true });
    args.push("--pack-destination", path.resolve(outDir));
  }

  const result = spawnSync("npm", args, {
    cwd: pluginDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
  }

  const [packResult] = JSON.parse(result.stdout);
  const files = packResult.files.map((file) => file.path);
  assertNoForbiddenFiles(files);

  const artifactName = `${manifest.name}-${version}.tgz`;
  const response = {
    ok: true,
    dryRun,
    plugin: manifest.name,
    version,
    lineagePackage: manifest.lineage.package,
    lineageVersion: manifest.lineage.version,
    artifactName,
    files,
  };

  if (!dryRun) {
    const artifactPath = path.join(path.resolve(outDir), packResult.filename);
    const artifact = await readFile(artifactPath);
    const checksum = createHash("sha256").update(artifact).digest("hex");
    await writeFile(`${artifactPath}.sha256`, `${checksum}  ${packResult.filename}\n`);
    response.artifactPath = artifactPath;
    response.sha256 = checksum;
  }

  return response;
}

function assertNoForbiddenFiles(files) {
  const forbidden = files.filter((file) =>
    /(^|\/)(node_modules|docs\/goals|\.git|\.asset-scratch|.*\.sqlite|.*\.db)(\/|$)/.test(file),
  );
  if (forbidden.length > 0) {
    throw new Error(`Plugin artifact contains forbidden files: ${forbidden.join(", ")}`);
  }
}

function isCliEntry() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
