import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from './assetCore';

export const richDemoWorkspaceTitle = 'Bleep LinkedIn dogfood round 02 grounded';
export const richDemoWorkspaceNotes = 'Grounded redo using actual Bleep app screenshots and feature copy. A is canvas root; B and C are linked sibling candidates for first selection.';
export const richDemoRootId = 'local-e88bc3fcd9e8';
export const richDemoSelectedId = 'local-0809da1e2b16';

export const richBleepDemoAssets = [
  ['local-e88bc3fcd9e8', '2026-06-organic-traffic-test/linkedin/dogfood-round-02-grounded/bleep-linkedin-grounded-02-a-click-words.png', 'bleep linkedin grounded 02 a click words', 'linkedin'],
  ['local-1116b236b91f', '2026-06-organic-traffic-test/linkedin/dogfood-round-02-grounded/bleep-linkedin-grounded-02-b-clean-version.png', 'bleep linkedin grounded 02 b clean version', 'linkedin'],
  ['local-4f03cc9d3167', '2026-06-organic-traffic-test/linkedin/dogfood-round-02-grounded/bleep-linkedin-grounded-02-c-four-steps.png', 'bleep linkedin grounded 02 c four steps', 'linkedin'],
  ['local-ea014f2c4f3c', '2026-06-organic-traffic-test/linkedin/dogfood-round-03-from-four-steps/bleep-linkedin-four-steps-03-a-tie-dye.png', 'bleep linkedin four steps 03 a tie dye', 'linkedin'],
  ['local-30cdcc36a905', '2026-06-organic-traffic-test/linkedin/dogfood-round-03-from-four-steps/bleep-linkedin-four-steps-03-b-galaxy.png', 'bleep linkedin four steps 03 b galaxy', 'linkedin'],
  ['local-1dfee19b46c9', '2026-06-organic-traffic-test/linkedin/dogfood-round-03-from-four-steps/bleep-linkedin-four-steps-03-c-professional.png', 'bleep linkedin four steps 03 c professional', 'linkedin'],
  ['local-91aceacac023', '2026-06-organic-traffic-test/linkedin/dogfood-round-05-from-selected-bases/bleep-linkedin-four-steps-05-a-ink-spotlight.png', 'bleep linkedin four steps 05 a ink spotlight', 'linkedin'],
  ['local-a0985efd423c', '2026-06-organic-traffic-test/linkedin/dogfood-round-05-from-selected-bases/bleep-linkedin-four-steps-05-b-clean-cream.png', 'bleep linkedin four steps 05 b clean cream', 'linkedin'],
  ['local-d3ad426056e4', '2026-06-organic-traffic-test/linkedin/dogfood-round-04-from-tie-dye/bleep-linkedin-tie-dye-04-a-warm-retro.png', 'bleep linkedin tie dye 04 a warm retro', 'linkedin'],
  ['local-172e9746b365', '2026-06-organic-traffic-test/linkedin/dogfood-round-04-from-tie-dye/bleep-linkedin-tie-dye-04-b-clean-pastel.png', 'bleep linkedin tie dye 04 b clean pastel', 'linkedin'],
  ['local-0809da1e2b16', '2026-06-organic-traffic-test/linkedin/dogfood-round-04-from-tie-dye/bleep-linkedin-tie-dye-04-c-bold-modern.png', 'bleep linkedin tie dye 04 c bold modern', 'linkedin'],
  ['local-65d75a099472', '2026-06-organic-traffic-test/linkedin/dogfood-adapter-proof/bleep-linkedin-adapter-proof-a.png', 'bleep linkedin adapter proof a', 'linkedin'],
  ['local-f3c9c34561d1', '2026-06-organic-traffic-test/linkedin/dogfood-adapter-proof/bleep-linkedin-adapter-proof-b.png', 'bleep linkedin adapter proof b', 'linkedin'],
  ['local-8b7197033c82', '2026-06-organic-traffic-test/linkedin/dogfood-round-06-multi-selected/bleep-linkedin-round-06-from-0809-bold-modern.png', 'bleep linkedin round 06 from 0809 bold modern', 'linkedin'],
  ['local-e91bd9cf8d03', '2026-06-organic-traffic-test/linkedin/dogfood-round-05-from-selected-bases/bleep-linkedin-tie-dye-05-a-cyan-spotlight.png', 'bleep linkedin tie dye 05 a cyan spotlight', 'linkedin'],
  ['local-74022111747a', '2026-06-organic-traffic-test/linkedin/dogfood-round-05-from-selected-bases/bleep-linkedin-tie-dye-05-b-warm-editorial.png', 'bleep linkedin tie dye 05 b warm editorial', 'linkedin'],
  ['local-fc9e0f674209', '2026-06-organic-traffic-test/linkedin/dogfood-round-06-multi-selected/bleep-linkedin-round-06-from-7402-warm-editorial.png', 'bleep linkedin round 06 from 7402 warm editorial', 'linkedin'],
  ['local-e0df9b84d830', '2026-06-organic-traffic-test/linkedin/dogfood-round-06-multi-selected/bleep-linkedin-round-06-from-e91b-cyan-spotlight.png', 'bleep linkedin round 06 from e91b cyan spotlight', 'linkedin'],
  ['local-91b283023699', '2026-06-organic-traffic-test/linkedin/dogfood-round-07-from-warm-editorial/bleep-linkedin-round-07-warm-editorial-cleaner.png', 'bleep linkedin round 07 warm editorial cleaner', 'linkedin'],
] as const;

