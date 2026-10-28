#Requires -Version 5.1
#Requires -Modules PSScriptAnalyzer
<#
    WozDev-Rules.psm1

    PSScriptAnalyzer custom rules that port the wozdev VS Code extension's PowerShell
    quick fixes, plus the checks of the writing-powershell skill's Test-PowerShellStyle.ps1.
    Findings carry a SuggestedCorrection where the rewrite is safe, so they are fixable
    with 'Invoke-ScriptAnalyzer -Fix' and from the VS Code PowerShell extension's
    lightbulb menu; a finding that cannot be rewritten safely says why in its message.

    Rules
        Measure-UnusedAssignment          $x = ... that is never read afterward -> remove the statement
        Measure-VariableCaseMismatch      $Result vs $result                    -> casing of the declaration
        Measure-AutomaticVariableCase     $True, $Psitem, $Erroractionpreference -> $true, $PSItem, $ErrorActionPreference
        Measure-AvoidOutNull              ... | Out-Null                        -> $null = ... or [void](...)
        Measure-UseStaticConstructor      New-Object Type -ArgumentList a, b    -> [Type]::new(a, b)
        Measure-UsePascalCaseVariable     $itemCount                            -> $ItemCount
        Measure-AvoidStringInterpolation  "Copied $Count files"                 -> ('Copied {0} files' -f $Count)
                                          "URL '$Url' is up"                    -> ("URL '{0}' is up" -f $Url)
        Measure-AvoidReturnValue          return $Result (advanced function)    -> $Result, then a bare return
        Measure-AvoidBacktickContinuation Cmd -A 1 `<newline> -B 2              -> $CmdParams = @{...}; Cmd @CmdParams
        Measure-AvoidDoubledSingleQuote   'name ''{0}'''                        -> report only: 'name "{0}"'
        Measure-UseWhereObjectScriptBlock Where-Object -Property Name -EQ -Value 'a' -> Where-Object { $_.Name -eq 'a' }
                                          Where-Object -FilterScript { ... }    -> Where-Object { ... }

    Usage
        Invoke-ScriptAnalyzer -Path .\MyScripts -Recurse -CustomRulePath .\WozDev-Rules.psm1 -IncludeDefaultRules
        Invoke-ScriptAnalyzer -Path .\MyScript.ps1 -CustomRulePath .\WozDev-Rules.psm1 -Fix

    Requires Windows PowerShell 5.1 or PowerShell 7 and the PSScriptAnalyzer module.
    See README.md next to this file for details.
#>

#region canonical names

# Automatic/special variables in their documented canonical casing. Matched
# case-insensitively; the stored spelling is what the casing fix writes.
$script:WozDevAutomaticNames = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($Name in @(
        '?', '^', '_', 'args', 'ConsoleFileName', 'EnabledExperimentalFeatures', 'Error', 'Event', 'EventArgs',
        'EventSubscriber', 'ExecutionContext', 'false', 'foreach', 'HOME', 'Host', 'input', 'IsCoreCLR', 'IsLinux',
        'IsMacOS', 'IsWindows', 'LASTEXITCODE', 'Matches', 'MyInvocation', 'NestedPromptLevel', 'null', 'PID',
        'PROFILE', 'PSBoundParameters', 'PSCmdlet', 'PSCommandPath', 'PSCulture', 'PSDebugContext', 'PSEdition',
        'PSHOME', 'PSItem', 'PSScriptRoot', 'PSSenderInfo', 'PSUICulture', 'PSVersionTable', 'PWD', 'Sender',
        'ShellId', 'StackTrace', 'switch', 'this', 'true'
    )) {
    $script:WozDevAutomaticNames[$Name] = $Name
}

# Preference variables (about_Preference_Variables). Same treatment, separate
# label so the message can say "preference variable".
$script:WozDevPreferenceNames = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($Name in @(
        'ConfirmPreference', 'DebugPreference', 'ErrorActionPreference', 'ErrorView', 'FormatEnumerationLimit',
        'InformationPreference', 'MaximumHistoryCount', 'OFS', 'OutputEncoding', 'ProgressPreference',
        'PSDefaultParameterValues', 'PSEmailServer', 'PSModuleAutoLoadingPreference',
        'PSNativeCommandArgumentPassing', 'PSNativeCommandUseErrorActionPreference', 'PSSessionApplicationName',
        'PSSessionConfigurationName', 'PSSessionOption', 'PSStyle', 'Transcript', 'VerbosePreference',
        'WarningPreference', 'WhatIfPreference'
    )) {
    $script:WozDevPreferenceNames[$Name] = $Name
}

# Type names New-Object resolves to PSObject. With -Property they create a custom
# object, which the [pscustomobject] cast does without the cmdlet.
$script:WozDevPSObjectTypeNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($Name in @(
        'psobject', 'pscustomobject', 'Management.Automation.PSObject', 'Management.Automation.PSCustomObject',
        'System.Management.Automation.PSObject', 'System.Management.Automation.PSCustomObject'
    )) {
    $null = $script:WozDevPSObjectTypeNames.Add($Name)
}

# Where-Object comparison switches and the operator each one stands for in a script
# block: -EQ -> -eq, -CEQ -> -ceq, -IEQ -> -ieq, plus -Is, -IsNot and -Not.
$script:WozDevWhereObjectOperators = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($Name in @('EQ', 'NE', 'GT', 'LT', 'GE', 'LE', 'Like', 'NotLike', 'Match', 'NotMatch', 'Contains', 'NotContains', 'In', 'NotIn')) {
    $Operator = $Name.ToLowerInvariant()
    $script:WozDevWhereObjectOperators[$Name] = '-' + $Operator
    $script:WozDevWhereObjectOperators['C' + $Name] = '-c' + $Operator
    $script:WozDevWhereObjectOperators['I' + $Name] = '-i' + $Operator
}
foreach ($Name in @('Is', 'IsNot', 'Not')) {
    $script:WozDevWhereObjectOperators[$Name] = '-' + $Name.ToLowerInvariant()
}

#endregion canonical names

#region helpers

function New-WozDevDiagnosticRecord {
    <#
        .SYNOPSIS
            Create a PSScriptAnalyzer DiagnosticRecord, with or without one SuggestedCorrection.
        .DESCRIPTION
            Builds the DiagnosticRecord PSScriptAnalyzer expects from a custom rule. With
            -CorrectionText and -Description the record gets exactly one CorrectionExtent so
            that Invoke-ScriptAnalyzer -Fix and editor quick fixes can apply it; an empty
            -CorrectionText deletes the range. Without them the record is a plain warning
            that no fix applies to.
        .PARAMETER Extent
            Extent of the finding (what gets the squiggle).
        .PARAMETER Message
            Message displayed by PSScriptAnalyzer.
        .PARAMETER RuleName
            Rule name; also used as RuleSuppressionID.
        .PARAMETER CorrectionText
            Replacement text for the correction range. An empty string deletes the range.
        .PARAMETER Description
            Short description of the correction (the quick-fix title in editors).
        .PARAMETER CorrectionRange
            Correction range as StartLine, StartColumn, EndLine, EndColumn (1-based, end column exclusive).
            Defaults to -Extent.
        .PARAMETER Severity
            Severity of the finding. Defaults to Warning.
    #>
    [CmdletBinding(DefaultParameterSetName = 'NoCorrection')]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord])]
    [System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Builds an in-memory record only; no system state changes.')]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.IScriptExtent]$Extent,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Message,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RuleName,

        [Parameter(Mandatory, ParameterSetName = 'Correction')]
        [AllowEmptyString()]
        [string]$CorrectionText,

        [Parameter(Mandatory, ParameterSetName = 'Correction')]
        [ValidateNotNullOrEmpty()]
        [string]$Description,

        [Parameter(ParameterSetName = 'Correction')]
        [ValidateCount(4, 4)]
        [int[]]$CorrectionRange,

        [ValidateSet('Information', 'Warning', 'Error')]
        [string]$Severity = 'Warning'
    )

    $Corrections = $null
    if ($PSCmdlet.ParameterSetName -eq 'Correction') {
        if (-not $CorrectionRange) {
            $CorrectionRange = @($Extent.StartLineNumber, $Extent.StartColumnNumber, $Extent.EndLineNumber, $Extent.EndColumnNumber)
        }

        # The constructor takes the lines first, then the columns. $Extent.File is $null
        # under -ScriptDefinition, which CorrectionExtent accepts.
        $Correction = [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.CorrectionExtent]::new(
            $CorrectionRange[0], $CorrectionRange[2], $CorrectionRange[1], $CorrectionRange[3],
            $CorrectionText, $Extent.File, $Description
        )
        $Corrections = [System.Collections.ObjectModel.Collection[Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.CorrectionExtent]]::new()
        $Corrections.Add($Correction)
    }

    [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord]@{
        Message = $Message
        Extent = $Extent
        RuleName = $RuleName
        Severity = $Severity
        RuleSuppressionID = $RuleName
        SuggestedCorrections = $Corrections
    }
}

function Get-WozDevVariableOccurrence {
    <#
        .SYNOPSIS
            List every variable occurrence in a script with its classification.
        .DESCRIPTION
            Finds every VariableExpressionAst under the root script block (nested script
            blocks and expandable strings included), sorted by position, and classifies
            each one the way the wozdev extension does. First match wins:
            Parameter, Scoped, Automatic, Preference, Assigned, Referenced.
            Parameter and Assigned are decided by exact (case-sensitive) token text, so
            '$Path' is not the parameter '$Path'; that is what lets the casing rule treat
            the parameter as the declaration.
        .PARAMETER ScriptBlockAst
            The ROOT script block of the file.
        .OUTPUTS
            One [pscustomobject] per occurrence, in document order. Collect with @(...).
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    $ParameterExtents = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($Parameter in $ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.ParameterAst] }, $true)) {
        $null = $ParameterExtents.Add($Parameter.Name.Extent.Text)
    }

    # Assignment targets: the left side, unwrapped through exactly one cast, so
    # '[int]$B = 1' counts but '[int][string]$C = 1', '$A, $B = 1, 2' and '$x.P = 1' do not.
    $AssignmentExtents = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $AssignmentTargets = [System.Collections.Generic.Dictionary[object, object]]::new()
    foreach ($Assignment in $ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)) {
        $Target = $Assignment.Left
        if ($Target -is [System.Management.Automation.Language.ConvertExpressionAst]) {
            $Target = $Target.Child
        }
        if ($Target -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $null = $AssignmentExtents.Add($Target.Extent.Text)
            $AssignmentTargets[$Target] = $Assignment
        }
    }

    $Variables = @($ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) | Sort-Object -Property { $_.Extent.StartOffset })
    foreach ($Variable in $Variables) {
        $Text = $Variable.Extent.Text
        $UserPath = $Variable.VariablePath.UserPath
        $Canonical = $null

        if ($ParameterExtents.Contains($Text)) {
            $Kind = 'Parameter'
        }
        elseif (-not $Variable.VariablePath.IsUnqualified -or $Text.IndexOf(':') -ge 0) {
            # '$Using:x' reports IsUnqualified, yet rewriting its token would drop the
            # qualifier, so any ':' in the token text counts as scoped.
            $Kind = 'Scoped'
        }
        elseif ($script:WozDevAutomaticNames.ContainsKey($UserPath)) {
            $Kind = 'Automatic'
            $Canonical = $script:WozDevAutomaticNames[$UserPath]
        }
        elseif ($script:WozDevPreferenceNames.ContainsKey($UserPath)) {
            $Kind = 'Preference'
            $Canonical = $script:WozDevPreferenceNames[$UserPath]
        }
        elseif ($AssignmentExtents.Contains($Text)) {
            $Kind = 'Assigned'
        }
        else {
            $Kind = 'Referenced'
        }

        $Assignment = $null
        $Operator = $null
        if ($AssignmentTargets.ContainsKey($Variable)) {
            $Assignment = $AssignmentTargets[$Variable]
            $Operator = $Assignment.Operator.ToString()
        }

        [pscustomobject]@{
            Ast = $Variable
            Name = $UserPath
            FullName = $Text
            Kind = $Kind
            CanonicalName = $Canonical
            IsSplatted = $Variable.Splatted
            IsAssignmentTarget = ($null -ne $Assignment)
            AssignmentOperator = $Operator
            AssignmentAst = $Assignment
            Extent = $Variable.Extent
            StartOffset = $Variable.Extent.StartOffset
            EndOffset = $Variable.Extent.EndOffset
            IsPureWrite = ($null -ne $Assignment -and $Operator -eq 'Equals')
            UnqualifiedName = $UserPath.Substring($UserPath.LastIndexOf(':') + 1).ToLowerInvariant()
        }
    }
}

function ConvertTo-WozDevVariableToken {
    <#
        .SYNOPSIS
            Rebuild a variable token with a new name, keeping its $, @ or ${...} form.
        .PARAMETER FullName
            The token as written, e.g. '$Result', '@Params' or '${Result}'.
        .PARAMETER CanonicalName
            The name to write instead.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$FullName,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$CanonicalName
    )

    if ($FullName.StartsWith('${')) {
        '${' + $CanonicalName + '}'
    }
    elseif ($FullName.StartsWith('@')) {
        '@' + $CanonicalName
    }
    else {
        '$' + $CanonicalName
    }
}

function Test-WozDevPrimaryExpression {
    <#
        .SYNOPSIS
            Decide whether an expression binds tighter than a [void] cast.
        .DESCRIPTION
            True for variables, member and method access, indexing, parentheses, $(...),
            @(...), hashtables, constants, strings, script blocks and casts, which can
            follow '[void]' directly. Binary, unary, array-literal and other expressions
            need parentheses, or the cast would apply to their first operand only.
        .PARAMETER Expression
            The expression that starts the pipeline.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpressionAst]$Expression
    )

    $Expression -is [System.Management.Automation.Language.VariableExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.MemberExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.IndexExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.ParenExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.SubExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.ArrayExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.HashtableAst] -or
    $Expression -is [System.Management.Automation.Language.ConstantExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
    $Expression -is [System.Management.Automation.Language.ConvertExpressionAst]
}

function Get-WozDevScriptLine {
    <#
        .SYNOPSIS
            Split the full script text into lines.
        .DESCRIPTION
            Splits on LF and strips one trailing CR per line, so CRLF and LF files give the
            same list and a file that ends with a newline gets a trailing empty line. That
            trailing line is what lets a last-statement removal swallow its line break.
        .PARAMETER ScriptBlockAst
            The ROOT script block of the file.
        .OUTPUTS
            [string] per line, in order. Collect with @(...).
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    $Text = $ScriptBlockAst.Extent.StartScriptPosition.GetFullScript()
    if ($null -eq $Text) {
        $Text = $ScriptBlockAst.Extent.Text
    }

    foreach ($Line in $Text.Split([char]"`n")) {
        if ($Line.EndsWith("`r")) {
            $Line.Substring(0, $Line.Length - 1)
        }
        else {
            $Line
        }
    }
}

