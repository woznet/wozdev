# Quick / Helper Function Template
function Get-Template {
    [CmdletBinding()]
    [OutputType([System.IO.FileSystemInfo])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    try {
        Get-ChildItem -Path $Path -ErrorAction Stop
    }
    catch {
        $PSCmdlet.ThrowTerminatingError($_)
    }
}
