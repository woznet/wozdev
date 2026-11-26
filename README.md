# WozDev

Woz's Claude Code plugin marketplace. Add it once, then install whichever plugins you want.

## Plugins

<!-- rumdl-disable MD033 -->

|                                                                                                                                        | Plugin                                     | What it does                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="plugins/wozdev/.claude-plugin/icon.png" alt="wozdev icon: a prompt chevron fanning out to three sub-agent nodes" width="48"> | [`wozdev`](plugins/wozdev/README.md)       | House-style skills with bundled checkers for Markdown and PowerShell, a prompt optimizer, a sub-agent orchestrator, a build doc writer, and a PRD and spec writer                                |
| <img src="plugins/deep-wiki/.claude-plugin/icon.png" alt="deep-wiki icon: a wiki page with a diagram and text lines" width="48">       | [`deep-wiki`](plugins/deep-wiki/README.md) | Generates Mermaid-rich, source-cited wikis for code repositories: a dark-mode VitePress site, onboarding guides, deep research, `AGENTS.md`, and `llms.txt` (fork of microsoft/skills deep-wiki) |

<!-- rumdl-enable MD033 -->

## Installation

In Claude Code, add this repository as a plugin marketplace:

```text
/plugin marketplace add woznet/wozdev
```

Then install one or both plugins:

```text
/plugin install wozdev@wozdev
/plugin install deep-wiki@wozdev
```

Running `/plugin` with no arguments also lists the marketplace's plugins so you can pick from them.

To try a plugin without installing it, clone the repository and point Claude Code at the plugin's folder:

```bash
git clone https://github.com/woznet/wozdev.git
claude --plugin-dir wozdev/plugins/wozdev
```

## Updating

Claude Code caches each installed plugin by the `version` in its `plugins/<name>/.claude-plugin/plugin.json` and replaces the cached copy only when that version changes. To pick up a release, refresh the marketplace, update the plugin, then restart Claude Code:

```bash
claude plugin marketplace update wozdev
```

```bash
claude plugin update wozdev@wozdev
```

Use `deep-wiki@wozdev` in place of `wozdev@wozdev` to update deep-wiki.

## Repository Layout

```text
.claude-plugin/marketplace.json   # Marketplace catalogue: one entry per plugin
plugins/
├── wozdev/                       # .claude-plugin/plugin.json, skills/
└── deep-wiki/                    # .claude-plugin/plugin.json, agents/, commands/, skills/
.github/                          # Version-bump check (CI workflow, pre-commit hook)
```

To add a plugin, create `plugins/<name>/` with its own `.claude-plugin/plugin.json`, then add an entry with `"source": "./plugins/<name>"` to `.claude-plugin/marketplace.json`.

## Contributing

Issues and pull requests are welcome.

Any change under a plugin's `skills/`, `agents/`, `commands/`, or `hooks/` folder must raise `version` in that plugin's `.claude-plugin/plugin.json`. A CI check enforces this on pull requests and pushes to `main`. For the same check before each commit, run `git config core.hooksPath .github/hooks` once after cloning. In an emergency, `git commit --no-verify` bypasses the hook, but CI still checks.

## License

[MIT](LICENSE)
