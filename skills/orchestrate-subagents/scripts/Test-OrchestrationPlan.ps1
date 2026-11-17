<#
    .SYNOPSIS
    Checks an orchestration plan file against the orchestrate-subagents plan format.

    .DESCRIPTION
    Reads one or more docs/woz-plans/<name>-plan.md files and reports every problem that would stop the plan
    from running safely: missing sections, an invalid mode, batches missing a field, empty fields, write keys
    that are not backticked, dependencies on unknown batches or on the batch itself, dependency cycles, write
    keys held by two batches with no dependency path between them, and, in plan_only mode, a missing or
    unlinked execute file.

    Prints one line per finding as 'path:line: error: message' (or 'path: error: message' for findings that
    belong to the whole file), sorted by line. Prints 'OK: path (N batches, mode M)' for a clean plan.
    Text inside fenced code blocks is ignored.

    Exit codes: 0 when every plan is clean, 1 when any plan has findings, 2 for a missing file.

    .PARAMETER Path
    One or more plan files to check. To pass several with -File, list them positionally (omit -Path).

    .EXAMPLE
    pwsh -NoProfile -File Test-OrchestrationPlan.ps1 docs/woz-plans/version-bump-ci-plan.md
    Checks one plan and, because it is plan_only, its execute file.

    .OUTPUTS
    System.String
