# Shows a Windows toast notification. Text comes in through environment variables
# so nothing from the app is ever interpreted as PowerShell code.
$ErrorActionPreference = 'Stop'
$title = [Security.SecurityElement]::Escape($env:TW_TITLE)
$body = [Security.SecurityElement]::Escape($env:TW_BODY)
$url = [Security.SecurityElement]::Escape($env:TW_URL)

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast activationType=`"protocol`" launch=`"$url`"><visual><binding template=`"ToastGeneric`"><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5F-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
