import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';
import { landingMedia } from './landingMedia';

describe('Lineage landing page', () => {
  it('uses the approved messaging and renders the active media slots', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('The UX where humans and agents shape visual work together.');
    expect(html).toContain('Lineage is the shared visual workspace where humans and agents create, review, and evolve creative assets together.');
    expect(html).toContain('Chat is the right UX for directing agent-driven creative work.');
    expect(html).toContain('But it isn’t built to hold the state of that work.');
    expect(html).toContain('One creative state for humans and agents.');
    expect(html).toContain('Lineage preserves every asset, path, prompt, relationship, and decision in a shared record—precise enough for agents to retrieve through the CLI and organized visually for humans to review and direct.');
    expect(html).toContain('Never lose the state behind the work.');
    expect(html).toContain('Every asset, path, prompt, iteration, and relationship stays available so the work can continue accurately.');
    expect(html).toContain('Keep your creative history organized.');
    expect(html).toContain('Review and compare the history, then use selections and annotations to direct the next iteration.');
    expect(html).toContain('Assets + context');
    expect(html).toContain('Selections + annotations');
    expect(html).toContain('Your creative history, ready to continue.');
    expect(html).not.toContain('The agent writes the work into Lineage.');
    expect(html).not.toContain('Not another generation graph.');
    expect((html.match(/<section/g) ?? []).length).toBe(3);

    for (const id of ['hero-board', 'selection-to-codex', 'reroll-loop'] as const) {
      expect(landingMedia[id]).toBeDefined();
      expect(html).toContain(`data-media-slot="${id}"`);
    }
    expect(html).not.toContain('data-media-slot="attempt-history"');
  });

  it('links to the public repository and exposes the documented install command', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('https://github.com/mean-weasel/lineage');
    expect(html).toContain('npm install -g @mean-weasel/lineage@latest');
  });
});
