# Desktop notification helper shipped with @hope_phenom/dsh-plugin-notify.
#
# This file is a dispatcher. It resolves the notification plan for the current
# platform and only then touches the platform-specific implementation, so a
# Windows-only API is never even parsed where it does not exist:
#
#   Windows  -> dot-sources notify.windows.ps1 (Shell_NotifyIcon balloon, then
#               a WinRT toast)
#   macOS    -> osascript: display notification
#   Linux    -> notify-send
#
#   pwsh -NoProfile -ExecutionPolicy Bypass -File notify.ps1 -Title "DSH" -Message "done"
#
# Diagnostics: -DryRun prints the resolved plan as JSON without sending
# anything, and -Platform lets any host ask what another platform would run:
#
#   pwsh -File notify.ps1 -DryRun -Platform macOS -Title T -Message M
#
# Exit code 0 means the notification was handed to the platform; anything else
# is reported on stderr so the plugin's Settings page can show it.

[CmdletBinding()]
param(
  [string]$Title = 'DSH',
  [string]$Message = '',
  [string]$Kind = 'root',
  [string]$Event = 'turn-end',
  [string]$IconPath = '',
  [int]$DurationMs = 6000,
  [ValidateSet('auto', 'Windows', 'macOS', 'Linux')][string]$Platform = 'auto',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-TargetPlatform {
  param([string]$Requested)
  if ($Requested -ne 'auto') { return $Requested }
  if ($null -ne $IsWindows -and $IsWindows) { return 'Windows' }
  if ($null -ne $IsMacOS -and $IsMacOS) { return 'macOS' }
  if ($null -ne $IsLinux -and $IsLinux) { return 'Linux' }
  # Windows PowerShell 5.1 defines none of the automatic platform variables.
  if ($PSVersionTable.PSEdition -eq 'Desktop') { return 'Windows' }
  return 'Linux'
}

function ConvertTo-NotifyPlainText {
  param([string]$Value)
  if ([string]::IsNullOrEmpty($Value)) { return '' }
  return $Value.Replace('\r\n', "`n").Replace('\n', "`n").Trim()
}

function Limit-NotifyText {
  param([string]$Value, [int]$Max = 250)
  if ([string]::IsNullOrEmpty($Value)) { return '' }
  $flat = $Value.Trim()
  if ($flat.Length -le $Max) { return $flat }
  return $flat.Substring(0, $Max - 1) + '…'
}

function ConvertTo-AppleScriptString {
  param([string]$Value)
  if ([string]::IsNullOrEmpty($Value)) { return '' }
  # Backslash first, then the quote it introduces.
  return $Value.Replace('\', '\\').Replace('"', '\"')
}

$target = Get-TargetPlatform $Platform
$title = Limit-NotifyText (ConvertTo-NotifyPlainText $Title) 120
$body = ConvertTo-NotifyPlainText $Message
if ([string]::IsNullOrWhiteSpace($body)) { $body = $title }
$linger = [Math]::Max(1000, [Math]::Min($DurationMs, 60000))
$iconFile = ''
if (-not [string]::IsNullOrWhiteSpace($IconPath) -and (Test-Path -LiteralPath $IconPath)) {
  $iconFile = (Resolve-Path -LiteralPath $IconPath).Path
}

switch ($target) {
  'macOS' {
    $script = 'display notification "{0}" with title "{1}"' -f (ConvertTo-AppleScriptString $body), (ConvertTo-AppleScriptString $title)
    $plan = [pscustomobject]@{
      Platform  = 'macOS'
      Backend   = 'osascript'
      InProcess = $false
      Command   = @('osascript', '-e', $script)
    }
  }
  'Linux' {
    $plan = [pscustomobject]@{
      Platform  = 'Linux'
      Backend   = 'notify-send'
      InProcess = $false
      Command   = @('notify-send', '--app-name=DSH', "--expire-time=$linger", $title, $body)
    }
  }
  default {
    $plan = [pscustomobject]@{
      Platform  = 'Windows'
      Backend   = 'winforms'
      InProcess = $true
      Command   = @('<in-process>', 'notify.windows.ps1', '-Title', $title, '-Message', $body)
    }
  }
}

if ($DryRun) {
  $plan | ConvertTo-Json -Compress
  exit 0
}

if ($target -eq 'Windows') {
  . (Join-Path $PSScriptRoot 'notify.windows.ps1')
  try {
    Invoke-WindowsNotification -Title $title -Message $body -IconPath $iconFile -DurationMs $linger
    exit 0
  } catch {
    [Console]::Error.WriteLine("notify.ps1 (Windows) failed: $($_.Exception.Message)")
    exit 1
  }
}

$executable = $plan.Command[0]
if (-not (Get-Command $executable -CommandType Application -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine("notify.ps1: '$executable' was not found on PATH")
  exit 1
}
try {
  if ($plan.Command.Count -gt 1) {
    & $executable @($plan.Command[1..($plan.Command.Count - 1)])
  } else {
    & $executable
  }
} catch {
  [Console]::Error.WriteLine("notify.ps1 ($target) failed: $($_.Exception.Message)")
  exit 1
}
if ($LASTEXITCODE -ne 0) {
  [Console]::Error.WriteLine("notify.ps1 ($target): $executable exited $LASTEXITCODE")
  exit $LASTEXITCODE
}
exit 0