function Test-WozDevAssignmentIsLive {
    <#
        .SYNOPSIS
            Decide whether an assignment's value can still be observed.
        .DESCRIPTION
            True when the variable is read anywhere after the assignment token; or, when
            the assignment sits inside a loop or a script-block literal (which may run
            again, like a ForEach-Object body), anywhere inside the outermost such
            container; or inside a function or script-block literal that does not contain
            the assignment, since that code can run later and PowerShell scoping is
            dynamic. Reads are matched by unqualified name, case-insensitively, so
            $script:x and $Using:x keep a plain $x alive. A function body holding both the
            read and the assignment is not a container: every call starts a fresh scope.
        .PARAMETER Subject
            The assignment-target occurrence from Get-WozDevVariableOccurrence.
        .PARAMETER Read
            The occurrences that are not plain '=' targets. Other names are ignored.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [pscustomobject]$Subject,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [pscustomobject[]]$Read
    )

    $Name = $Subject.UnqualifiedName
    foreach ($Occurrence in $Read) {
        if ($Occurrence.UnqualifiedName -eq $Name -and $Occurrence.StartOffset -ge $Subject.EndOffset) {
            $true
            return
        }
    }

    # Inside a loop (or a script block that may run again) a read placed before the
    # assignment observes the previous iteration's value: check the outermost container.
    $Container = $null
    $Node = $Subject.Ast.Parent
    while ($null -ne $Node) {
        if ($Node -is [System.Management.Automation.Language.LoopStatementAst] -or $Node -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
            $Container = $Node
        }
        $Node = $Node.Parent
    }
    if ($null -ne $Container) {
        $Start = $Container.Extent.StartOffset
        $End = $Container.Extent.EndOffset
        foreach ($Occurrence in $Read) {
            if ($Occurrence.UnqualifiedName -eq $Name -and $Occurrence.StartOffset -ge $Start -and $Occurrence.EndOffset -le $End) {
                $true
                return
            }
        }
    }

    # A read inside a function or script-block literal that does not contain the
    # assignment can run after it: functions are called later, and PowerShell scoping
    # is dynamic, so the function sees the caller's variable.
    foreach ($Occurrence in $Read) {
        if ($Occurrence.UnqualifiedName -ne $Name) {
            continue
        }
        $Node = $Occurrence.Ast.Parent
        while ($null -ne $Node) {
            if ($Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -or $Node -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
                if ($Subject.StartOffset -lt $Node.Extent.StartOffset -or $Subject.EndOffset -gt $Node.Extent.EndOffset) {
                    $true
                    return
                }
            }
            $Node = $Node.Parent
        }
    }

    $false
}

function Get-WozDevStatementRemovalRange {
    <#
        .SYNOPSIS
            Work out the range to delete for a whole statement.
        .DESCRIPTION
            Deletes the statement's own lines, line break included, when nothing else
            shares its first and last line. When other code shares a line (such as
            '$x = 1; Write-Output hi' or a trailing comment) only the statement's extent
            goes. On the last line of the file the range stops at the end of that line.
        .PARAMETER Statement
            Extent of the statement to remove.
        .PARAMETER ScriptLine
            The script's lines, from Get-WozDevScriptLine.
        .OUTPUTS
            [int[]] StartLine, StartColumn, EndLine, EndColumn.
    #>
    [CmdletBinding()]
    [OutputType([int[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.IScriptExtent]$Statement,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string[]]$ScriptLine
    )

    $FirstLine = $ScriptLine[$Statement.StartLineNumber - 1]
    $LastLine = $ScriptLine[$Statement.EndLineNumber - 1]
    $Before = $FirstLine.Substring(0, [Math]::Min($Statement.StartColumnNumber - 1, $FirstLine.Length))
    $After = $LastLine.Substring([Math]::Min($Statement.EndColumnNumber - 1, $LastLine.Length))

    if (-not [string]::IsNullOrWhiteSpace($Before) -or -not [string]::IsNullOrWhiteSpace($After)) {
        # Something else shares the line: remove only the statement itself.
        [int[]]@($Statement.StartLineNumber, $Statement.StartColumnNumber, $Statement.EndLineNumber, $Statement.EndColumnNumber)
    }
    elseif ($Statement.EndLineNumber -lt $ScriptLine.Count) {
        # Swallow the whole line(s) including the trailing line break.
        [int[]]@($Statement.StartLineNumber, 1, ($Statement.EndLineNumber + 1), 1)
    }
    else {
        [int[]]@($Statement.StartLineNumber, 1, $Statement.EndLineNumber, ($LastLine.Length + 1))
    }
}

function Test-WozDevTypeLiteral {
    <#
        .SYNOPSIS
            Decide whether a type name can be written as a type literal.
        .DESCRIPTION
            Parses '[<TypeName>]' and returns true only when that gives one type expression
            covering the whole text with no parse errors. 'List[string]', 'byte[]' and
            'Dictionary[string, int]' pass; text that would escape the brackets, such as
            'Foo] + [Bar', does not. No type is loaded or looked up.
        .PARAMETER TypeName
            The type name as New-Object received it.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$TypeName
    )

    $IsLiteral = $false
    if (-not [string]::IsNullOrWhiteSpace($TypeName)) {
        $Literal = '[{0}]' -f $TypeName
        $Tokens = $null
        $Errors = $null
        $Ast = [System.Management.Automation.Language.Parser]::ParseInput($Literal, [ref]$Tokens, [ref]$Errors)
        if ($Errors.Count -eq 0 -and $null -ne $Ast.EndBlock -and $Ast.EndBlock.Statements.Count -eq 1) {
            $Expression = Get-WozDevPureExpression -Statement $Ast.EndBlock.Statements[0]
            $IsLiteral = $Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $Expression.Extent.Text -eq $Literal
        }
    }
    $IsLiteral
}

function Resolve-WozDevTypeName {
    <#
        .SYNOPSIS
            Look up a type name in the analyzing session, as a type literal would.
        .DESCRIPTION
            Tries the name as written, then prefixed with each namespace from the analyzed
            file's 'using namespace' statements. Returns the [type], or nothing when no
            loaded assembly defines it. Results, misses included, are kept in -Cache.
        .PARAMETER TypeName
            A name that passed Test-WozDevTypeLiteral.
        .PARAMETER Namespace
            Namespaces from the analyzed file's 'using namespace' statements.
        .PARAMETER Cache
            Lookup cache shared by one rule run.
    #>
    [CmdletBinding()]
    [OutputType([type])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TypeName,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$Namespace,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Collections.Generic.Dictionary[string, object]]$Cache
    )

    if (-not $Cache.ContainsKey($TypeName)) {
        $Type = $TypeName -as [type]
        foreach ($Name in $Namespace) {
            if ($null -ne $Type) {
                break
            }
            $Type = ('{0}.{1}' -f $Name, $TypeName) -as [type]
        }
        $Cache[$TypeName] = $Type
    }
    $Cache[$TypeName]
}

function Test-WozDevEnumerableType {
    <#
        .SYNOPSIS
            Decide whether PowerShell unrolls instances of a type in the pipeline.
        .DESCRIPTION
            True for IEnumerable types other than strings and dictionaries. Erring toward
            true is safe: it only adds a ',' that does not change the result.
        .PARAMETER Type
            The type to test.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [type]$Type
    )

    [System.Collections.IEnumerable].IsAssignableFrom($Type) -and
    $Type -ne [string] -and
    -not [System.Collections.IDictionary].IsAssignableFrom($Type)
}

function Test-WozDevCoreType {
    <#
        .SYNOPSIS
            Decide whether a type is loaded in every PowerShell session before it parses a script.
        .DESCRIPTION
            True when the type, its array element type and its generic arguments all come
            from the core library or System.Management.Automation. Only those are certain
            to resolve inside a class, where type literals are resolved at parse time.
        .PARAMETER Type
            The type to test.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [type]$Type
    )

    if ($Type.HasElementType) {
        Test-WozDevCoreType -Type $Type.GetElementType()
    }
    else {
        $IsCore = $Type.Assembly -eq [object].Assembly -or $Type.Assembly -eq [psobject].Assembly
        if ($IsCore -and $Type.IsGenericType) {
            foreach ($Argument in $Type.GetGenericArguments()) {
                if (-not (Test-WozDevCoreType -Type $Argument)) {
                    $IsCore = $false
                    break
                }
            }
        }
        $IsCore
    }
}

function Get-WozDevPureExpression {
    <#
        .SYNOPSIS
            Return the expression a statement consists of, if that is all it is.
        .DESCRIPTION
            Returns the expression when the statement is just one expression with no
            redirection, such as the content of '(1, 2)', one line of '@(...)' or the
            right-hand side of '$A = 1, 2'. Returns nothing for commands, longer pipelines
            and other statements.
        .PARAMETER Statement
            The statement to unwrap.
    #>
    [CmdletBinding()]
    [OutputType([System.Management.Automation.Language.ExpressionAst])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [System.Management.Automation.Language.StatementAst]$Statement
    )

    # An assignment's right-hand side is a bare CommandExpressionAst; elsewhere it sits in a pipeline.
    $Element = $Statement
    if ($Statement -is [System.Management.Automation.Language.PipelineAst] -and $Statement.PipelineElements.Count -eq 1) {
        $Element = $Statement.PipelineElements[0]
    }
    if ($Element -is [System.Management.Automation.Language.CommandExpressionAst] -and $Element.Redirections.Count -eq 0) {
        $Element.Expression
    }
}

function Test-WozDevArrayExpression {
    <#
        .SYNOPSIS
            Decide whether an expression always produces an array.
        .DESCRIPTION
            True for an array literal ('a, b', and ',$x', which parses as a one-element
            array literal), an array subexpression ('@(...)'), an array cast
            ('[string[]]$x'), a range ('1..3') and a subexpression with several
            statements ('$(1; 2)'), also inside parentheses.
        .PARAMETER Expression
            The expression to test.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpressionAst]$Expression
    )

    if ($Expression -is [System.Management.Automation.Language.ParenExpressionAst]) {
        $Inner = Get-WozDevPureExpression -Statement $Expression.Pipeline
        $null -ne $Inner -and (Test-WozDevArrayExpression -Expression $Inner)
    }
    else {
        $Expression -is [System.Management.Automation.Language.ArrayLiteralAst] -or
        $Expression -is [System.Management.Automation.Language.ArrayExpressionAst] -or
        ($Expression -is [System.Management.Automation.Language.ConvertExpressionAst] -and $Expression.Type.TypeName.IsArray) -or
        ($Expression -is [System.Management.Automation.Language.BinaryExpressionAst] -and $Expression.Operator -eq [System.Management.Automation.Language.TokenKind]::DotDot) -or
        ($Expression -is [System.Management.Automation.Language.SubExpressionAst] -and $Expression.SubExpression.Statements.Count -gt 1)
    }
}

function Get-WozDevArrayVariableName {
    <#
        .SYNOPSIS
            List the variables known to hold several values.
        .DESCRIPTION
            Returns a case-insensitive set of unqualified names: args, input and null, every
            variable the file assigns an array literal (',$x' included), '@(...)' or an
            array cast to, and every parameter declared with an array type. New-Object spreads
            such a value over the constructor parameters, while [Type]::new($x) passes it
            as one argument.
        .PARAMETER ScriptBlockAst
            The ROOT script block of the file.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.HashSet[string]])]
    [System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseOutputTypeCorrectly', '', Justification = 'The leading comma emits the HashSet itself; the analyzer only sees the wrapper array.')]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    $Names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($Name in @('args', 'input', 'null')) {
        $null = $Names.Add($Name)
    }

    $Predicate = { param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.AssignmentStatementAst] -or $Ast -is [System.Management.Automation.Language.ParameterAst] }
    foreach ($Node in $ScriptBlockAst.FindAll($Predicate, $true)) {
        $Variable = $null
        $IsArray = $false
        if ($Node -is [System.Management.Automation.Language.ParameterAst]) {
            $Variable = $Node.Name
            $IsArray = $Node.StaticType.IsArray
        }
        else {
            $Variable = $Node.Left
            if ($Variable -is [System.Management.Automation.Language.ConvertExpressionAst]) {
                $IsArray = $Variable.Type.TypeName.IsArray
                $Variable = $Variable.Child
            }
            # Inline type checks first: most assignments are not arrays, and a function call
            # per assignment adds up in large files.
            $Right = $Node.Right
            if (-not $IsArray -and $Right -is [System.Management.Automation.Language.CommandExpressionAst] -and $Right.Redirections.Count -eq 0) {
                $Value = $Right.Expression
                if ($Value -is [System.Management.Automation.Language.ArrayLiteralAst] -or $Value -is [System.Management.Automation.Language.ArrayExpressionAst] -or $Value -is [System.Management.Automation.Language.ConvertExpressionAst] -or $Value -is [System.Management.Automation.Language.ParenExpressionAst]) {
                    $IsArray = Test-WozDevArrayExpression -Expression $Value
                }
            }
        }
        if ($IsArray -and $Variable -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $UserPath = $Variable.VariablePath.UserPath
            $null = $Names.Add($UserPath.Substring($UserPath.LastIndexOf(':') + 1))
        }
    }

    # The leading comma keeps the set from being unrolled into its names.
    , $Names
}

function Get-WozDevSplicedText {
    <#
        .SYNOPSIS
            Return a slice of the script text with some inner ranges replaced.
        .PARAMETER ScriptText
            The full script text the offsets refer to.
        .PARAMETER StartOffset
            Start of the slice (inclusive).
        .PARAMETER EndOffset
            End of the slice (exclusive).
        .PARAMETER Replacement
            Objects with StartOffset, EndOffset and Text, inside the slice, in document
            order and not overlapping each other.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$ScriptText,

        [Parameter(Mandatory)]
        [int]$StartOffset,

        [Parameter(Mandatory)]
        [int]$EndOffset,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Replacement
    )

    # Substring, not Append(string, int, int): PowerShell 7 binds that overload in time
    # proportional to the whole script, which made large files take seconds.
    $Builder = [System.Text.StringBuilder]::new()
    $Position = $StartOffset
    foreach ($Edit in $Replacement) {
        $null = $Builder.Append($ScriptText.Substring($Position, $Edit.StartOffset - $Position))
        $null = $Builder.Append($Edit.Text)
        $Position = $Edit.EndOffset
    }
    $null = $Builder.Append($ScriptText.Substring($Position, $EndOffset - $Position))
    $Builder.ToString()
}

