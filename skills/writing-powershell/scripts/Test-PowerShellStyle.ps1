#Requires -Version 5.1
<#
    .SYNOPSIS
    Lints PowerShell files against the writing-powershell skill's style.

    .DESCRIPTION
    Runs PSScriptAnalyzer with the bundled PSScriptAnalyzerSettings.psd1 (an
    IncludeRules allow-list of built-in rules, including formatting, casing, and 5.1
    syntax rules) and the bundled WozDev-Rules.psm1 custom rules, which cover the
    conventions PSScriptAnalyzer has no rule for:

      - Measure-AvoidOutNull              Out-Null -> $null = ... or [void](...)
      - Measure-AvoidDoubledSingleQuote   doubled single quotes -> embedded double quotes
      - Measure-AvoidBacktickContinuation backtick continuation -> splatting
      - Measure-UseStaticConstructor      New-Object -> [Type]::new() (-ComObject is allowed)
      - Measure-AvoidStringInterpolation  "...$Var..." -> ('...{0}...' -f $Var)
      - Measure-AvoidReturnValue          (disabled via ExcludeRules in PSScriptAnalyzerSettings.psd1)
      - Measure-UsePascalCaseVariable     camelCase variables -> PascalCase
      - Measure-VariableCaseMismatch      $Result vs $result -> the declaration's casing
      - Measure-AutomaticVariableCase     $True, $Psitem -> $true, $PSItem
      - Measure-UnusedAssignment          assignments that are never read

    Parse errors are reported as well, as RuleName ParseError.

    PSUseCorrectCasing runs in a second Invoke-ScriptAnalyzer call of its own: run in
    parallel with the other rules it intermittently crashes or hangs PSScriptAnalyzer.
    If PSScriptAnalyzer still fails on a file after three attempts, the file is reported
    as RuleName AnalyzerError (exit 1 with -EnableExit), never as clean.

    Emits one object per finding. With -EnableExit it prints a table instead and
    exits 1 when anything is found, so it can gate a build or an agent's "done" step.

    .PARAMETER Path
    One or more .ps1/.psm1/.psd1 files or directories. Directories are searched
    recursively.

    .PARAMETER SettingsPath
    PSScriptAnalyzer settings file. Defaults to the one next to this script.

    .PARAMETER CustomRulePath
    PSScriptAnalyzer custom rule module. Defaults to WozDev-Rules.psm1 next to this
    script.

    .PARAMETER EnableExit
    Print the findings as a table and exit with code 1 when there are any (0 when
    clean). Use from bash or CI: pwsh -NoProfile -File ./Test-PowerShellStyle.ps1 -Path ./src -EnableExit

    .PARAMETER Fix
    Before checking, rewrite each file in place with Invoke-Formatter using the same
    settings (braces, indentation, casing). Only layout changes; every other finding
    still needs a manual fix.

    .EXAMPLE
    ./Test-PowerShellStyle.ps1 -Path ./MyModule

    .EXAMPLE
    ./Test-PowerShellStyle.ps1 -Path ./Get-Thing.ps1, ./Set-Thing.ps1 | Format-Table -AutoSize

    .OUTPUTS
    System.Management.Automation.PSCustomObject
