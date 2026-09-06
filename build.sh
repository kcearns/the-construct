#!/usr/bin/env bash
# Build the Rust game core to WASM and generate JS bindings into site/pkg
set -euo pipefail
cd "$(dirname "$0")/core"
# Strip local filesystem paths (home dir, cargo registry) from panic-location
# strings embedded in the binary so the published .wasm carries no machine info.
export RUSTFLAGS="--remap-path-prefix=$HOME=/~ --remap-path-prefix=$PWD=/core ${RUSTFLAGS:-}"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir ../site/pkg --out-name matrix_core \
  target/wasm32-unknown-unknown/release/matrix_core.wasm
ls -la ../site/pkg/matrix_core_bg.wasm
