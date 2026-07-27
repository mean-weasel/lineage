import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const STATIC_IMAGE_MAX_PIXELS = 100_000_000;

type SupportedStaticImageFormat = 'jpeg' | 'png' | 'webp';

export interface StaticImageMetadata {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  format: SupportedStaticImageFormat;
  height: number;
  width: number;
}

class StaticImageMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaticImageMetadataError';
  }
}

const decoderScript = String.raw`
const sharp = require(process.argv[1]);
const file = process.argv[2];
(async () => {
  const image = sharp(file, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 100000000,
    sequentialRead: true
  });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new Error('unsupported decoded format: ' + (metadata.format || 'unknown'));
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw new Error('decoded dimensions are unavailable');
  }
  if (metadata.width * metadata.height > 100000000) {
    throw new Error('decoded image exceeds the 100000000-pixel safety limit');
  }
  if ((metadata.pages || 1) !== 1) {
    throw new Error('animated images are not supported');
  }
  await image.stats();
  process.stdout.write(JSON.stringify({
    format: metadata.format,
    width: metadata.width,
    height: metadata.height
  }));
})().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});`;

function contentType(format: SupportedStaticImageFormat): StaticImageMetadata['contentType'] {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  return 'image/webp';
}

export function readStaticImageMetadata(filePath: string): StaticImageMetadata {
  const sharpModule = createRequire(import.meta.url).resolve('sharp');
  const result = spawnSync(process.execPath, ['-e', decoderScript, sharpModule, filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024,
    timeout: 30_000,
  });
  if (result.error) {
    throw new StaticImageMetadataError(`Unable to decode static image: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `decoder exited with status ${result.status ?? 'unknown'}`;
    throw new StaticImageMetadataError(`Unable to decode supported PNG, JPEG, or WebP bytes: ${detail}`);
  }
  try {
    const decoded = JSON.parse(result.stdout) as { format?: unknown; width?: unknown; height?: unknown };
    if (
      (decoded.format !== 'png' && decoded.format !== 'jpeg' && decoded.format !== 'webp')
      || !Number.isInteger(decoded.width)
      || !Number.isInteger(decoded.height)
    ) {
      throw new Error('decoder returned invalid metadata');
    }
    const width = Number(decoded.width);
    const height = Number(decoded.height);
    if (width * height > STATIC_IMAGE_MAX_PIXELS) {
      throw new Error(`decoded image exceeds the ${STATIC_IMAGE_MAX_PIXELS}-pixel safety limit`);
    }
    return { contentType: contentType(decoded.format), format: decoded.format, height, width };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StaticImageMetadataError(`Unable to decode static image metadata: ${detail}`);
  }
}
