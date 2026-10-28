# WozDev

Woz's AI development toolkit for Claude Code: skills, and in time agents and hooks, that make Claude write and check work to a consistent house style.

## What It Does

Each skill loads automatically when Claude writes, reviews, or fixes files of the matching type. Every skill carries its own rules, templates, and a checker, so the result is proven clean rather than eyeballed.

## Skills

| Skill                | Triggers on                                                                                        | Validates with                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `writing-markdown`   | Writing or fixing READMEs, docs, changelogs, or any `.md` / `.markdown` file                       | `rumdl check --fix`, then `rumdl clean`                                             |
| `writing-powershell` | Any PowerShell work - `.ps1` / `.psm1` / `.psd1` files, one-liners, Pester, Windows and M365 admin | `scripts/Test-PowerShellStyle.ps1` (PSScriptAnalyzer plus custom `Measure-*` rules) |

Inside Claude Code the skills are namespaced as `wozdev:writing-markdown` and `wozdev:writing-powershell`.

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

## Usage

Once installed, ask Claude to work with Markdown or PowerShell as usual - for example "write a README for this module" or "write a function that exports disabled AD users to CSV." The right skill loads on its own, and Claude runs its checker before handing the file back.

## Conflicts

If standalone copies of `writing-markdown` or `writing-powershell` are also installed (for example in `~/.claude/skills`), both versions are offered and they may differ. Remove the standalone copies once the plugin is installed.

## Contributing

The skills are developed in a separate workspace and synced into this repository, which bumps the patch number of `version` in `.claude-plugin/plugin.json` on each release. Issues and pull requests are welcome; accepted changes are ported back to the source so the next sync keeps them.

## License

[MIT](LICENSE)
