import type express from 'express';
import type { LineageRuntimeChannel } from '../shared/runtimeInfoTypes';
import type { ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import { AgentClaimError, type AgentClaim } from './agentClaims';
import type { ProfileWriterLease } from './profileWriterLease';
import { getProfileWriterDelegation } from './profileWriterLease';

export const managedWriterRequestSchemaVersion = 'lineage.managed_writer_request.v1' as const;
const managedWriterResponseSchemaVersion = 'lineage.managed_writer_response.v1' as const;
export const managedWriterRoute = '/api/managed-writer/execute' as const;
const delegationHeader = 'X-Lineage-Writer-Delegation';

interface ManagedWriterIdentity {
  channel: LineageRuntimeChannel;
  environment: ResolvedLineageProfile['environment'];
  profile_id: string;
  service_origin: string;
}

interface ManagedWriterRequest {
  args: string[];
  channel: LineageRuntimeChannel;
  command: string;
  environment: ResolvedLineageProfile['environment'];
  profile_id: string;
  schema_version: typeof managedWriterRequestSchemaVersion;
  service_origin: string;
}

interface ManagedWriterResponse {
  ok: true;
  result: unknown;
  schema_version: typeof managedWriterResponseSchemaVersion;
  service: ManagedWriterIdentity;
}

export class ManagedWriterRoutingError extends Error {
  constructor(message: string, public readonly status = 409, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ManagedWriterRoutingError';
  }
}

export function isManagedWriterRoutingError(error: unknown): error is ManagedWriterRoutingError {
  return error instanceof ManagedWriterRoutingError;
}

export function managedWriterTimeoutMs(command: string, args: string[]): number {
  const subcommand = args.find(arg => !arg.startsWith('-')) || '';
  return command === 'reroll' && subcommand === 'import' ? 5 * 60_000 : 30_000;
}

function requestBody(value: unknown): ManagedWriterRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedWriterRoutingError('Managed writer request must be a JSON object', 400);
  }
  const body = value as Partial<ManagedWriterRequest>;
  if (body.schema_version !== managedWriterRequestSchemaVersion) {
    throw new ManagedWriterRoutingError(`Unsupported managed writer request schema: ${String(body.schema_version)}`, 400);
  }
  if (typeof body.command !== 'string' || !body.command || !Array.isArray(body.args) || body.args.some(arg => typeof arg !== 'string')) {
    throw new ManagedWriterRoutingError('Managed writer request requires a command and string args', 400);
  }
  if (
    typeof body.profile_id !== 'string'
    || typeof body.channel !== 'string'
    || typeof body.environment !== 'string'
    || typeof body.service_origin !== 'string'
  ) {
    throw new ManagedWriterRoutingError('Managed writer request requires profile identity', 400);
  }
  return body as ManagedWriterRequest;
}

function containsProtectedOverride(args: string[]): boolean {
  return args.some(arg => arg === '--db' || arg.startsWith('--db=')
    || arg === '--asset-root' || arg.startsWith('--asset-root=')
    || arg === '--profile' || arg.startsWith('--profile='));
}

export function registerManagedWriterRoute(
  app: express.Express,
  fields: {
    channel: LineageRuntimeChannel;
    accepts: (command: string, args: string[]) => boolean;
    execute: (command: string, args: string[]) => unknown;
    profile?: ResolvedLineageProfile;
    writerLease?: ProfileWriterLease;
  },
): void {
  app.post(managedWriterRoute, (req, res, next) => {
    try {
      if (!fields.profile || !fields.writerLease) {
        throw new ManagedWriterRoutingError('Managed writer delegation is unavailable for an unprofiled service', 404);
      }
      if (!fields.writerLease.authenticate(req.header(delegationHeader))) {
        throw new ManagedWriterRoutingError('Managed writer delegation was not authorized', 401);
      }
      const body = requestBody(req.body);
      if (
        body.profile_id !== fields.profile.profile_id
        || body.channel !== fields.channel
        || body.environment !== fields.profile.environment
        || body.service_origin !== fields.profile.service_origin
      ) {
        throw new ManagedWriterRoutingError('Managed writer request profile/service identity does not match this service', 409);
      }
      if (containsProtectedOverride(body.args)) {
        throw new ManagedWriterRoutingError('Managed writer requests cannot override profile, database, or asset root', 400);
      }
      if (!fields.accepts(body.command, body.args)) {
        throw new ManagedWriterRoutingError(`Unsupported managed writer command: ${body.command}`, 400);
      }
      const result = fields.execute(body.command, body.args);
      const response: ManagedWriterResponse = {
        ok: true,
        result,
        schema_version: managedWriterResponseSchemaVersion,
        service: {
          channel: fields.channel,
          environment: fields.profile.environment,
          profile_id: fields.profile.profile_id,
          service_origin: fields.profile.service_origin,
        },
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  });
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return fallback;
}

function agentClaimError(body: unknown, status: number): AgentClaimError | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.message !== 'string' || typeof record.error !== 'string') return undefined;
  const conflicts = Array.isArray(record.conflicts) ? record.conflicts as AgentClaim[] : [];
  return new AgentClaimError(record.message, status, record.error, conflicts);
}

function assertResponseIdentity(
  body: unknown,
  profile: ResolvedLineageProfile,
  channel: LineageRuntimeChannel,
): asserts body is ManagedWriterResponse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ManagedWriterRoutingError('Managed writer service returned a non-object response', 502);
  }
  const response = body as Partial<ManagedWriterResponse>;
  if (
    response.ok !== true
    || response.schema_version !== managedWriterResponseSchemaVersion
    || !response.service
    || response.service.profile_id !== profile.profile_id
    || response.service.environment !== profile.environment
    || response.service.service_origin !== profile.service_origin
    || response.service.channel !== channel
  ) {
    throw new ManagedWriterRoutingError('Managed writer response identity does not match the selected profile/service', 502);
  }
}

export async function executeManagedWriterCommand(
  profile: ResolvedLineageProfile,
  channel: LineageRuntimeChannel,
  command: string,
  args: string[],
): Promise<unknown> {
  const delegation = getProfileWriterDelegation(profile);
  let response: Response;
  try {
    response = await fetch(new URL(managedWriterRoute, delegation.service_origin), {
      body: JSON.stringify({
        args,
        channel,
        command,
        environment: profile.environment,
        profile_id: profile.profile_id,
        schema_version: managedWriterRequestSchemaVersion,
        service_origin: profile.service_origin,
      } satisfies ManagedWriterRequest),
      headers: {
        'Content-Type': 'application/json',
        [delegationHeader]: delegation.token,
      },
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(managedWriterTimeoutMs(command, args)),
    });
  } catch (error) {
    throw new ManagedWriterRoutingError(
      `Managed service for Lineage profile ${profile.profile_id} is unavailable or did not respond at ${profile.service_origin}; no direct fallback was attempted and the mutation outcome is unknown`,
      503,
      { cause: error },
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ManagedWriterRoutingError('Managed writer service returned invalid JSON; mutation result is unknown', 502, { cause: error });
  }
  if (!response.ok) {
    const claimError = agentClaimError(body, response.status);
    if (claimError) throw claimError;
    throw new ManagedWriterRoutingError(errorMessage(body, `Managed writer service returned HTTP ${response.status}`), response.status);
  }
  assertResponseIdentity(body, profile, channel);
  return body.result;
}
