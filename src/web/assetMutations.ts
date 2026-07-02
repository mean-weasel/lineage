import type { MutationResponse } from '../shared/types';
import { api } from './api';

export function postMutation(path: string, project: string, body: Record<string, unknown>) {
  return api<MutationResponse>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, ...body }),
  });
}

export function normalizePlacementValues(values: { scheduledAt?: string; postedAt?: string; url?: string }) {
  return {
    ...values,
    scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
    postedAt: values.postedAt ? new Date(values.postedAt).toISOString() : undefined,
  };
}
