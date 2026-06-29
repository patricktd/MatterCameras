import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'deploy';
const extraArgs = process.argv.slice(3);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, shell: false });
  process.exit(result.status ?? 1);
}

if (process.platform === 'win32') {
  const script = mode === 'quick-deploy' ? 'quick-deploy.ps1' : 'deploy.ps1';
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, script), ...extraArgs]);
}

if (!existsSync(join(root, 'deploy.env'))) {
  console.error('Copy deploy.env.example → deploy.env and set DEPLOY_HOST, DEPLOY_USER, DEPLOY_DIR.');
  process.exit(1);
}

run('npm', ['run', 'build', '--prefix', root]);

const bashScript =
  mode === 'quick-deploy'
    ? join(root, 'scripts/quick-deploy.sh')
    : join(root, 'scripts/deploy.sh');

run('bash', [bashScript, ...extraArgs]);
