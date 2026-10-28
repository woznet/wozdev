---
name: writing-markdown
description: 'Conventions, a document scaffold, and a rumdl lint/format workflow for writing high-quality Markdown. Use when writing, generating, reviewing, or fixing Markdown - READMEs, docs, wikis, changelogs, or any .md / .markdown file. Covers ATX headings and strict hierarchy, blank-line spacing around blocks, fenced code blocks with language tags, consistent list markers and indentation, tables, descriptive links and image alt text, and linting and auto-fixing every file with rumdl (check, check --fix, fmt) until zero violations remain, then clearing the rumdl cache (clean). Installs rumdl from its GitHub release binary on 64-bit Linux or Windows when it is missing.'

---

# Writing Markdown

Author Markdown that is well-structured, portable, and free of syntax errors - then prove it with `rumdl`.

**Core rule:** Use ATX headings in a strict hierarchy, surround every block element with blank lines, tag every fenced code block with a language, and use one consistent list marker - then run `rumdl check --color never --fix` and resolve every remaining violation, then finish with `rumdl clean --color never`. Pass `--color never` to every rumdl command.

## When to Use This Skill

- Writing or generating any Markdown file (README, docs, changelog, wiki page)
- Reviewing or refactoring existing `.md` / `.markdown` files
- Fixing reported Markdown syntax errors or lint failures
- Setting up Markdown linting and formatting for a project with rumdl

## Prerequisites

Supported platforms: 64-bit Ubuntu (26.04) and 64-bit Windows 11.

1. Check for rumdl: `rumdl --color never --version`. If it prints a version, skip to the workflow.
2. If it is missing, install the GitHub release binary with the bundled script for the platform:
   - Linux: `bash <skill-dir>/scripts/install-rumdl.sh` - installs to `~/.local/bin/rumdl`.
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <skill-dir>/scripts/Install-Rumdl.ps1` (or `pwsh -NoProfile -File ...`) - installs to `%LOCALAPPDATA%\Programs\rumdl\rumdl.exe` and adds that folder to the user PATH.
3. Both scripts install the latest release by default, take a tag such as `v0.3.0` to pin a version, verify the release SHA-256 checksum, and skip the install when `rumdl` is already on PATH unless forced.
4. Re-run `rumdl --color never --version` to confirm. If a new shell still cannot find it, call it by the full path the script printed.

## Quick Reference

| Topic         | Do                                                          | Don't                                            |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Headings      | ATX `## Title`, one H1, no skipped levels                   | Setext `===`, multiple H1, jump H2 to H4         |
| Spacing       | blank line before and after headings, lists, fences, tables | blocks glued to surrounding text                 |
| Code          | fenced block with a language tag (bash, python, text)       | indented code, untagged fences                   |
| Lists         | one marker `-`, 2-space nested indent                       | mixed `*`/`+`/`-`, 4-space or ragged indent      |
| Ordered lists | consistent `1.` style                                       | `1)`, random restarts                            |
| Links         | `[descriptive text](url)`                                   | bare URLs, "click here"                          |
| Images        | `![real alt text](url)`                                     | empty or missing alt text                        |
| Emphasis      | consistent `**bold**` and `_italic_`                        | mixing `__`/`**` styles                          |
| Whitespace    | no trailing spaces, no tabs, one final newline              | trailing spaces, hard tabs, no/triple newline    |
| Line length   | no limit - MD013 is disabled                                | hard-wrapping prose, tables, or URLs to a column |
| Validation    | `rumdl check --color never --fix`, fix the rest, then `rumdl clean --color never` | shipping unlinted Markdown |

## Workflow: Write and Lint a Markdown File

1. Start from `references/document-scaffold.md` for a well-structured skeleton.
2. Write content: a single H1 title, then `##` / `###` in strict order, with a blank line around every block.
3. Tag every fenced code block with a language (use `text` for plain output).
4. Use `-` for bullets and `1.` for ordered items; indent nested items by 2 spaces.
5. Write descriptive link text and real image alt text; never paste bare URLs.
6. Auto-fix: `rumdl check --color never --fix path/to/file.md` (or `rumdl fmt --color never .` to format a whole tree).
7. Re-check: `rumdl check --color never path/to/file.md` and manually fix every remaining (unfixable) violation.
8. Repeat steps 6-7 until rumdl reports zero issues.
9. Always finish with `rumdl clean --color never`, run from the same directory as the checks, to clear the `.rumdl_cache` folder they leave behind.

## References

Read these on demand - do not load all of them up front.

| File                              | Read when you need                                           |
| --------------------------------- | ------------------------------------------------------------ |
| `references/style-guide.md`       | The full rules with rationale and rumdl rule IDs             |
| `references/examples.md`          | Before/after good-vs-bad Markdown for a concrete pattern     |
| `references/rumdl-reference.md`   | rumdl CLI commands, `.rumdl.toml` config, and the rule catalog |
| `references/document-scaffold.md` | A copy-ready skeleton for a new document                     |
| `.rumdl.toml`                     | The example config that keeps this skill's own files lint clean |
| `scripts/install-rumdl.sh`        | Install rumdl on 64-bit Linux from the GitHub release binary |
| `scripts/Install-Rumdl.ps1`       | Install rumdl on 64-bit Windows from the GitHub release binary |

## Gotchas

- **Surround block elements with blank lines.** Models habitually glue a heading, list, code fence, or table to the previous paragraph - rumdl flags this (MD022 / MD031 / MD032). One blank line before and after, every time.
- **Every fenced code block needs a language tag** (MD040). Use `text` for plain output rather than leaving the fence bare.
- **One H1 per document, no skipped levels** (MD025 / MD001). Never jump from `##` to `####`, and never add a second `#`. A YAML front matter `title:` alongside a single `#` heading is fine - `.rumdl.toml` sets `front-matter-title = ""` under `[MD025]` so the front matter title is not counted as an H1.
- **Use `-` for bullets, not `*` or `+`** (MD004). Pick one marker and keep it.
- **No bare URLs** (MD034). Wrap them: `<https://example.com>` or `[label](https://example.com)`.
- **Always give images real alt text** (MD045) - describe the image; never leave `![]()` empty.
- **Strip trailing whitespace and hard tabs** (MD009 / MD010); end the file with exactly one trailing newline (MD047).
- **Never hard-wrap to a line-length limit.** MD013 is off via `disable = ["MD013"]` in `.rumdl.toml`; long prose lines, table rows, and URLs are fine as-is. Use `rumdl check --color never --disable MD013` where no config applies.
- **Always pass `--color never`** to every rumdl command (`check`, `fmt`, `clean`, `rule`, ...). Colored output embeds ANSI escape codes that clutter captured logs and agent tool output.
- **Always end with `rumdl clean --color never`.** `check` and `fmt` write a `.rumdl_cache` folder in the current directory; `clean` removes it, so run it from that same directory as the last step.
- **Linting is not optional.** A file is not done until `rumdl check --color never` returns zero issues.
