#!/usr/bin/env bash
# Build the escrow + the test-only pump mock, then run unit, property and LiteSVM tests.
set -euo pipefail
cd "$(dirname "$0")/.."
anchor build
cargo build-sbf --manifest-path tests/mock_pump/Cargo.toml --sbf-out-dir target/deploy
cargo test -p narrative_escrow -- --nocapture "$@"
