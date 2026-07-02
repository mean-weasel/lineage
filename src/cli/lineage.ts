#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({ binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' });
