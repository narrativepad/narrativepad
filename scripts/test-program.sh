#!/usr/bin/env bash
# Build the escrow + the test-only pump mock, then run unit, property and LiteSVM tests.
set -euo pipefail
cd "$(dirname "$0")/.."
# anchor build also writes the IDL and TS types.
anchor build
# Deployable binaries are SBPF v0. The Agave 4.x toolchain defaults to v3, which devnet and mainnet
# don't accept yet (feature C8XZNs1b…, SIMD-0161, inactive), so rebuild explicitly. The LiteSVM
# tests below then run against the exact file that gets deployed.
cargo build-sbf --manifest-path programs/narrative_escrow/Cargo.toml --sbf-out-dir target/deploy --arch v0
cargo build-sbf --manifest-path tests/mock_pump/Cargo.toml --sbf-out-dir target/deploy --arch v0
# The SBPF version is the ELF header's e_flags (offset 48). Refuse anything but v0.
sbpf=$(od -An -t u4 -j 48 -N 4 target/deploy/narrative_escrow.so | tr -d ' ')
if [ "$sbpf" != "0" ]; then
  echo "error: target/deploy/narrative_escrow.so is SBPF v$sbpf; devnet and mainnet need v0" >&2
  exit 1
fi
cargo test -p narrative_escrow -- --nocapture "$@"
