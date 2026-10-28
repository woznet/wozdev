<#
Disabled - 'PSAvoidUsingWriteHost'
#>
@{
    # IncludeRules is an allow-list: only the rules named below run, and the
    # formatting rules among them also need Enable = $true under Rules.
    IncludeDefaultRules = $true
    Severity = @('Error', 'Warning', 'Information')
    # The WozDev custom rules (Measure-*) live in WozDev-Rules.psm1 next to this file.
    # Test-PowerShellStyle.ps1 passes it with -CustomRulePath, so the path is not hard-coded here.
    IncludeRules = @(
        # WozDev custom rules - IncludeRules is an allow-list, so custom rules must be named here too
        'Measure-*',
        # 'PSAlignAssignmentStatement',
        'PSAvoidDefaultValueSwitchParameter',
        # 'PSAvoidGlobalVars',
        'PSAvoidSemicolonsAsLineTerminators',
        'PSAvoidTrailingWhitespace',
        'PSAvoidUsingCmdletAliases',
        # 'PSAvoidUsingComputerNameHardcoded',
        # 'PSAvoidUsingConvertToSecureStringWithPlainText',
        'PSAvoidUsingDoubleQuotesForConstantString',
        # 'PSAvoidUsingEmptyCatchBlock',
        # 'PSAvoidUsingInvokeExpression',
        'PSAvoidUsingPlainTextForPassword',
        'PSAvoidUsingPositionalParameters',
        'PSAvoidUsingUserNameAndPasswordParams',
        'PSAvoidUsingWMICmdlet',
        'PSMisleadingBacktick',
        'PSMissingModuleManifestField',
        'PSPlaceCloseBrace',
        'PSPlaceOpenBrace',
        'PSPossibleIncorrectComparisonWithNull',
        'PSPossibleIncorrectUsageOfAssignmentOperator',
        'PSPossibleIncorrectUsageOfRedirectionOperator',
        'PSProvideCommentHelp',
        'PSReservedCmdletChar',
        'PSReservedParams',
        'PSShouldProcess',
        # 'PSUseApprovedVerbs',
        'PSUseBOMForUnicodeEncodedFile',
        'PSUseCmdletCorrectly',
        'PSUseCompatibleSyntax',
        'PSUseConsistentIndentation',
        'PSUseConsistentWhitespace',
        'PSUseCorrectCasing',
        # 'PSUseDeclaredVarsMoreThanAssignments',
        'PSUseLiteralInitializerForHashtable',
        'PSUseProcessBlockForPipelineCommand',
        'PSUsePSCredentialType',
        # 'PSUseShouldProcessForStateChangingFunctions',
        # 'PSUseSingularNouns',
        'UseUTF8EncodingForHelpFile'
    )

    # ExcludeRules wins over the IncludeRules allow-list (including 'Measure-*').
    ExcludeRules = @(
        # Temporarily disabled: misfires. The rule stays in WozDev-Rules.psm1;
        # delete this entry to re-enable it.
        'Measure-AvoidReturnValue'
    )

    Rules = @{

        PSAvoidUsingCmdletAliases = @{
            allowlist = @('cd')
        }
        PSProvideCommentHelp = @{
            Enable = $true
            ExportedOnly = $true
            BlockComment = $true
            VSCodeSnippetCorrection = $true
            Placement = 'begin'
        }

        # OTBS: '{' ends the line; '}' sits on its own line, so catch/else/finally
        # start a new line (matches the bundled templates).
        PSPlaceOpenBrace = @{
            Enable = $true
            OnSameLine = $true
            NewLineAfter = $true
            IgnoreOneLineBlock = $true
        }

        PSPlaceCloseBrace = @{
            Enable = $true
            NewLineAfter = $true
            IgnoreOneLineBlock = $true
            NoEmptyLineBefore = $true
        }

        PSUseConsistentIndentation = @{
            Enable = $true
            Kind = 'space'
            PipelineIndentation = 'IncreaseIndentationAfterEveryPipeline'
            IndentationSize = 4
        }

        PSUseConsistentWhitespace = @{
            Enable = $false
            CheckInnerBrace = $false
            CheckOpenBrace = $false
            CheckOpenParen = $false
            CheckOperator = $false
            CheckPipe = $false
            CheckPipeForRedundantWhitespace = $false
            CheckSeparator = $false
            CheckParameter = $false
            IgnoreAssignmentOperatorInsideHashTable = $true
        }

        PSAlignAssignmentStatement = @{
            Enable = $true
            CheckHashtable = $false
        }

        PSUseCorrectCasing = @{
            Enable = $true
        }

        PSAvoidUsingDoubleQuotesForConstantString = @{
            Enable = $true
        }

        PSAvoidSemicolonsAsLineTerminators = @{
            Enable = $true
        }

        # Flags 7+-only syntax (ternary, &&/||, ??, ?.) that Windows PowerShell 5.1 cannot parse.
        PSUseCompatibleSyntax = @{
            Enable = $true
            TargetVersions = @('5.1', '7.4')
        }
    }
}
