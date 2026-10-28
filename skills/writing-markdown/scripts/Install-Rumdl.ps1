<#
.SYNOPSIS
    Installs rumdl from its GitHub release binary on 64-bit Windows.

.DESCRIPTION
    Downloads the x86_64-pc-windows-msvc release zip of rumdl, verifies its SHA-256 checksum,
    copies rumdl.exe into InstallDirectory, and adds that folder to the user PATH and the
    current session PATH. Does nothing when rumdl is already on PATH unless -Force is given.
    Runs on Windows PowerShell 5.1 and PowerShell 7.

.PARAMETER Version
    Release tag to install, such as v0.3.0. Defaults to the latest release.

.PARAMETER InstallDirectory
    Folder that receives rumdl.exe. Defaults to %LOCALAPPDATA%\Programs\rumdl.

.PARAMETER Force
    Installs even when rumdl is already on PATH.

.PARAMETER SkipPathUpdate
    Leaves the user PATH unchanged; only the current session PATH is updated.

.EXAMPLE
    pwsh -NoProfile -File .\Install-Rumdl.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Rumdl.ps1 -Version v0.3.0 -Force

.OUTPUTS
    System.Management.Automation.PSCustomObject
#>
[CmdletBinding(SupportsShouldProcess)]
[OutputType([pscustomobject])]
param(
    [ValidatePattern('^(latest|v?\d+\.\d+\.\d+)$')]
    [string]$Version = 'latest',

    [ValidateNotNullOrEmpty()]
    [string]$InstallDirectory = (Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Programs\rumdl'),

    [switch]$Force,

    [switch]$SkipPathUpdate
)

$Repo = 'https://github.com/rvben/rumdl'
$Target = 'x86_64-pc-windows-msvc'

$Existing = Get-Command -Name 'rumdl' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($Existing -and -not $Force) {
    Write-Verbose -Message ('rumdl is already installed at {0}' -f $Existing.Source)
    [pscustomobject]@{
        Version   = (& $Existing.Source --color never --version)
        Path      = $Existing.Source
        Installed = $false
    }
    return
}

if (-not [Environment]::Is64BitOperatingSystem) {
    $PSCmdlet.ThrowTerminatingError([System.Management.Automation.ErrorRecord]::new(
            [System.PlatformNotSupportedException]::new('This installer supports 64-bit Windows only.'),
            'UnsupportedPlatform',
            [System.Management.Automation.ErrorCategory]::NotImplemented,
            $null
        ))
}

$WorkDirectory = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('rumdl-{0}' -f [guid]::NewGuid())
$PreviousProgress = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'

try {
    if ($Version -eq 'latest') {
        $Release = Invoke-RestMethod -Uri 'https://api.github.com/repos/rvben/rumdl/releases/latest' -ErrorAction Stop
        $Version = $Release.tag_name
    }
    if (-not $Version.StartsWith('v')) {
        $Version = 'v{0}' -f $Version
    }

    $Asset = 'rumdl-{0}-{1}.zip' -f $Version, $Target
    $Url = '{0}/releases/download/{1}/{2}' -f $Repo, $Version, $Asset
    $ZipPath = Join-Path -Path $WorkDirectory -ChildPath $Asset
    $HashPath = '{0}.sha256' -f $ZipPath

    # The download and checksum run under -WhatIf too; only the install steps are guarded.
    $null = New-Item -Path $WorkDirectory -ItemType Directory -Force -WhatIf:$false -Confirm:$false -ErrorAction Stop
    Write-Verbose -Message ('Downloading {0}' -f $Url)
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing -ErrorAction Stop
    Invoke-WebRequest -Uri ('{0}.sha256' -f $Url) -OutFile $HashPath -UseBasicParsing -ErrorAction Stop

    $ExpectedHash = ((Get-Content -Path $HashPath -Raw -ErrorAction Stop).Trim() -split '\s+')[0]
    $ActualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256 -ErrorAction Stop).Hash
    if ($ActualHash -ne $ExpectedHash) {
        throw ('SHA-256 mismatch for {0} (expected {1}, got {2})' -f $Asset, $ExpectedHash, $ActualHash)
    }

    $ExePath = Join-Path -Path $InstallDirectory -ChildPath 'rumdl.exe'
    if ($PSCmdlet.ShouldProcess(
            ('Install rumdl {0} to "{1}"' -f $Version, $ExePath),
            ('Install rumdl {0} to "{1}"?' -f $Version, $ExePath),
            'Install rumdl')) {
        Expand-Archive -Path $ZipPath -DestinationPath $WorkDirectory -Force -ErrorAction Stop
        $null = New-Item -Path $InstallDirectory -ItemType Directory -Force -ErrorAction Stop
        Copy-Item -Path (Join-Path -Path $WorkDirectory -ChildPath 'rumdl.exe') -Destination $ExePath -Force -ErrorAction Stop
    }

    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $UserPathEntries = @($UserPath -split ';' | Where-Object -FilterScript { $_ })
    if (-not $SkipPathUpdate -and $UserPathEntries -notcontains $InstallDirectory -and
        $PSCmdlet.ShouldProcess(
            ('Add "{0}" to the user PATH' -f $InstallDirectory),
            ('Add "{0}" to the user PATH?' -f $InstallDirectory),
            'Update user PATH')) {
        [Environment]::SetEnvironmentVariable('Path', (($UserPathEntries + $InstallDirectory) -join ';'), 'User')
    }

    if (($env:Path -split ';') -notcontains $InstallDirectory) {
        $env:Path = '{0};{1}' -f $env:Path.TrimEnd(';'), $InstallDirectory
    }

    if (Test-Path -Path $ExePath) {
        [pscustomobject]@{
            Version   = (& $ExePath --color never --version)
            Path      = $ExePath
            Installed = $true
        }
    }
}
catch {
    $PSCmdlet.ThrowTerminatingError($_)
}
finally {
    $ProgressPreference = $PreviousProgress
    Remove-Item -Path $WorkDirectory -Recurse -Force -WhatIf:$false -Confirm:$false -ErrorAction SilentlyContinue
}
