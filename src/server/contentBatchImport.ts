import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { repoRoot } from './assetCore';
import { attachContentPostAsset, createContentBatch, createContentPost } from './contentBatches';
import type { ContentPostPhase } from '../shared/types';

type ImportKind = 'all' | 'concepts' | 'drafts';

interface MarkdownItem {
  body: string;
  campaign?: string;
  channel: string;
  cta?: string;
  kind: 'concept' | 'draft';
  postId: string;
  relatedAsset?: string;
  sourcePath: string;
  title: string;
  phase: ContentPostPhase;
}

export interface ContentImportOptions {
  batchId: string;
  confirmWrite: boolean;
  campaign?: string;
  kind?: ImportKind;
  title?: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

function metadata(text: string): Record<string, string> {
  return Object.fromEntries(
    [...text.matchAll(/^- ([^:]+):\s*(.+)$/gm)].map(match => [match[1].trim().toLowerCase(), match[2].trim()])
  );
}

function normalizeChannel(value: string): string {
  const channel = value.trim().toLowerCase();
  if (channel === 'linkedin') return 'linkedin';
  if (channel === 'tiktok') return 'tiktok';
  if (channel === 'youtube') return 'youtube';
  if (channel === 'meta') return 'meta';
  if (channel === 'x/twitter' || channel === 'twitter' || channel === 'x') return 'x-twitter';
  return channel;
}

function phaseFromStatus(value?: string): ContentPostPhase {
  const phase = value?.trim().toLowerCase().replace(/-/g, '_');
  if (phase === 'review' || phase === 'scheduled' || phase === 'posted' || phase === 'skipped' || phase === 'archived') return phase;
  return 'draft';
}

function postIdFor(kind: MarkdownItem['kind'], file: string): string {
  const slug = basename(file, '.md').replace(/^\d{4}-\d{2}-/, '');
  return `${kind}-${slug}`;
}

function itemFromFile(file: string): MarkdownItem | null {
  const parts = file.split('/');
  const kind = parts.includes('drafts') ? 'draft' : parts.includes('concepts') ? 'concept' : null;
  if (!kind) return null;
  const text = readFileSync(file, 'utf8');
  const meta = metadata(text);
  const pathChannel = parts[parts.indexOf('channels') + 1] || '';
  const relatedAsset = meta['related asset'] && meta['related asset'] !== 'none yet' ? meta['related asset'] : undefined;
  return {
    body: text,
    campaign: meta.campaign,
    channel: normalizeChannel(meta.channel || pathChannel),
    cta: meta.cta,
    kind,
    phase: phaseFromStatus(meta.status),
    postId: postIdFor(kind, file),
    relatedAsset,
    sourcePath: relative(repoRoot, file),
    title: text.match(/^#\s+(.+)$/m)?.[1] || basename(file, '.md'),
  };
}

function demoMarkdownItems(kind: ImportKind): MarkdownItem[] {
  const root = join(repoRoot, 'demo-project', 'channels');
  if (!existsSync(root)) return [];
  return walk(root)
    .map(itemFromFile)
    .filter((item): item is MarkdownItem => Boolean(item))
    .filter(item => kind === 'all' || `${item.kind}s` === kind)
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export function importDemoContentBatch(project: string, options: ContentImportOptions) {
  const kind = options.kind || 'all';
  const items = demoMarkdownItems(kind);
  const batch = {
    batchId: options.batchId,
    campaign: options.campaign || '2026-06-organic-traffic-test',
    confirmWrite: options.confirmWrite,
    notes: `Imported ${kind} from demo-project/channels markdown.`,
    title: options.title || 'Demo imported content batch',
  };
  if (!options.confirmWrite) {
    return { ok: true, dryRun: true, batch, counts: countsFor(items), items: previewItems(items) };
  }
  createContentBatch(project, batch);
  let attached = 0;
  for (const item of items) {
    createContentPost(project, {
      batchId: options.batchId,
      body: item.body,
      campaign: item.campaign || batch.campaign,
      channel: item.channel,
      confirmWrite: true,
      cta: item.cta,
      notes: `Imported ${item.kind} from ${item.sourcePath}`,
      phase: item.phase,
      postId: item.postId,
      sourcePath: item.sourcePath,
      title: item.title,
    });
    if (item.relatedAsset) {
      attachContentPostAsset(project, { assetId: item.relatedAsset, confirmWrite: true, postId: item.postId, role: 'related' });
      attached += 1;
    }
  }
  return { ok: true, batch_id: options.batchId, counts: { ...countsFor(items), attached }, items: previewItems(items) };
}

function countsFor(items: MarkdownItem[]) {
  return {
    concepts: items.filter(item => item.kind === 'concept').length,
    drafts: items.filter(item => item.kind === 'draft').length,
    total: items.length,
  };
}

function previewItems(items: MarkdownItem[]) {
  return items.map(item => ({
    channel: item.channel,
    kind: item.kind,
    phase: item.phase,
    post_id: item.postId,
    related_asset: item.relatedAsset,
    source_path: item.sourcePath,
    title: item.title,
  }));
}
