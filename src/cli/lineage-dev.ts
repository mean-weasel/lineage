#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

const preview = process.env.LINEAGE_CHANNEL === 'preview';
await runLineageCli({
  binName: 'lineage-dev',
  channel: preview ? 'preview' : 'dev',
  defaultHost: preview ? 'lineage-preview.localhost' : 'lineage-dev.localhost',
  defaultPort: preview ? 5199 : 5198,
  displayName: preview ? 'Lineage Preview' : 'Lineage Dev',
});
