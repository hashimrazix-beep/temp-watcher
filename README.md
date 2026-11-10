# TempWatch

A local dashboard for Windows and macOS laptops that shows temperature, CPU and memory usage live, and sends a desktop notification when a limit is crossed.

No dependencies beyond [Node.js](https://nodejs.org) and the tools that ship with the operating system. No admin rights needed. Nothing leaves your machine: the server only listens on `127.0.0.1`.

## Run it

**Windows**

- Double-click **`Start TempWatch.bat`** — runs in a window and opens the dashboard.
- Or **`Start TempWatch (background).vbs`** — runs with no window so alerts keep working after you close the page. Stop it from Settings → Data → Quit monitor.

**macOS**

- Double-click **`Start TempWatch.command`** (the first time, right-click → Open if macOS blocks it).
- For temperature readings install a small helper, since macOS has no built-in way to read them: `brew install narugit/tap/smctemp` (Apple silicon or Intel) or `brew install osx-cpu-temp` (Intel). CPU, memory, battery, disk, network, top apps and alerts work without it.
- Allow notifications from Script Editor if macOS asks; alerts are shown through `osascript`.

**Either**: `node server.js --open` from a terminal.

The dashboard is at <http://127.0.0.1:4517>. Set the `PORT` environment variable to use a different port.

## Features

- Live gauges with min / avg / max, history charts from 1 minute to 24 hours, per-thread CPU bars, top apps by CPU or memory, battery, disks, network and uptime.
- Alerts for high and critical temperature, sudden temperature spikes, high CPU and high memory, each with its own limit and duration.
- Desktop pop-up notifications, in-page sound and banner, alert log, repeat reminders, "back to normal" notices and snooze.
- °C / °F, dark and light themes, accent colour, compact layout, update speed, hide or rearrange cards, rename sensors, a small always-on-top mini window, CSV export and keyboard shortcuts.

## About the temperature reading

On Windows, temperatures come from the ACPI thermal zones exposed without admin rights, not per-core CPU sensors. They usually read a little cooler than tools such as HWMonitor, so lower the alert limits if you want earlier warnings. On macOS they come from `smctemp` or `osx-cpu-temp` when one is installed.

macOS support has been checked against sample command output but not yet run on a real Mac; please open an issue if a reading looks wrong.

Settings and the alert log are saved in a local `data/` folder, which is not tracked by git.
