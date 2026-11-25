# PowerShell Patterns

Ready-to-adapt patterns for situations where models tend to improvise badly. Every
block passes `scripts/Test-PowerShellStyle.ps1`.

## Contents

1. Collections
2. Discarding output
3. Conditional splatting
4. Paths
5. Credentials and secrets
6. Microsoft Graph: paging and throttling
7. Standalone scripts and `#Requires`

## 1. Collections

`$Array += $Item` allocates a new array and copies every element, so a loop of
10,000 items does ~50 million copies. Prefer capturing loop output, or a typed list
when you add conditionally or from several places.

```powershell
# Simplest: let the loop emit, and capture it.
$Report = foreach ($User in $Users) {
    [pscustomobject]@{
        Name    = $User.DisplayName
        Enabled = $User.AccountEnabled
    }
}

# When items are added conditionally or from multiple places.
$Failed = [System.Collections.Generic.List[string]]::new()
foreach ($User in $Users) {
    if (-not $User.AccountEnabled) {
        $Failed.Add($User.UserPrincipalName)
    }
}

# Fast lookup instead of repeated Where-Object scans.
$ById = @{}
foreach ($Device in $Devices) {
    $ById[$Device.Id] = $Device
}
```

`List[T].Add` returns nothing, so it needs no discarding; `ArrayList.Add` and
`HashSet.Add` return values and do. Wrap results in `@()` when you need `.Count` on
something that might be a single object or `$null`.

## 2. Discarding output

```powershell
$null = New-Item -Path $Folder -ItemType Directory -Force
[void]$Builder.AppendLine($Line)
$null = $Seen.Add($Key)
```

Assignment to `$null` reads best for cmdlets; `[void]` reads best for method calls.
Never pipe to `Out-Null`.

## 3. Conditional splatting

Build the hashtable once, then add optional keys. Forward common parameters
explicitly rather than relying on `$PSBoundParameters` leaking unrelated keys.

```powershell
$Params = @{
    Path        = $Path
    Recurse     = $true
    ErrorAction = 'Stop'
}
if ($PSBoundParameters.ContainsKey('Filter')) {
    $Params['Filter'] = $Filter
}
if ($Force) {
    $Params['Force'] = $true
}
$Items = Get-ChildItem @Params
```

## 4. Paths

- Build paths with `Join-Path`, never `$Folder + '\' + $Name` - separators differ
  across platforms and doubled separators creep in.
- Use `-LiteralPath` for paths that come from users or data; `-Path` treats `[`,
  `]`, `*`, and `?` as wildcards, so `Report [Final].xlsx` silently matches nothing.
- Resolve and validate before acting. In `[ValidateScript()]`, throw your own
  message when the check fails and end with `$true`. A bare `Test-Path` that
  returns `$false` only gives the caller a generic "did not return a result of
  True" error.

```powershell
param(
    # Validate Directory Path
    [ValidateScript({
            if (-not (Test-Path -LiteralPath $_ -PathType Container)) {
                throw ('Unable to find directory: {0}' -f $_)
            }
            $true
        })]
    [string]$OutputFolder,

    # Validate File Path
    [ValidateScript({
            if (-not (Test-Path -LiteralPath $_ -PathType Leaf)) {
                throw ('Cannot find path: {0}' -f $_)
            }
            $true
        })]
    [string]$InputFile
)
```

```powershell
$Target = Join-Path -Path $OutputFolder -ChildPath ('{0}.csv' -f $ReportName)
$Report | Export-Csv -LiteralPath $Target -NoTypeInformation -Encoding utf8
```

## 5. Credentials and secrets

- Take `[pscredential]` parameters, not `$UserName`/`$Password` strings
  (PSScriptAnalyzer flags the latter).
- Never hardcode secrets or call `ConvertTo-SecureString -AsPlainText` on a literal.
  Pull from `Microsoft.PowerShell.SecretManagement`, a managed identity, or
  certificate auth.
- Prefer certificate or managed-identity auth for unattended Graph/Az scripts over
  client secrets.

```powershell
param(
    [Parameter(Mandatory)]
    [System.Management.Automation.PSCredential]
    [System.Management.Automation.Credential()]
    $Credential
)
```

```powershell
$ClientSecret = Get-Secret -Name 'GraphAppSecret' -Vault 'Automation' -ErrorAction Stop
```

## 6. Microsoft Graph: paging and throttling

Graph returns at most one page per call. With the Microsoft.Graph SDK cmdlets, pass
`-All`. With `Invoke-MgGraphRequest` (or raw REST), follow `@odata.nextLink` until it
disappears - a single call silently truncates results.

```powershell
function Get-GraphCollection {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^(v1\.0|beta)/')]
        [string]$Uri
    )

    $Next = $Uri
    while ($Next) {
        try {
            $Page = Invoke-MgGraphRequest -Method GET -Uri $Next -OutputType PSObject -ErrorAction Stop
        }
        catch {
            $PSCmdlet.ThrowTerminatingError($_)
        }
        foreach ($Item in $Page.value) {
            $Item
        }
        $Next = $Page.'@odata.nextLink'
    }
}
```

- Ask for less: `$select` the properties you use and `$filter` server-side. Advanced
  queries (`$count`, `endswith`, `ne`) need `ConsistencyLevel = 'eventual'` in the
  headers plus `$count=true`.
- Build OData filters with `-f`. OData itself requires single quotes around string
  values, so the format string is double-quoted with nothing interpolated:
  `("userPrincipalName eq '{0}'" -f $Upn)`. Validate the value first (an
  apostrophe inside the value must be doubled for OData, which is the one place
  doubling is required - do it on the value, not in your source string).
- On HTTP 429/503 the SDK retries automatically; raw REST callers should honor the
  `Retry-After` header rather than retrying in a tight loop.
- Declare scopes up front (`Connect-MgGraph -Scopes 'User.Read.All'`) and request
  the least privilege the task needs.

## 7. Standalone scripts and `#Requires`

A `.ps1` meant to be run (not dot-sourced) still gets help, `[CmdletBinding()]`, and
a typed `param()` block at the top. `#Requires` fails fast with a clear message
instead of a confusing error halfway through.

```powershell
#Requires -Version 5.1
#Requires -Modules @{ ModuleName = 'Microsoft.Graph.Users'; ModuleVersion = '2.0.0' }
<#
    .SYNOPSIS
    Exports disabled Entra ID users to CSV.

    .PARAMETER OutputPath
    Destination CSV file.

    .EXAMPLE
    ./Export-DisabledUser.ps1 -OutputPath ./disabled.csv
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$Users = Get-MgUser -All -Filter 'accountEnabled eq false' -Property 'displayName,userPrincipalName' -ErrorAction Stop
$Users |
    Select-Object -Property DisplayName, UserPrincipalName |
    Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8
```

- Put helper functions above the main body, or in a module if more than one script
  uses them.
- Add `#Requires -RunAsAdministrator` only when the script truly needs elevation.
- `Set-StrictMode -Version Latest` catches typos in variable and property names;
  worth enabling in new scripts, risky to bolt onto old ones without testing.
