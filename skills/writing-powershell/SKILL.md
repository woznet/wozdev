---
name: "writing-powershell"
description: 'House style, scaffolds, patterns, and a bundled style checker for high-quality PowerShell. Use whenever the answer will contain PowerShell or the input is PowerShell, even if the user never says PowerShell: writing, debugging, reviewing, or refactoring functions, scripts, one-liners, modules, Pester tests, or .ps1/.psm1/.psd1 files and diffs; pasted PowerShell errors; Windows and M365 admin jobs where PowerShell is the natural tool - Active Directory queries and CSV reports, Intune detection/remediation scripts, autounattend and first-logon setup, logon scripts, registry, scheduled tasks, Azure Automation runbooks, Microsoft Graph, Entra ID, Exchange Online, and Az. Covers Verb-Noun naming, OTBS braces, CmdletBinding, ShouldProcess, single-quote/-f strings, $null = instead of Out-Null, PascalCase variables, structured output, Graph paging, and 5.1 compatibility. Also use when pwsh, PSScriptAnalyzer, or Pester must be installed before code can be validated. Not for bash, Python, Terraform, Bicep, or KQL.'
---

# Writing PowerShell

Author PowerShell that is idiomatic, safe, and consistent with an approved style, then prove it with the bundled checker.

**Core rule:** `[CmdletBinding()]` functions, single-quoted `-f` strings, OTBS braces, `try/catch`, structured object output. Never `Write-Host`, `Out-Null`, backtick continuation, `New-Object`, aliases, doubled single quotes, or raw-string returns.

## Choosing a Template

Two scaffolds cover the common cases. Default to **quick**; promote to **full** only when a real need appears.

| Use **full** when… | Use **quick/helper** when… |
|---|---|
| Takes pipeline input | Small, single-purpose helper |
| Destructive/stateful action needing `-WhatIf`/`-Confirm` | No destructive side effects |
| Needs `begin`/`end` for shared setup or teardown | Thin wrapper over one or two calls |
| Public/exported module command | Internal helper |

A standalone `.ps1` script follows the same rules at file level: help block, `[CmdletBinding()]` and `param()` at the top, `#Requires` for modules it needs. See `references/patterns.md`.

## Quick Reference

| Topic | Do | Don't |
|-------|----|-------|
| Strings | `('{0} -> {1}' -f $a, $b)`, single quotes | `"$a -> $b"`, double-quote interpolation |
| Quotes inside strings | embed double quotes: `('name "{0}"' -f $A)` | doubled single quotes: `('name ''{0}''' -f $A)` |
| Discarding output | `$null = $List.Add($x)` or `[void]$List.Add($x)` | `$List.Add($x) \| Out-Null` |
| Functions | `[CmdletBinding()]` + typed, validated `param`; `begin/process/end` for pipeline input | bare scripts, missing `[CmdletBinding()]` |
| ShouldProcess | bare `SupportsShouldProcess`; 3-param `ShouldProcess($desc, $warning, $caption)` | `SupportsShouldProcess = $true`; no confirm on destructive ops |
| Braces | OTBS - `{` ends the line, `}` on its own line, `catch`/`else` on the next line | Allman/other styles |
| Continuation | splatting | backticks |
| Objects | `[Type]::new()`; emit `[pscustomobject]` | `New-Object` (except `-ComObject`); raw strings; `return $value` in advanced functions |
| Collections | `[System.Collections.Generic.List[T]]::new()` or `$x = foreach (...) { ... }` | `$array += $item` in a loop |
| Filtering | `Where-Object { $_.Name -eq 'test.txt' }` - a script block, passed positionally | `Where-Object -Property Name -EQ -Value 'test.txt'`; `Where-Object -FilterScript { ... }` |
| Paths | `Join-Path`, `-LiteralPath` for user-supplied paths | string-concatenated paths, `-Path` on names with `[ ]` |
| Streams | `Write-Verbose` / `Write-Information` / `Write-Error` / `Write-Warning` | `Write-Host`; logging via `Write-Output` |
| Errors | `try/catch/finally` + `-ErrorAction Stop` on critical ops; `$PSCmdlet.ThrowTerminatingError($_)` to halt | `$?` checks; empty `catch` |
| Naming | approved `Get-Verb` Verb-Noun, singular nouns, PascalCase functions, parameters, and variables, no aliases | unapproved verbs, `gci`/`%`/`?` aliases |
| Indent | 4 spaces, no tabs, no trailing whitespace | tabs, ragged indent |
| Parse compatibility | syntax 5.1 can parse | ternary `? :`, `&&`/`\|\|`, `??`/`??=`, `?.`/`?[]` |

