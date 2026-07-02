import { describe, expect, it } from 'vitest';
import { shouldRevealCopiedText } from './copyFallback';

describe('shouldRevealCopiedText', () => {
  it('reveals agent handoff commands as a visible fallback', () => {
    expect(shouldRevealCopiedText('next context command', 'npm run studio:cli -- agent "keep working on my selections"')).toBe(true);
  });

  it('keeps ordinary copied links out of the fallback panel', () => {
    expect(shouldRevealCopiedText('preview link', 'https://example.com/asset.png')).toBe(false);
  });
});