#>
[CmdletBinding()]
[OutputType([pscustomobject])]
param(
    [Parameter(Mandatory, Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
    [Alias('FullName')]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path,

    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$SettingsPath = (Join-Path -Path $PSScriptRoot -ChildPath 'PSScriptAnalyzerSettings.psd1'),

    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$CustomRulePath = (Join-Path -Path $PSScriptRoot -ChildPath 'WozDev-Rules.psm1'),

    [switch]$EnableExit,

    [switch]$Fix
)

begin {
    if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
        $Message = 'PSScriptAnalyzer is not installed. Run: Install-Module PSScriptAnalyzer -Scope CurrentUser'
        $Exception = [System.InvalidOperationException]::new($Message)
        $ErrorRecord = [System.Management.Automation.ErrorRecord]::new($Exception, 'PSScriptAnalyzerMissing', 'NotInstalled', $null)
        $PSCmdlet.ThrowTerminatingError($ErrorRecord)
    }

    $Extensions = @('.ps1', '.psm1', '.psd1')
    $Files = [System.Collections.Generic.List[string]]::new()
    $Findings = [System.Collections.Generic.List[object]]::new()

    # PSScriptAnalyzer runs its rules in parallel over shared CommandInfo objects, and
    # CommandInfo.Parameters is not thread-safe, so PSUseCorrectCasing intermittently throws
    # NullReferenceException or hangs (PSScriptAnalyzer#1708). Running it in a call of its
    # own leaves no other rule reading those objects at the same time.
    $CasingRule = 'PSUseCorrectCasing'
    $Settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
    $MainSettings = $Settings.Clone()
    $MainSettings.ExcludeRules = @($Settings.ExcludeRules) + $CasingRule
    $CasingSettings = $Settings.Clone()
    $CasingSettings.IncludeRules = @($CasingRule)
    $CasingIncluded = -not $Settings.IncludeRules -or @($Settings.IncludeRules | Where-Object { $CasingRule -like $_ }).Count -gt 0
    $RunCasingPass = $CasingIncluded -and @($Settings.ExcludeRules) -notcontains $CasingRule

    function ConvertTo-StyleFinding {
        param(
            [string]$RuleName,
            [string]$Severity,
            [string]$File,
            [int]$Line,
            [string]$Message
        )
        [pscustomobject]@{
            RuleName = $RuleName
            Severity = $Severity
            File = $File
            Line = $Line
            Message = $Message
        }
    }

    function Get-StyleFinding {
        param(
            [string]$File
        )
        # Custom rules never run on a file that does not parse, and the Severity
        # filter in the settings drops PSScriptAnalyzer's own ParseError records,
        # so parse errors are reported here.
        $Tokens = $null
        $ParseErrors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$Tokens, [ref]$ParseErrors)

        foreach ($ParseError in $ParseErrors) {
            ConvertTo-StyleFinding -RuleName 'ParseError' -Severity 'Error' -File $File -Line $ParseError.Extent.StartLineNumber -Message $ParseError.Message
        }
    }

    function Invoke-StyleAnalyzer {
        param(
            [hashtable]$AnalyzerParams,
            [string]$File,
            [int]$MaxAttempt = 3
        )
        # A rule error is non-terminating and leaves no records, which would read as a
        # clean file, so fail closed: retry, then report the file as not checked.
        for ($Attempt = 1; $Attempt -le $MaxAttempt; $Attempt++) {
            try {
                # Collect before emitting so a failed attempt leaves no partial findings.
                $Records = Invoke-ScriptAnalyzer @AnalyzerParams -ErrorAction Stop
                foreach ($Record in $Records) {
                    ConvertTo-StyleFinding -RuleName $Record.RuleName -Severity $Record.Severity.ToString() -File $File -Line $Record.Line -Message $Record.Message
                }
                return
            }
            catch {
                $LastError = $_
                Write-Verbose ('Invoke-ScriptAnalyzer attempt {0} of {1} failed on {2}: {3}' -f $Attempt, $MaxAttempt, $File, $LastError.Exception.Message)
            }
        }
        $Message = 'PSScriptAnalyzer failed {0} times; this file was NOT checked. Re-run the checker. Last error ({1}): {2}' -f $MaxAttempt, $LastError.FullyQualifiedErrorId, $LastError.Exception.Message
        ConvertTo-StyleFinding -RuleName 'AnalyzerError' -Severity 'Error' -File $File -Line 0 -Message $Message
    }
}

process {
    foreach ($Item in $Path) {
        try {
            $Resolved = Get-Item -LiteralPath $Item -ErrorAction Stop
        }
        catch {
            $PSCmdlet.WriteError($_)
            continue
        }
        if ($Resolved.PSIsContainer) {
            $Found = Get-ChildItem -LiteralPath $Resolved.FullName -Recurse -File |
                Where-Object { $Extensions -contains $_.Extension }
            foreach ($File in $Found) {
                $Files.Add($File.FullName)
            }
        }
        elseif ($Extensions -contains $Resolved.Extension) {
            $Files.Add($Resolved.FullName)
        }
    }
}

end {
    foreach ($File in $Files) {
        if ($Fix) {
            $Original = [System.IO.File]::ReadAllText($File)
            $Formatted = Invoke-Formatter -ScriptDefinition $Original -Settings $SettingsPath -Verbose:$false
            if ($Formatted -cne $Original) {
                # Keep the file's BOM (or lack of one) so 5.1 decodes it the same way.
                $Bytes = [System.IO.File]::ReadAllBytes($File)
                $HasBom = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF
                [System.IO.File]::WriteAllText($File, $Formatted, [System.Text.UTF8Encoding]::new($HasBom))
                Write-Verbose ('Reformatted {0}' -f $File)
            }
        }

        Write-Verbose ('Analyzing {0}' -f $File)

        # Invoke-ScriptAnalyzer -Path takes a single string, so call it per file.
        $AnalyzerParams = @{
            Path = $File
            Settings = $MainSettings
            CustomRulePath = $CustomRulePath
            IncludeDefaultRules = $true
            Verbose = $false
        }
        foreach ($Finding in (Invoke-StyleAnalyzer -AnalyzerParams $AnalyzerParams -File $File)) {
            $Findings.Add($Finding)
        }

        if ($RunCasingPass) {
            $CasingParams = @{
                Path = $File
                Settings = $CasingSettings
                Verbose = $false
            }
            foreach ($Finding in (Invoke-StyleAnalyzer -AnalyzerParams $CasingParams -File $File)) {
                $Findings.Add($Finding)
            }
        }

        foreach ($Finding in (Get-StyleFinding -File $File)) {
            $Findings.Add($Finding)
        }
    }

    Write-Verbose ('{0} file(s) analyzed, {1} finding(s).' -f $Files.Count, $Findings.Count)
    if (-not $EnableExit) {
        $Findings
        return
    }

    # exit stops the pipeline before buffered formatting flushes, so render the
    # table to a string first or the findings never reach the console.
    if ($Findings.Count -eq 0) {
        Write-Output ('Clean: {0} file(s), 0 findings.' -f $Files.Count)
        exit 0
    }
    $Table = $Findings | Sort-Object -Property File, Line |
        Format-Table -Property Severity, RuleName, File, Line, Message -AutoSize -Wrap |
            Out-String -Width 220
    Write-Output $Table.TrimEnd()
    Write-Output ('{0} finding(s) in {1} file(s).' -f $Findings.Count, $Files.Count)
    exit 1
}
