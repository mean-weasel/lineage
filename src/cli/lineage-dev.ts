#!/usr/bin/env node

import { runLineageCli } from './lineageCli';
import { getLineageCodeIdentity } from '../server/runtimeInfo';

const identity = getLineageCodeIdentity('dev');
if (!identity.verified) {
  console.error(`lineage-dev: published package execution is disabled. ${identity.errors.join('; ')}. Run dev from a Git checkout with npm run lineage:dev -- <command>.`);
  process.exit(1);
}

const preview = process.env.LINEAGE_CHANNEL === 'preview';
await runLineageCli({
  binName: 'lineage-dev',
  channel: preview ? 'preview' : 'dev',
  defaultHost: preview ? 'lineage-preview.localhost' : 'lineage-dev.localhost',
  defaultPort: preview ? 5199 : 5198,
  displayName: preview ? 'Lineage Preview' : 'Lineage Dev',
});
