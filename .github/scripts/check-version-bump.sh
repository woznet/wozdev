#!/usr/bin/env bash
# Fail when a plugin's components changed but its plugin.json version was not strictly increased.
# Components are plugins/<name>/{skills,agents,commands,hooks}/; the manifest is
# plugins/<name>/.claude-plugin/plugin.json. A plugin with no manifest at the base is new and skipped.
#   check-version-bump.sh <base-ref>   compare <base-ref> to HEAD (CI)
#   check-version-bump.sh --staged     compare HEAD to the index (pre-commit)
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <base-ref> | --staged" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "check-version-bump: jq is required but not installed (https://jqlang.org/download/)." >&2
  exit 1
fi

diff_opts=(-c core.quotepath=false diff --name-only --no-renames)

if [ "$1" = '--staged' ]; then
  changed=$(git "${diff_opts[@]}" --cached)
  old_rev='HEAD'
  new_rev=''
else
  changed=$(git "${diff_opts[@]}" "$1" HEAD)
  old_rev="$1"
  new_rev='HEAD'
fi

plugins=$(sed -nE 's#^plugins/([^/]+)/(skills|agents|commands|hooks)/.*#\1#p' <<<"$changed" | sort -u)

status=0

for plugin in $plugins; do
  manifest="plugins/$plugin/.claude-plugin/plugin.json"

  if ! git cat-file -e "$old_rev:$manifest" 2>/dev/null; then
    continue
  fi

  if ! git cat-file -e "$new_rev:$manifest" 2>/dev/null; then
    echo "check-version-bump: $plugin: $manifest is missing." >&2
    status=1
    continue
  fi

  old=$(git show "$old_rev:$manifest" | jq -r '.version')
  new=$(git show "$new_rev:$manifest" | jq -r '.version')

  if ! grep -Eq '^[0-9]+(\.[0-9]+)*$' <<<"$new"; then
    echo "check-version-bump: $plugin: version '$new' in $manifest is missing or not numeric (expected e.g. 1.2.3)." >&2
    status=1
    continue
  fi

  highest=$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -n 1)

  if [ "$new" = "$old" ] || [ "$highest" != "$new" ]; then
    echo "check-version-bump: $plugin: components changed but version not bumped ($old -> $new) in $manifest." >&2
    status=1
  fi
done

exit "$status"
