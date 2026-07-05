#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({ binName: 'lineage-dev', channel: 'development', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' });
