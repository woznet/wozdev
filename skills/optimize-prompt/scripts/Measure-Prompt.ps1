<#
    .SYNOPSIS
    Measures a prompt file and flags wording worth a second look.

    .DESCRIPTION
    Reports characters, words, lines, and an estimated token count for each prompt file, plus counts of
    filler phrases, shouted emphasis, and duplicated lines. With -Baseline it also reports the tokens saved
    against an earlier version. With -Findings it lists each flagged line instead of the summary.

    The token count is an estimate (characters divided by CharsPerToken). Tokenizers differ by model and by
    content, so use it to compare two versions of a prompt, not to predict a bill.

    .PARAMETER Path
    One or more prompt files to measure. To pass several with -File, list them positionally (omit -Path).

    .PARAMETER Baseline
    An earlier version of the prompt. Adds BaselineTokens, SavedTokens, and SavedPercent to the summary.

    .PARAMETER CharsPerToken
    Characters per token used for the estimate. Default 4, a common figure for English prose.

    .PARAMETER Findings
    Emit one object per flagged phrase or line (Line, Kind, Text, Path) instead of the summary.

    .EXAMPLE
    pwsh -NoProfile -File Measure-Prompt.ps1 -Path ./prompt.md
    Summarizes one prompt.

    .EXAMPLE
    pwsh -NoProfile -File Measure-Prompt.ps1 -Path ./prompt.md -Baseline ./original.md
    Summarizes the prompt and reports the saving against the original.

    .EXAMPLE
    pwsh -NoProfile -File Measure-Prompt.ps1 -Path ./prompt.md -Findings
    Lists each flagged line.

    .OUTPUTS
    System.Management.Automation.PSCustomObject
#>
[CmdletBinding()]
[OutputType([pscustomobject])]
param(
    [Parameter(Mandatory, Position = 0, ValueFromRemainingArguments)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path,

    [ValidateNotNullOrEmpty()]
    [string]$Baseline,

    [ValidateRange(1.0, 10.0)]
    [double]$CharsPerToken = 4.0,

    [switch]$Findings
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Plain output when run with -File: ANSI color codes clutter captured logs. $PSStyle exists only in 7.2+.
if (Get-Variable -Name PSStyle -ErrorAction Ignore) {
    $PSStyle.OutputRendering = 'PlainText'
}

# Phrases that usually carry no instruction. A match is a candidate for removal, not an error.
$FillerPattern = @(
    'please'
    'kindly'
    'thank you'
    'thanks in advance'
    'in order to'
    'it is (?:very |extremely )?important (?:to note |to remember )?(?:that|to)'
    'it should be noted that'
    'note that'
    'make sure (?:that|to)'
    'be sure to'
    'remember to'
    'i (?:want|need|would like) you to'
    'feel free to'
    'as (?:mentioned|stated|noted|described) (?:above|earlier|before|previously)'
    'in other words'
    'due to the fact that'
    'in the event that'
    'for the purpose of'
    'with regard to'
    'at this point in time'
    'each and every'
    'under any circumstances'
    'very'
    'really'
    'basically'
    'actually'
    'simply'
) -join '|'
$FillerRegex = [regex]::new(('\b(?:{0})\b' -f $FillerPattern), [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

# Case-sensitive on purpose: only the shouted forms are flagged.
$EmphasisRegex = [regex]::new('\b(?:IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS|MANDATORY|ABSOLUTELY|EXTREMELY|VERY)\b|!{2,}')

function Get-PromptText {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$LiteralPath
    )

    try {
        $Item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
        $Text = [System.IO.File]::ReadAllText($Item.FullName)
        # Normalize line endings so CRLF and LF copies of the same prompt measure the same.
        $Text -replace '\r\n?', "`n"
    }
    catch {
        $PSCmdlet.ThrowTerminatingError($_)
    }
}

function Get-TokenEstimate {
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [double]$CharsPerToken
    )

    [int][math]::Ceiling($Text.Length / $CharsPerToken)
}

function Get-PromptFinding {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $Lines = @($Text -split "`n")
    $Seen = [System.Collections.Generic.Dictionary[string, int]]::new()

    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
        $Line = $Lines[$Index]
        $LineNumber = $Index + 1

        foreach ($Match in $FillerRegex.Matches($Line)) {
            [pscustomobject]@{
                Line = $LineNumber
                Kind = 'Filler'
                Text = $Match.Value.ToLowerInvariant()
                Path = $Label
            }
        }

        foreach ($Match in $EmphasisRegex.Matches($Line)) {
            [pscustomobject]@{
                Line = $LineNumber
                Kind = 'Emphasis'
                Text = $Match.Value
                Path = $Label
            }
        }

        # Short lines, fences, and table rules repeat legitimately; only longer text counts as a duplicate.
        $Normalized = ($Line -replace '\s+', ' ').Trim().ToLowerInvariant()
        if ($Normalized.Length -lt 25 -or $Normalized -match '^[\s|:`~=-]+$') {
            continue
        }
        if ($Seen.ContainsKey($Normalized)) {
            $Preview = $Normalized
            if ($Preview.Length -gt 60) {
                $Preview = ('{0}...' -f $Preview.Substring(0, 60))
            }
            [pscustomobject]@{
                Line = $LineNumber
                Kind = 'Duplicate'
                Text = ('same as line {0}: {1}' -f $Seen[$Normalized], $Preview)
                Path = $Label
            }
        }
        else {
            $Seen[$Normalized] = $LineNumber
        }
    }
}

$BaselineTokens = $null
if ($PSBoundParameters.ContainsKey('Baseline')) {
    $BaselineTokens = Get-TokenEstimate -Text (Get-PromptText -LiteralPath $Baseline) -CharsPerToken $CharsPerToken
}

foreach ($File in $Path) {
    $Text = Get-PromptText -LiteralPath $File
    $FileFindings = @(Get-PromptFinding -Text $Text -Label $File)

    if ($Findings) {
        $FileFindings
        continue
    }

    $Tokens = Get-TokenEstimate -Text $Text -CharsPerToken $CharsPerToken
    $LineCount = 0
    if ($Text.Length -gt 0) {
        $LineCount = @($Text.TrimEnd("`n") -split "`n").Count
    }

    $Summary = [ordered]@{
        Path            = $File
        Characters      = $Text.Length
        Words           = [regex]::Matches($Text, '\S+').Count
        Lines           = $LineCount
        EstimatedTokens = $Tokens
        Filler          = @($FileFindings | Where-Object { $_.Kind -eq 'Filler' }).Count
        Emphasis        = @($FileFindings | Where-Object { $_.Kind -eq 'Emphasis' }).Count
        Duplicate       = @($FileFindings | Where-Object { $_.Kind -eq 'Duplicate' }).Count
    }

    if ($null -ne $BaselineTokens) {
        $Saved = $BaselineTokens - $Tokens
        $SavedPercent = 0.0
        if ($BaselineTokens -gt 0) {
            $SavedPercent = [math]::Round(100.0 * $Saved / $BaselineTokens, 1)
        }
        $Summary['BaselineTokens'] = $BaselineTokens
        $Summary['SavedTokens'] = $Saved
        $Summary['SavedPercent'] = $SavedPercent
    }

    [pscustomobject]$Summary
}
