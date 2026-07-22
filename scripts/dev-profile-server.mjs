import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { assertLineageCodeOrigin, getLineageRuntimeInfo } from '../src/server/runtimeInfo.ts';
import { assertProfileChannel, doctorLineageProfile, resolveLineageProfile } from '../src/server/lineageProfiles.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function readOption(name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(`lineage dev: ${message}`);
  process.exit(1);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run dev -- --profile <development-profile>');
  process.exit(0);
}

const unknownArgs = args.filter((arg, index) => {
  if (arg === '--profile') return false;
  if (index > 0 && args[index - 1] === '--profile') return false;
  return !arg.startsWith('--profile=');
});
if (unknownArgs.length > 0) fail(`Unknown option: ${unknownArgs[0]}`);

const optionProfile = readOption('--profile');
if (args.includes('--profile') && !optionProfile) fail('--profile requires a value');
if (optionProfile && process.env.LINEAGE_PROFILE && optionProfile !== process.env.LINEAGE_PROFILE) {
  fail(`--profile ${optionProfile} conflicts with LINEAGE_PROFILE ${process.env.LINEAGE_PROFILE}`);
}
const selector = optionProfile || process.env.LINEAGE_PROFILE;
if (!selector) {
  fail('A named development profile is required before any port or database is opened. Create one with `npm run lineage:dev -- profile init --profile <id> --confirm-write`, then run `npm run dev -- --profile <id>`.');
}

process.env.LINEAGE_CHANNEL = 'dev';

let profile;
let runtime;
try {
  const code = assertLineageCodeOrigin('dev');
  profile = resolveLineageProfile(selector);
  assertProfileChannel(profile, 'dev');
  runtime = getLineageRuntimeInfo({ channel: 'dev', code, dbPath: profile.database_path });
  const doctor = doctorLineageProfile(selector, {
    channel: 'dev',
    code: runtime.code,
    gitSha: runtime.git_sha,
    version: runtime.version,
  });
  if (!doctor.ok) {
    const failures = doctor.checks
      .filter(check => check.status === 'fail')
      .map(check => `${check.id}: ${check.message}`)
      .join('; ');
    fail(`Profile ${profile.profile_id} failed doctor: ${failures}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const serviceUrl = new URL(profile.service_origin);
const port = serviceUrl.port || '80';
const serviceInstanceId = randomUUID();
console.log(`Lineage Dev hot reload starting at ${profile.service_origin}`);
console.log(`Profile: ${profile.profile_id} (${profile.environment})`);
console.log(`SQLite: ${profile.database_path}`);
console.log(`Assets: ${profile.asset_root}`);

const child = spawn(join(packageRoot, 'node_modules', '.bin', 'tsx'), [join(packageRoot, 'src', 'server.ts')], {
  cwd: packageRoot,
  env: {
    ...process.env,
    HOST: serviceUrl.hostname,
    LINEAGE_ASSET_ROOT: profile.asset_root,
    LINEAGE_CHANNEL: 'dev',
    LINEAGE_DB: profile.database_path,
    LINEAGE_DB_ACCESS: undefined,
    LINEAGE_LAUNCHER_PID: String(process.pid),
    LINEAGE_PROFILE: selector,
    LINEAGE_PROFILE_ENVIRONMENT: profile.environment,
    LINEAGE_PROFILE_FINGERPRINT: profile.profile_fingerprint,
    LINEAGE_PROFILE_ID: profile.profile_id,
    LINEAGE_PROFILE_MANIFEST: profile.manifest_path,
    LINEAGE_PROFILE_SERVICE_ORIGIN: profile.service_origin,
    LINEAGE_SERVICE_INSTANCE_ID: serviceInstanceId,
    NODE_ENV: 'development',
    PORT: port,
  },
  stdio: 'inherit',
});

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let forwardedSignal;
const stop = signal => {
  forwardedSignal = signal;
  child.kill(signal);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', error => fail(`failed to start source server: ${error.message}`));
child.once('exit', code => process.exit(code ?? (forwardedSignal ? signalExitCodes[forwardedSignal] : 1)));
