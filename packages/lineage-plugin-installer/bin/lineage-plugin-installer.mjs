#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { doctorPluginInstallation, installFromOptions } from "../src/installer.mjs";

const rawArgs = process.argv.slice(2);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function usage() {
  return `lineage-plugin-installer ${packageJson.version}

Usage:
  lineage-plugin-installer install [--channel latest|next|<tag> | --version <version>] [--codex-home <path>] [--dry-run] [--json]
  lineage-plugin-installer install --version <version> --target-dir <path> [--plugin <path> | --artifact-file <path> --checksum-file <path>] [--dry-run] [--json]
  lineage-plugin-installer doctor [--channel latest|next|<tag> | --version <version>] [--codex-home <path>] [--json]
  lineage-plugin-installer --help
  lineage-plugin-installer --version

Install activates the exact version-locked plugin in the selected Codex home.
--target-dir is a files-only mode and cannot be combined with --codex-home.
Doctor is read-only and checks Codex registration, marketplace root, installed
and enabled state, and the on-disk plugin manifest.`;
}

if (rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0])) {
  console.log(packageJson.version);
  process.exit(0);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    channel: { type: "string" },
    version: { type: "string" },
    plugin: { type: "string" },
    "artifact-file": { type: "string" },
    "checksum-file": { type: "string" },
    "artifact-url": { type: "string" },
    "checksum-url": { type: "string" },
    "release-base-url": { type: "string" },
    "github-repo": { type: "string" },
    "target-dir": { type: "string" },
    "codex-home": { type: "string" },
    "no-activate": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    json: { type: "boolean", default: false },
  },
});

const command = positionals[0] || "install";

if (values.help) {
  console.log(usage());
  process.exit(0);
}

if (!["install", "doctor"].includes(command)) {
  console.error(`Unsupported command: ${command}`);
  process.exit(2);
}

try {
  if (command === "doctor") {
    const result = await doctorPluginInstallation({
      channel: values.channel,
      version: values.version,
      codexHome: values["codex-home"],
    });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Lineage plugin doctor: ${result.ok ? "ok" : "failed"}`);
      console.log(`Codex home: ${result.codexHome}`);
      for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    }
    process.exit(result.ok ? 0 : 1);
  }
  const result = await installFromOptions({
    channel: values.channel,
    version: values.version,
    pluginDir: values.plugin,
    artifactFile: values["artifact-file"],
    checksumFile: values["checksum-file"],
    artifactUrl: values["artifact-url"],
    checksumUrl: values["checksum-url"],
    releaseBaseUrl: values["release-base-url"],
    githubRepo: values["github-repo"],
    targetRoot: values["target-dir"],
    codexHome: values["codex-home"],
    activate: values["no-activate"] ? false : undefined,
    dryRun: values["dry-run"],
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const mode = result.dryRun ? "Would install" : result.activated ? "Installed and activated" : "Installed files for";
    console.log(`${mode} ${result.plugin}@${result.pluginVersion} for ${result.lineagePackage}@${result.lineageVersion}`);
    if (result.codexHome) console.log(`Codex home: ${result.codexHome}`);
    console.log(result.destination);
  }
} catch (error) {
  if (values.json) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
