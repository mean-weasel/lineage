#!/usr/bin/env node

import { runLineageCli } from './lineageCli';
import { getLineageCodeIdentity } from '../server/runtimeInfo';

const identity = getLineageCodeIdentity('dev');
if (!identity.verified) {
  console.error(`lineage-dev: published package execution is disabled. ${identity.errors.join('; ')}. Run dev from a Git checkout with npm run lineage:dev -- <command>.`);
  process.exit(1);
}

runLineageCli({ binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' });
