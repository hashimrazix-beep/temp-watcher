' Starts the monitor with no window, so alerts keep working after you close the dashboard.
' Stop it from the dashboard: Settings > Data > Quit monitor.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js --open", 0, False
