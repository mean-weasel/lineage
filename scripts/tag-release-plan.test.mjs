import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { planTagRelease } from './tag-release-plan.mjs';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsRoot);

function metadata(version = '1.2.3') {
  return {
    changelog: `# Changelog\n\n## ${version}\n\n- Release notes.\n`,
    packageInfo: { name: '@mean-weasel/lineage', version },
    packageLock: { version, packages: { '': { version } } },
    pluginManifest: {
      version,
      lineage: { package: '@mean-weasel/lineage', version },
    },
    pluginPackage: { version },
    tag: `v${version}`,
  };
}

test('maps a stable version tag to npm latest and a full GitHub release', () => {
  assert.deepEqual(planTagRelease(metadata()), {
    github_channel: 'latest',
    github_prerelease: false,
    npm_tag: 'latest',
    package: '@mean-weasel/lineage',
    tag: 'v1.2.3',
    version: '1.2.3',
  });
});

test('maps a prerelease version tag to npm next and a GitHub prerelease', () => {
  assert.deepEqual(planTagRelease(metadata('1.2.3-rc.1')), {
    github_channel: 'next',
    github_prerelease: true,
    npm_tag: 'next',
    package: '@mean-weasel/lineage',
    tag: 'v1.2.3-rc.1',
    version: '1.2.3-rc.1',
  });
});

test('rejects a tag that does not exactly match package.json', () => {
  assert.throws(
    () => planTagRelease({ ...metadata(), tag: 'v1.2.4' }),
    /must exactly match v1\.2\.3/,
  );
});

test('rejects version drift across release metadata', () => {
  const input = metadata();
  input.packageLock.packages[''].version = '1.2.2';
  input.pluginManifest.lineage.version = '1.2.2';
  assert.throws(
    () => planTagRelease(input),
    /package-lock root package version does not match[\s\S]*plugin lineage\.version does not match/,
  );
});

test('rejects an unsupported release version or missing changelog section', () => {
  const input = metadata('1.2');
  input.changelog = '# Changelog\n';
  assert.throws(
    () => planTagRelease(input),
    /Invalid release version[\s\S]*CHANGELOG\.md is missing/,
  );
});

test('release mutation refuses direct execution without the exact tag authority', () => {
  const result = spawnSync(process.execPath, [join(scriptsRoot, 'release.mjs'), '--tag', 'latest', '--skip-ci'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, LINEAGE_RELEASE_TAG: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing npm mutation outside the tag-triggered Release workflow/);
});

test('legacy dist-tag promotion fails closed', () => {
  const result = spawnSync(process.execPath, [join(scriptsRoot, 'release.mjs'), '--promote-latest', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Dist-tag promotion is no longer a release authority/);
});

test('GitHub release mutation refuses direct execution without the exact tag authority', () => {
  const result = spawnSync(process.execPath, [
    join(scriptsRoot, 'sync-github-release.mjs'),
    '--channel', 'latest',
    '--target', 'HEAD',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, LINEAGE_RELEASE_TAG: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing GitHub release mutation outside the tag-triggered Release workflow/);
});