export const richDemoEdges = [
  ['local-e88bc3fcd9e8', 'local-1116b236b91f'],
  ['local-e88bc3fcd9e8', 'local-4f03cc9d3167'],
  ['local-4f03cc9d3167', 'local-ea014f2c4f3c'],
  ['local-4f03cc9d3167', 'local-30cdcc36a905'],
  ['local-4f03cc9d3167', 'local-1dfee19b46c9'],
  ['local-4f03cc9d3167', 'local-91aceacac023'],
  ['local-4f03cc9d3167', 'local-a0985efd423c'],
  ['local-ea014f2c4f3c', 'local-d3ad426056e4'],
  ['local-ea014f2c4f3c', 'local-172e9746b365'],
  ['local-ea014f2c4f3c', 'local-0809da1e2b16'],
  ['local-0809da1e2b16', 'local-65d75a099472'],
  ['local-0809da1e2b16', 'local-f3c9c34561d1'],
  ['local-0809da1e2b16', 'local-8b7197033c82'],
  ['local-0809da1e2b16', 'local-e91bd9cf8d03'],
  ['local-0809da1e2b16', 'local-74022111747a'],
  ['local-e91bd9cf8d03', 'local-e0df9b84d830'],
  ['local-74022111747a', 'local-fc9e0f674209'],
  ['local-fc9e0f674209', 'local-91b283023699'],
] as const;

function richAssetRoot(): string {
  return process.env.ASSET_STUDIO_RICH_SEED_ASSET_ROOT || join(repoRoot, '.asset-scratch');
}

export function richAssetPath(localPath: string): string {
  return join(richAssetRoot(), localPath);
}

function richSeedFixturePath(localPath: string): string {
  return join(repoRoot, 'asset-studio', 'fixtures', 'bleep-rich-seed-media', localPath);
}

function missingRichDemoFiles(): string[] {
  return richBleepDemoAssets.map(asset => asset[1]).filter(localPath => !existsSync(richAssetPath(localPath)));
}

export function restoreRichBleepSeedMedia(fields: { confirmWrite: boolean } = { confirmWrite: false }) {
  const missing = missingRichDemoFiles();
  const unavailable = missing.filter(localPath => !existsSync(richSeedFixturePath(localPath)));
  if (!fields.confirmWrite) {
    return { ok: unavailable.length === 0, dryRun: true as const, media_root: richAssetRoot(), missing, unavailable, would_restore: missing.length - unavailable.length };
  }
  if (unavailable.length > 0) throw new Error(`Missing committed rich Bleep seed media fixtures: ${unavailable.slice(0, 3).join(', ')}`);
  for (const localPath of missing) {
    const target = richAssetPath(localPath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(richSeedFixturePath(localPath), target);
  }
  return { ok: true as const, media_root: richAssetRoot(), restored: missing.length, total: richBleepDemoAssets.length };
}

export function richBleepSeedMediaStatus() {
  const missing = missingRichDemoFiles();
  const unavailable = richBleepDemoAssets.map(asset => asset[1]).filter(localPath => !existsSync(richSeedFixturePath(localPath)));
  return {
    ok: missing.length === 0 && unavailable.length === 0,
    media_root: richAssetRoot(),
    present: richBleepDemoAssets.length - missing.length,
    total: richBleepDemoAssets.length,
    missing,
    fixture_present: richBleepDemoAssets.length - unavailable.length,
    fixture_total: richBleepDemoAssets.length,
    fixture_missing: unavailable,
  };
}

export function requireRichDemoFiles() {
  const restored = restoreRichBleepSeedMedia({ confirmWrite: true });
  const missing = missingRichDemoFiles();
  if (missing.length > 0) throw new Error(`Missing rich Bleep seed screenshots after media restore: ${missing.slice(0, 3).join(', ')}`);
  return restored;
}
