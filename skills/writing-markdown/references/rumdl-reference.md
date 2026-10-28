# rumdl Reference

`rumdl` is a fast, Rust-based Markdown linter and formatter. Its rules mirror the familiar `MDxxx` rule IDs from markdownlint, and it can auto-fix most of them.

## Installing from GitHub Releases

Install from the release binaries at <https://github.com/rvben/rumdl/releases>. The bundled scripts automate these steps; do them by hand only when a script cannot run.

1. Resolve the version: `https://github.com/rvben/rumdl/releases/latest` redirects to `.../releases/tag/<VERSION>` (for example `v0.3.0`). The API at `https://api.github.com/repos/rvben/rumdl/releases/latest` returns the same value as `tag_name`.
2. Download the archive and its `.sha256` file from `https://github.com/rvben/rumdl/releases/download/<VERSION>/`:

   | Platform | Asset | Binary inside |
   | -------- | ----- | ------------- |
   | 64-bit Linux | `rumdl-<VERSION>-x86_64-unknown-linux-gnu.tar.gz` | `rumdl` |
   | 64-bit Windows | `rumdl-<VERSION>-x86_64-pc-windows-msvc.zip` | `rumdl.exe` |

3. Compare the archive's SHA-256 with the first token of the `.sha256` file, case-insensitively (the Windows file is uppercase hex with no file name).
4. Extract the binary from the archive root into a folder on PATH.

| Script | Default install path | Options |
| ------ | -------------------- | ------- |
| `bash scripts/install-rumdl.sh [--force] [VERSION]` | `~/.local/bin/rumdl` (override with `INSTALL_DIR`) | warns if the folder is not on PATH |
| `scripts/Install-Rumdl.ps1 [-Version <tag>] [-Force]` | `%LOCALAPPDATA%\Programs\rumdl\rumdl.exe` (`-InstallDirectory`) | adds the folder to the user PATH unless `-SkipPathUpdate`; supports `-WhatIf` |

## Commands

Pass `--color never` to every command so output stays free of ANSI escape codes, and finish every lint run with `rumdl clean --color never`.

| Command | Purpose |
| --------- | --------- |
| `rumdl check --color never .` | Lint files; exit code 1 if violations remain |
| `rumdl check --color never --fix .` | Auto-fix what it can, report the rest; exit 0 if all fixed |
| `rumdl fmt --color never .` | Format in place (always exits 0) - ideal for editors/CI |
| `rumdl check --color never --diff .` | Preview fixes without writing files |
| `rumdl clean --color never` | Clear the `.rumdl_cache` folder in the current directory - always run last |
| `rumdl init --color never` | Create a default `.rumdl.toml` |
| `rumdl rule --color never MD013` | Show documentation for a rule (omit ID to list all) |
| `rumdl config --color never` | Print the effective configuration and its source |
| `rumdl --color never --version` | Show the installed version |

## Common Invocations

```bash
# Lint a single file
rumdl check --color never README.md

# Auto-fix a file, then verify nothing is left
rumdl check --color never --fix README.md
rumdl check --color never README.md

# Lint a whole tree, but skip generated folders
rumdl check --color never . --exclude "node_modules,dist"

# Lint only specific rules, or disable noisy ones
rumdl check --color never --enable MD001,MD040 docs/
rumdl check --color never --disable MD013 README.md

# Always finish by clearing the cache, from the same directory
rumdl clean --color never
```

## Configuration (`.rumdl.toml`)

rumdl searches upward from the current directory for `.rumdl.toml`, `rumdl.toml`, `.config/rumdl.toml`, or a `[tool.rumdl]` table in `pyproject.toml`, stopping at the first match (or a `.git` boundary). A `.rumdl.toml` inside a subdirectory applies to the Markdown files in that subdirectory.

```toml
[global]
flavor = "standard"
exclude = ["node_modules", "dist"]
disable = ["MD033"]   # allow inline HTML, for example

[MD013]
line-length = 120
code-blocks = false
tables = false

[MD025]
level = 1
front-matter-title = ""   # a YAML `title:` no longer counts as an H1 (default: "title")

[MD004]
style = "dash"

[MD048]
code-fence-style = "backtick"
```

Generate a starting point with `rumdl init --color never`, or import an existing markdownlint config with `rumdl import --color never .markdownlint.json`.

## Key Rule Catalog

| Category | Rules | Concern |
| ---------- | ------- | --------- |
| Headings | MD001, MD003, MD018, MD019, MD022, MD025, MD026, MD041 | Hierarchy, style, spacing, single H1 |
| Lists | MD004, MD005, MD007, MD029, MD030, MD032 | Markers, indentation, spacing |
| Code | MD014, MD040, MD046, MD048 | Fenced blocks, language tags, fence style |
| Whitespace | MD009, MD010, MD012, MD047 | Trailing spaces, tabs, blanks, final newline |
| Links/Images | MD034, MD039, MD042, MD045, MD051, MD052, MD053 | Bare URLs, alt text, references |
| Emphasis | MD036, MD037, MD049, MD050 | Emphasis style and spacing |
| Tables | MD055, MD056, MD058 | Pipe style, column count, spacing |

Run `rumdl rule --color never` for the complete, up-to-date list of all rules.

## Flavors

rumdl adjusts rules per Markdown flavor to reduce false positives. Set one in `[global]` with `flavor = "..."`:

| Flavor | Use for |
| -------- | --------- |
| `standard` | CommonMark plus GFM tables and task lists (default) |
| `gfm` | GitHub Flavored Markdown |
| `mkdocs` | MkDocs / Material admonitions and content tabs |
| `mdx` | MDX (JSX in Markdown) |
| `quarto` | Quarto / RMarkdown |

## Exit Codes

| Code | Meaning |
| ------ | --------- |
| `0` | Success - no violations, or all were fixed |
| `1` | Violations found (or remain after `--fix`) |
| `2` | Tool error |