## Workflow: Write New Code

1. **Choose the scaffold:** full/pipeline command → `references/function-template-full.ps1`; simple helper → `references/function-template-quick.ps1`.
2. Rename to an approved Verb-Noun (`Get-Verb`); type-constrain and validate every parameter.
3. Fill comment-based help (`.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.OUTPUTS`). The quick template ships without help; add at least `.SYNOPSIS` if exported.
4. Put per-item logic in `process` (full template); delete unused `begin`/`end`/`finally` blocks and their placeholder comments.
5. Guard destructive actions with the 3-param `ShouldProcess` overload.
6. Set `[OutputType()]` to the type the function actually emits.
7. For collections, Graph calls, credentials, paths, or scripts with dependencies, check `references/patterns.md` before improvising.
8. **Validate** (next section) and fix every finding before handing the code back.

## Workflow: Review or Refactor Existing Code

1. Run the checker on the file first - it finds the mechanical issues faster and more reliably than reading.
2. Fix findings without changing behavior: keep parameter names, positions, and output shape unless the user asked for a change, because callers depend on them.
3. Then read for what a linter can't see. Lint findings are the cheap part; the review earns its keep here:
   - **Blast radius:** what is the worst a single run can do? Unbounded deletes or disables, no `-WhatIf` path, no `ConfirmImpact = 'High'` on destructive work, no cap on how many objects it touches, a default parameter value (0, empty, `*`) that widens the scope to everything.
   - **Silent wrong answers:** missing paging (`-All`, `@odata.nextLink`), swallowed errors (empty `catch`, no `-ErrorAction Stop` so `catch` never fires), wildcard paths that match nothing, null or never-set dates comparing as "old", UTC vs local time.
   - **Ordering and auditability:** does the record of what happened get written before or after the irreversible step, and does it survive a failure halfway through?
   - **Identity:** are objects matched and reported by a unique ID, not a display name?
   - **Environment:** required modules, connections, permissions/scopes, and 5.1 vs 7 assumptions.
4. Re-run the checker until it is clean. When reviewing for someone else, don't rewrite: report findings grouped by severity (critical / high / medium / low) with line numbers and a one-line fix each, put style-only items in a compact table at the end, and say which few fixes matter most.

## Validate with the Bundled Checker

A bare `Invoke-ScriptAnalyzer` misses most of this style: brace placement, indentation, casing, and 5.1 syntax rules are off by default, and no built-in rule knows about `Out-Null`, doubled single quotes, backticks, `New-Object`, interpolation, or camelCase variables. So use the bundled checker. It runs PSScriptAnalyzer with `scripts/PSScriptAnalyzerSettings.psd1` (an `IncludeRules` allow-list) plus the custom rules in `scripts/WozDev-Rules.psm1`, and reports parse errors:

```bash
pwsh -NoProfile -File <skill-dir>/scripts/Test-PowerShellStyle.ps1 -Path ./MyScript.ps1 -EnableExit
```

- `-Path` takes files or directories (recursive). Exit code 0 means clean; 1 prints a findings table.
- Without `-EnableExit` it emits finding objects, handy inside a pwsh session.
- Save the code to a file before checking; the checker reads files, not strings.
- Custom-rule findings are named `Measure-*` (`Measure-AvoidOutNull`, `Measure-UsePascalCaseVariable`, `Measure-UnusedAssignment`, ...), and each message states the rewrite.
- An `AnalyzerError` finding means PSScriptAnalyzer itself failed and the file was not checked. It is not a problem in the code: re-run the checker, and never report that file as clean.
- Treat `Information` findings as worth fixing too. Leave a finding only with a reason you can state (for example `Measure-UnusedAssignment` on a statement whose right-hand side has a side effect you need; keep the call and assign it to `$null`), and mention it to the user.
- Add `-Fix` to rewrite the files' layout in place first (braces, indentation, cmdlet casing) via `Invoke-Formatter`, then fix what remains by hand. It never changes logic, so it is safe to run on your own output; on a user's file, only when you were asked to change it.
- The settings leave some house rules unchecked, so read for them yourself: `Write-Host`, empty `catch` blocks, unapproved verbs, plural nouns, missing `ShouldProcess` on state-changing functions, and spacing around operators and braces.

