# WozDev

Woz's AI development toolkit for Claude Code: skills, and in time agents and hooks, that make Claude write and check work to a consistent house style.

## What It Does

Each skill loads automatically when Claude works on the kind of file or task it covers. Every skill carries its own rules, references, and a checker or meter, so the result is measured rather than eyeballed.

## Skills

| Skill                | Triggers on                                                                                                     | Validates with                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `writing-markdown`   | Writing or fixing READMEs, docs, changelogs, or any `.md` / `.markdown` file                                    | `rumdl check --no-cache --fix`                                                      |
| `writing-powershell` | Any PowerShell work - `.ps1` / `.psm1` / `.psd1` files, one-liners, Pester, Windows and M365 admin              | `scripts/Test-PowerShellStyle.ps1` (PSScriptAnalyzer plus custom `Measure-*` rules) |
| `optimize-prompt`    | Writing, tightening, or restructuring prompts - system prompts, agent briefs, `SKILL.md`, `CLAUDE.md`, templates | `scripts/Measure-Prompt.ps1` or `scripts/measure-prompt.sh` (estimated tokens before/after, filler and emphasis) |
| `orchestrate-subagents` | Planning or running a large task as batches of sub-agent work; writes `docs/woz-plans/<name>-plan.md` (and `-execute.md` in plan-only mode) | `scripts/Test-OrchestrationPlan.ps1` or `scripts/test-orchestration-plan.sh` (sections, batch fields, dependency cycles, write-key conflicts) |

Inside Claude Code the skills are namespaced as `wozdev:writing-markdown`, `wozdev:writing-powershell`, `wozdev:optimize-prompt`, and `wozdev:orchestrate-subagents`.

## Installation

In Claude Code, add this repository as a plugin marketplace, then install the plugin:

```text
/plugin marketplace add woznet/wozdev
/plugin install wozdev@wozdev
```

To try the plugin without installing it, clone the repository and point Claude Code at it:

```bash
git clone https://github.com/woznet/wozdev.git
claude --plugin-dir wozdev
```

## Prerequisites

- **rumdl** for the Markdown skill. If it is missing, the skill installs the GitHub release binary on 64-bit Windows or Linux with its bundled `Install-Rumdl.ps1` or `install-rumdl.sh`.
- **PowerShell 7 (`pwsh`)** and the **PSScriptAnalyzer** module for the PowerShell checker. The skill's `references/installing-powershell.md` covers bootstrapping both, plus Pester.
- **PowerShell 7 (`pwsh`), Windows PowerShell 5.1, or bash with GNU grep and awk** for the prompt meter. It needs no modules; the bash version covers hosts without PowerShell.
- **PowerShell 7 (`pwsh`), Windows PowerShell 5.1, or bash with awk** for the plan checker. It needs no modules.

## Usage

Once installed, ask Claude to work with Markdown, PowerShell, prompts, or multi-agent plans as usual - for example "write a README for this module", "write a function that exports disabled AD users to CSV", "tighten this system prompt", or "plan this migration as sub-agent batches, but don't run anything yet." The right skill loads on its own, and Claude runs its checker before handing the file back. To call a skill directly, type its name as a slash command, such as `/wozdev:optimize-prompt`.

## Updating

Claude Code caches each installed plugin by the `version` in `.claude-plugin/plugin.json` and replaces the cached copy only when that version changes, so every release bumps it. To pick up a release, refresh the marketplace, update the plugin, then restart Claude Code:

```bash
claude plugin marketplace update wozdev
```

```bash
claude plugin update wozdev@wozdev
```

If the update reports that wozdev is already at the latest version, the release did not change `version`, and the cached copy stays as it was.

## Contributing

The skills are developed in a separate workspace and synced into this repository, which bumps the patch number of `version` in `.claude-plugin/plugin.json` on each release. Issues and pull requests are welcome; accepted changes are ported back to the source so the next sync keeps them.

Any change under `skills/` must raise `version` in `.claude-plugin/plugin.json`. A CI check enforces this on pull requests and pushes to `main`. For the same check before each commit, run `git config core.hooksPath .github/hooks` once after cloning. In an emergency, `git commit --no-verify` bypasses the hook, but CI still checks.

## License

[MIT](LICENSE)
