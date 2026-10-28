# PowerShell Style Guide

The full conventions behind the Quick Reference in `SKILL.md`, with rationale where useful.
`scripts/Test-PowerShellStyle.ps1` enforces most of these rules. Its settings
leave a few unchecked, so check those by hand: `Write-Host`, empty `catch`,
approved verbs, singular nouns, `ShouldProcess` on state-changing functions, and
spacing.

## Naming

- PascalCase for function names, parameters, and variables (`$UserList`, not
  `$userList`); lowercase for keywords;
  UPPERCASE for help keywords (`.SYNOPSIS`, `.DESCRIPTION`).
- Verb-Noun names using approved verbs only - run `Get-Verb` to check. Singular
  nouns (`Get-User`, not `Get-Users`).
- No aliases in scripts: write `Get-ChildItem`, not `gci`; `Where-Object`, not `?`.
- Filter with a script block passed positionally:
  `Where-Object { $_.Name -eq 'test.txt' }`. Never use the comparison form
  (`Where-Object -Property Name -EQ -Value 'test.txt'`, `Where-Object Name -EQ 'test.txt'`)
  and never name `-FilterScript` (`Where-Object -FilterScript { ... }`). One form
  reads the same everywhere and handles compound conditions without a rewrite.
  The checker flags both as `Measure-UseWhereObjectScriptBlock` and fixes them
  where the rewrite keeps the behavior. It skips the fix for `Count` and `Length`,
  because `$_.Length` is 1 on an object with no `Length` property (a directory),
  which the comparison form would have filtered out.

## Layout

- **Braces (OTBS):** the opening `{` ends the line; the closing `}` sits on its
  own line, so `catch`, `finally`, `else`, and `elseif` start the next line.
  One-line blocks such as `{ $_.Enabled }` in `Where-Object` are fine.
- **Indent:** 4 spaces, never tabs. No trailing whitespace. When a pipeline
  wraps, indent one more level after every `|`, not only the first.
- **Blank lines:** 2 between functions, 1 around methods. No blank line
  directly before a closing `}`.
- **Spacing:** single space around parameters and binary operators; none around
  unary operators; a space inside `{ }` and `$( )`.
- **Continuation:** use splatting, never backticks.

## Functions & Scripts

- Always declare `[CmdletBinding()]` and a `param` block. Add a `process` block
  when the function accepts pipeline input, and `begin`/`end` only when needed; a
  helper without pipeline input can use a plain body (see the quick template).
- Write attributes bare: `SupportsShouldProcess`, not `SupportsShouldProcess = $true`.
- Type-constrain parameters and give sensible defaults where appropriate.
- Validate parameters with attributes (`[ValidateNotNullOrEmpty()]`,
  `[ValidateSet()]`, `[ValidateScript()]`). For directory and file paths, have
  `[ValidateScript()]` throw a readable message (see `references/patterns.md`,
  Paths).

## Strings

- Prefer single quotes.
- Use `-f` composite formatting inside parentheses:
  `('{0} of {1}' -f $done, $total)` - not double-quote interpolation
  `"$done of $total"`.
- Embed literal quotes as double quotes inside a single-quoted string:
  `('name "{0}"' -f $A)`. Never escape with doubled single quotes (`''`).
- Double quotes are acceptable only for escapes (`` "`n" ``) or when the text
  itself must contain single quotes (OData filters) - and still with nothing
  interpolated.

## Objects & Output

- Use `[Class]::new()` over `New-Object` (except `-ComObject`).
- Return structured data - `[pscustomobject]` (or hashtables for internal use) -
  not raw strings, so callers can filter, sort, and format.
- Emit output instead of `return $value` in advanced functions; a bare `return`
  for early exit is fine.
- Discard unwanted output with `$null = ...` or `[void]...`, never `| Out-Null`.
- Build collections with `List[T]` or by capturing loop output, not `+=`.

## Streams

- Use `Write-Verbose`, `Write-Information`, `Write-Warning`, and `Write-Error`
  per their purpose; emit data implicitly (or with `Write-Output`).
- Never use `Write-Host`.
- Never log with `Write-Output` - use `Write-Verbose` or `Write-Information`.

## Errors

- Use `try/catch/finally` rather than checking `$?`. For native executables,
  `$LASTEXITCODE` is the only signal - check it immediately after the call.
- Add `-ErrorAction Stop` to critical operations so failures are catchable.
- Never leave a `catch` empty; at minimum `Write-Verbose` why it is safe to ignore.

## Security

- Validate and sanitize all external/user input.
- Do not invoke external executables without validating paths and input first.
- No `Invoke-Expression` on anything derived from input.
- Use `[pscredential]` parameters and a secret store; never plaintext passwords.

## Modules

- Prefer `.psd1`/`.psm1` modules with `private`/`public` directories.
- Give every public function comment-based help: `.SYNOPSIS`, `.DESCRIPTION`,
  `.PARAMETER`, `.EXAMPLE`, `.OUTPUTS`.

## Testing

- Use Pester with the Arrange-Act-Assert pattern.
- Validate with `scripts/Test-PowerShellStyle.ps1` (PSScriptAnalyzer plus the
  bundled settings and `Measure-*` custom rules) and fix every finding.

## Performance

- Prefer language features and .NET methods over cmdlets where it is clearer.
- Keep scripts simple: avoid complex one-liners, unnecessary loops, and excessive
  pipeline chaining - use intermediate variables.
- Use `[ordered]`/`[hashtable]`, `Where-Object`, and `Select-Object` appropriately.
- Comment non-trivial logic (explain *why*, not *what*).
