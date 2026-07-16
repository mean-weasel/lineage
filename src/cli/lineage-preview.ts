#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({
  binName: 'lineage-preview',
  channel: 'preview',
  defaultHost: 'lineage-preview.localhost',
  defaultPort: 5199,
  displayName: 'Lineage Preview',
});
