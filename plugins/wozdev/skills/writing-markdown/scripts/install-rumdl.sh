#!/usr/bin/env bash
# Install rumdl from its GitHub release binary on 64-bit Linux (x86_64).
#
# Usage: install-rumdl.sh [--force] [VERSION]
#   VERSION      Release tag such as v0.3.0 (default: the latest release)
#   --force      Install even when rumdl is already on PATH
#   INSTALL_DIR  Environment variable for the target folder (default: ~/.local/bin)
set -euo pipefail

repo='https://github.com/rvben/rumdl'
target='x86_64-unknown-linux-gnu'
install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
version='latest'
force=0

for arg in "$@"; do
    case "$arg" in
        --force) force=1 ;;
        -h | --help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) version="$arg" ;;
    esac
done

if [ "$force" -eq 0 ] && command -v rumdl >/dev/null 2>&1; then
    echo "rumdl is already installed: $(command -v rumdl) ($(rumdl --color never --version))"
    exit 0
fi

if [ "$(uname -s)" != 'Linux' ] || [ "$(uname -m)" != 'x86_64' ]; then
    echo "error: this installer supports 64-bit Linux (x86_64) only, not $(uname -s) $(uname -m)" >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo 'error: curl is required; install it with: sudo apt install curl' >&2
    exit 1
fi

if [ "$version" = 'latest' ]; then
    # /releases/latest redirects to /releases/tag/<version>
    version="$(curl -fsSLo /dev/null -w '%{url_effective}' "$repo/releases/latest")"
    version="${version##*/}"
fi
if ! [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: '$version' is not a release tag like v0.3.0" >&2
    exit 1
fi
version="v${version#v}"

asset="rumdl-$version-$target.tar.gz"
url="$repo/releases/download/$version/$asset"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

echo "Downloading $url"
curl -fsSL -o "$work_dir/$asset" "$url"
curl -fsSL -o "$work_dir/$asset.sha256" "$url.sha256"

expected="$(awk '{ print tolower($1) }' "$work_dir/$asset.sha256")"
actual="$(sha256sum "$work_dir/$asset" | awk '{ print $1 }')"
if [ "$expected" != "$actual" ]; then
    echo "error: SHA-256 mismatch for $asset (expected $expected, got $actual)" >&2
    exit 1
fi

tar -xzf "$work_dir/$asset" -C "$work_dir" rumdl
mkdir -p "$install_dir"
install -m 0755 "$work_dir/rumdl" "$install_dir/rumdl"
echo "Installed $("$install_dir/rumdl" --color never --version) to $install_dir/rumdl"

case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
        echo "warning: $install_dir is not on PATH. Add it with:" >&2
        echo "  export PATH=\"$install_dir:\$PATH\"" >&2
        ;;
esac
