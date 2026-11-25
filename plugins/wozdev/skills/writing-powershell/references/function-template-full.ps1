# Full Function Template
function Get-Template {
    <#
        .SYNOPSIS
        Brief and simple summary of what the function does.

        .DESCRIPTION
        Short and straightforward description explaining the purpose and typical usage.

        .PARAMETER InputObject
        Describe the parameter. Mention constraints, expected types, etc.

        .PARAMETER OtherParameter
        Describe the parameter.

        .PARAMETER PassThru
        Emit the processed object back to the pipeline. By default the function produces no output.

        .EXAMPLE
        Get-Template -InputObject $value -OtherParameter 'X'
        Demonstrates a typical usage scenario.

        .INPUTS
        TypeName
        Describe what can be piped to this function.

        .OUTPUTS
        TypeName
        Describe what the function outputs.

        .NOTES
        Author: Your Name
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
    [OutputType([object])]
    param(
        [Parameter(Mandatory, Position = 0, ValueFromPipeline)]
        [ValidateNotNullOrEmpty()]
        [object]$InputObject,

        [Parameter(Position = 1)]
        [string]$OtherParameter,

        [switch]$PassThru
    )
    begin {
        # Exclude if not used.
        # Initialize resources shared across the pipeline.
        # Example: $Client = [System.Net.Http.HttpClient]::new()
    }
    process {
        try {
            Write-Verbose ('Processing: {0} ({1})' -f $InputObject, $OtherParameter)

            # Optional confirmation (3-parameter ShouldProcess overload).
            $TargetDesc = ($InputObject | Out-String).Trim()
            $ActionName = 'Do the thing'
            $VerboseDescription = ('{0} -> {1}' -f $ActionName, $TargetDesc)
            $VerboseWarning = ('This will {0} on: {1}' -f $ActionName.ToLower(), $TargetDesc)
            $Caption = ('Confirm: {0}' -f $ActionName)

            if ($PSCmdlet.ShouldProcess($VerboseDescription, $VerboseWarning, $Caption)) {
                # Core logic goes here.

                # Advanced functions emit to the pipeline instead of using 'return'.
                if ($PassThru) { $InputObject }
            }
        }
        catch {
            # Non-terminating: report this item and continue the pipeline.
            Write-Error -ErrorRecord $_

            # Terminating: stop the whole command (use when the error is fatal).
            # $PSCmdlet.ThrowTerminatingError($_)
        }
        finally {
            # Exclude if not used.
            # Per-item cleanup.
        }
    }
    end {
        # Exclude if not used.
        # Dispose resources created in begin.
        # Example: $Client.Dispose()
    }
}
