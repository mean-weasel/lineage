import type { AdapterProvider, AdapterType } from './adapterSettingsTypes';

type DocumentationMaturity = 'Available' | 'Preview' | 'Planned';
type AdapterLiveBehavior = 'available' | 'disabled' | 'handoff';

export interface AdapterCatalogEntry {
  adapterType: AdapterType;
  capabilityId: 'cloud-storage' | 'social-scheduling' | 'image-generation';
  capabilityLabel: string;
  description: string;
  docsSlug: string;
  liveBehavior: AdapterLiveBehavior;
  maturity: DocumentationMaturity;
  providerId: AdapterProvider;
  providerLabel: string;
}

/**
 * Public-safe adapter metadata shared by application settings and documentation
 * validation. Keep credentials, project configuration, and execution logic out
 * of this catalog.
 */
const adapterCatalogJson = `[
  {
    "adapterType": "cloud",
    "capabilityId": "cloud-storage",
    "capabilityLabel": "Cloud storage",
    "description": "Inspect and back up approved assets with an explicitly configured cloud storage provider.",
    "docsSlug": "integrations/cloud-storage",
    "liveBehavior": "available",
    "maturity": "Available",
    "providerId": "s3",
    "providerLabel": "Amazon S3"
  },
  {
    "adapterType": "scheduler",
    "capabilityId": "social-scheduling",
    "capabilityLabel": "Social scheduling",
    "description": "Prepare and validate reviewed social posts for an external scheduler without publishing them live.",
    "docsSlug": "integrations/social-scheduling",
    "liveBehavior": "disabled",
    "maturity": "Preview",
    "providerId": "buffer",
    "providerLabel": "Buffer"
  },
  {
    "adapterType": "image_generator",
    "capabilityId": "image-generation",
    "capabilityLabel": "Image generation",
    "description": "Create Codex generation handoffs and durable import receipts without embedding a model service.",
    "docsSlug": "integrations/image-generation",
    "liveBehavior": "handoff",
    "maturity": "Available",
    "providerId": "codex-handoff",
    "providerLabel": "Codex handoff"
  }
]`;

export const adapterCatalog = JSON.parse(adapterCatalogJson) as readonly AdapterCatalogEntry[];

export function findAdapterCatalogEntry(adapterType: AdapterType, providerId: AdapterProvider): AdapterCatalogEntry {
  const entry = adapterCatalog.find(item => item.adapterType === adapterType && item.providerId === providerId);
  if (!entry) throw new Error(`Missing public adapter catalog entry: ${adapterType}/${providerId}`);
  return entry;
}
