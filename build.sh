#!/usr/bin/env bash
# Build the Rust game core to WASM and generate JS bindings into ./pkg
set -euo pipefail
cd "$(dirname "$0")/core"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir ../pkg --out-name matrix_core \
  target/wasm32-unknown-unknown/release/matrix_core.wasm
ls -la ../pkg/matrix_core_bg.wasm
