import type {
  DeliverySurfaceRecord,
  DeliverySurfaceSnapshot,
  GeometryProfileRecord,
  GeometryProfileSnapshot,
  OutputTargetChoice,
  OutputTargetRegistry,
} from './outputTargetTypes';
import { OUTPUT_TARGET_REGISTRY_SCHEMA, OutputTargetResolutionError } from './outputTargetTypes';

const VERIFIED_AT = '2026-07-27';

const geometries: readonly GeometryProfileRecord[] = [
  ['static-image.1080x1080', 1080, 1080],
  ['static-image.1080x1440', 1080, 1440],
  ['static-image.1080x1920', 1080, 1920],
  ['static-image.1200x628', 1200, 628],
  ['static-image.1200x1200', 1200, 1200],
  ['static-image.720x900', 720, 900],
  ['static-image.1000x1500', 1000, 1500],
  ['static-image.1440x1800', 1440, 1800],
  ['static-image.720x1280', 720, 1280],
  ['static-image.720x720', 720, 720],
].map(([id, width, height]) => Object.freeze({
  id: String(id), version: 1, media_kind: 'static_image' as const, width: Number(width), height: Number(height),
}));

type Seed = [id: string, platform: string, surface: string, geometry: string, source: string, aliases?: string[]];
const seeds: Seed[] = [
  ['instagram.feed_square', 'Instagram', 'Feed square', 'static-image.1080x1080', 'https://www.facebook.com/help/1631821640426723/', ['instagram square']],
  ['instagram.feed_portrait', 'Instagram', 'Feed portrait', 'static-image.1080x1440', 'https://www.facebook.com/help/1631821640426723/', ['instagram portrait']],
  ['instagram.story', 'Instagram', 'Story', 'static-image.1080x1920', 'https://www.facebook.com/help/instagram/192168966243613', ['instagram stories']],
  ['facebook.story', 'Facebook', 'Story', 'static-image.1080x1920', 'https://www.facebook.com/business/ads/stories-ad-format', ['facebook stories']],
  ['linkedin.single_image_landscape', 'LinkedIn', 'Single-image landscape', 'static-image.1200x628', 'https://business.linkedin.com/advertise/ads/sponsored-content/single-image-ads-specs'],
  ['linkedin.single_image_square', 'LinkedIn', 'Single-image square', 'static-image.1200x1200', 'https://business.linkedin.com/advertise/ads/sponsored-content/single-image-ads-specs'],
  ['linkedin.single_image_portrait', 'LinkedIn', 'Single-image portrait', 'static-image.720x900', 'https://business.linkedin.com/advertise/ads/sponsored-content/single-image-ads-specs'],
  ['pinterest.standard_pin', 'Pinterest', 'Standard Pin', 'static-image.1000x1500', 'https://business.pinterest.com/creative-best-practices/'],
  ['x.standalone_square', 'X', 'Standalone image square', 'static-image.1200x1200', 'https://business.x.com/en/help/campaign-setup/creative-ad-specifications'],
  ['x.standalone_landscape', 'X', 'Standalone image landscape', 'static-image.1200x628', 'https://business.x.com/en/help/campaign-setup/creative-ad-specifications'],
  ['x.standalone_portrait', 'X', 'Standalone image portrait', 'static-image.1440x1800', 'https://business.x.com/en/help/campaign-setup/creative-ad-specifications'],
  ['x.standalone_vertical', 'X', 'Standalone image vertical', 'static-image.1080x1920', 'https://business.x.com/en/help/campaign-setup/creative-ad-specifications'],
  ['tiktok.carousel_vertical', 'TikTok', 'Standard carousel vertical', 'static-image.720x1280', 'https://ads.tiktok.com/help/article/specifications-for-carousel-ads?lang=en'],
  ['google_business.profile_photo_square', 'Google Business', 'Profile photo square', 'static-image.720x720', 'https://support.google.com/business/answer/6123536?hl=en'],
];