#>
[CmdletBinding()]
[OutputType([string])]
param(
    [Parameter(Mandatory, Position = 0, ValueFromRemainingArguments)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Keep these lists and every message below in sync with test-orchestration-plan.sh; the two must print
# identical output.
$RequiredSections = @(
    'Overall Goal'
    'Operating Mode and Authorization'
    'Context Manifest'
    'Batches'
    'Final Review'
)
$RequiredFields = @(
    'Write Keys'
    'Target Context'
    'Dependencies'
    'Acceptance Criteria'
    'Instructions'
)
$FieldPattern = '^- \*\*(Write Keys|Target Context|Dependencies|Acceptance Criteria|Instructions)\*\*:\s*(.*?)\s*$'

function Test-KeyOverlap {
    <#
        .SYNOPSIS
        Returns $true when two normalized write keys name the same thing or one tree contains the other.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [string]$First,

        [Parameter(Mandatory)]
        [string]$Second
    )

    if ($First -eq $Second) {
        return $true
    }
    if ($First.EndsWith('/') -and $Second.StartsWith($First)) {
        return $true
    }
    if ($Second.EndsWith('/') -and $First.StartsWith($Second)) {
        return $true
    }
    return $false
}

function Test-PlanFile {
    <#
        .SYNOPSIS
        Checks one plan file, writes its report lines, and returns $true when it is clean.
    #>
    [CmdletBinding()]
    [OutputType([string], [bool])]
    param(
        [Parameter(Mandatory)]
        [string]$PlanPath
    )

    # Seq keeps findings on the same line in the order they were found.
    $Findings = [System.Collections.Generic.List[object]]::new()
    function Add-Finding {
        param([int]$Line, [string]$Message)
        $Findings.Add([pscustomobject]@{ Line = $Line; Seq = $Findings.Count; Message = $Message })
    }

    $Lines = @(Get-Content -LiteralPath $PlanPath -Encoding utf8)
    $SeenSections = @{}
    $Mode = $null
    $ModeLine = 0
    $Batches = [System.Collections.Generic.List[object]]::new()
    $Current = $null
    $InFinal = $false
    $FinalInstructions = $false
    $FenceChar = $null
    $FenceLength = 0
    $Pending = $null

    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
        $LineNumber = $Index + 1
        $Text = $Lines[$Index]

        # Skip fenced code: a fence closes only with the same character, at least as long as the opener.
        if ($null -ne $FenceChar) {
            if ($Text -match ('^\s*{0}{{{1},}}\s*$' -f [regex]::Escape($FenceChar), $FenceLength)) {
                $FenceChar = $null
            }
            continue
        }
        if ($Text -match '^\s*(`{3,}|~{3,})') {
            $FenceChar = $Matches[1].Substring(0, 1)
            $FenceLength = $Matches[1].Length
            continue
        }

        # A field with no inline value must be followed by an indented list item.
        if ($null -ne $Pending) {
            if ($Text -match '^\s{2,}[-*]\s+\S') {
                $Pending = $null
                continue
            }
            if ($Text -match '^\s*$') {
                continue
            }
            Add-Finding -Line $Pending.Line -Message ('field "{0}" is empty' -f $Pending.Field)
            $Pending = $null
        }

        if ($Text -match '^##\s+(.+?)\s*$' -and $Text -notmatch '^###') {
            $Current = $null
            $Name = $Matches[1]
            $SeenSections[$Name.ToLowerInvariant()] = $true
            $InFinal = ($Name -ieq 'Final Review')
            continue
        }
        if ($Text -match '^###\s+Batch\s+(\d+)\b') {
            $Number = [int]$Matches[1]
            $Duplicate = @($Batches | Where-Object { $_.Number -eq $Number })
            if ($Duplicate.Count -gt 0) {
                Add-Finding -Line $LineNumber -Message ('duplicate Batch {0}' -f $Number)
            }
            $Current = [pscustomobject]@{
                Number       = $Number
                Line         = $LineNumber
                Fields       = @{}
                Keys         = [System.Collections.Generic.List[string]]::new()
                Dependencies = [System.Collections.Generic.List[object]]::new()
            }
            $Batches.Add($Current)
            continue
        }
        if ($Text -match '^###') {
            $Current = $null
            continue
        }

        if ($Text -match '^- \*\*Mode\*\*:\s*(.*?)\s*$') {
            $ModeLine = $LineNumber
            if ($Matches[1] -match '\bplan_and_execute\b') {
                $Mode = 'plan_and_execute'
            }
            elseif ($Matches[1] -match '\bplan_only\b') {
                $Mode = 'plan_only'
            }
            continue
        }

        if ($Text -match $FieldPattern) {
            $Field = $Matches[1]
            $Value = $Matches[2]
            if ($null -eq $Current) {
                if ($InFinal -and $Field -eq 'Instructions') {
                    $FinalInstructions = $true
                    if ($Value -eq '') {
                        $Pending = [pscustomobject]@{ Line = $LineNumber; Field = $Field }
                    }
                }
                continue
            }

            $Current.Fields[$Field] = $true
            if ($Value -eq '') {
                $Pending = [pscustomobject]@{ Line = $LineNumber; Field = $Field }
                continue
            }

            if ($Field -eq 'Write Keys') {
                $KeyMatches = [regex]::Matches($Value, '`([^`]+)`')
                if ($KeyMatches.Count -eq 0) {
                    if ($Value -notmatch '^(?i)none\b') {
                        Add-Finding -Line $LineNumber -Message 'Write Keys must be backticked keys or none'
                    }
                }
                foreach ($KeyMatch in $KeyMatches) {
                    $Key = $KeyMatch.Groups[1].Value.Trim().ToLowerInvariant().Replace('\', '/')
                    $Key = $Key -replace '^\./', ''
                    $Current.Keys.Add($Key)
                }
            }
            elseif ($Field -eq 'Dependencies') {
                $DependencyMatches = [regex]::Matches($Value, '(?i)\bBatch\s+(\d+)')
                if ($DependencyMatches.Count -eq 0) {
                    if ($Value -notmatch '^(?i)none\b') {
                        Add-Finding -Line $LineNumber -Message 'Dependencies must be none or Batch references'
                    }
                }
                foreach ($DependencyMatch in $DependencyMatches) {
                    $Current.Dependencies.Add([pscustomobject]@{
                            Number = [int]$DependencyMatch.Groups[1].Value
                            Line   = $LineNumber
                        })
                }
            }
        }
    }
    if ($null -ne $Pending) {
        Add-Finding -Line $Pending.Line -Message ('field "{0}" is empty' -f $Pending.Field)
    }

    # Whole-file checks.
    foreach ($Section in $RequiredSections) {
        if (-not $SeenSections.ContainsKey($Section.ToLowerInvariant())) {
            Add-Finding -Line 0 -Message ('missing section "## {0}"' -f $Section)
        }
    }
    if ($null -eq $Mode) {
        Add-Finding -Line $ModeLine -Message 'Mode must be `plan_only` or `plan_and_execute`'
    }
    if ($Batches.Count -eq 0) {
        Add-Finding -Line 0 -Message 'no "### Batch <number>:" sections'
    }
    if ($SeenSections.ContainsKey('final review') -and -not $FinalInstructions) {
        Add-Finding -Line 0 -Message 'Final Review has no Instructions field'
    }

    # Per-batch fields and dependency targets.
    $Known = @{}
    foreach ($Batch in $Batches) {
        $Known[$Batch.Number] = $true
    }
    foreach ($Batch in $Batches) {
        foreach ($Field in $RequiredFields) {
            if (-not $Batch.Fields.ContainsKey($Field)) {
                Add-Finding -Line $Batch.Line -Message ('Batch {0} is missing field "{1}"' -f $Batch.Number, $Field)
            }
        }
        foreach ($Dependency in $Batch.Dependencies) {
            if ($Dependency.Number -eq $Batch.Number) {
                Add-Finding -Line $Dependency.Line -Message ('Batch {0} depends on itself' -f $Batch.Number)
            }
            elseif (-not $Known.ContainsKey($Dependency.Number)) {
                Add-Finding -Line $Dependency.Line -Message ('Batch {0} depends on unknown Batch {1}' -f $Batch.Number, $Dependency.Number)
            }
        }
    }

    # Dependency edges between distinct, known batches.
    $Edges = @{}
    foreach ($Batch in $Batches) {
        $Targets = $Batch.Dependencies | Where-Object { $_.Number -ne $Batch.Number -and $Known.ContainsKey($_.Number) }
        $Edges[$Batch.Number] = @($Targets | ForEach-Object { $_.Number } | Sort-Object -Unique)
    }

    # Cycles: whatever Kahn's algorithm cannot remove is in, or waits on, a cycle.
    $Remaining = @{}
    foreach ($Number in $Edges.Keys) {
        $Remaining[$Number] = @($Edges[$Number]).Count
    }
    $Done = @{}
    $Progress = $true
    while ($Progress) {
        $Progress = $false
        foreach ($Number in @($Remaining.Keys)) {
            if ($Done.ContainsKey($Number)) {
                continue
            }
            $Open = @($Edges[$Number] | Where-Object { -not $Done.ContainsKey($_) })
            if ($Open.Count -eq 0) {
                $Done[$Number] = $true
                $Progress = $true
            }
        }
    }
    $Stuck = @($Edges.Keys | Where-Object { -not $Done.ContainsKey($_) } | Sort-Object)
    if ($Stuck.Count -gt 0) {
        Add-Finding -Line 0 -Message ('dependency cycle among batches: {0}' -f ($Stuck -join ', '))
    }

    # Reachability: $Reach[a][b] is true when a depends on b directly or through a chain.
    $Reach = @{}
    foreach ($Number in $Edges.Keys) {
        $Seen = @{}
        $Stack = [System.Collections.Generic.Stack[int]]::new()
        foreach ($Next in $Edges[$Number]) {
            $Stack.Push($Next)
        }
        while ($Stack.Count -gt 0) {
            $Node = $Stack.Pop()
            if ($Seen.ContainsKey($Node)) {
                continue
            }
            $Seen[$Node] = $true
            foreach ($Next in $Edges[$Node]) {
                $Stack.Push($Next)
            }
        }
        $Reach[$Number] = $Seen
    }

    # Write-key ownership: overlapping keys need a dependency path between their batches.
    for ($First = 0; $First -lt $Batches.Count; $First++) {
        for ($Second = $First + 1; $Second -lt $Batches.Count; $Second++) {
            $Earlier = $Batches[$First]
            $Later = $Batches[$Second]
            if ($Earlier.Number -eq $Later.Number) {
                continue
            }
            if ($Reach[$Earlier.Number].ContainsKey($Later.Number) -or $Reach[$Later.Number].ContainsKey($Earlier.Number)) {
                continue
            }
            foreach ($LaterKey in $Later.Keys) {
                foreach ($EarlierKey in $Earlier.Keys) {
                    if (Test-KeyOverlap -First $LaterKey -Second $EarlierKey) {
                        $Message = 'Batch {0} write key `{1}` overlaps `{2}` in Batch {3} with no dependency path between them' -f $Later.Number, $LaterKey, $EarlierKey, $Earlier.Number
                        Add-Finding -Line $Later.Line -Message $Message
                        break
                    }
                }
            }
        }
    }

    # plan_only needs its execute file beside the plan, naming the plan.
    if ($Mode -eq 'plan_only') {
        $PlanName = $PlanPath -replace '^.*[\\/]', ''
        if ($PlanName -notmatch '-plan\.md$') {
            Add-Finding -Line 0 -Message 'plan file name must end in -plan.md'
        }
        else {
            $ExecutePath = $PlanPath -replace '-plan\.md$', '-execute.md'
            if (-not (Test-Path -LiteralPath $ExecutePath -PathType Leaf)) {
                Add-Finding -Line 0 -Message ('plan_only plan needs execute file {0}' -f $ExecutePath)
            }
            else {
                $ExecuteText = Get-Content -LiteralPath $ExecutePath -Raw -Encoding utf8
                if ($null -eq $ExecuteText -or -not $ExecuteText.Contains($PlanName)) {
                    Add-Finding -Line 0 -Message ('execute file {0} does not reference {1}' -f $ExecutePath, $PlanName)
                }
            }
        }
    }

    foreach ($Finding in ($Findings | Sort-Object -Property Line, Seq)) {
        if ($Finding.Line -eq 0) {
            '{0}: error: {1}' -f $PlanPath, $Finding.Message
        }
        else {
            '{0}:{1}: error: {2}' -f $PlanPath, $Finding.Line, $Finding.Message
        }
    }
    if ($Findings.Count -eq 0) {
        $ModeText = if ($null -eq $Mode) { 'unknown' } else { $Mode }
        'OK: {0} ({1} batches, mode {2})' -f $PlanPath, $Batches.Count, $ModeText
    }
    return ($Findings.Count -eq 0)
}

# Check every path before any plan, so a typo stops the run with no partial output.
$Missing = @($Path | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($Missing.Count -gt 0) {
    foreach ($Item in $Missing) {
        [Console]::Error.WriteLine(('Test-OrchestrationPlan.ps1: file not found: {0}' -f $Item))
    }
    exit 2
}

$AllClean = $true
foreach ($Item in $Path) {
    $Result = @(Test-PlanFile -PlanPath $Item)
    $Clean = [bool]$Result[-1]
    $Result | Select-Object -SkipLast 1 | Write-Output
    if (-not $Clean) {
        $AllClean = $false
    }
}

if (-not $AllClean) {
    exit 1
}
exit 0
