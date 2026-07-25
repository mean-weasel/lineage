import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        capability: z.enum(['cloud-storage', 'social-scheduling', 'image-generation']).optional(),
        currentProviders: z.array(z.string()).optional(),
        liveBehavior: z.enum(['available', 'disabled', 'handoff']).optional(),
        maturity: z.enum(['Available', 'Preview', 'Planned']).optional(),
        providerIds: z.array(z.enum(['s3', 'buffer', 'codex-handoff'])).optional(),
      }),
    }),
  }),
};
