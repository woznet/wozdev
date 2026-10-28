# PowerShell Examples: Before & After

Each pair shows a common AI-generated pattern (Before) and its idiomatic rewrite (After).

## 1. Strings: interpolation -> single quotes + `-f`

**Before:**

```powershell
Write-Verbose "Downloading $SourceUrl to $DestinationPath"
Write-Error "The URL '$SourceUrl' is not valid."
```

**After:**

```powershell
Write-Verbose ('Downloading {0} to {1}' -f $SourceUrl, $DestinationPath)
Write-Error ('The URL {0} is not valid.' -f $SourceUrl)
```

## 2. CmdletBinding: bare attributes

**Before:**

```powershell
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
```

**After:**

```powershell
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
```

## 3. Confirmation: 3-parameter ShouldProcess overload

**Before** (single-parameter — weak `-WhatIf`/`-Confirm` text):

```powershell
if ($PSCmdlet.ShouldProcess($DestinationPath, "Download file")) {
    Invoke-RestMethod -Uri $SourceUrl -OutFile $DestinationPath
}
```

**After:**

```powershell
$Action = 'Download file'
$Description = ('{0}: {1} -> {2}' -f $Action, $SourceUrl, $DestinationPath)
$Warning = ('This will overwrite: {0}' -f $DestinationPath)
$Caption = ('Confirm: {0}' -f $Action)
if ($PSCmdlet.ShouldProcess($Description, $Warning, $Caption)) {
    Invoke-RestMethod -Uri $SourceUrl -OutFile $DestinationPath -ErrorAction Stop
}
```

## 4. Output: objects, not strings

**Before:**

```powershell
return "Saved $DestinationPath ($Size bytes)"
```

**After:**

```powershell
[pscustomobject]@{
    Path      = $DestinationPath
    SizeBytes = $Size
    Source    = $SourceUrl
}
```

## 5. Object creation & line continuation

**Before** (`New-Object`, backtick continuation):

```powershell
$Results = New-Object 'System.Collections.Generic.List[object]'
$Response = Invoke-RestMethod -Uri $Url `
    -Headers $Headers `
    -TimeoutSec 100
$Results.AddRange($Response.value)
```

**After** (`::new()`, splatting):

```powershell
$Results = [System.Collections.Generic.List[object]]::new()
$Request = @{
    Uri         = $Url
    Headers     = $Headers
    TimeoutSec  = 100
    ErrorAction = 'Stop'
}
$Response = Invoke-RestMethod @Request
$Results.AddRange([object[]]$Response.value)
```

## 6. Streams: no `Write-Host`

**Before:**

```powershell
Write-Host "Done."
```

**After:**

```powershell
Write-Verbose 'Done.'
```

## 7. Discarding output: no `Out-Null`

**Before:**

```powershell
$Results.Add($Item) | Out-Null
New-Item -Path $LogFolder -ItemType Directory -Force | Out-Null
```

**After:**

```powershell
[void]$Results.Add($Item)
$null = New-Item -Path $LogFolder -ItemType Directory -Force
```

## 8. Quotes inside strings: no doubled single quotes

**Before:**

```powershell
Write-Warning ('User ''{0}'' was not found.' -f $Upn)
```

**After:**

```powershell
Write-Warning ('User "{0}" was not found.' -f $Upn)
```

## 9. Building collections: no `+=` in loops

**Before:**

```powershell
$Stale = @()
foreach ($Device in $Devices) {
    if ($Device.LastSyncDateTime -lt $Cutoff) {
        $Stale += $Device
    }
}
return $Stale
```

**After:**

```powershell
foreach ($Device in $Devices) {
    if ($Device.LastSyncDateTime -lt $Cutoff) {
        $Device
    }
}
```

The function's output is the collection; the caller captures it with
`$Stale = @(Get-StaleDevice -Cutoff $Cutoff)`.

## 10. Filtering: a positional script block

**Before** (comparison form, named `-FilterScript`):

```powershell
$Match = Get-ChildItem -LiteralPath $Folder | Where-Object -Property Name -EQ -Value 'test.txt'
$Large = Get-ChildItem -LiteralPath $Folder | Where-Object -FilterScript { $_.Length -gt 1MB }
```

**After:**

```powershell
$Match = Get-ChildItem -LiteralPath $Folder | Where-Object { $_.Name -eq 'test.txt' }
$Large = Get-ChildItem -LiteralPath $Folder | Where-Object { $_.Length -gt 1MB }
```
