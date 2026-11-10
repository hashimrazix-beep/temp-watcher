' Starts the monitor with no window, so alerts keep working after you close the dashboard.
' Stop it from the dashboard: Settings > Data > Quit monitor.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js is required but was not found." & vbCrLf & "Install it from https://nodejs.org and then try again.", 48, "TempWatch"
  WScript.Quit 1
End If
sh.Run "node server.js", 0, False
