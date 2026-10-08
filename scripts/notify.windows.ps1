# Windows implementation of the notification helper shipped with
# @hope_phenom/dsh-plugin-notify. It is dot-sourced by notify.ps1 only when the
# target platform is Windows, so the Windows-only types below are never parsed
# anywhere else.
#
# Primary path: a Windows Shell notification (Shell_NotifyIcon balloon), which
# Windows 10/11 surface as a normal notification and which needs no registered
# AppUserModelID. Fallback: a WinRT toast, for the rare host where the balloon
# path is unavailable.

# notify.ps1 normally provides this when it dot-sources this file; defining it
# when absent keeps the file usable on its own.
if (-not (Get-Command -Name Limit-NotifyText -ErrorAction SilentlyContinue)) {
  function Limit-NotifyText {
    param([string]$Value, [int]$Max = 250)
    if ([string]::IsNullOrEmpty($Value)) { return '' }
    $flat = $Value.Trim()
    if ($flat.Length -le $Max) { return $flat }
    return $flat.Substring(0, $Max - 1) + '…'
  }
}

function Send-NotifyBalloon {
  param([string]$Title, [string]$Message, [string]$IconPath, [int]$DurationMs)

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $icon = $null
  if (-not [string]::IsNullOrEmpty($IconPath) -and $IconPath.EndsWith('.ico')) {
    $icon = New-Object System.Drawing.Icon($IconPath)
  } else {
    $icon = [System.Drawing.SystemIcons]::Information
  }

  $notify = New-Object System.Windows.Forms.NotifyIcon
  try {
    $notify.Icon = $icon
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = (Limit-NotifyText $Message 250)
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.Visible = $true
    $notify.ShowBalloonTip($DurationMs)
    # The balloon is owned by this process, so pump messages until it has been
    # handed over to the shell, then a little longer to let it appear.
    $deadline = (Get-Date).AddMilliseconds($DurationMs)
    while ((Get-Date) -lt $deadline) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 100
    }
  } finally {
    $notify.Visible = $false
    $notify.Dispose()
  }
}

function Send-NotifyToast {
  param([string]$Title, [string]$Message)

  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $nodes = $template.GetElementsByTagName('text')
  $nodes.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
  $nodes.Item(1).AppendChild($template.CreateTextNode((Limit-NotifyText $Message 250))) | Out-Null

  $toast = New-Object Windows.UI.Notifications.ToastNotification $template
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
}

function Invoke-WindowsNotification {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$IconPath = '',
    [int]$DurationMs = 6000
  )

  $balloonError = ''
  try {
    Send-NotifyBalloon -Title $Title -Message $Message -IconPath $IconPath -DurationMs $DurationMs
    return
  } catch {
    $balloonError = $_.Exception.Message
  }

  try {
    Send-NotifyToast -Title $Title -Message $Message
  } catch {
    throw "balloon=$balloonError; toast=$($_.Exception.Message)"
  }
}
