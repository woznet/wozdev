# Example

Rough notes in, finished build doc out.

## Input Notes

```text
want CI to fail if someone changes skills/ but forgets to bump plugin.json version.
also nice to catch it locally before commit.
ideas: github action on PR + push to main. or a pre-commit hook. probably both?
compare versions properly, 0.1.10 > 0.1.9. jq is fine as a dep.
dont auto-bump, just fail with a clear msg
```

## Output

Saved as `docs/woz-docs/spec-dev/version-bump-ci/BUILD.md`:

````markdown
# Version Bump Check

## Overall Goal

Fail any commit, pull request, or push to `main` that changes `skills/` without raising `version` in `.claude-plugin/plugin.json`.

## Build Checklist

- [ ] Create `.github/scripts/check-version-bump.sh` with a base-ref mode and a `--staged` mode
- [ ] Create `.github/workflows/version-check.yml` that runs the script on pull requests and pushes to `main`
- [ ] Create `.github/hooks/pre-commit` that runs the script with `--staged`
- [ ] Document `git config core.hooksPath .github/hooks` in `README.md`

## Check Script

- **Intent**: One script holds the comparison so CI and the hook cannot disagree; it fails and never edits the version ("dont auto-bump, just fail").
- **Implementation Guidelines**:
  - Accept exactly one argument, `<base-ref>` or `--staged`; exit 2 on anything else.
  - Exit 0 when no changed path starts with `skills/`.
  - Read both versions with `jq -r '.version'`; exit 1 with an install hint when `jq` is missing.
  - Compare with `sort -V`; exit 1 unless the new version is strictly higher, printing old and new versions.
- **Done When**:
  - A staged edit under `skills/` with no version change makes the script exit 1 and print both versions.
  - Bumping `0.1.9` to `0.1.10` makes it exit 0.

## CI Workflow

- **Intent**: Catch missed bumps that skipped the local hook.
- **Implementation Guidelines**:
  - Trigger on `pull_request` and on `push` to `main`.
  - Check out with `fetch-depth: 0` so the base ref exists.
  - Run the script with the pull request base SHA, or the `before` SHA on push.
- **Done When**:
  - A pull request that edits `skills/` without a bump shows a failed check.

## Pre-commit Hook

- **Intent**: Fail fast locally before a commit is made.
- **Implementation Guidelines**:
  - Run `.github/scripts/check-version-bump.sh --staged` and exit with its status.
  - Add the one-time setup command `git config core.hooksPath .github/hooks` to `README.md`.
- **Done When**:
  - With `core.hooksPath` set, `git commit` of an unbumped `skills/` change is refused.
  - `README.md` contains the `git config core.hooksPath .github/hooks` command.

## Open Questions

- Build both the CI workflow and the pre-commit hook? The notes say "probably both?" - assuming: both.
- Should the push check compare against the previous commit or the last release tag? - assuming: the previous commit (`before` SHA).
````
