export interface LandingMediaDefinition {
  id: 'hero-board' | 'selection-to-codex' | 'reroll-loop' | 'attempt-history';
  eyebrow: string;
  title: string;
  description: string;
  kind: 'image' | 'video';
  src?: string;
  poster?: string;
}

// Add the final public-safe file path to `src` when each launch asset is approved.
// The surrounding layout and accessible description remain stable.
export const landingMedia: Record<LandingMediaDefinition['id'], LandingMediaDefinition> = {
  'hero-board': {
    id: 'hero-board',
    eyebrow: 'Hero canvas · 16:9',
    title: 'The Swissifier — Launch Campaign',
    description: 'A wide reveal of the complete Swissifier lineage board.',
    kind: 'video',
  },
  'selection-to-codex': {
    id: 'selection-to-codex',
    eyebrow: 'Human → agent · 8–14 sec',
    title: 'Choose where to continue',
    description: 'A node selection in Lineage becomes precise context in Codex.',
    kind: 'video',
  },
  'reroll-loop': {
    id: 'reroll-loop',
    eyebrow: 'Two-way loop · 25–40 sec',
    title: 'Ask for another pass',
    description: 'Codex recognizes a re-roll request and records the new attempt.',
    kind: 'video',
  },
  'attempt-history': {
    id: 'attempt-history',
    eyebrow: 'Product still · 4:3',
    title: 'Keep every useful attempt',
    description: 'The current result and previous attempts stay attached to one node.',
    kind: 'image',
  },
};
