import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldRevealCopiedText } from './copyFallback';

describe('shouldRevealCopiedText', () => {
  it('reveals agent handoff commands as a visible fallback', () => {
    expect(shouldRevealCopiedText('next context command', 'npx lineage agent "keep working on my selections"')).toBe(true);
  });

  it('keeps ordinary copied links out of the fallback panel', () => {
    expect(shouldRevealCopiedText('preview link', 'https://example.com/asset.png')).toBe(false);
  });

  it('keeps the Agents view read-only and tokenless', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/AgentsView.tsx'), 'utf8');

    expect(source).toContain('/api/agent-claims');
    expect(source).not.toContain('claim_token');
    expect(source).not.toContain('claimToken');
    expect(source).not.toContain("method: 'POST'");
  });
});