function Get-WozDevRewrittenText {
    <#
        .SYNOPSIS
            Return a slice of the script with each New-Object inside it converted.
        .DESCRIPTION
            Converts the outermost New-Object commands inside the slice (each conversion
            already covers the commands nested in it) and splices in those that can be
            fixed. Those commands are added to -Result.Nested, so the rule does not report
            them a second time. Commands that cannot be fixed stay as written.
        .PARAMETER StartOffset
            Start of the slice (inclusive).
        .PARAMETER EndOffset
            End of the slice (exclusive).
        .PARAMETER Context
            The rule's per-file context.
        .PARAMETER Result
            The conversion that the slice belongs to.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [int]$StartOffset,

        [Parameter(Mandatory)]
        [int]$EndOffset,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Result
    )

    $Replacements = [System.Collections.Generic.List[object]]::new()
    $CoveredEnd = -1
    foreach ($Command in $Context.Commands) {
        $Extent = $Command.Extent
        if ($Extent.StartOffset -lt $StartOffset -or $Extent.EndOffset -gt $EndOffset -or $Extent.StartOffset -lt $CoveredEnd) {
            continue
        }
        $Conversion = ConvertTo-WozDevStaticConstructor -CommandAst $Command -Context $Context
        if ($null -ne $Conversion.Text) {
            # Only a converted command covers its range; inside one that stays as written,
            # fixable descendants are still spliced in, so they never overlap the parent fix.
            $CoveredEnd = $Extent.EndOffset
            $Replacements.Add([pscustomobject]@{ StartOffset = $Extent.StartOffset; EndOffset = $Extent.EndOffset; Text = $Conversion.Text })
            $Result.Nested.Add($Command)
        }
    }
    Get-WozDevSplicedText -ScriptText $Context.ScriptText -StartOffset $StartOffset -EndOffset $EndOffset -Replacement $Replacements
}

function ConvertTo-WozDevArgumentText {
    <#
        .SYNOPSIS
            Render one New-Object argument as a method argument.
        .DESCRIPTION
            Barewords become quoted strings ('C:\x.txt', "C:\$dir"), a parenthesized
            New-Object that can be fixed becomes its conversion without the parentheses,
            and anything else keeps its text with nested New-Object commands converted.
            Returns nothing for a bareword with embedded quotes, which cannot be rewritten
            safely.
        .PARAMETER Element
            The argument as written.
        .PARAMETER Context
            The rule's per-file context.
        .PARAMETER Result
            The conversion that the argument belongs to.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpressionAst]$Element,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Result
    )

    $Extent = $Element.Extent
    if ($Element -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $Element.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::BareWord) {
        "'{0}'" -f [System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($Element.Value)
    }
    elseif ($Element -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $Element.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::BareWord) {
        if ($Extent.Text.IndexOfAny([char[]]@([char]34, [char]39)) -lt 0) {
            '"{0}"' -f (Get-WozDevRewrittenText -StartOffset $Extent.StartOffset -EndOffset $Extent.EndOffset -Context $Context -Result $Result)
        }
    }
    else {
        $Command = $null
        if ($Element -is [System.Management.Automation.Language.ParenExpressionAst] -and $Element.Pipeline -is [System.Management.Automation.Language.PipelineAst] -and $Element.Pipeline.PipelineElements.Count -eq 1) {
            $Command = $Element.Pipeline.PipelineElements[0]
        }
        $Conversion = $null
        if ($null -ne $Command -and $Context.CommandSet.Contains($Command)) {
            $Conversion = ConvertTo-WozDevStaticConstructor -CommandAst $Command -Context $Context
        }
        if ($null -ne $Conversion -and $null -ne $Conversion.Text) {
            # The parentheses were only there to run a command; a method argument takes the expression directly.
            $Result.Nested.Add($Command)
            $Conversion.Text
        }
        else {
            Get-WozDevRewrittenText -StartOffset $Extent.StartOffset -EndOffset $Extent.EndOffset -Context $Context -Result $Result
        }
    }
}

function ConvertTo-WozDevNewObjectArgument {
    <#
        .SYNOPSIS
            Turn the -ArgumentList of a New-Object into the text inside '::new(...)'.
        .DESCRIPTION
            New-Object passes each element of its -ArgumentList array as one constructor
            argument. This keeps that meaning: 'a, b', '(a, b)' and '@(a, b)' give two
            arguments, '(,$x)' gives $x, '@()' gives none, and newline-separated lines in
            '@(...)' are joined with commas. The layout and comments inside parentheses
            are kept. A single other value counts as one argument unless it is known to
            hold several values (an array variable, an array cast, a command inside
            '@(...)', a nested New-Object of a collection type); then Reason is set.
        .PARAMETER Value
            The bound -ArgumentList value, or $null when there is none.
        .PARAMETER Context
            The rule's per-file context.
        .PARAMETER Result
            The conversion that the arguments belong to.
        .OUTPUTS
            [pscustomobject] with Text, Count and Reason.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [System.Management.Automation.Language.Ast]$Value,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Result
    )

    $Output = [pscustomobject]@{ Text = ''; Count = 0; Reason = $null }
    if ($null -eq $Value) {
        $Output
        return
    }

    $UnknownCount = 'the number of constructor arguments is unknown'
    $QuotedBareword = 'an argument is a bareword that contains quotes'

    # Exact shapes: the items, plus the inner range of the parentheses whose layout is kept.
    $Items = $null
    $InnerStart = 0
    $InnerEnd = 0
    $Single = $null
    if ($Value -is [System.Management.Automation.Language.ArrayLiteralAst]) {
        $Items = $Value.Elements
    }
    elseif ($Value -is [System.Management.Automation.Language.ParenExpressionAst] -or $Value -is [System.Management.Automation.Language.ArrayExpressionAst]) {
        if ($Value -is [System.Management.Automation.Language.ParenExpressionAst]) {
            $Statements = @($Value.Pipeline)
            $InnerStart = $Value.Extent.StartOffset + 1
        }
        else {
            $Statements = @($Value.SubExpression.Statements)
            $InnerStart = $Value.Extent.StartOffset + 2
        }
        $InnerEnd = $Value.Extent.EndOffset - 1

        if ($Statements.Count -eq 0) {
            $Output
            return
        }

        $Expressions = foreach ($Statement in $Statements) {
            Get-WozDevPureExpression -Statement $Statement
        }
        $Expressions = @($Expressions)

        if ($Statements.Count -eq 1 -and $Expressions.Count -eq 1) {
            $Expression = $Expressions[0]
            if ($Expression -is [System.Management.Automation.Language.ArrayLiteralAst] -and $Expression.Elements.Count -eq 1) {
                # ',$x' parses as a one-element array: exactly one argument, whatever $x holds.
                $Text = ConvertTo-WozDevArgumentText -Element $Expression.Elements[0] -Context $Context -Result $Result
                if ($null -eq $Text) {
                    $Output.Reason = $QuotedBareword
                }
                else {
                    $Output.Text = $Text
                    $Output.Count = 1
                }
                $Output
                return
            }
            elseif ($Expression -is [System.Management.Automation.Language.ArrayLiteralAst]) {
                $Items = $Expression.Elements
            }
            else {
                $Single = $Expression
            }
        }
        elseif ($Statements.Count -eq 1 -and $Value -is [System.Management.Automation.Language.ParenExpressionAst]) {
            # A command in parentheses: one value, kept with its parentheses.
            $Single = $Value
        }
        elseif ($Expressions.Count -ne $Statements.Count) {
            # A command inside '@(...)' asks for its output as an array.
            $Output.Reason = $UnknownCount
            $Output
            return
        }
        else {
            # Newline-separated lines of '@(...)': each line is one argument.
            $Replacements = [System.Collections.Generic.List[object]]::new()
            for ($I = 0; $I -lt $Expressions.Count; $I++) {
                $Expression = $Expressions[$I]
                if ((Test-WozDevArrayExpression -Expression $Expression) -or (Test-WozDevArrayVariable -Expression $Expression -Context $Context)) {
                    $Output.Reason = $UnknownCount
                    $Output
                    return
                }
                $Text = ConvertTo-WozDevArgumentText -Element $Expression -Context $Context -Result $Result
                if ($null -eq $Text) {
                    $Output.Reason = $QuotedBareword
                    $Output
                    return
                }
                if ($I -lt $Expressions.Count - 1) {
                    $Text += ','
                }
                $Replacements.Add([pscustomobject]@{ StartOffset = $Expression.Extent.StartOffset; EndOffset = $Expression.Extent.EndOffset; Text = $Text })
            }
            $Output.Text = Get-WozDevSplicedText -ScriptText $Context.ScriptText -StartOffset $InnerStart -EndOffset $InnerEnd -Replacement $Replacements
            $Output.Count = $Expressions.Count
            $Output
            return
        }
    }
    else {
        $Single = $Value
    }

    if ($null -ne $Items) {
        $Replacements = [System.Collections.Generic.List[object]]::new()
        foreach ($Item in $Items) {
            $Text = ConvertTo-WozDevArgumentText -Element $Item -Context $Context -Result $Result
            if ($null -eq $Text) {
                $Output.Reason = $QuotedBareword
                $Output
                return
            }
            $Replacements.Add([pscustomobject]@{ StartOffset = $Item.Extent.StartOffset; EndOffset = $Item.Extent.EndOffset; Text = $Text })
        }
        if ($InnerEnd -gt $InnerStart) {
            $Output.Text = Get-WozDevSplicedText -ScriptText $Context.ScriptText -StartOffset $InnerStart -EndOffset $InnerEnd -Replacement $Replacements
        }
        else {
            # A bare 'a, b' command argument: barewords need quoting, so join the rendered items.
            $Output.Text = ($Replacements | ForEach-Object -MemberName Text) -join ', '
        }
        $Output.Count = $Items.Count
        $Output
        return
    }

    # One value of unknown shape: one argument, unless it is known to hold several.
    if ((Test-WozDevArrayExpression -Expression $Single) -or (Test-WozDevArrayVariable -Expression $Single -Context $Context) -or (Test-WozDevNestedCollection -Expression $Single -Context $Context)) {
        $Output.Reason = $UnknownCount
        $Output
        return
    }
    $Text = ConvertTo-WozDevArgumentText -Element $Single -Context $Context -Result $Result
    if ($null -eq $Text) {
        $Output.Reason = $QuotedBareword
    }
    else {
        $Output.Text = $Text
        $Output.Count = 1
    }
    $Output
}

function Test-WozDevArrayVariable {
    <#
        .SYNOPSIS
            Decide whether an expression is a variable known to hold several values.
        .PARAMETER Expression
            The argument to test.
        .PARAMETER Context
            The rule's per-file context; its ArrayVariables set is built on first use.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpressionAst]$Expression,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    $IsArray = $false
    if ($Expression -is [System.Management.Automation.Language.VariableExpressionAst]) {
        if ($null -eq $Context.ArrayVariables) {
            $Context.ArrayVariables = Get-WozDevArrayVariableName -ScriptBlockAst $Context.ScriptBlockAst
        }
        $UserPath = $Expression.VariablePath.UserPath
        $IsArray = $Context.ArrayVariables.Contains($UserPath.Substring($UserPath.LastIndexOf(':') + 1))
    }
    $IsArray
}

function Test-WozDevNestedCollection {
    <#
        .SYNOPSIS
            Decide whether an argument is a parenthesized New-Object of a collection type.
        .DESCRIPTION
            New-Object spreads a collection passed as its whole -ArgumentList over the
            constructor parameters, so '(New-Object List[int])' is not one argument.
            Unknown types count as single objects.
        .PARAMETER Expression
            The argument to test.
        .PARAMETER Context
            The rule's per-file context.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpressionAst]$Expression,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    $IsCollection = $false
    if ($Expression -is [System.Management.Automation.Language.ParenExpressionAst] -and $Expression.Pipeline -is [System.Management.Automation.Language.PipelineAst] -and $Expression.Pipeline.PipelineElements.Count -eq 1) {
        $Command = $Expression.Pipeline.PipelineElements[0]
        if ($Context.CommandSet.Contains($Command)) {
            $Conversion = ConvertTo-WozDevStaticConstructor -CommandAst $Command -Context $Context
            if (-not [string]::IsNullOrEmpty($Conversion.TypeText)) {
                $Type = Resolve-WozDevTypeName -TypeName $Conversion.TypeText -Namespace $Context.Namespace -Cache $Context.TypeCache
                $IsCollection = $null -ne $Type -and (Test-WozDevEnumerableType -Type $Type)
            }
        }
    }
    $IsCollection
}

function ConvertTo-WozDevStaticConstructor {
    <#
        .SYNOPSIS
            Work out the static-constructor rewrite of one New-Object command.
        .DESCRIPTION
            Returns the conversion of the command, computing it on first use and caching
            it in -Context.Results, since nested commands are converted while their parent
            is. Text holds the replacement for the whole command, or $null with Reason
            saying why it cannot be rewritten safely. Skip is set for -ComObject, which
            has no static-constructor equivalent and is not reported.
        .PARAMETER CommandAst
            A New-Object command.
        .PARAMETER Context
            The rule's per-file context.
        .OUTPUTS
            [hashtable] with Ast, Text, Reason, Kind, TypeText, TargetType, HasArgument,
            Skip and Nested.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.CommandAst]$CommandAst,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    if (-not $Context.Results.ContainsKey($CommandAst)) {
        $Context.Results[$CommandAst] = Get-WozDevNewObjectConversion -CommandAst $CommandAst -Context $Context
    }
    $Context.Results[$CommandAst]
}

