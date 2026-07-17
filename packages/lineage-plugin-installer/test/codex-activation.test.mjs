import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CODEX_MARKETPLACE_NAME,
  CODEX_PLUGIN_ID,
  MARKETPLACE_MANIFEST_PATH,
  createMarketplaceManifest,
  defaultMarketplaceRoot,
  installPluginMarketplace,
} from "../src/installer.mjs";

const pluginDir = path.resolve("../../plugins/lineage-codex-plugin");
const expectedVersion = JSON.parse(
  await readFile(path.join(pluginDir, ".codex-plugin", "plugin.json"), "utf8"),
).version;

test("marketplace metadata points at the packaged plugin within its root", () => {
  assert.deepEqual(createMarketplaceManifest(), {
    name: "lineage",
    interface: { displayName: "Lineage" },
    plugins: [
      {
        name: "lineage-codex-plugin",
        source: { source: "local", path: "./plugins/lineage-codex-plugin" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  });
});

test("activation dry-run reports registration without writing or invoking Codex", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");
  const fake = createFakeCodex();

  try {
    const result = await installPluginMarketplace({
      pluginDir,
      expectedVersion,
      codexHome,
      dryRun: true,
      runCodex: fake.run,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.activated, false);
    assert.equal(result.marketplaceRoot, defaultMarketplaceRoot(codexHome));
    assert.deepEqual(result.registration, [
      ["codex", "plugin", "marketplace", "add", defaultMarketplaceRoot(codexHome), "--json"],
      ["codex", "plugin", "add", CODEX_PLUGIN_ID, "--json"],
    ]);
    assert.equal(fake.calls.length, 0);
    await assert.rejects(stat(codexHome), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("activation installs, registers, enables, and cleanly reinstalls one verified tree", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");
  const fake = createFakeCodex();

  try {
    const first = await installPluginMarketplace({
      pluginDir,
      expectedVersion,
      codexHome,
      runCodex: fake.run,
    });
    const second = await installPluginMarketplace({
      pluginDir,
      expectedVersion,
      codexHome,
      runCodex: fake.run,
    });

    assert.equal(first.activated, true);
    assert.equal(second.activated, true);
    assert.equal(fake.marketplaceRoot, defaultMarketplaceRoot(codexHome));
    assert.equal(fake.installed, true);
    assert.equal(fake.enabled, true);
    assert.equal(fake.version, expectedVersion);
    const marketplace = JSON.parse(
      await readFile(path.join(defaultMarketplaceRoot(codexHome), MARKETPLACE_MANIFEST_PATH), "utf8"),
    );
    assert.deepEqual(marketplace, createMarketplaceManifest());
    const manifest = JSON.parse(
      await readFile(path.join(first.destination, ".codex-plugin", "plugin.json"), "utf8"),
    );
    assert.equal(manifest.version, expectedVersion);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("activation restores filesystem and Codex state when plugin registration partially fails", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");
  const fake = createFakeCodex();

  try {
    await installPluginMarketplace({ pluginDir, expectedVersion, codexHome, runCodex: fake.run });
    const marker = path.join(defaultMarketplaceRoot(codexHome), "prior-install-marker.txt");
    await writeFile(marker, "prior verified root\n");
    fake.partialPluginAddFailures = 1;

    await assert.rejects(
      installPluginMarketplace({ pluginDir, expectedVersion, codexHome, runCodex: fake.run }),
      /Failed to install the Lineage plugin/,
    );

    assert.equal(await readFile(marker, "utf8"), "prior verified root\n");
    assert.equal(fake.marketplaceRoot, defaultMarketplaceRoot(codexHome));
    assert.equal(fake.installed, true);
    assert.equal(fake.enabled, true);
    assert.equal(fake.version, expectedVersion);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("activation removes newly-created marketplace and plugin state after a partial first-install failure", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");
  const fake = createFakeCodex({ partialPluginAddFailures: 1 });

  try {
    await assert.rejects(
      installPluginMarketplace({ pluginDir, expectedVersion, codexHome, runCodex: fake.run }),
      /Failed to install the Lineage plugin/,
    );

    await assert.rejects(stat(defaultMarketplaceRoot(codexHome)), /ENOENT/);
    assert.equal(fake.marketplaceRoot, null);
    assert.equal(fake.installed, false);
    assert.equal(fake.enabled, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("activation removes a newly-created Codex home when CLI preflight fails", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");

  try {
    await assert.rejects(
      installPluginMarketplace({
        pluginDir,
        expectedVersion,
        codexHome,
        runCodex: () => ({ status: 1, stdout: "", stderr: "codex unavailable" }),
      }),
      /codex unavailable/,
    );
    await assert.rejects(stat(codexHome), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("activation rolls back when Codex reports an installed version mismatch", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-codex-activation-"));
  const codexHome = path.join(temp, "codex-home");
  const fake = createFakeCodex({ listVersionOverride: "0.0.0-mismatch" });

  try {
    await assert.rejects(
      installPluginMarketplace({ pluginDir, expectedVersion, codexHome, runCodex: fake.run }),
      /Codex plugin state.*0\.0\.0-mismatch/,
    );
    await assert.rejects(stat(defaultMarketplaceRoot(codexHome)), /ENOENT/);
    assert.equal(fake.marketplaceRoot, null);
    assert.equal(fake.installed, false);
    assert.equal(fake.enabled, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function createFakeCodex(options = {}) {
  const state = {
    calls: [],
    marketplaceRoot: options.marketplaceRoot || null,
    installed: options.installed || false,
    enabled: options.enabled || false,
    version: options.version || expectedVersion,
    partialPluginAddFailures: options.partialPluginAddFailures || 0,
    listVersionOverride: options.listVersionOverride || null,
  };

  state.run = (_command, args, options = {}) => {
    state.calls.push({ args: [...args], codexHome: options.codexHome });
    const key = args.slice(0, 3).join(" ");
    if (key === "plugin marketplace list") {
      return ok({
        marketplaces: state.marketplaceRoot
          ? [{ name: CODEX_MARKETPLACE_NAME, root: state.marketplaceRoot }]
          : [],
      });
    }
    if (key === "plugin list --available") {
      const plugin = {
        pluginId: CODEX_PLUGIN_ID,
        version: state.listVersionOverride || state.version,
        installed: state.installed,
        enabled: state.enabled,
      };
      return ok({
        installed: state.installed ? [plugin] : [],
        available: state.marketplaceRoot && !state.installed ? [plugin] : [],
      });
    }
    if (key === "plugin marketplace add") {
      state.marketplaceRoot = path.resolve(args[3]);
      return ok({ marketplaceName: CODEX_MARKETPLACE_NAME, installedRoot: state.marketplaceRoot });
    }
    if (args[0] === "plugin" && args[1] === "add") {
      state.installed = true;
      state.enabled = true;
      state.version = expectedVersion;
      if (state.partialPluginAddFailures > 0) {
        state.partialPluginAddFailures -= 1;
        return { status: 1, stdout: "", stderr: "simulated partial plugin add failure" };
      }
      return ok({ pluginId: CODEX_PLUGIN_ID, version: state.version });
    }
    if (args[0] === "plugin" && args[1] === "remove") {
      state.installed = false;
      state.enabled = false;
      return ok({ pluginId: CODEX_PLUGIN_ID });
    }
    if (key === "plugin marketplace remove") {
      state.marketplaceRoot = null;
      return ok({ marketplaceName: CODEX_MARKETPLACE_NAME });
    }
    return { status: 1, stdout: "", stderr: `unexpected fake Codex args: ${args.join(" ")}` };
  };
  return state;
}

function ok(value) {
  return { status: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}