No `pwsh` on the machine? Bootstrap it - see `references/installing-powershell.md`. Don't skip validation or hand back unvalidated code; if installation is truly impossible, say so plainly and list what you checked by hand.

## References

Read on demand - do not load all up front.

| File | Read when you need |
|------|--------------------|
| `references/function-template-full.ps1` | Advanced-function scaffold: pipeline input, `ShouldProcess`, `begin/process/end` |
| `references/function-template-quick.ps1` | Minimal helper scaffold: `[CmdletBinding()]` + validated `param` + `try/catch` |
| `references/patterns.md` | Collections, output suppression, conditional splatting, paths, credentials, Microsoft Graph paging, standalone scripts and `#Requires` |
| `references/style-guide.md` | Full style rules with rationale |
| `references/examples.md` | Before/after rewrites of common AI-generated mistakes |
| `references/testing-and-modules.md` | Pester 5+ tests (Arrange-Act-Assert), `.psd1/.psm1` layout |
| `references/installing-powershell.md` | `pwsh`, PSScriptAnalyzer, or Pester is missing |
| `scripts/Test-PowerShellStyle.ps1` | The checker (run it; reading it is optional) |
| `scripts/PSScriptAnalyzerSettings.psd1` | Which built-in rules run and how the formatting rules are configured |
| `scripts/WozDev-Rules.psm1` | The `Measure-*` custom rules, when a finding's message isn't enough to fix it |

## Gotchas

These add rationale beyond the Quick Reference table.

- **Default to single quotes.** Models habitually emit `"...$Var..."`; rewrite it as `('...{0}...' -f $Var)`. A double-quoted string is fine only when it needs an escape like `` "`n" `` or `` "`t" `` and nothing is interpolated.
- **Never escape a quote with doubled single quotes.** Embed literal double quotes instead: `('name "{0}"' -f $A)`. The doubled form is legal but hard to read and easy to miscount. If the text truly needs a literal single quote (an OData filter such as `startswith(displayName,'A')`), build it with `-f` so the quote sits in the format string once: `("startswith(displayName,'{0}')" -f $Prefix)` - double-quoted, nothing interpolated, no doubling.
- **Discard output with `$null =` or `[void]`, never `Out-Null`.** It is a house rule, and it is also faster - `Out-Null` spins up a pipeline per call. Methods like `List.Add`, `HashSet.Add`, `StringBuilder.Append`, and `New-Item` emit values that leak into function output if not discarded.
- **Confirmation needs the 3-param overload** - `ShouldProcess($Description, $Warning, $Caption)` - for meaningful `-Confirm`/`-WhatIf` output, not just `ShouldProcess($Target)`.
- **Return objects, not strings, and don't `return $value` from advanced functions.** Emit the object on its own line; use a bare `return` only to exit early. Everything uncaptured in a function is output, which is why stray method results must be discarded.
- **Don't downgrade terminating errors.** After catching an `-ErrorAction Stop` failure, rethrow with `$PSCmdlet.ThrowTerminatingError($_)`. Re-emitting via `Write-Error` silently turns a fatal error non-terminating.
- **`+=` on an array copies the whole array each time** - quadratic in loops. Use a generic `List[T]` or assign the loop's output directly.
- **Use only syntax that Windows PowerShell 5.1 can parse.** 7+-only syntax fails at parse time, so the whole file won't load. The checker flags it through `PSUseCompatibleSyntax`.
- **Validate external input** (URLs, paths, IDs) before acting on it; never pass unvalidated input to external executables, `Invoke-Expression`, or OData filters.
- **Keep `.ps1` source ASCII.** Windows PowerShell 5.1 reads a BOM-less file as ANSI, so a curly quote, em dash, or accented name in a string turns into mojibake or breaks parsing. Write non-ASCII characters as `[char]0x2019`, or save the file as UTF-8 with BOM (the checker flags this as `PSUseBOMForUnicodeEncodedFile`).
- **`Invoke-ScriptAnalyzer -Path` takes one string**, not an array. Loop over files, or point it at a directory with `-Recurse`. The bundled checker already handles this.
- **A missing `pwsh` is not a reason to skip validation.** On Windows, finding `powershell` proves nothing - that is 5.1 Desktop, not `pwsh` 7.x, and it ships no PSScriptAnalyzer.
