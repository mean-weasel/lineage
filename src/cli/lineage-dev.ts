#!/usr/bin/env node

import { runLineageCli } from './lineageCli';

runLineageCli({ binName: 'lineage-dev', channel: 'development', defaultPort: 5198, displayName: 'Lineage Dev' });
