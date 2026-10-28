# Testing, Modules & Analysis

Authoring guidance kept separate from the core style so it loads only when building
tests or packaging a module.

## Pester Tests (Arrange-Act-Assert)

Write tests with Pester 5+, one behaviour per `It`. Pester 5 runs discovery and
execution separately: anything the tests need (dot-sourcing the code under test,
shared fixtures) must live in `BeforeAll`, or it will not exist when `It` runs.

```powershell
BeforeAll {
    . $PSCommandPath.Replace('.Tests.ps1', '.ps1')
}

Describe 'Save-WebFile' {
    It 'returns an object with the destination path' {
        # Arrange
        $Url = 'https://example.com/file.txt'
        $Destination = Join-Path -Path $TestDrive -ChildPath 'file.txt'
        Mock Invoke-WebRequest { }

        # Act
        $Result = Save-WebFile -SourceUrl $Url -DestinationPath $Destination -Confirm:$false

        # Assert
        $Result.Path | Should -Be $Destination
        Should -Invoke Invoke-WebRequest -Times 1 -Exactly
    }

    It 'throws on an invalid URL' {
        { Save-WebFile -SourceUrl 'not-a-url' -DestinationPath 'x.txt' } |
            Should -Throw
    }
}
```

Guidelines:

- Use `$TestDrive` for filesystem fixtures - it is cleaned up automatically.
- Use `Mock` to isolate the unit from network, disk, and external commands, and
  `Should -Invoke` to assert the mock was (or was not) called.
- For module code, mock inside the module: `Mock Invoke-WebRequest { } -ModuleName MyModule`,
  or wrap the test in `InModuleScope MyModule { }` to reach private functions.
- Pester 6: a `Mock` with `-ParameterFilter` no longer falls through to the real
  command for calls that don't match; add an unfiltered default `Mock` for the
  same command if other calls must still work.
- Test helpers follow the same rules: a helper named `New-TestFile` is a
  state-changing function that needs `ShouldProcess` (as are `Set-`, `Remove-`,
  `Start-`, `Stop-`, `Update-`), so name setup helpers `Initialize-...` or keep the
  setup inline.
- Pass `-Confirm:$false` to suppress prompts for functions with `ShouldProcess`.
- One assertion intent per `It`; name tests by the behaviour they verify.
- Run with `Invoke-Pester -Path ./tests -Output Detailed`; use `-CI` in pipelines
  to get a non-zero exit code and a test-results file.
- Test files follow the same style rules - run the checker on them too.

## Module Layout (`.psd1` / `.psm1`)

Prefer a module over a loose script collection. Separate public (exported) from
private (internal) functions.

```text
MyModule/
  MyModule.psd1        # Manifest: version, author, FunctionsToExport
  MyModule.psm1        # Root module: dot-sources public/private, exports public
  public/              # One file per exported function (comment-based help required)
    Save-WebFile.ps1
  private/             # Internal helpers, not exported
    Resolve-Destination.ps1
  tests/
    Save-WebFile.Tests.ps1
```

- Declare exported functions explicitly in the manifest's `FunctionsToExport`
  (avoid `'*'` so the module surface is intentional).
- Every public function needs comment-based help:
  `.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.OUTPUTS`.
- Keep private helpers small and single-purpose.

## Static Analysis

Lint every script, module, and test file before considering it done:

```bash
pwsh -NoProfile -File <skill-dir>/scripts/Test-PowerShellStyle.ps1 -Path ./MyModule -EnableExit
```

- The checker wraps `Invoke-ScriptAnalyzer` with `scripts/PSScriptAnalyzerSettings.psd1`
  and the custom rules in `scripts/WozDev-Rules.psm1`. To make editors (VS Code's
  PowerShell extension) and CI apply the same rules, copy both files to the repo
  root and add `CustomRulePath = @('<absolute path>/WozDev-Rules.psm1')` to the
  copied settings. PSScriptAnalyzer resolves a relative `CustomRulePath` against
  the current directory, not the settings file.
- Fix every finding; suppress a rule only with a documented reason, using
  `[Diagnostics.CodeAnalysis.SuppressMessageAttribute('RuleName', '', Justification = '...')]`
  on the narrowest scope.
- Run it in CI so violations fail the build.
