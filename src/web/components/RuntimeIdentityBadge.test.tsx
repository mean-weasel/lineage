import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { RuntimeIdentityBadge } from './Topbar';

describe('RuntimeIdentityBadge', () => {
  it('renders the exact profile identity supplied by the runtime API contract', () => {
    const runtime: LineageRuntimeInfo = {
      asset_root: '/test/media',
      channel: 'dev',
      cli: { launcher: 'npm run lineage:dev --', runtime_selector: "--profile '/tmp/dev/profile.json'" },
      database: { exists: true, path: '/test/lineage.sqlite' },
      fetchedAt: '2026-07-14T00:00:00.000Z',
      package_name: '@mean-weasel/lineage',
      profile: {
        bound: true,
        environment: 'development',
        id: 'development-main',
        service_origin: 'http://lineage-dev.localhost:5198',
      },
      schema: {
        migration_keys: [],
        profile_environment: 'development',
        profile_id: 'development-main',
      },
      version: '0.1.11',
    };

    const html = renderToStaticMarkup(<RuntimeIdentityBadge runtime={runtime} />);

    expect(html).toContain('aria-label="Lineage development profile development-main"');
    expect(html).toContain('data-profile-id="development-main"');
    expect(html).toContain('<strong>DEVELOPMENT</strong>');
    expect(html).toContain('<span>development-main</span>');
  });

  it('makes legacy-unbound and unavailable identities prominent', () => {
    const legacy: LineageRuntimeInfo = {
      asset_root: '/test/media',
      channel: 'stable',
      cli: { launcher: 'lineage-stable', runtime_selector: "--db '/test/lineage.sqlite'" },
      database: { exists: false, path: '/test/lineage.sqlite' },
      fetchedAt: '2026-07-14T00:00:00.000Z',
      package_name: '@mean-weasel/lineage',
      profile: {
        bound: false,
        environment: 'production',
        id: 'legacy-unbound',
        warning: 'Legacy unbound runtime',
      },
      schema: { migration_keys: [] },
      version: '0.1.11',
    };

    expect(renderToStaticMarkup(<RuntimeIdentityBadge runtime={legacy} />)).toContain('legacy-unbound · UNBOUND');
    expect(renderToStaticMarkup(<RuntimeIdentityBadge runtime={null} unavailable />)).toContain('IDENTITY UNAVAILABLE');
  });
});
