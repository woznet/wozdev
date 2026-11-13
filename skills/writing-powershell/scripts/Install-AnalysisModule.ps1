#Requires -Version 5.1
<#
    .SYNOPSIS
    Installs PSScriptAnalyzer and Pester for the current user from the PowerShell Gallery.

    .DESCRIPTION
    Downloads each module's .nupkg straight from www.powershellgallery.com and extracts
    it into the user module folder as <Name>\<Version>. It needs no PowerShellGet,
    PSResourceGet, NuGet provider, or trusted-repository setting, never prompts, and
    behaves the same in Windows PowerShell 5.1 and PowerShell 7 on any platform.

    A module that is already available at or above its minimum version is skipped
    unless -Force is given. Pester's minimum is 5.0.0, so the Pester 3.4 that ships
    with Windows does not count.

    .PARAMETER Name
    Modules to install. Defaults to both PSScriptAnalyzer and Pester.

    .PARAMETER Destination
    Module folder to install into. Defaults to the current user's module folder for
    this edition and platform.

    .PARAMETER Force
    Install the latest version even when a suitable version is already available,
    replacing an existing copy of that version in Destination.

    .EXAMPLE
    ./Install-AnalysisModule.ps1

    .EXAMPLE
    pwsh -NoProfile -File ./Install-AnalysisModule.ps1 -Name PSScriptAnalyzer

    .OUTPUTS
    System.Management.Automation.PSCustomObject
#>
[CmdletBinding(SupportsShouldProcess)]
[OutputType([pscustomobject])]
param(
    [ValidateSet('PSScriptAnalyzer', 'Pester')]
    [string[]]$Name = @('PSScriptAnalyzer', 'Pester'),

    [ValidateNotNullOrEmpty()]
    [string]$Destination,

    [switch]$Force
)

begin {
    $MinimumVersion = @{
        PSScriptAnalyzer = [version]'1.0.0'
        Pester = [version]'5.0.0'
    }
    $PackageUrl = 'https://www.powershellgallery.com/api/v2/package/{0}'
    $MetadataItem = @('_rels', 'package', '[Content_Types].xml', '.signature.p7s')

    # Invoke-WebRequest renders a progress bar per chunk, which slows 5.1 downloads badly,
    # and older 5.1 hosts default to TLS 1.0, which the Gallery refuses.
    $ProgressPreference = 'SilentlyContinue'
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12

    if (-not $Destination) {
        if ($PSVersionTable.PSEdition -eq 'Desktop') {
            $Destination = Join-Path -Path ([System.Environment]::GetFolderPath('MyDocuments')) -ChildPath 'WindowsPowerShell\Modules'
        }
        elseif ($IsWindows) {
            $Destination = Join-Path -Path ([System.Environment]::GetFolderPath('MyDocuments')) -ChildPath 'PowerShell\Modules'
        }
        else {
            $DataHome = $env:XDG_DATA_HOME
            if (-not $DataHome) {
                $DataHome = Join-Path -Path $HOME -ChildPath '.local/share'
            }
            $Destination = Join-Path -Path $DataHome -ChildPath 'powershell/Modules'
        }
    }

    $ModulePath = $env:PSModulePath -split [System.IO.Path]::PathSeparator
    if ($ModulePath -notcontains $Destination.TrimEnd('\', '/')) {
        Write-Warning -Message ('{0} is not on PSModulePath; import the modules by path or add it.' -f $Destination)
    }
}

process {
    foreach ($ModuleName in $Name) {
        $Available = Get-Module -ListAvailable -Name $ModuleName | Where-Object { $_.Version -ge $MinimumVersion[$ModuleName] }
        $Existing = $Available | Sort-Object -Property Version -Descending | Select-Object -First 1

        if ($Existing -and -not $Force) {
            [pscustomobject]@{
                Name = $ModuleName
                Version = $Existing.Version
                Path = $Existing.ModuleBase
                Status = 'AlreadyInstalled'
            }
            continue
        }

        $Description = ('Downloading {0} from the PowerShell Gallery into {1}.' -f $ModuleName, $Destination)
        $Warning = ('Install {0} into {1}?' -f $ModuleName, $Destination)
        if (-not $PSCmdlet.ShouldProcess($Description, $Warning, 'Install module')) {
            continue
        }

        $ModuleFolder = Join-Path -Path $Destination -ChildPath $ModuleName
        $Staging = Join-Path -Path $ModuleFolder -ChildPath ('.staging-{0}' -f [guid]::NewGuid().ToString('N'))
        # Expand-Archive in 5.1 accepts only a .zip extension.
        $Package = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('{0}-{1}.zip' -f $ModuleName, [guid]::NewGuid().ToString('N'))

        try {
            $Request = @{
                Uri = ($PackageUrl -f $ModuleName)
                OutFile = $Package
                UseBasicParsing = $true
                ErrorAction = 'Stop'
            }
            Invoke-WebRequest @Request

            # Staging inside the module folder keeps the final rename on one volume.
            $null = New-Item -ItemType Directory -Path $Staging -Force -ErrorAction Stop
            Expand-Archive -LiteralPath $Package -DestinationPath $Staging -Force -ErrorAction Stop

            $Nuspec = Get-ChildItem -LiteralPath $Staging -Filter '*.nuspec' -File | Select-Object -First 1
            $Version = ([xml](Get-Content -LiteralPath $Nuspec.FullName -Raw)).package.metadata.version

            foreach ($Item in $MetadataItem + $Nuspec.Name) {
                Remove-Item -LiteralPath (Join-Path -Path $Staging -ChildPath $Item) -Recurse -Force -ErrorAction SilentlyContinue
            }

            $Target = Join-Path -Path $ModuleFolder -ChildPath $Version
            if (Test-Path -LiteralPath $Target) {
                Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
            }
            Rename-Item -LiteralPath $Staging -NewName $Version -ErrorAction Stop

            [pscustomobject]@{
                Name = $ModuleName
                Version = [version]$Version
                Path = $Target
                Status = 'Installed'
            }
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
        finally {
            Remove-Item -LiteralPath $Package -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $Staging) {
                Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
