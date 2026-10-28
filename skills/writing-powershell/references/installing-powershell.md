# Installing PowerShell

Get a working `pwsh` when none is present, so `Invoke-ScriptAnalyzer` and Pester can actually run. Source is the official repo: <https://github.com/PowerShell/PowerShell>. Prefer the portable extract (no admin, no system change); fall back to a package only if a system-wide install is genuinely required.

## 1. Detect First

Never install blind — check, and skip everything below if this succeeds.

```bash
command -v pwsh && pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
```

```powershell
Get-Command pwsh -ErrorAction SilentlyContinue
```

On Windows, `powershell` (5.1, Desktop edition) is **not** `pwsh` (7.x, Core). Finding `powershell` does not mean the bootstrap can be skipped.

## 2. Resolve the Latest Version

The `/releases/latest` redirect gives the tag without an API token or rate limit.

```bash
VER=$(curl -sSI https://github.com/PowerShell/PowerShell/releases/latest |
    tr -d '\r' | sed -n 's#.*/releases/tag/v##p')
```

```powershell
$Rel = Invoke-RestMethod 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest'
$Ver = $Rel.tag_name.TrimStart('v')
```

Assets live at `https://github.com/PowerShell/PowerShell/releases/download/v$VER/<asset>`.

## 3. Portable Extract (Preferred)

Linux/macOS — pick the asset by architecture, extract, then expose it on `PATH`:

```bash
case "$(uname -m)" in
    x86_64)  ASSET="powershell-$VER-linux-x64.tar.gz" ;;
    aarch64) ASSET="powershell-$VER-linux-arm64.tar.gz" ;;
esac
curl -L --fail -o /tmp/pwsh.tar.gz \
    "https://github.com/PowerShell/PowerShell/releases/download/v$VER/$ASSET"
mkdir -p "$HOME/.local/pwsh" "$HOME/.local/bin"
tar -xzf /tmp/pwsh.tar.gz -C "$HOME/.local/pwsh"
chmod +x "$HOME/.local/pwsh/pwsh"
ln -sf "$HOME/.local/pwsh/pwsh" "$HOME/.local/bin/pwsh"
export PATH="$HOME/.local/bin:$PATH"
```

Windows — extract the zip to a user-writable location:

```powershell
$Base = 'https://github.com/PowerShell/PowerShell/releases/download/v{0}' -f $Ver
$Dest = Join-Path $env:LOCALAPPDATA 'Microsoft\PowerShell\7'
$Zip = Join-Path $env:TEMP ('PowerShell-{0}-win-x64.zip' -f $Ver)
$Url = '{0}/PowerShell-{1}-win-x64.zip' -f $Base, $Ver
Invoke-WebRequest -Uri $Url -OutFile $Zip -ErrorAction Stop
Expand-Archive -Path $Zip -DestinationPath $Dest -Force
$env:PATH = ('{0};{1}' -f $Dest, $env:PATH)
```

Substitute `win-arm64` on ARM devices.

## 3b. When GitHub Is Blocked

Sandboxes and corporate proxies often block `github.com` (the version lookup returns
an empty `VER` or a 403). The same build is published on `packages.microsoft.com`,
and on Debian/Ubuntu `dpkg -x` unpacks it without root or a system install:

```bash
. /etc/os-release
BASE="https://packages.microsoft.com/$ID/$VERSION_ID/prod/pool/main/p/powershell/"
DEB=$(curl -sS --fail "$BASE" | grep -o 'powershell_[0-9.]*-1\.deb_amd64\.deb' | sort -uV | tail -1)
curl -L --fail -o /tmp/pwsh.deb "$BASE$DEB"
mkdir -p /tmp/pwsh-x "$HOME/.local/bin"
dpkg -x /tmp/pwsh.deb /tmp/pwsh-x
rm -rf "$HOME/.local/pwsh"
mv /tmp/pwsh-x/opt/microsoft/powershell/7 "$HOME/.local/pwsh"
ln -sf "$HOME/.local/pwsh/pwsh" "$HOME/.local/bin/pwsh"
```

If that host is blocked too, report it to the user rather than hunting for mirrors.
The modules in step 5 come from `www.powershellgallery.com`, which is usually
reachable even when GitHub is not.

## 4. Package Fallback (Needs Elevation)

Only when the portable extract will not do — a shared machine, a service account, or a PATH you cannot alter. Both require root/admin.

```bash
curl -L --fail -o /tmp/pwsh.deb \
    "https://github.com/PowerShell/PowerShell/releases/download/v$VER/powershell_$VER-1.deb_amd64.deb"
sudo dpkg -i /tmp/pwsh.deb || sudo apt-get install -f -y
```

```powershell
$Msi = Join-Path $env:TEMP ('PowerShell-{0}-win-x64.msi' -f $Ver)
Start-Process msiexec.exe -ArgumentList @('/i', $Msi, '/qn') -Wait -NoNewWindow
```

RPM distros use `powershell-$VER-1.rh.x86_64.rpm`.

## 5. Install the Analysis Modules

`pwsh` alone cannot validate anything — add the two modules the workflow depends on.

```powershell
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force -ErrorAction Stop
Install-Module -Name Pester -Scope CurrentUser -Force -SkipPublisherCheck -ErrorAction Stop
Get-Module -ListAvailable -Name PSScriptAnalyzer, Pester | Select-Object -Property Name, Version
```

`-SkipPublisherCheck` is required for Pester on Windows, where it collides with the Microsoft-signed version shipped in the box. Confirm the bootstrap worked by running the real thing: the bundled checker, `scripts/Test-PowerShellStyle.ps1`.

## Gotchas

- **Asset casing differs by platform.** Linux and macOS assets are lowercase (`powershell-7.6.4-linux-x64.tar.gz`); Windows assets are `PowerShell-` with both capitals (`PowerShell-7.6.4-win-x64.zip`). Copying one pattern to the other 404s.
- **Download in the foreground.** The tarball is ~75 MB. Backgrounding it with `&` loses the process wherever the shell tears down between calls, leaving no file and no error — the transfer itself takes only seconds.
- **`export PATH` dies with the shell.** In a non-interactive or per-call shell, re-export it or invoke the absolute path (`$HOME/.local/pwsh/pwsh`) each time.
- **Never pipe a remote script straight into a shell.** Download to a file, then run it.
- **Pin the version when reproducibility matters.** `releases/latest` is a moving target; hardcode `VER` in CI so a new release cannot change the build.
