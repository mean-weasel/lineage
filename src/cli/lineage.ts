#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({ binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' });
