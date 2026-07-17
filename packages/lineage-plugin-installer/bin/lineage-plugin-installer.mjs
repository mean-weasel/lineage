#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { installFromOptions } from "../src/installer.mjs";

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0])) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
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
    json: { type: "boolean", default: false },
  },
});

const command = positionals[0] || "install";

if (command !== "install") {
  console.error(`Unsupported command: ${command}`);
  process.exit(2);
}

try {
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