const surfaces: readonly DeliverySurfaceRecord[] = seeds.map(([id, platform, surface, geometry, source, aliases = []]) => Object.freeze({
  id,
  version: 1,
  platform,
  surface,
  media_kind: 'static_image' as const,
  geometry_profile_id: geometry,
  geometry_profile_version: 1,
  aliases: Object.freeze([id, `${platform} ${surface}`, ...aliases]) as unknown as string[],
  guidance: Object.freeze([]) as unknown as string[],
  source_url: source,
  source_verified_at: VERIFIED_AT,
  lifecycle: 'active' as const,
}));

export const outputTargetRegistry: OutputTargetRegistry = Object.freeze({
  schema_version: OUTPUT_TARGET_REGISTRY_SCHEMA,
  geometries: Object.freeze(geometries),
  surfaces: Object.freeze(surfaces),
});

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');
}

export function geometrySnapshot(id: string, version: number): GeometryProfileSnapshot {
  const record = outputTargetRegistry.geometries.find(item => item.id === id && item.version === version);
  if (!record) throw new OutputTargetResolutionError('unknown_surface', `Unknown geometry profile ${id}@${version}`);
  return structuredClone(record);
}

export function surfaceSnapshot(id: string, version: number): DeliverySurfaceSnapshot {
  const record = outputTargetRegistry.surfaces.find(item => item.id === id && item.version === version);
  if (!record) throw new OutputTargetResolutionError('unknown_surface', `Unknown delivery surface ${id}@${version}`);
  return {
    id: record.id,
    version: record.version,
    platform: record.platform,
    surface: record.surface,
    media_kind: record.media_kind,
    geometry: geometrySnapshot(record.geometry_profile_id, record.geometry_profile_version),
    guidance: [...record.guidance],
    source_url: record.source_url,
    source_verified_at: record.source_verified_at,
    lifecycle: record.lifecycle,
    ...(record.replacement ? { replacement: { ...record.replacement } } : {}),
  };
}

function choice(record: DeliverySurfaceRecord): OutputTargetChoice {
  const geometry = geometrySnapshot(record.geometry_profile_id, record.geometry_profile_version);
  return {
    surface_id: record.id, surface_version: record.version, platform: record.platform,
    surface: record.surface, width: geometry.width, height: geometry.height,
  };
}

export function resolveDeliverySurface(reference: {
  platform?: string;
  surface?: string;
  surface_id?: string;
  surface_version?: number;
}): DeliverySurfaceSnapshot {
  if (reference.surface_id) return surfaceSnapshot(reference.surface_id, reference.surface_version ?? 1);
  const platformName = normalized(reference.platform || '');
  const platformMatches = outputTargetRegistry.surfaces.filter(item => normalized(item.platform) === platformName && item.lifecycle !== 'removed');
  if (platformMatches.length === 0) throw new OutputTargetResolutionError('unknown_platform', `Unknown output platform: ${reference.platform || ''}`);
  if (!reference.surface) {
    if (platformMatches.length !== 1) {
      throw new OutputTargetResolutionError(
        'ambiguous_platform',
        `${platformMatches[0].platform} requires an explicit delivery surface`,
        platformMatches.map(choice),
      );
    }
    return surfaceSnapshot(platformMatches[0].id, platformMatches[0].version);
  }
  const surfaceName = normalized(reference.surface);
  const match = platformMatches.find(item =>
    normalized(item.surface) === surfaceName || item.aliases.some(alias => normalized(alias) === surfaceName),
  );
  if (!match) {
    throw new OutputTargetResolutionError(
      'unknown_surface',
      `Unknown ${platformMatches[0].platform} delivery surface: ${reference.surface}`,
      platformMatches.map(choice),
    );
  }
  return surfaceSnapshot(match.id, match.version);
}

export function customGeometrySnapshot(width: number, height: number): GeometryProfileSnapshot {
  if (
    !Number.isInteger(width) || !Number.isInteger(height)
    || width < 16 || width > 16_384 || height < 16 || height > 16_384
    || width * height > 100_000_000
  ) {
    throw new OutputTargetResolutionError(
      'invalid_custom_geometry',
      'Custom static-image dimensions must be integer sides from 16 through 16384 with area at most 100000000 pixels',
    );
  }
  return { id: `custom.static_image.${width}x${height}`, version: 1, media_kind: 'static_image', width, height };
}
