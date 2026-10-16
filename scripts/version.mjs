// App version for builds: APP_VERSION / GIT_SHA from the environment (CI, Docker),
// otherwise `git describe` / `git rev-parse` if available, otherwise "dev" / "unknown".
import { execSync } from 'node:child_process';

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export const appVersion = process.env.APP_VERSION || git('describe --tags --always') || 'dev';
export const gitSha = process.env.GIT_SHA || git('rev-parse HEAD') || 'unknown';