function Get-WozDevNewObjectConversion {
    <#
        .SYNOPSIS
            Compute the static-constructor rewrite of one New-Object command.
        .DESCRIPTION
            The worker behind ConvertTo-WozDevStaticConstructor; call that instead. The
            first check that fails sets Reason: splatting, unbindable parameters,
            parameters other than -TypeName, -ArgumentList and -Property, redirections,
            a command that does not start its pipeline, a type name that is not a constant
            type literal, a class body using a type that may not be loaded at parse time,
            -ArgumentList with -Property, an argument list of unknown size, and a struct
            with no parameterless constructor. In output position (anything but an
            assignment, parentheses, a hashtable value or a class method's return) a ','
            is added unless the type is known not to be a collection, because PowerShell
            unrolls an expression's collection where New-Object writes it as one object.
            The rewrite must parse.
        .PARAMETER CommandAst
            A New-Object command.
        .PARAMETER Context
            The rule's per-file context.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.CommandAst]$CommandAst,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    $Result = @{
        Ast = $CommandAst
        Text = $null
        Reason = $null
        Kind = 'Constructor'
        TypeText = $null
        TargetType = $null
        HasArgument = $false
        Skip = $false
        Nested = [System.Collections.Generic.List[object]]::new()
    }

    $Binding = [System.Management.Automation.Language.StaticParameterBinder]::BindCommand($CommandAst, $true)
    $Bound = $Binding.BoundParameters
    if ($Bound.ContainsKey('ComObject')) {
        $Result.Skip = $true
        $Result
        return
    }

    # Windows PowerShell binds '@Params' as -TypeName, so check for splatting before trusting the binding.
    foreach ($Element in $CommandAst.CommandElements) {
        if ($Element -is [System.Management.Automation.Language.VariableExpressionAst] -and $Element.Splatted) {
            $Result.Reason = 'the parameters are splatted'
            $Result
            return
        }
    }
    if ($Binding.BindingExceptions.Count -gt 0) {
        $Result.Reason = 'the parameters cannot be bound statically'
        $Result
        return
    }
    foreach ($Name in $Bound.Keys) {
        if ($Name -ne 'TypeName' -and $Name -ne 'ArgumentList' -and $Name -ne 'Property') {
            $Result.Reason = 'it uses -{0}' -f $Name
            $Result
            return
        }
    }
    if ($CommandAst.Redirections.Count -gt 0) {
        $Result.Reason = 'it has a redirection'
        $Result
        return
    }
    $Pipeline = $CommandAst.Parent
    if ($Pipeline -isnot [System.Management.Automation.Language.PipelineAst] -or -not [object]::ReferenceEquals($Pipeline.PipelineElements[0], $CommandAst)) {
        $Result.Reason = 'it is not the first command in its pipeline'
        $Result
        return
    }

    if (-not $Bound.ContainsKey('TypeName')) {
        $Result.Reason = 'it has no -TypeName'
        $Result
        return
    }
    $TypeArgument = $Bound['TypeName'].Value
    if ($TypeArgument -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        $Result.Reason = 'the type name is not a constant'
        $Result
        return
    }
    $TypeText = $TypeArgument.Value.Trim()
    if (-not (Test-WozDevTypeLiteral -TypeName $TypeText)) {
        $Result.Reason = 'the type name "{0}" is not a valid type literal' -f $TypeText
        $Result
        return
    }
    $Result.TypeText = $TypeText
    $Result.TargetType = $TypeText
    $IsPSObjectCast = $false

    # Inside a class, type literals are resolved when the script is parsed, while
    # New-Object looks the type up when it runs; only types every session loads are safe.
    for ($Node = $CommandAst.Parent; $null -ne $Node; $Node = $Node.Parent) {
        if ($Node -is [System.Management.Automation.Language.TypeDefinitionAst]) {
            $Type = Resolve-WozDevTypeName -TypeName $TypeText -Namespace $Context.Namespace -Cache $Context.TypeCache
            if ($null -eq $Type -or -not (Test-WozDevCoreType -Type $Type)) {
                $Result.Reason = 'it is inside a class, and [{0}] may not be loaded when the class is parsed' -f $TypeText
                $Result
                return
            }
            break
        }
    }

    if ($Bound.ContainsKey('Property')) {
        if ($Bound.ContainsKey('ArgumentList')) {
            $Result.Reason = 'it combines -ArgumentList and -Property'
            $Result
            return
        }
        $Value = $Bound['Property'].Value
        if ($Value -is [System.Management.Automation.Language.ParenExpressionAst]) {
            $Inner = Get-WozDevPureExpression -Statement $Value.Pipeline
            if ($null -ne $Inner) {
                $Value = $Inner
            }
        }
        # '-Property $null' still creates an object; '[pscustomobject]$null' is $null.
        $IsNull = $Value -is [System.Management.Automation.Language.VariableExpressionAst] -and $Value.VariablePath.UserPath -eq 'null'
        if ($IsNull -or $Value -isnot [System.Management.Automation.Language.ExpressionAst] -or $Value -is [System.Management.Automation.Language.ConstantExpressionAst] -or $Value -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
            $Result.Reason = 'the -Property value is not a hashtable'
            $Result
            return
        }

        $Result.Kind = 'Cast'
        if ($script:WozDevPSObjectTypeNames.Contains($TypeText)) {
            # The [pscustomobject] literal keeps key order on its own, so [ordered] is redundant.
            $IsPSObjectCast = $true
            $Result.TargetType = 'pscustomobject'
            if ($Value -is [System.Management.Automation.Language.ConvertExpressionAst] -and $Value.Type.TypeName.FullName -eq 'ordered' -and $Value.Child -is [System.Management.Automation.Language.HashtableAst]) {
                $Value = $Value.Child
            }
        }
        $ValueText = Get-WozDevRewrittenText -StartOffset $Value.Extent.StartOffset -EndOffset $Value.Extent.EndOffset -Context $Context -Result $Result
        if (-not (Test-WozDevPrimaryExpression -Expression $Value)) {
            $ValueText = '({0})' -f $ValueText
        }
        $Expression = '[{0}]{1}' -f $Result.TargetType, $ValueText
    }
    else {
        $ArgumentValue = $null
        if ($Bound.ContainsKey('ArgumentList')) {
            $ArgumentValue = $Bound['ArgumentList'].Value
        }
        $Arguments = ConvertTo-WozDevNewObjectArgument -Value $ArgumentValue -Context $Context -Result $Result
        if ($null -ne $Arguments.Reason) {
            $Result.Reason = $Arguments.Reason
            $Result
            return
        }
        $Result.HasArgument = $Arguments.Count -gt 0
        if (-not $Result.HasArgument) {
            # New-Object can create any struct; ::new() needs a declared parameterless constructor (primitives and enums excepted).
            $Type = Resolve-WozDevTypeName -TypeName $TypeText -Namespace $Context.Namespace -Cache $Context.TypeCache
            if ($null -ne $Type -and $Type.IsValueType -and -not $Type.IsPrimitive -and -not $Type.IsEnum -and $null -eq $Type.GetConstructor([type]::EmptyTypes)) {
                $Result.Reason = 'the type [{0}] is a struct without a parameterless constructor' -f $TypeText
                $Result
                return
            }
        }
        $Expression = '[{0}]::new({1})' -f $TypeText, $Arguments.Text
    }

    # Assignments, parentheses, hashtable values and a class method's return keep the object
    # as is; anywhere else (statements, a function's return, $(), @(), foreach and switch
    # input) PowerShell would unroll a collection that New-Object writes as one object,
    # and ',' prevents that.
    $Parent = $Pipeline.Parent
    $IsMethodReturn = $false
    if ($Parent -is [System.Management.Automation.Language.ReturnStatementAst]) {
        $Node = $Parent.Parent
        while ($null -ne $Node -and $Node -isnot [System.Management.Automation.Language.ScriptBlockAst]) {
            $Node = $Node.Parent
        }
        # A method body hangs off a FunctionDefinitionAst under the FunctionMemberAst.
        $IsMethodReturn = $null -ne $Node -and $Node.Parent -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Parent.Parent -is [System.Management.Automation.Language.FunctionMemberAst]
    }
    $IsValuePosition = $Pipeline.PipelineElements.Count -eq 1 -and ($Parent -is [System.Management.Automation.Language.AssignmentStatementAst] -or $Parent -is [System.Management.Automation.Language.ParenExpressionAst] -or $Parent -is [System.Management.Automation.Language.HashtableAst] -or $IsMethodReturn)
    if (-not $IsValuePosition -and -not $IsPSObjectCast) {
        $Type = Resolve-WozDevTypeName -TypeName $TypeText -Namespace $Context.Namespace -Cache $Context.TypeCache
        if ($null -eq $Type -or (Test-WozDevEnumerableType -Type $Type)) {
            $Expression = ',' + $Expression
        }
    }

    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($Expression, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count -gt 0) {
        $Result.Reason = 'the rewrite does not parse'
        $Result
        return
    }

    $Result.Text = $Expression
    $Result
}

function Get-WozDevScriptText {
    <#
        .SYNOPSIS
            Return the full text of the analyzed script.
        .PARAMETER ScriptBlockAst
            The ROOT script block of the file.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    $Text = $ScriptBlockAst.Extent.StartScriptPosition.GetFullScript()
    if ($null -eq $Text) {
        $Text = $ScriptBlockAst.Extent.Text
    }
    $Text
}

function Get-WozDevScriptToken {
    <#
        .SYNOPSIS
            Tokenize the analyzed script.
        .DESCRIPTION
            Re-parses the full script text under the file's own path, so the tokens carry
            the same lines, columns, offsets and file as the Ast PSScriptAnalyzer supplied.
            Rules that work on an Ast get no tokens from PSScriptAnalyzer.
        .PARAMETER ScriptBlockAst
            The ROOT script block of the file.
        .OUTPUTS
            [System.Management.Automation.Language.Token] per token, in document order. Collect with @(...).
    #>
    [CmdletBinding()]
    [OutputType([System.Management.Automation.Language.Token])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput((Get-WozDevScriptText -ScriptBlockAst $ScriptBlockAst), $ScriptBlockAst.Extent.File, [ref]$Tokens, [ref]$Errors)
    $Tokens
}

function Get-WozDevNewLine {
    <#
        .SYNOPSIS
            Return the line break the script uses: CRLF when it has any, else LF.
        .PARAMETER ScriptText
            The full script text.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$ScriptText
    )

    if ($ScriptText.Contains("`r`n")) {
        "`r`n"
    }
    else {
        "`n"
    }
}

function Get-WozDevLinePrefix {
    <#
        .SYNOPSIS
            Return the text on an extent's first line that comes before the extent.
        .PARAMETER Extent
            The extent whose line prefix to return.
        .PARAMETER ScriptText
            The full script text the extent's offsets refer to.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.IScriptExtent]$Extent,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$ScriptText
    )

    $Start = $Extent.StartOffset
    $LineStart = $ScriptText.LastIndexOf([char]"`n", [Math]::Max($Start - 1, 0)) + 1
    if ($Start -eq 0) {
        $LineStart = 0
    }
    $ScriptText.Substring($LineStart, $Start - $LineStart)
}

function Get-WozDevVariableGroup {
    <#
        .SYNOPSIS
            Group the file's unqualified user variables by name and pick each group's canonical casing.
        .DESCRIPTION
            Groups the Parameter, Assigned and Referenced occurrences by lower-cased name,
            in first-seen order. The declaration decides the casing: the parameter, else the
            first plain assignment, else the first occurrence. Shared by the casing rules so
            they agree on which spelling is canonical.
        .PARAMETER Occurrence
            The occurrences from Get-WozDevVariableOccurrence.
        .OUTPUTS
            [pscustomobject] with Key, Canonical and Occurrences, per group.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [pscustomobject[]]$Occurrence
    )

    $Groups = [ordered]@{}
    foreach ($Item in $Occurrence) {
        if ($Item.Kind -ne 'Parameter' -and $Item.Kind -ne 'Assigned' -and $Item.Kind -ne 'Referenced') {
            continue
        }
        $Key = $Item.Name.ToLowerInvariant()
        if (-not $Groups.Contains($Key)) {
            $Groups[$Key] = [System.Collections.Generic.List[object]]::new()
        }
        $Groups[$Key].Add($Item)
    }

    foreach ($Key in $Groups.Keys) {
        $Members = $Groups[$Key]
        $Declaration = $null
        foreach ($Item in $Members) {
            if ($Item.Kind -eq 'Parameter') {
                $Declaration = $Item
                break
            }
        }
        if ($null -eq $Declaration) {
            foreach ($Item in $Members) {
                if ($Item.IsPureWrite) {
                    $Declaration = $Item
                    break
                }
            }
        }
        if ($null -eq $Declaration) {
            $Declaration = $Members[0]
        }

        [pscustomobject]@{
            Key = $Key
            Canonical = $Declaration.Name
            Occurrences = $Members
        }
    }
}

function ConvertTo-WozDevPascalCase {
    <#
        .SYNOPSIS
            Upper-case the first character of a name.
        .PARAMETER Name
            The name to convert.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Name
    )

    $Name.Substring(0, 1).ToUpperInvariant() + $Name.Substring(1)
}

function Test-WozDevLowerCaseName {
    <#
        .SYNOPSIS
            Decide whether a name starts with a lower-case letter.
        .PARAMETER Name
            The name to test.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Name
    )

    $Name.Length -gt 0 -and [char]::IsLower($Name[0])
}

function ConvertTo-WozDevFormatLiteral {
    <#
        .SYNOPSIS
            Turn a literal run of a double-quoted string into the text of a single-quoted -f format string.
        .DESCRIPTION
            Resolves the escapes a double-quoted string allows ('`$', '`"', '``', '""' and a
            backtick before an ordinary character) and doubles '{' and '}' for -f. Returns
            Text, or Reason when the run cannot be written in a single-quoted string without
            doubled quotes: a control-character escape such as '`n', a single quote, or a
            typographic double quote.
        .PARAMETER Text
            The source text of the run, as written between the quotes.
        .OUTPUTS
            [pscustomobject] with Text and Reason.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text
    )

    $Output = [pscustomobject]@{ Text = $null; Reason = $null }
    $Builder = [System.Text.StringBuilder]::new()
    $I = 0
    while ($I -lt $Text.Length) {
        $Char = $Text[$I]
        $Code = [int]$Char
        if ($Char -eq [char]'`') {
            if ($I + 1 -ge $Text.Length) {
                $Output.Reason = 'it ends with a backtick'
                $Output
                return
            }
            $Next = $Text[$I + 1]
            # Escapes are case-sensitive, but treating '`N' like '`n' only gives up a fix.
            if ('0abefnrtuvABEFNRTUV'.IndexOf($Next) -ge 0) {
                $Output.Reason = ('it contains the escape sequence "`{0}", which a single-quoted string cannot hold' -f $Next)
                $Output
                return
            }
            $Char = $Next
            $Code = [int]$Char
            $I++
        }
        elseif ($Char -eq [char]'"' -and $I + 1 -lt $Text.Length -and $Text[$I + 1] -eq [char]'"') {
            $I++
        }

        if ($Code -eq 39 -or ($Code -ge 0x2018 -and $Code -le 0x201B)) {
            $Output.Reason = 'its text contains a single quote, which would need doubling'
            $Output
            return
        }
        if ($Code -ge 0x201C -and $Code -le 0x201E) {
            $Output.Reason = 'its text contains a typographic double quote'
            $Output
            return
        }
        if ($Char -eq [char]'{' -or $Char -eq [char]'}') {
            $null = $Builder.Append($Char)
        }
        $null = $Builder.Append($Char)
        $I++
    }
    $Output.Text = $Builder.ToString()
    $Output
}

function ConvertTo-WozDevDoubleQuotedFormatLiteral {
    <#
        .SYNOPSIS
            Turn a literal run of a double-quoted string into the text of a double-quoted -f format string.
        .DESCRIPTION
            The fallback when the run cannot go into a single-quoted string. Keeps the source
            text as written, so its escapes, doubled quotes and single quotes stay valid, and
            only doubles the braces that reach -f: a bare '{' or '}' becomes '{{' or '}}',
            and an escaped '`{' becomes '`{{'. The caller rejects '`u{...}', which
            PowerShell 7 reads as an escape and Windows PowerShell 5.1 as text.
        .PARAMETER Text
            The source text of the run, as written between the quotes.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text
    )

    $Builder = [System.Text.StringBuilder]::new()
    $I = 0
    while ($I -lt $Text.Length) {
        $Char = $Text[$I]
        if ($Char -eq [char]'`' -and $I + 1 -lt $Text.Length) {
            $Next = $Text[$I + 1]
            $null = $Builder.Append($Char).Append($Next)
            if ($Next -eq [char]'{' -or $Next -eq [char]'}') {
                $null = $Builder.Append($Next)
            }
            $I += 2
            continue
        }
        if ($Char -eq [char]'{' -or $Char -eq [char]'}') {
            $null = $Builder.Append($Char)
        }
        $null = $Builder.Append($Char)
        $I++
    }
    $Builder.ToString()
}

