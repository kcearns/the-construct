// Build the Rust game core to WASM and generate JS bindings into site/pkg.
// Run with `npm run build`. Requires the wasm32 target and wasm-bindgen CLI
// (see README, Prerequisites).
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const core = join(root, 'core');
const outDir = join(root, 'site', 'pkg');
const wasm = join(core, 'target', 'wasm32-unknown-unknown', 'release', 'matrix_core.wasm');

// Strip local filesystem paths (home dir, crate dir) from panic-location
// strings embedded in the binary so the published .wasm carries no machine info.
const rustflags = [
  `--remap-path-prefix=${homedir()}=/~`,
  `--remap-path-prefix=${core}=/core`,
  process.env.RUSTFLAGS ?? '',
].join(' ').trim();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: core, ...opts });
  if (r.error) { console.error(`failed to start ${cmd}: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { env: { ...process.env, RUSTFLAGS: rustflags } });
run('wasm-bindgen', ['--target', 'web', '--out-dir', outDir, '--out-name', 'matrix_core', wasm]);

const kb = (statSync(join(outDir, 'matrix_core_bg.wasm')).size / 1024).toFixed(1);
console.log(`site/pkg/matrix_core_bg.wasm  ${kb} KB`);
