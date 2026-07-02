import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const uiFiles = [
  'asset-studio/src/components/LineageView.tsx',
  'asset-studio/src/components/LineageDetailModal.tsx',
  'asset-studio/src/components/LineageSidePanel.tsx',
  'asset-studio/src/components/LineageContextMenu.tsx',
  'asset-studio/src/components/LineageHandoffPanel.tsx',
  'asset-studio/src/components/LineageAssetNode.tsx',
  'asset-studio/src/components/LineageToolbar.tsx',
  'asset-studio/src/components/LineageWorkspacePicker.tsx',
  'asset-studio/src/components/LineageView.css',
  'asset-studio/src/components/LedgerView.tsx',
];

const staleHumanPhrases = [
  'Set next base',
  'Set as next base',
  'Next base selected',
  'Clear selected',
  'Next-base rationale',
  'selected base',
  'Copy base',
  'Agent needs a base',
  'content: "next base"',
  'Create from root',
  'Selection & handoff',
];

describe('Lineage human-facing terminology', () => {
  it('uses next-variation language instead of next-base copy', () => {
    const staleMatches = uiFiles.flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return staleHumanPhrases.flatMap(phrase => source.includes(phrase) ? [`${file}: ${phrase}`] : []);
    });

    expect(staleMatches).toEqual([]);
  });
});