function ConvertTo-WozDevFormatExpression {
    <#
        .SYNOPSIS
            Work out the '-f' rewrite of one interpolated double-quoted string.
        .DESCRIPTION
            Rewrites "a $B $($C.D)" to ('a {0} {1}' -f $B, $C.D). A variable used twice
            gets one placeholder. A '$(...)' holding a single expression passes that
            expression, parenthesized unless it binds tighter than ','. Gives up (Text is
            $null, Reason says why) when the rewrite could change the result:
            - a value that may be an array ('$(...)' running a command, an array literal,
              range or cast, a variable assigned an array), because -f formats an array as
              'System.Object[]' or takes only its first element where the string joins all
              elements with spaces.
            Text that a single-quoted string cannot hold without doubled quotes (a single
            quote, an escape such as '`n', a typographic quote) keeps the string's own
            double quotes, with its braces doubled: "It's $A`n" becomes ("It's {0}`n" -f $A),
            and IsDoubleQuoted is set.
            -f formats numbers and dates for the current culture where expansion uses the
            invariant culture, so a [double] or [datetime] can render differently on
            non-English systems; review the fix where that matters.
        .PARAMETER StringAst
            A double-quoted string with at least one nested expression.
        .PARAMETER Context
            Hashtable with ScriptBlockAst, ScriptText and ArrayVariables (filled on first use).
        .OUTPUTS
            [pscustomobject] with Text, Reason and IsDoubleQuoted.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.ExpandableStringExpressionAst]$StringAst,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    $Output = [pscustomobject]@{ Text = $null; Reason = $null; IsDoubleQuoted = $false }
    $Extent = $StringAst.Extent

    # Literal runs as written, and the placeholder that follows each run but the last.
    $Runs = [System.Collections.Generic.List[string]]::new()
    $Placeholders = [System.Collections.Generic.List[string]]::new()
    $Arguments = [System.Collections.Generic.List[string]]::new()
    $Indexes = [System.Collections.Generic.Dictionary[string, int]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $Position = $Extent.StartOffset + 1
    foreach ($Nested in $StringAst.NestedExpressions) {
        $Runs.Add($Context.ScriptText.Substring($Position, $Nested.Extent.StartOffset - $Position))

        $Value = $Nested
        $ArgumentText = $Nested.Extent.Text
        if ($Nested -is [System.Management.Automation.Language.SubExpressionAst]) {
            $Value = $null
            if ($Nested.SubExpression.Statements.Count -eq 1) {
                $Value = Get-WozDevPureExpression -Statement $Nested.SubExpression.Statements[0]
            }
            if ($null -eq $Value) {
                $Output.Reason = ('{0} runs a command, which may return several values' -f $Nested.Extent.Text)
                $Output
                return
            }
            $ArgumentText = $Value.Extent.Text
            if (-not (Test-WozDevPrimaryExpression -Expression $Value)) {
                $ArgumentText = '({0})' -f $ArgumentText
            }
        }
        if ((Test-WozDevArrayExpression -Expression $Value) -or (Test-WozDevArrayVariable -Expression $Value -Context $Context)) {
            $Output.Reason = ('{0} may hold an array, which -f does not join like a string does' -f $Nested.Extent.Text)
            $Output
            return
        }

        # A variable read twice gives the same value; anything else is evaluated once per use.
        $Index = $Arguments.Count
        if ($Nested -is [System.Management.Automation.Language.VariableExpressionAst] -and $Indexes.ContainsKey($ArgumentText)) {
            $Index = $Indexes[$ArgumentText]
        }
        else {
            $Arguments.Add($ArgumentText)
            if ($Nested -is [System.Management.Automation.Language.VariableExpressionAst]) {
                $Indexes[$ArgumentText] = $Index
            }
        }
        $Placeholders.Add(('{{{0}}}' -f $Index))
        $Position = $Nested.Extent.EndOffset
    }
    $Runs.Add($Context.ScriptText.Substring($Position, $Extent.EndOffset - 1 - $Position))

    # A single-quoted format string when every run fits in one; otherwise keep the
    # string's own double quotes and move only the expansions out.
    $Format = [System.Text.StringBuilder]::new()
    for ($I = 0; $I -lt $Runs.Count; $I++) {
        $Literal = ConvertTo-WozDevFormatLiteral -Text $Runs[$I]
        if ($null -ne $Literal.Reason) {
            $Output.IsDoubleQuoted = $true
            break
        }
        $null = $Format.Append($Literal.Text)
        if ($I -lt $Placeholders.Count) {
            $null = $Format.Append($Placeholders[$I])
        }
    }
    if ($Output.IsDoubleQuoted) {
        foreach ($Run in $Runs) {
            if ($Run.IndexOf('`u{', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $Output.Reason = 'it contains a "`u{...}" escape, which PowerShell 7 and Windows PowerShell 5.1 read differently'
                $Output
                return
            }
        }
        $Format = [System.Text.StringBuilder]::new()
        $null = $Format.Append($Extent.Text[0])
        for ($I = 0; $I -lt $Runs.Count; $I++) {
            $null = $Format.Append((ConvertTo-WozDevDoubleQuotedFormatLiteral -Text $Runs[$I]))
            if ($I -lt $Placeholders.Count) {
                $null = $Format.Append($Placeholders[$I])
            }
        }
        $null = $Format.Append($Extent.Text[$Extent.Text.Length - 1])

        # The format string must not expand anything itself, such as a '$' that now meets a placeholder.
        $Tokens = $null
        $Errors = $null
        $FormatAst = [System.Management.Automation.Language.Parser]::ParseInput($Format.ToString(), [ref]$Tokens, [ref]$Errors)
        $FormatValue = $null
        if ($Errors.Count -eq 0 -and $FormatAst.EndBlock.Statements.Count -eq 1) {
            $FormatValue = Get-WozDevPureExpression -Statement $FormatAst.EndBlock.Statements[0]
        }
        if ($FormatValue -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
            $Output.Reason = 'the rewrite would expand text'
            $Output
            return
        }
        $Expression = '{0} -f {1}' -f $Format.ToString(), ($Arguments -join ', ')
    }
    else {
        $Expression = "'{0}' -f {1}" -f $Format.ToString(), ($Arguments -join ', ')
    }

    # The string's own parentheses can stand in for the ones around the -f expression.
    $Parent = $StringAst.Parent
    $IsParenthesized = $Parent -is [System.Management.Automation.Language.CommandExpressionAst] -and $Parent.Redirections.Count -eq 0 -and
    $Parent.Parent -is [System.Management.Automation.Language.PipelineAst] -and $Parent.Parent.PipelineElements.Count -eq 1 -and
    $Parent.Parent.Parent -is [System.Management.Automation.Language.ParenExpressionAst]
    if (-not $IsParenthesized) {
        $Expression = '({0})' -f $Expression
    }

    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($Expression, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count -gt 0) {
        $Output.Reason = 'the rewrite does not parse'
        $Output
        return
    }
    $Output.Text = $Expression
    $Output
}

function ConvertTo-WozDevSplatValue {
    <#
        .SYNOPSIS
            Render a command argument as a hashtable value.
        .DESCRIPTION
            Barewords become quoted strings (C:\x -> 'C:\x', C:\$Dir -> "C:\$Dir"), and an
            array of arguments is rendered element by element. Anything else keeps its text.
            Returns nothing for a bareword with embedded quotes.
        .PARAMETER Element
            The argument as written.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.CommandElementAst]$Element
    )

    if ($Element -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $Element.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::BareWord) {
        "'{0}'" -f [System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($Element.Value)
    }
    elseif ($Element -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $Element.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::BareWord) {
        if ($Element.Extent.Text.IndexOfAny([char[]]@([char]34, [char]39)) -lt 0) {
            '"{0}"' -f $Element.Extent.Text
        }
    }
    elseif ($Element -is [System.Management.Automation.Language.ArrayLiteralAst]) {
        $Items = [System.Collections.Generic.List[string]]::new()
        foreach ($Item in $Element.Elements) {
            $Text = ConvertTo-WozDevSplatValue -Element $Item
            if ($null -eq $Text) {
                return
            }
            $Items.Add($Text)
        }
        $Items -join ', '
    }
    else {
        $Element.Extent.Text
    }
}

function ConvertTo-WozDevSplat {
    <#
        .SYNOPSIS
            Work out the splatting rewrite of one command continued with backticks.
        .DESCRIPTION
            Moves the named parameters into a hashtable assigned on the lines before the
            command and passes it with '@Name'; positional arguments stay on the command line
            in their order. Parameter names are written in full, as the command declares
            them. Gives up (Text is $null, Reason says why) unless the rewrite is certain to
            bind the same way: the command must stand alone as a statement at the start of
            its line, must be loaded in the analyzing session so that switches can be told
            from parameters that take a value, must bind statically, and must carry no
            comments, redirections, splatting, stop-parsing token or backtick inside an
            argument. The hashtable variable gets a name the file does not use yet.
        .PARAMETER CommandAst
            The command to rewrite.
        .PARAMETER Continuation
            The command's line-continuation tokens.
        .PARAMETER Context
            Hashtable with ScriptText, Tokens, NewLine, UsedNames (names the file uses) and
            CommandCache.
        .OUTPUTS
            [pscustomobject] with Text and Reason.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.CommandAst]$CommandAst,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.Token[]]$Continuation,

        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [hashtable]$Context
    )

    $Output = [pscustomobject]@{ Text = $null; Reason = $null }
    $Extent = $CommandAst.Extent
    $Pipeline = $CommandAst.Parent
    if ($Pipeline -isnot [System.Management.Automation.Language.PipelineAst] -or $Pipeline.PipelineElements.Count -ne 1 -or
        ($Pipeline.Parent -isnot [System.Management.Automation.Language.NamedBlockAst] -and $Pipeline.Parent -isnot [System.Management.Automation.Language.StatementBlockAst])) {
        $Output.Reason = 'it is not a statement of its own'
        $Output
        return
    }
    $Indent = Get-WozDevLinePrefix -Extent $Extent -ScriptText $Context.ScriptText
    if (-not [string]::IsNullOrWhiteSpace($Indent)) {
        $Output.Reason = 'other code precedes it on its line'
        $Output
        return
    }
    $NameElement = $CommandAst.CommandElements[0]
    if ($CommandAst.InvocationOperator -ne [System.Management.Automation.Language.TokenKind]::Unknown -or $NameElement -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or
        $NameElement.StringConstantType -ne [System.Management.Automation.Language.StringConstantType]::BareWord) {
        $Output.Reason = 'its command name is not a plain name'
        $Output
        return
    }
    if ($CommandAst.Redirections.Count -gt 0) {
        $Output.Reason = 'it has a redirection'
        $Output
        return
    }
    foreach ($Token in $Context.Tokens) {
        if ($Token.Extent.StartOffset -ge $Extent.EndOffset) {
            break
        }
        if ($Token.Extent.StartOffset -lt $Extent.StartOffset) {
            continue
        }
        if ($Token.Kind -eq [System.Management.Automation.Language.TokenKind]::Comment) {
            $Output.Reason = 'it contains a comment'
            $Output
            return
        }
        if ($Token.Text -eq '--%') {
            $Output.Reason = 'it uses the stop-parsing token'
            $Output
            return
        }
    }
    $Elements = $CommandAst.CommandElements
    foreach ($Element in $Elements) {
        if ($Element -is [System.Management.Automation.Language.VariableExpressionAst] -and $Element.Splatted) {
            $Output.Reason = 'it already uses splatting'
            $Output
            return
        }
        foreach ($Token in $Continuation) {
            if ($Token.Extent.StartOffset -ge $Element.Extent.StartOffset -and $Token.Extent.EndOffset -le $Element.Extent.EndOffset) {
                $Output.Reason = 'a backtick continues a line inside an argument'
                $Output
                return
            }
        }
    }

    $Name = $NameElement.Value
    if (-not $Context.CommandCache.ContainsKey($Name)) {
        $Info = Get-Command -Name $Name -ErrorAction Ignore | Select-Object -First 1
        if ($Info -is [System.Management.Automation.AliasInfo]) {
            $Info = $Info.ResolvedCommand
        }
        $Context.CommandCache[$Name] = $Info
    }
    $Info = $Context.CommandCache[$Name]
    if ($null -eq $Info -or $null -eq $Info.Parameters) {
        $Output.Reason = ('{0} is not loaded, so its switches cannot be told from its parameters' -f $Name)
        $Output
        return
    }
    $Binding = [System.Management.Automation.Language.StaticParameterBinder]::BindCommand($CommandAst, $true)
    if ($Binding.BindingExceptions.Count -gt 0) {
        $Output.Reason = 'the parameters cannot be bound statically'
        $Output
        return
    }

    $Named = [System.Collections.Generic.List[string]]::new()
    $Positional = [System.Collections.Generic.List[string]]::new()
    $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    for ($I = 1; $I -lt $Elements.Count; $I++) {
        $Element = $Elements[$I]
        if ($Element -isnot [System.Management.Automation.Language.CommandParameterAst]) {
            $Positional.Add($Element.Extent.Text)
            continue
        }
        try {
            $Metadata = $Info.ResolveParameter($Element.ParameterName)
        }
        catch {
            $Metadata = $null
        }
        if ($null -eq $Metadata -or -not $Seen.Add($Metadata.Name)) {
            $Output.Reason = ('-{0} does not resolve to exactly one parameter' -f $Element.ParameterName)
            $Output
            return
        }

        $Next = $null
        if ($I + 1 -lt $Elements.Count) {
            $Next = $Elements[$I + 1]
        }
        $Bound = $null
        if ($Binding.BoundParameters.ContainsKey($Metadata.Name)) {
            $Bound = $Binding.BoundParameters[$Metadata.Name].Value
        }
        if ($null -ne $Element.Argument) {
            $ValueText = ConvertTo-WozDevSplatValue -Element $Element.Argument
        }
        elseif ($null -ne $Next -and [object]::ReferenceEquals($Bound, $Next)) {
            $ValueText = ConvertTo-WozDevSplatValue -Element $Next
            $I++
        }
        elseif ($Metadata.SwitchParameter) {
            $ValueText = '$true'
        }
        else {
            $Output.Reason = ('the value of -{0} cannot be found' -f $Element.ParameterName)
            $Output
            return
        }
        if ($null -eq $ValueText) {
            $Output.Reason = 'an argument is a bareword that contains quotes'
            $Output
            return
        }
        $Named.Add(('{0} = {1}' -f $Metadata.Name, $ValueText))
    }
    if ($Named.Count -eq 0) {
        $Output.Reason = 'it has no named parameters to splat'
        $Output
        return
    }

    # 'Get-ChildItem' -> $ChildItemParams, numbered when the file already uses the name.
    $Noun = $Info.Name.Substring($Info.Name.IndexOf('-') + 1) -replace '[^A-Za-z0-9]', ''
    if ($Noun.Length -eq 0 -or [char]::IsDigit($Noun[0])) {
        $Noun = 'Command'
    }
    $Base = '{0}Params' -f (ConvertTo-WozDevPascalCase -Name $Noun)
    $VariableName = $Base
    for ($Number = 2; $Context.UsedNames.Contains($VariableName); $Number++) {
        $VariableName = '{0}{1}' -f $Base, $Number
    }
    $null = $Context.UsedNames.Add($VariableName)

    $NewLine = $Context.NewLine
    $Builder = [System.Text.StringBuilder]::new()
    $null = $Builder.Append(('${0} = @{{' -f $VariableName)).Append($NewLine)
    foreach ($Line in $Named) {
        $null = $Builder.Append($Indent).Append('    ').Append($Line).Append($NewLine)
    }
    $null = $Builder.Append($Indent).Append('}').Append($NewLine).Append($Indent).Append($NameElement.Extent.Text)
    foreach ($Text in $Positional) {
        $null = $Builder.Append(' ').Append($Text)
    }
    $null = $Builder.Append(' @').Append($VariableName)
    $Expression = $Builder.ToString()

    $Tokens = $null
    $Errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($Expression, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count -gt 0) {
        $Output.Reason = 'the rewrite does not parse'
        $Output
        return
    }
    $Output.Text = $Expression
    $Output
}

