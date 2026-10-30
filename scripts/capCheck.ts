/**
 * `pnpm cap:check [ios|android]`: after `cap sync`, checks that every model `public/models/manifest.json`
 * lists (the manifest included) is in the native projects' copy of the web build, so the apps never
 * fall back to procedural models for a file that was left out. Exit code 1 lists what is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { missingModels, NATIVE_MODEL_DIRS, type NativePlatform } from '../src/native/build';
import { manifestModelFiles } from '../src/pwa/rules';

const arg = process.argv[2];
if (arg !== undefined && !(arg in NATIVE_MODEL_DIRS)) {
  console.error(`Usage: pnpm cap:check [${Object.keys(NATIVE_MODEL_DIRS).join('|')}]`);
  process.exit(2);
}
const platforms = (arg ? [arg] : Object.keys(NATIVE_MODEL_DIRS)) as NativePlatform[];
const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as Record<string, unknown>;
const files = ['manifest.json', ...manifestModelFiles(manifest)];

let failed = false;
for (const platform of platforms) {
  const dir = NATIVE_MODEL_DIRS[platform];
  const missing = missingModels(files, dir, existsSync);
  if (missing.length) {
    failed = true;
    console.error(`✗ ${platform}: ${missing.length} of ${files.length} model files missing from ${dir} (run \`pnpm cap:sync\`):`);
    for (const f of missing) console.error(`    ${f}`);
  } else console.log(`✓ ${platform}: all ${files.length - 1} models and the manifest are in ${dir}`);
}
process.exit(failed ? 1 : 0);
