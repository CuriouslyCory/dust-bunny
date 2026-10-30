/**
 * `pnpm cap:check [ios|android]`: after `cap sync`, checks that every model `public/models/manifest.json`
 * lists (the manifest included) is in the native projects' copy of the web build, so the apps never
 * fall back to procedural models for a file that was left out. Unless VITE_E2E is set (the
 * `cap:*:test` scripts), it also refuses a sync an E2E build left behind: `[e2e]` code in the web
 * build, or cleartext / mixed content allowed in `capacitor.config.json`. Run it before archiving a
 * release. Exit code 1 lists the problems.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { missingModels, NATIVE_CONFIG_FILES, NATIVE_MODEL_DIRS, releaseSyncProblems, type NativePlatform } from '../src/native/build';
import { manifestModelFiles } from '../src/pwa/rules';

const arg = process.argv[2];
if (arg !== undefined && !(arg in NATIVE_MODEL_DIRS)) {
  console.error(`Usage: pnpm cap:check [${Object.keys(NATIVE_MODEL_DIRS).join('|')}]`);
  process.exit(2);
}
const platforms = (arg ? [arg] : Object.keys(NATIVE_MODEL_DIRS)) as NativePlatform[];
const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as Record<string, unknown>;
const files = ['manifest.json', ...manifestModelFiles(manifest)];
const release = !process.env.VITE_E2E;

/** The synced web build's text files (path, contents), for the E2E check. */
function* webBuildTexts(dir: string): Generator<[string, string]> {
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(js|html|css|json)$/.test(e.name)) {
      const path = join(e.parentPath, e.name);
      yield [path, readFileSync(path, 'utf8')];
    }
  }
}

let failed = false;
for (const platform of platforms) {
  const dir = NATIVE_MODEL_DIRS[platform];
  const missing = missingModels(files, dir, existsSync);
  if (missing.length) {
    failed = true;
    console.error(`✗ ${platform}: ${missing.length} of ${files.length} model files missing from ${dir} (run \`pnpm cap:sync\`):`);
    for (const f of missing) console.error(`    ${f}`);
  } else console.log(`✓ ${platform}: all ${files.length - 1} models and the manifest are in ${dir}`);
  if (!release) continue;
  const configFile = NATIVE_CONFIG_FILES[platform];
  const config = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
  const webDir = dirname(dir);
  const problems = releaseSyncProblems(config, existsSync(webDir) ? webBuildTexts(webDir) : []);
  if (problems.length) {
    failed = true;
    console.error(`✗ ${platform}: not a release sync (run \`pnpm cap:sync\` without VITE_E2E):`);
    for (const p of problems) console.error(`    ${p}`);
  } else console.log(`✓ ${platform}: release sync (no E2E code, no cleartext or mixed content)`);
}
process.exit(failed ? 1 : 0);
