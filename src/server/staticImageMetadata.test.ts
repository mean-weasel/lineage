import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readStaticImageMetadata } from './staticImageMetadata';

describe('static image metadata', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('decodes %s from bytes even with a misleading extension', async (format, contentType) => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const file = join(directory, `valid-${format}.video`);
    await sharp({
      create: { background: '#23574a', channels: 4, height: 19, width: 23 },
    })[format]().toFile(file);

    expect(readStaticImageMetadata(file)).toEqual({ contentType, format, height: 19, width: 23 });
  });

  it('rejects truncated and corrupt bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const valid = join(directory, 'valid.png');
    const truncated = join(directory, 'truncated.png');
    const corrupt = join(directory, 'corrupt.png');
    await sharp({
      create: { background: '#23574a', channels: 4, height: 19, width: 23 },
    }).png().toFile(valid);
    const bytes = readFileSync(valid);
    writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    writeFileSync(corrupt, Buffer.from('not an image'));

    expect(() => readStaticImageMetadata(truncated)).toThrow(/Unable to decode supported PNG, JPEG, or WebP bytes/);
    expect(() => readStaticImageMetadata(corrupt)).toThrow(/Unable to decode supported PNG, JPEG, or WebP bytes/);
  });

  it.each([
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="19"></svg>'],
    ['GIF', 'GIF89a'],
    ['video', '....ftypmp42'],
  ])('rejects unsupported %s bytes', (_label, bytes) => {
    const directory = mkdtempSync(join(tmpdir(), 'lineage-static-image-'));
    const file = join(directory, 'spoofed.png');
    writeFileSync(file, bytes);
    expect(() => readStaticImageMetadata(file)).toThrow(/supported PNG, JPEG, or WebP bytes/);
  });
});
