#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({ binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' });
