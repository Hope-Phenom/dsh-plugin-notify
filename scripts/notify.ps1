# Desktop notification helper shipped with @hope_phenom/dsh-plugin-notify.
#
# Primary path: a Windows Shell notification (Shell_NotifyIcon balloon), which
# Windows 10/11 surface as a normal notification and which needs no registered
# AppUserModelID. Fallback: a WinRT toast, for the rare host where the balloon
# path is unavailable.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File notify.ps1 `
#     -Title "DSH" -Message "turn complete" -DurationMs 6000
#
# Exit code 0 means the notification was handed to the shell; anything else is
# reported on stderr so the plugin's Settings page can show it.

[CmdletBinding()]
param(
  [string]$Title = 'DSH',
  [string]$Message = '',
  [string]$Kind = 'root',
  [string]$Event = 'turn-end',
  [string]$IconPath = '',
  [int]$DurationMs = 6000
)

$ErrorActionPreference = 'Stop'

function ConvertTo-PlainText([string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return '' }
  return $value.Replace('\r\n', "`n").Replace('\n', "`n").Trim()
}

function Limit-Text([string]$value, [int]$max) {
  if ([string]::IsNullOrEmpty($value)) { return '' }
  $flat = $value.Trim()
  if ($flat.Length -le $max) { return $flat }
  return $flat.Substring(0, $max - 1) + '…'
}

$title = Limit-Text (ConvertTo-PlainText $Title) 120
$body = ConvertTo-PlainText $Message
if ([string]::IsNullOrWhiteSpace($body)) { $body = $title }
$linger = [Math]::Max(1000, [Math]::Min($DurationMs, 60000))
$iconFile = ''
if (-not [string]::IsNullOrWhiteSpace($IconPath) -and (Test-Path -LiteralPath $IconPath)) {
  $iconFile = (Resolve-Path -LiteralPath $IconPath).Path
}

# --- Primary: Shell_NotifyIcon balloon -------------------------------------
function Send-Balloon {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $icon = $null
  if ($iconFile -ne '' -and $iconFile.EndsWith('.ico')) {
    $icon = New-Object System.Drawing.Icon($iconFile)
  } else {
    $icon = [System.Drawing.SystemIcons]::Information
  }

  $notify = New-Object System.Windows.Forms.NotifyIcon
  try {
    $notify.Icon = $icon
    $notify.BalloonTipTitle = $title
    $notify.BalloonTipText = Limit-Text $body 250
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.Visible = $true
    $notify.ShowBalloonTip($linger)
    # The balloon is owned by this process, so pump messages until it has been
    # handed over to the shell, then a little longer to let it appear.
    $deadline = (Get-Date).AddMilliseconds($linger)
    while ((Get-Date) -lt $deadline) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 100
    }
  } finally {
    $notify.Visible = $false
    $notify.Dispose()
  }
}

# --- Fallback: WinRT toast -------------------------------------------------
function Send-Toast {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $nodes = $template.GetElementsByTagName('text')
  $nodes.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
  $nodes.Item(1).AppendChild($template.CreateTextNode((Limit-Text $body 250))) | Out-Null

  $toast = New-Object Windows.UI.Notifications.ToastNotification $template
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
}

try {
  Send-Balloon
  exit 0
} catch {
  $balloonError = $_.Exception.Message
}

try {
  Send-Toast
  exit 0
} catch {
  [Console]::Error.WriteLine("notify.ps1 failed: balloon=$balloonError; toast=$($_.Exception.Message)")
  exit 1
}