function ConvertTo-WozDevExpressionArgument {
    <#
        .SYNOPSIS
            Rewrite a command argument as the same value in expression mode.
        .DESCRIPTION
            A bare word such as test.txt is a string only in argument mode; in a script block
            it has to be quoted. Quotes bare words (and the bare words of a list), keeps
            every other argument's text, and returns $null when a bare word holds a single
            quote or a variable, which a plain quoted string cannot reproduce.
        .PARAMETER Argument
            The argument Ast from the command line.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.Ast]$Argument
    )

    $BareWord = [System.Management.Automation.Language.StringConstantType]::BareWord
    if ($Argument -is [System.Management.Automation.Language.ArrayLiteralAst]) {
        $Items = [System.Collections.Generic.List[string]]::new()
        foreach ($Element in $Argument.Elements) {
            $Item = ConvertTo-WozDevExpressionArgument -Argument $Element
            if ($null -eq $Item) {
                return
            }
            $Items.Add($Item)
        }
        $Items -join ', '
    }
    elseif ($Argument -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $Argument.StringConstantType -eq $BareWord) {
        return
    }
    elseif ($Argument -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $Argument.StringConstantType -eq $BareWord) {
        if (-not $Argument.Value.Contains("'")) {
            ("'{0}'" -f $Argument.Value)
        }
    }
    else {
        $Argument.Extent.Text
    }
}

