#!/usr/bin/env bash
# One-time toolchain setup inside WSL2 Ubuntu (see docs/ARCHITECTURE.md §12.1).
# Pinned versions: Rust stable (>= 1.89), Agave/Solana CLI v4.1.2, Anchor 1.2.0.
# Safe to re-run. Never prints or stores seed phrases.
set -euo pipefail

AGAVE_VERSION="v4.1.2"
ANCHOR_VERSION="1.2.0"

echo "==> apt build dependencies"
sudo apt-get update -y
sudo apt-get install -y build-essential pkg-config libudev-dev llvm libclang-dev \
  protobuf-compiler libssl-dev curl git

echo "==> Rust"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
rustup update stable

echo "==> Agave (Solana CLI) ${AGAVE_VERSION}"
sh -c "$(curl -sSfL https://release.anza.xyz/${AGAVE_VERSION}/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release/bin' "$HOME/.bashrc" || \
  echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"

echo "==> Anchor ${ANCHOR_VERSION} via avm"
if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/otter-sec/anchor avm --force
fi
avm install "${ANCHOR_VERSION}"
avm use "${ANCHOR_VERSION}"

echo "==> Devnet CLI config (public RPC; the app itself uses HELIUS_API_KEY from env)"
solana config set --url https://api.devnet.solana.com >/dev/null
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  # --silent: do not print the seed phrase. This is a DEVNET-ONLY deployer key.
  solana-keygen new --no-bip39-passphrase --silent -o "$HOME/.config/solana/id.json" >/dev/null
fi
echo "devnet deployer: $(solana address)"

echo "==> Versions"
rustc --version; cargo --version; solana --version; anchor --version
