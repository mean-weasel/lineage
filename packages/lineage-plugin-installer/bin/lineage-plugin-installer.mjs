#!/usr/bin/env node
import { parseArgs } from "node:util";
import { installFromOptions } from "../src/installer.mjs";

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
    dryRun: values["dry-run"],
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const mode = result.dryRun ? "Would install" : "Installed";
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