function Get-WozDevWhereObjectConversion {
    <#
        .SYNOPSIS
            Work out the positional script block form of one Where-Object call.
        .DESCRIPTION
            Returns $null when the call already passes a positional script block, passes
            only a variable, or is splatted. Otherwise returns a hashtable: Kind
            ('FilterScript' or 'Comparison'), Extent to report, Text and Range for the fix
            (Range as StartLine, StartColumn, EndLine, EndColumn), and Reason when no fix
            is safe.
        .PARAMETER CommandAst
            The Where-Object command.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Management.Automation.Language.CommandAst]$CommandAst
    )

    $Elements = $CommandAst.CommandElements
    if ($Elements.Count -lt 2) {
        return
    }
    foreach ($Element in $Elements) {
        # Splatting hides which parameters are bound.
        if ($Element -is [System.Management.Automation.Language.VariableExpressionAst] -and $Element.Splatted) {
            return
        }
    }

    $Result = @{
        Kind = $null
        Extent = $Elements[0].Extent
        Text = $null
        Range = $null
        Reason = $null
    }

    # -FilterScript, written out or abbreviated: drop the parameter name, keep the block.
    for ($I = 1; $I -lt $Elements.Count; $I++) {
        $Element = $Elements[$I]
        if ($Element -isnot [System.Management.Automation.Language.CommandParameterAst] -or $Element.ParameterName.Length -eq 0) {
            continue
        }
        if (-not 'FilterScript'.StartsWith($Element.ParameterName, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $Result.Kind = 'FilterScript'
        $Result.Extent = $Element.Extent
        $Argument = $Element.Argument
        $Start = $Element.Extent
        if ($null -eq $Argument -and $I + 1 -lt $Elements.Count) {
            $Argument = $Elements[$I + 1]
        }
        if ($Argument -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
            $Result.Reason = 'the -FilterScript argument is not a script block literal'
        }
        elseif ($null -ne $Element.Argument) {
            # -FilterScript:{ ... } - the parameter's extent covers its argument.
            $Result.Text = $Argument.Extent.Text
            $Result.Range = @($Start.StartLineNumber, $Start.StartColumnNumber, $Start.EndLineNumber, $Start.EndColumnNumber)
        }
        else {
            $Result.Text = ''
            $Result.Range = @($Start.StartLineNumber, $Start.StartColumnNumber, $Argument.Extent.StartLineNumber, $Argument.Extent.StartColumnNumber)
        }
        $Result
        return
    }

    # Comparison form: -Property, -Value and an operator switch, named or positional.
    $Property = $null
    $Value = $null
    $Operator = $null
    $IsComparison = $false
    $Positional = [System.Collections.Generic.List[object]]::new()
    for ($I = 1; $I -lt $Elements.Count; $I++) {
        $Element = $Elements[$I]
        if ($Element -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
            return
        }
        if ($Element -isnot [System.Management.Automation.Language.CommandParameterAst]) {
            $Positional.Add($Element)
            continue
        }

        $Name = $Element.ParameterName
        if ($script:WozDevWhereObjectOperators.ContainsKey($Name)) {
            $IsComparison = $true
            if ($null -ne $Operator -or $null -ne $Element.Argument) {
                $Result.Reason = ('the -{0} switch cannot be rewritten as one operator' -f $Name)
            }
            $Operator = $script:WozDevWhereObjectOperators[$Name]
        }
        elseif ($Name -eq 'Property' -or $Name -eq 'Value') {
            $IsComparison = $true
            $Argument = $Element.Argument
            if ($null -eq $Argument -and $I + 1 -lt $Elements.Count -and $Elements[$I + 1] -isnot [System.Management.Automation.Language.CommandParameterAst]) {
                $I++
                $Argument = $Elements[$I]
            }
            if ($null -eq $Argument) {
                $Result.Reason = ('-{0} has no argument' -f $Name)
            }
            elseif ($Name -eq 'Property') {
                $Property = $Argument
            }
            else {
                $Value = $Argument
            }
        }
        else {
            $Result.Reason = ('it also passes -{0}' -f $Name)
        }
    }

    foreach ($Element in $Positional) {
        if ($null -eq $Property) {
            $Property = $Element
        }
        elseif ($null -eq $Value) {
            $Value = $Element
        }
        else {
            $Result.Reason = 'it has more arguments than -Property and -Value'
        }
    }

    # 'Where-Object $Filter' passes a script block held in a variable; leave it alone.
    if (-not $IsComparison -and $Property -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        return
    }
    $Result.Kind = 'Comparison'

    # Each step runs only while no earlier step found a reason to skip the fix.
    $PropertyText = $null
    if ($null -eq $Result.Reason) {
        # $_.Count and $_.Length fall back to the intrinsic members, which are 1 for an
        # object without that property (a directory's Length); the comparison form skips it.
        if ($Property -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $Property.Value -match '^(Count|Length)$') {
            $Result.Reason = ('$_.{0} is 1 for objects without a {0} property, which the comparison form skips' -f $Property.Value)
        }
        elseif ($Property -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $Property.Value -match '^[A-Za-z_][A-Za-z0-9_]*$') {
            $PropertyText = '$_.' + $Property.Value
        }
        elseif ($Property -is [System.Management.Automation.Language.StringConstantExpressionAst] -and -not $Property.Value.Contains("'")) {
            $PropertyText = '$_.' + ("'{0}'" -f $Property.Value)
        }
        elseif ($Property -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $PropertyText = '$_.' + $Property.Extent.Text
        }
        else {
            $Result.Reason = 'the property is not a plain name or a variable'
        }
    }

    $Condition = $null
    if ($null -ne $PropertyText) {
        if ($null -eq $Operator) {
            if ($null -eq $Value) {
                $Condition = $PropertyText
            }
            else {
                $Result.Reason = 'it passes a value without an operator'
            }
        }
        elseif ($Operator -eq '-not') {
            if ($null -eq $Value) {
                $Condition = '-not ' + $PropertyText
            }
            else {
                $Result.Reason = '-Not takes no value'
            }
        }
        elseif ($null -eq $Value) {
            $Result.Reason = ('{0} has no value to compare with' -f $Operator)
        }
        else {
            $ValueText = ConvertTo-WozDevExpressionArgument -Argument $Value
            if ($null -eq $ValueText) {
                $Result.Reason = 'the value is a bare word that holds a quote or a variable'
            }
            else {
                $Condition = ('{0} {1} {2}' -f $PropertyText, $Operator, $ValueText)
            }
        }
    }

    if ($null -ne $Condition) {
        $Expression = ('{{ {0} }}' -f $Condition)
        $Tokens = $null
        $Errors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseInput($Expression, [ref]$Tokens, [ref]$Errors)
        if ($Errors.Count -gt 0) {
            $Result.Reason = 'the rewrite does not parse'
        }
        else {
            $First = $Elements[1].Extent
            $Last = $Elements[$Elements.Count - 1].Extent
            $Result.Text = $Expression
            $Result.Range = @($First.StartLineNumber, $First.StartColumnNumber, $Last.EndLineNumber, $Last.EndColumnNumber)
        }
    }
    $Result
}

#endregion helpers

#region rules

function Measure-AvoidOutNull {
    <#
        .SYNOPSIS
            Measure-AvoidOutNull
        .DESCRIPTION
            Piping to Out-Null is the slowest way to discard output. Flags every pipeline
            whose last command is Out-Null and fixes it by rewriting the whole pipeline to
            '$null = ...' when it stands as a statement, or to a '[void](...)' cast when it
            is embedded in a larger expression or starts with a method call.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AvoidOutNull
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        # PSScriptAnalyzer calls the rule once per nested script block; the root pass covers the whole file.
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            # Only pipelines ENDING in Out-Null: a bare Out-Null statement or a mid-pipeline Out-Null is not a match.
            $Predicate = {
                param([System.Management.Automation.Language.Ast]$Ast)

                if ($Ast -isnot [System.Management.Automation.Language.PipelineAst] -or $Ast.PipelineElements.Count -lt 2) {
                    return $false
                }
                $Last = $Ast.PipelineElements[$Ast.PipelineElements.Count - 1]
                if ($Last -isnot [System.Management.Automation.Language.CommandAst]) {
                    return $false
                }
                $Name = $Last.GetCommandName()
                -not [string]::IsNullOrEmpty($Name) -and
                ($Name -eq 'Out-Null' -or $Name.EndsWith('\Out-Null', [System.StringComparison]::OrdinalIgnoreCase))
            }

            $Pipelines = @($ScriptBlockAst.FindAll($Predicate, $true) | Sort-Object -Property { $_.Extent.StartOffset })
            foreach ($Pipeline in $Pipelines) {
                $Elements = $Pipeline.PipelineElements
                $Segments = [System.Collections.Generic.List[string]]::new()
                for ($I = 0; $I -lt $Elements.Count - 1; $I++) {
                    $Segments.Add($Elements[$I].Extent.Text)
                }
                $Remaining = $Segments -join ' | '

                # '$null = <expr>' is only legal where the pipeline stands as a statement;
                # embedded pipelines (parentheses, assignment right-hand side, return) need [void](...).
                $IsStatementPosition = ($Pipeline.Parent -is [System.Management.Automation.Language.NamedBlockAst]) -or ($Pipeline.Parent -is [System.Management.Automation.Language.StatementBlockAst])
                $LeadsWithExpression = $Elements[0] -is [System.Management.Automation.Language.CommandExpressionAst]

                if (-not $IsStatementPosition) {
                    $Replacement = '[void]({0})' -f $Remaining
                }
                elseif ($LeadsWithExpression) {
                    # '[void]expr' is only safe when expr binds tighter than the cast:
                    # '[void]1 + 2' would be ([void]1) + 2. Anything else is parenthesized.
                    if ($Elements.Count -eq 2 -and (Test-WozDevPrimaryExpression -Expression $Elements[0].Expression)) {
                        $Replacement = '[void]{0}' -f $Remaining
                    }
                    else {
                        $Replacement = '[void]({0})' -f $Remaining
                    }
                }
                else {
                    $Replacement = '$null = {0}' -f $Remaining
                }

                if ($Replacement.StartsWith('$null')) {
                    $FixDescription = 'Replace Out-Null with $null assignment'
                }
                else {
                    $FixDescription = 'Replace Out-Null with [void] cast'
                }

                $Params = @{
                    Extent = $Elements[$Elements.Count - 1].Extent
                    Message = 'Avoid piping to Out-Null; assign to $null or cast to [void] instead.'
                    RuleName = 'Measure-AvoidOutNull'
                    CorrectionText = $Replacement
                    CorrectionRange = @($Pipeline.Extent.StartLineNumber, $Pipeline.Extent.StartColumnNumber, $Pipeline.Extent.EndLineNumber, $Pipeline.Extent.EndColumnNumber)
                    Description = $FixDescription
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-UseStaticConstructor {
    <#
        .SYNOPSIS
            Measure-UseStaticConstructor
        .DESCRIPTION
            New-Object is far slower than calling a type's static constructor. Flags every
            New-Object that creates a .NET object (not -ComObject) and fixes it to
            [Type]::new(...), or to a [Type]@{...} / [pscustomobject]@{...} cast for
            -Property. Positional, abbreviated, parenthesized, multi-line and nested forms
            are rewritten with the same constructor arguments, keeping the layout of
            multi-line argument lists. When the rewrite could change behavior (splatting,
            common parameters, a variable type name, an argument list of unknown size, a
            struct without a parameterless constructor) the finding carries no fix and its
            message says why.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-UseStaticConstructor
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $ScriptText = $ScriptBlockAst.Extent.StartScriptPosition.GetFullScript()
            if ($null -eq $ScriptText) {
                $ScriptText = $ScriptBlockAst.Extent.Text
            }
            # Most files never call New-Object; skip the Ast walk for them.
            if ($ScriptText.IndexOf('New-Object', [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
                return
            }

            $Predicate = {
                param([System.Management.Automation.Language.Ast]$Ast)

                if ($Ast -isnot [System.Management.Automation.Language.CommandAst]) {
                    return $false
                }
                $Name = $Ast.GetCommandName()
                -not [string]::IsNullOrEmpty($Name) -and
                ($Name -eq 'New-Object' -or $Name.EndsWith('\New-Object', [System.StringComparison]::OrdinalIgnoreCase))
            }
            $Commands = @($ScriptBlockAst.FindAll($Predicate, $true) | Sort-Object -Property { $_.Extent.StartOffset })
            if ($Commands.Count -eq 0) {
                return
            }

            $Namespaces = foreach ($UsingStatement in $ScriptBlockAst.UsingStatements) {
                if ($UsingStatement.UsingStatementKind -eq [System.Management.Automation.Language.UsingStatementKind]::Namespace) {
                    $UsingStatement.Name.Value
                }
            }
            $CommandSet = [System.Collections.Generic.HashSet[object]]::new()
            foreach ($Command in $Commands) {
                $null = $CommandSet.Add($Command)
            }
            # A hashtable, not a [pscustomobject]: binding a custom object to a parameter costs
            # time proportional to its rendered text, which here includes the whole script.
            $Context = @{
                ScriptBlockAst = $ScriptBlockAst
                ScriptText = $ScriptText
                Namespace = [string[]]@($Namespaces)
                Commands = $Commands
                CommandSet = $CommandSet
                TypeCache = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::OrdinalIgnoreCase)
                Results = [System.Collections.Generic.Dictionary[object, object]]::new()
                ArrayVariables = $null
            }

            # A command whose fix is spliced into a fixed parent's fix is not reported on its
            # own: two overlapping corrections would leave -Fix a no-op pass to finish on.
            $Covered = [System.Collections.Generic.HashSet[object]]::new()
            foreach ($Command in $Commands) {
                $Conversion = ConvertTo-WozDevStaticConstructor -CommandAst $Command -Context $Context
                if ($null -ne $Conversion.Text) {
                    foreach ($Nested in $Conversion.Nested) {
                        $null = $Covered.Add($Nested)
                    }
                }
            }

            foreach ($Command in $Commands) {
                $Conversion = $Context.Results[$Command]
                if ($Conversion.Skip -or $Covered.Contains($Command)) {
                    continue
                }

                $Params = @{
                    Extent = $Command.CommandElements[0].Extent
                    RuleName = 'Measure-UseStaticConstructor'
                }
                if ($null -eq $Conversion.Text) {
                    $Params.Message = 'Use a static constructor instead of New-Object. No automatic fix: {0}.' -f $Conversion.Reason
                }
                else {
                    if ($Conversion.Kind -eq 'Cast') {
                        $Params.Message = 'Use a [{0}] cast instead of New-Object -Property.' -f $Conversion.TargetType
                        $Params.Description = 'Replace New-Object with a [{0}] cast' -f $Conversion.TargetType
                    }
                    else {
                        $Params.Message = 'Use [{0}]::new() instead of New-Object.' -f $Conversion.TypeText
                        if ($Conversion.HasArgument) {
                            $Params.Description = 'Replace New-Object with [{0}]::new(...)' -f $Conversion.TypeText
                        }
                        else {
                            $Params.Description = 'Replace New-Object with [{0}]::new()' -f $Conversion.TypeText
                        }
                    }
                    $Extent = $Command.Extent
                    $Params.CorrectionText = $Conversion.Text
                    $Params.CorrectionRange = @($Extent.StartLineNumber, $Extent.StartColumnNumber, $Extent.EndLineNumber, $Extent.EndColumnNumber)
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-AutomaticVariableCase {
    <#
        .SYNOPSIS
            Measure-AutomaticVariableCase
        .DESCRIPTION
            Automatic and preference variables have one documented spelling ($true, $PSItem,
            $ErrorActionPreference). Flags every occurrence written with different casing
            and fixes that token to the canonical spelling, keeping its ${...} or @ form.
            Scope-qualified names such as $global:True are left alone.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AutomaticVariableCase
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            foreach ($Occurrence in @(Get-WozDevVariableOccurrence -ScriptBlockAst $ScriptBlockAst)) {
                if ($Occurrence.Kind -ne 'Automatic' -and $Occurrence.Kind -ne 'Preference') {
                    continue
                }
                if ([string]::IsNullOrEmpty($Occurrence.CanonicalName)) {
                    continue
                }
                if ([string]::Equals($Occurrence.Name, $Occurrence.CanonicalName, [System.StringComparison]::Ordinal)) {
                    continue
                }

                if ($Occurrence.Kind -eq 'Preference') {
                    $KindLabel = 'preference'
                }
                else {
                    $KindLabel = 'automatic'
                }
                $Replacement = ConvertTo-WozDevVariableToken -FullName $Occurrence.FullName -CanonicalName $Occurrence.CanonicalName

                $Params = @{
                    Extent = $Occurrence.Extent
                    Message = ("'{0}' is the {1} variable '`${2}'; use its canonical casing." -f $Occurrence.FullName, $KindLabel, $Occurrence.CanonicalName)
                    RuleName = 'Measure-AutomaticVariableCase'
                    CorrectionText = $Replacement
                    Description = ('Normalize casing to {0}' -f $Replacement)
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-VariableCaseMismatch {
    <#
        .SYNOPSIS
            Measure-VariableCaseMismatch
        .DESCRIPTION
            PowerShell variables are case-insensitive, so $Result and $Result are the same
            variable written two ways. Groups every unqualified user variable by name across
            the file, takes the declaration's casing as canonical (the parameter, else the
            first plain assignment, else the first occurrence) and flags each occurrence
            that differs, fixing that token in place and keeping its ${...} or @ form.
            Scope-qualified, automatic and preference variables are left to other rules, and
            so is a group whose declaration starts with a lower-case letter: the
            Measure-UsePascalCaseVariable fix renames all of its occurrences.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-VariableCaseMismatch
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $Records = [System.Collections.Generic.List[object]]::new()
            foreach ($Group in @(Get-WozDevVariableGroup -Occurrence @(Get-WozDevVariableOccurrence -ScriptBlockAst $ScriptBlockAst))) {
                # A lower-case declaration is Measure-UsePascalCaseVariable's to fix; fixing it
                # here too would give the same tokens two opposite corrections.
                $Canonical = $Group.Canonical
                if (Test-WozDevLowerCaseName -Name $Canonical) {
                    continue
                }

                foreach ($Occurrence in $Group.Occurrences) {
                    if ([string]::Equals($Occurrence.Name, $Canonical, [System.StringComparison]::Ordinal)) {
                        continue
                    }
                    $Replacement = ConvertTo-WozDevVariableToken -FullName $Occurrence.FullName -CanonicalName $Canonical

                    $Params = @{
                        Extent = $Occurrence.Extent
                        Message = ("'{0}' does not match the declared casing '`${1}'." -f $Occurrence.FullName, $Canonical)
                        RuleName = 'Measure-VariableCaseMismatch'
                        CorrectionText = $Replacement
                        Description = ('Normalize casing to {0}' -f $Replacement)
                    }
                    $Records.Add((New-WozDevDiagnosticRecord @Params))
                }
            }

            $Records | Sort-Object -Property { $_.Extent.StartOffset }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-UnusedAssignment {
    <#
        .SYNOPSIS
            Measure-UnusedAssignment
        .DESCRIPTION
            Flags a plain '$x = ...' assignment whose variable is never read afterward
            anywhere in the file and fixes it by removing the whole statement (its own
            lines when nothing else shares them). Reads of any form count: references,
            splatting, compound assignments, scope-qualified and string-embedded uses.
            An assignment inside a loop or a script-block literal also stays when the
            variable is read earlier in that container, since it may run again.
            Parameters, scope-qualified targets, automatic and preference variables are
            never flagged. The removal drops the right-hand side too, even when it is a
            command with side effects, so review the fix before applying it in bulk.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-UnusedAssignment
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $Occurrences = @(Get-WozDevVariableOccurrence -ScriptBlockAst $ScriptBlockAst)
            # Anything that observes the value, grouped by name: references, splatted uses,
            # compound assignments (+= reads first), scope-qualified and string-embedded uses.
            $ReadsByName = @{}
            foreach ($Occurrence in $Occurrences) {
                if ($Occurrence.IsPureWrite) {
                    continue
                }
                if (-not $ReadsByName.ContainsKey($Occurrence.UnqualifiedName)) {
                    $ReadsByName[$Occurrence.UnqualifiedName] = [System.Collections.Generic.List[object]]::new()
                }
                $ReadsByName[$Occurrence.UnqualifiedName].Add($Occurrence)
            }
            $Lines = $null

            foreach ($Candidate in $Occurrences) {
                if ($Candidate.Kind -ne 'Assigned' -or -not $Candidate.IsPureWrite -or $Candidate.IsSplatted) {
                    continue
                }
                $Reads = $ReadsByName[$Candidate.UnqualifiedName]
                if ($null -eq $Reads) {
                    $Reads = @()
                }
                if (Test-WozDevAssignmentIsLive -Subject $Candidate -Read $Reads) {
                    continue
                }

                if ($null -eq $Lines) {
                    $Lines = @(Get-WozDevScriptLine -ScriptBlockAst $ScriptBlockAst)
                }
                $Range = Get-WozDevStatementRemovalRange -Statement $Candidate.AssignmentAst.Extent -ScriptLine $Lines

                $Params = @{
                    Extent = $Candidate.Extent
                    Message = ("Variable '{0}' is assigned but never referenced afterward." -f $Candidate.FullName)
                    RuleName = 'Measure-UnusedAssignment'
                    CorrectionText = ''
                    CorrectionRange = $Range
                    Description = 'Remove unused assignment'
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-AvoidDoubledSingleQuote {
    <#
        .SYNOPSIS
            Measure-AvoidDoubledSingleQuote
        .DESCRIPTION
            A single quote escaped by doubling it ('name ''{0}''') is legal but hard to read
            and easy to miscount. Flags every single-quoted string that contains '' and
            suggests embedding double quotes instead: ('name "{0}"' -f $Value). There is no
            automatic fix: replacing the quotes changes the string's value, which matters
            where the text is SQL, a filter or other code.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AvoidDoubledSingleQuote
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            # Most files never double a quote; skip tokenizing them.
            if ((Get-WozDevScriptText -ScriptBlockAst $ScriptBlockAst).IndexOf("''") -lt 0) {
                return
            }

            foreach ($Token in @(Get-WozDevScriptToken -ScriptBlockAst $ScriptBlockAst)) {
                if ($Token.Kind -ne [System.Management.Automation.Language.TokenKind]::StringLiteral -or $Token.Text.Length -le 2) {
                    continue
                }
                if (-not $Token.Text.Substring(1, $Token.Text.Length - 2).Contains("''")) {
                    continue
                }

                $Params = @{
                    Extent = $Token.Extent
                    Message = ('Avoid doubled single quotes in {0}; embed double quotes inside the single-quoted string instead.' -f $Token.Text)
                    RuleName = 'Measure-AvoidDoubledSingleQuote'
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-AvoidBacktickContinuation {
    <#
        .SYNOPSIS
            Measure-AvoidBacktickContinuation
        .DESCRIPTION
            A backtick line continuation breaks silently when whitespace follows it. Flags
            every one and, for a command that can be rewritten safely, fixes the whole
            command to splatting: the named parameters move into a hashtable on the lines
            before it, under a variable name the file does not use yet, and the command
            passes that hashtable with '@Name'. A command gets one finding with the fix;
            otherwise each backtick gets its own finding without one, and the message says
            why. The fix needs the command loaded in the analyzing session, to tell switches
            from parameters that take a value.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AvoidBacktickContinuation
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $ScriptText = Get-WozDevScriptText -ScriptBlockAst $ScriptBlockAst
            if ($ScriptText.IndexOf([char]'`') -lt 0) {
                return
            }
            $Tokens = @(Get-WozDevScriptToken -ScriptBlockAst $ScriptBlockAst)
            $Continuations = @($Tokens | Where-Object { $_.Kind -eq [System.Management.Automation.Language.TokenKind]::LineContinuation })
            if ($Continuations.Count -eq 0) {
                return
            }

            # Each backtick belongs to the innermost command around it, if any.
            $Commands = @($ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.CommandAst] }, $true))
            $Groups = [System.Collections.Generic.Dictionary[object, object]]::new()
            $Loose = [System.Collections.Generic.List[object]]::new()
            foreach ($Token in $Continuations) {
                $Owner = $null
                foreach ($Command in $Commands) {
                    $Extent = $Command.Extent
                    if ($Extent.StartOffset -le $Token.Extent.StartOffset -and $Extent.EndOffset -ge $Token.Extent.EndOffset) {
                        if ($null -eq $Owner -or $Extent.EndOffset - $Extent.StartOffset -lt $Owner.Extent.EndOffset - $Owner.Extent.StartOffset) {
                            $Owner = $Command
                        }
                    }
                }
                if ($null -eq $Owner) {
                    $Loose.Add($Token)
                    continue
                }
                if (-not $Groups.ContainsKey($Owner)) {
                    $Groups[$Owner] = [System.Collections.Generic.List[object]]::new()
                }
                $Groups[$Owner].Add($Token)
            }

            $UsedNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            foreach ($Variable in $ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)) {
                $UserPath = $Variable.VariablePath.UserPath
                $null = $UsedNames.Add($UserPath.Substring($UserPath.LastIndexOf(':') + 1))
            }
            $Context = @{
                ScriptText = $ScriptText
                Tokens = $Tokens
                NewLine = Get-WozDevNewLine -ScriptText $ScriptText
                UsedNames = $UsedNames
                CommandCache = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::OrdinalIgnoreCase)
            }

            $Message = 'Avoid backtick line continuation; use splatting instead.'
            $Records = [System.Collections.Generic.List[object]]::new()
            foreach ($Command in $Groups.Keys) {
                $Owned = [System.Management.Automation.Language.Token[]]$Groups[$Command].ToArray()
                $Conversion = ConvertTo-WozDevSplat -CommandAst $Command -Continuation $Owned -Context $Context
                if ($null -ne $Conversion.Text) {
                    $Extent = $Command.Extent
                    $Params = @{
                        Extent = $Owned[0].Extent
                        Message = $Message
                        RuleName = 'Measure-AvoidBacktickContinuation'
                        CorrectionText = $Conversion.Text
                        CorrectionRange = @($Extent.StartLineNumber, $Extent.StartColumnNumber, $Extent.EndLineNumber, $Extent.EndColumnNumber)
                        Description = ('Splat the parameters of {0}' -f $Command.GetCommandName())
                    }
                    $Records.Add((New-WozDevDiagnosticRecord @Params))
                    continue
                }
                foreach ($Token in $Owned) {
                    $Params = @{
                        Extent = $Token.Extent
                        Message = ('{0} No automatic fix: {1}.' -f $Message, $Conversion.Reason)
                        RuleName = 'Measure-AvoidBacktickContinuation'
                    }
                    $Records.Add((New-WozDevDiagnosticRecord @Params))
                }
            }
            foreach ($Token in $Loose) {
                $Params = @{
                    Extent = $Token.Extent
                    Message = ('{0} No automatic fix: it does not continue a command.' -f $Message)
                    RuleName = 'Measure-AvoidBacktickContinuation'
                }
                $Records.Add((New-WozDevDiagnosticRecord @Params))
            }

            $Records | Sort-Object -Property { $_.Extent.StartOffset }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-AvoidStringInterpolation {
    <#
        .SYNOPSIS
            Measure-AvoidStringInterpolation
        .DESCRIPTION
            Variables expanded inside a double-quoted string are easy to miss and mangle
            text such as "$Name:" or "$Obj.Prop". Flags every double-quoted string that
            expands a variable or subexpression and fixes it to a single-quoted format
            string with -f: "Copied $Count files to $($Target.Path)" becomes
            ('Copied {0} files to {1}' -f $Count, $Target.Path). A string whose text a
            single-quoted string cannot hold, such as a single quote or '`n', keeps its
            double quotes and only the expansions move out: "URL '$Url' is up" becomes
            ("URL '{0}' is up" -f $Url). The finding carries no fix when the rewrite could
            change the text: a value that may be an array (a '$(...)' that runs a command,
            or a variable the file assigns an array). -f
            formats numbers and dates for the current culture, where expansion uses the
            invariant culture, so review the fix for [double] and [datetime] values on
            non-English systems. Here-strings are not flagged. A string nested inside
            another one that gets a fix is reported without one; run -Fix again for it.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AvoidStringInterpolation
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $Predicate = {
                param([System.Management.Automation.Language.Ast]$Ast)

                $Ast -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
                $Ast.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::DoubleQuoted -and
                $Ast.NestedExpressions.Count -gt 0
            }
            $Strings = @($ScriptBlockAst.FindAll($Predicate, $true) | Sort-Object -Property { $_.Extent.StartOffset })
            if ($Strings.Count -eq 0) {
                return
            }

            $Context = @{
                ScriptBlockAst = $ScriptBlockAst
                ScriptText = Get-WozDevScriptText -ScriptBlockAst $ScriptBlockAst
                ArrayVariables = $null
            }
            $Message = 'Avoid variable expansion in double-quoted strings; use a single-quoted format string with -f.'

            # Sorted by start, so an enclosing string comes before the strings inside it.
            $CoveredEnd = -1
            foreach ($String in $Strings) {
                $Extent = $String.Extent
                $Params = @{
                    Extent = $Extent
                    RuleName = 'Measure-AvoidStringInterpolation'
                }
                if ($Extent.StartOffset -lt $CoveredEnd) {
                    $Params.Message = ('{0} No automatic fix yet: the enclosing string is fixed first.' -f $Message)
                }
                else {
                    $Conversion = ConvertTo-WozDevFormatExpression -StringAst $String -Context $Context
                    if ($null -eq $Conversion.Text) {
                        $Params.Message = ('{0} No automatic fix: {1}.' -f $Message, $Conversion.Reason)
                    }
                    else {
                        $CoveredEnd = $Extent.EndOffset
                        $Params.Message = $Message
                        $Params.CorrectionText = $Conversion.Text
                        $Params.Description = 'Rewrite as a -f format string'
                        if ($Conversion.IsDoubleQuoted) {
                            $Params.Message = 'Avoid variable expansion in double-quoted strings; move the values into -f arguments.'
                            $Params.Description = 'Rewrite as a -f format string (keeps double quotes)'
                        }
                    }
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-AvoidReturnValue {
    <#
        .SYNOPSIS
            Measure-AvoidReturnValue
        .DESCRIPTION
            In an advanced function, 'return <value>' hides that everything else the
            function emits is output too. Flags every 'return' with a value that belongs
            to an advanced function (one with [CmdletBinding()] or a [Parameter()]
            attribute; returns inside nested functions and script blocks belong to those)
            and fixes it to emit the value, followed by a bare 'return' unless the return
            was the last statement of the function's begin, process or end block.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-AvoidReturnValue
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $ScriptText = $null
            $AttributePattern = '^(System\.Management\.Automation\.)?{0}(Attribute)?$'
            foreach ($Function in $ScriptBlockAst.FindAll({ param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
                $ParamBlock = $Function.Body.ParamBlock
                if ($null -eq $ParamBlock -or $Function.Parent -is [System.Management.Automation.Language.FunctionMemberAst]) {
                    continue
                }
                $IsAdvanced = $false
                foreach ($Attribute in $ParamBlock.Attributes) {
                    if ($Attribute.TypeName.FullName -match ($AttributePattern -f 'CmdletBinding')) {
                        $IsAdvanced = $true
                    }
                }
                foreach ($Parameter in $ParamBlock.Parameters) {
                    foreach ($Attribute in $Parameter.Attributes) {
                        if ($Attribute -is [System.Management.Automation.Language.AttributeAst] -and $Attribute.TypeName.FullName -match ($AttributePattern -f 'Parameter')) {
                            $IsAdvanced = $true
                        }
                    }
                }
                if (-not $IsAdvanced) {
                    continue
                }

                $Predicate = { param([System.Management.Automation.Language.Ast]$Ast) $Ast -is [System.Management.Automation.Language.ReturnStatementAst] -and $null -ne $Ast.Pipeline }
                foreach ($Return in $Function.Body.FindAll($Predicate, $true)) {
                    # Skip returns that belong to a nested function or script block.
                    $Owner = $Return.Parent
                    while ($null -ne $Owner -and $Owner -isnot [System.Management.Automation.Language.FunctionDefinitionAst] -and $Owner -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
                        $Owner = $Owner.Parent
                    }
                    if (-not [object]::ReferenceEquals($Owner, $Function)) {
                        continue
                    }

                    if ($null -eq $ScriptText) {
                        $ScriptText = Get-WozDevScriptText -ScriptBlockAst $ScriptBlockAst
                        $NewLine = Get-WozDevNewLine -ScriptText $ScriptText
                    }
                    $Value = $Return.Pipeline.Extent.Text
                    $Block = $Return.Parent
                    $IsLast = $Block -is [System.Management.Automation.Language.NamedBlockAst] -and [object]::ReferenceEquals($Block.Parent, $Function.Body) -and
                    [object]::ReferenceEquals($Block.Statements[$Block.Statements.Count - 1], $Return)

                    $Extent = $Return.Extent
                    $Indent = Get-WozDevLinePrefix -Extent $Extent -ScriptText $ScriptText
                    $LineEnd = $ScriptText.IndexOf([char]"`n", $Extent.EndOffset)
                    if ($LineEnd -lt 0) {
                        $LineEnd = $ScriptText.Length
                    }
                    $After = $ScriptText.Substring($Extent.EndOffset, $LineEnd - $Extent.EndOffset)
                    if ($IsLast) {
                        $Replacement = $Value
                    }
                    elseif ([string]::IsNullOrWhiteSpace($Indent) -and [string]::IsNullOrWhiteSpace($After)) {
                        $Replacement = '{0}{1}{2}return' -f $Value, $NewLine, $Indent
                    }
                    else {
                        $Replacement = '{0}; return' -f $Value
                    }

                    $Params = @{
                        Extent = $Extent
                        Message = ('Avoid return with a value in advanced function {0}; emit the value, then use a bare return to exit early.' -f $Function.Name)
                        RuleName = 'Measure-AvoidReturnValue'
                        Severity = 'Information'
                    }
                    $Tokens = $null
                    $Errors = $null
                    $null = [System.Management.Automation.Language.Parser]::ParseInput($Replacement, [ref]$Tokens, [ref]$Errors)
                    if ($Errors.Count -eq 0) {
                        $Params.CorrectionText = $Replacement
                        $Params.Description = 'Emit the value instead of returning it'
                    }
                    New-WozDevDiagnosticRecord @Params
                }
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-UsePascalCaseVariable {
    <#
        .SYNOPSIS
            Measure-UsePascalCaseVariable
        .DESCRIPTION
            Variables are PascalCase. Flags every occurrence of a user variable whose
            declaration (the parameter, else the first plain assignment, else the first
            occurrence) starts with a lower-case letter, and fixes each token to the
            declaration with its first letter upper-cased, keeping its ${...}, @ or scope
            form. Variables are case-insensitive, so the rename never changes behavior.
            Scope-qualified uses ($script:count) are fixed the same way; drive-qualified
            ($env:path), automatic and preference variables are left alone.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-UsePascalCaseVariable
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $Occurrences = @(Get-WozDevVariableOccurrence -ScriptBlockAst $ScriptBlockAst)
            $Groups = @{}
            foreach ($Group in @(Get-WozDevVariableGroup -Occurrence $Occurrences)) {
                $Groups[$Group.Key] = $Group
            }

            foreach ($Occurrence in $Occurrences) {
                $Replacement = $null
                if ($Occurrence.Kind -eq 'Scoped') {
                    $Name = $Occurrence.Name.Substring($Occurrence.Name.LastIndexOf(':') + 1)
                    if ($Occurrence.Ast.VariablePath.IsDriveQualified -or -not (Test-WozDevLowerCaseName -Name $Name) -or
                        $script:WozDevAutomaticNames.ContainsKey($Name) -or $script:WozDevPreferenceNames.ContainsKey($Name)) {
                        continue
                    }
                    $Target = $Name
                    if ($Groups.ContainsKey($Name.ToLowerInvariant())) {
                        $Target = $Groups[$Name.ToLowerInvariant()].Canonical
                    }
                    $Target = ConvertTo-WozDevPascalCase -Name $Target

                    # The name is the token's tail, before the closing brace of a ${...} form.
                    $Text = $Occurrence.FullName
                    $End = $Text.Length
                    if ($Text.StartsWith('${') -and $Text.EndsWith('}')) {
                        $End--
                    }
                    $Start = $End - $Name.Length
                    if ($Start -gt 0 -and [string]::Equals($Text.Substring($Start, $Name.Length), $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $Replacement = $Text.Substring(0, $Start) + $Target + $Text.Substring($End)
                    }
                }
                elseif ($Groups.ContainsKey($Occurrence.Name.ToLowerInvariant())) {
                    $Canonical = $Groups[$Occurrence.Name.ToLowerInvariant()].Canonical
                    if (-not (Test-WozDevLowerCaseName -Name $Canonical)) {
                        continue
                    }
                    $Target = ConvertTo-WozDevPascalCase -Name $Canonical
                    if ([string]::Equals($Occurrence.Name, $Target, [System.StringComparison]::Ordinal)) {
                        continue
                    }
                    $Replacement = ConvertTo-WozDevVariableToken -FullName $Occurrence.FullName -CanonicalName $Target
                }
                else {
                    continue
                }

                $Suggestion = $Replacement
                if ($null -eq $Suggestion) {
                    $Suggestion = '${0}' -f $Target
                }
                $Params = @{
                    Extent = $Occurrence.Extent
                    Message = ("Variable '{0}' is not PascalCase; rename it to '{1}' everywhere." -f $Occurrence.FullName, $Suggestion)
                    RuleName = 'Measure-UsePascalCaseVariable'
                }
                if ($null -ne $Replacement) {
                    $Params.CorrectionText = $Replacement
                    $Params.Description = ('Rename to {0}' -f $Replacement)
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

function Measure-UseWhereObjectScriptBlock {
    <#
        .SYNOPSIS
            Measure-UseWhereObjectScriptBlock
        .DESCRIPTION
            Where-Object takes its condition as a positional script block:
            Where-Object { $_.Name -eq 'test.txt' }. Flags a named -FilterScript and fixes it
            by dropping the parameter name, and flags the comparison form (-Property, -Value
            and switches such as -EQ, named or positional) and fixes it to the same test in a
            script block. When the rewrite could change behavior (an abbreviated or extra
            parameter, a value with no operator, a bare word holding a quote or a variable,
            a Count or Length property) the finding carries no fix and its message says why. A call that passes only a
            variable or is splatted is left alone.
        .PARAMETER ScriptBlockAst
            The script block to examine. PSScriptAnalyzer supplies it.
        .INPUTS
            [System.Management.Automation.Language.ScriptBlockAst]
        .OUTPUTS
            [Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]]
        .EXAMPLE
            Invoke-ScriptAnalyzer -Path .\Script.ps1 -CustomRulePath .\WozDev-Rules.psm1 -IncludeRule Measure-UseWhereObjectScriptBlock
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [System.Management.Automation.Language.ScriptBlockAst]$ScriptBlockAst
    )

    process {
        if ($null -ne $ScriptBlockAst.Parent) {
            return
        }

        try {
            $Predicate = {
                param([System.Management.Automation.Language.Ast]$Ast)

                if ($Ast -isnot [System.Management.Automation.Language.CommandAst]) {
                    return $false
                }
                $Name = $Ast.GetCommandName()
                -not [string]::IsNullOrEmpty($Name) -and
                ($Name -eq 'Where-Object' -or $Name -eq 'where' -or $Name -eq '?' -or $Name.EndsWith('\Where-Object', [System.StringComparison]::OrdinalIgnoreCase))
            }
            $Commands = @($ScriptBlockAst.FindAll($Predicate, $true) | Sort-Object -Property { $_.Extent.StartOffset })

            # A call nested in the arguments of a comparison being rewritten is reported on the
            # next run: two overlapping corrections would leave -Fix a no-op pass to finish on.
            $CoveredEnd = -1
            foreach ($Command in $Commands) {
                if ($Command.Extent.StartOffset -lt $CoveredEnd) {
                    continue
                }
                $Conversion = Get-WozDevWhereObjectConversion -CommandAst $Command
                if ($null -eq $Conversion) {
                    continue
                }

                if ($Conversion.Kind -eq 'FilterScript') {
                    $Message = 'Pass the Where-Object script block positionally; drop -FilterScript.'
                    $FixDescription = 'Remove -FilterScript'
                }
                elseif ($null -ne $Conversion.Text) {
                    $Message = ('Use a script block with Where-Object: Where-Object {0}' -f $Conversion.Text)
                    $FixDescription = 'Rewrite as a Where-Object script block'
                    $CoveredEnd = $Command.Extent.EndOffset
                }
                else {
                    $Message = 'Use a script block with Where-Object, such as Where-Object { $_.Name -eq "value" }.'
                }
                if ($null -ne $Conversion.Reason) {
                    $Message = ('{0} No automatic fix: {1}.' -f $Message, $Conversion.Reason)
                }

                $Params = @{
                    Extent = $Conversion.Extent
                    Message = $Message
                    RuleName = 'Measure-UseWhereObjectScriptBlock'
                }
                if ($null -ne $Conversion.Text) {
                    $Params.CorrectionText = $Conversion.Text
                    $Params.CorrectionRange = $Conversion.Range
                    $Params.Description = $FixDescription
                }
                New-WozDevDiagnosticRecord @Params
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
    }
}

#endregion rules

Export-ModuleMember -Function @(
    'Measure-UnusedAssignment', 'Measure-VariableCaseMismatch', 'Measure-AutomaticVariableCase', 'Measure-AvoidOutNull',
    'Measure-UseStaticConstructor', 'Measure-UsePascalCaseVariable', 'Measure-AvoidStringInterpolation',
    'Measure-AvoidReturnValue', 'Measure-AvoidBacktickContinuation', 'Measure-AvoidDoubledSingleQuote',
    'Measure-UseWhereObjectScriptBlock'
)
