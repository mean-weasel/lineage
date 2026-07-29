import { appName } from '../shared/appConstants';
import type { LineageRuntimeInfo } from '../shared/runtimeInfoTypes';
import { lineageReleaseInfo } from './releaseInfo';

export function buildAboutLineageDiagnostics(
  runtime: LineageRuntimeInfo | null,
  runtimeIdentityUnavailable: boolean
): string {
  const unavailable = runtimeIdentityUnavailable || !runtime;
  const revision = runtime?.code?.git_sha || runtime?.git_sha || 'Unavailable';
  return [
    `${appName} diagnostics`,
    `Version: ${lineageReleaseInfo.version}`,
    `Release channel: ${lineageReleaseInfo.channel}`,
    `Runtime channel: ${unavailable ? 'Unavailable' : runtime.channel}`,
    `Environment: ${unavailable ? 'Unavailable' : runtime.profile.environment}`,
    `Profile: ${unavailable ? 'Unavailable' : runtime.profile.id}`,
    `Revision: ${unavailable ? 'Unavailable' : revision}`,
    `Code origin: ${unavailable ? 'Unavailable' : runtime.code?.origin || 'Unavailable'}`,
  ].join('\n');
}
