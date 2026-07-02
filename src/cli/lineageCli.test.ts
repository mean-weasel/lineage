import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveStartOptions } from './lineageCli';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('lineage CLI start options', () => {
  it('uses stable channel defaults with an isolated runtime home', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-home';
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.LINEAGE_DB;

    const options = resolveStartOptions({ binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' }, []);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-home', 'lineage.sqlite'),
      host: '127.0.0.1',
      json: false,
      open: false,
      port: 5197,
    });
  });

  it('keeps the development channel on a separate default port and database', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-dev-home';

    const options = resolveStartOptions({ binName: 'lineage-dev', channel: 'development', defaultPort: 5198, displayName: 'Lineage Dev' }, ['--json']);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-dev-home', 'lineage-dev.sqlite'),
      json: true,
      port: 5198,
    });
  });

  it('accepts explicit host, port, database, and open flags', () => {
    const options = resolveStartOptions(
      { binName: 'lineage', channel: 'stable', defaultPort: 5197, displayName: 'Lineage' },
      ['--host', '0.0.0.0', '--port=6123', '--db', '/tmp/custom.sqlite', '--open']
    );

    expect(options).toMatchObject({
      dbPath: '/tmp/custom.sqlite',
      host: '0.0.0.0',
      open: true,
      port: 6123,
    });
  });
});
