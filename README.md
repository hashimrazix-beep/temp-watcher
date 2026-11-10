# TempWatch

A local dashboard for Windows laptops that shows temperature, CPU and memory usage live, and sends a Windows notification when a limit is crossed.

No dependencies beyond [Node.js](https://nodejs.org) and the PowerShell that ships with Windows. No admin rights needed. Nothing leaves your machine: the server only listens on `127.0.0.1`.

## Run it

- Double-click **`Start TempWatch.bat`** — runs in a window and opens the dashboard.
- Or **`Start TempWatch (background).vbs`** — runs with no window so alerts keep working after you close the page. Stop it from Settings → Data → Quit monitor.
- Or from a terminal: `node server.js --open`

The dashboard is at <http://127.0.0.1:4517>. Set the `PORT` environment variable to use a different port.

## Features

- Live gauges with min / avg / max, history charts from 1 minute to 24 hours, per-thread CPU bars, top apps by CPU or memory, battery, disks, network and uptime.
- Alerts for high and critical temperature, sudden temperature spikes, high CPU and high memory, each with its own limit and duration.
- Windows pop-up notifications, in-page sound and banner, alert log, repeat reminders, "back to normal" notices and snooze.
- °C / °F, dark and light themes, accent colour, compact layout, update speed, hide or rearrange cards, rename sensors, a small always-on-top mini window, CSV export and keyboard shortcuts.

## About the temperature reading

Temperatures come from the ACPI thermal zones Windows exposes without admin rights, not per-core CPU sensors. They usually read a little cooler than tools such as HWMonitor, so lower the alert limits if you want earlier warnings.

Settings and the alert log are saved in a local `data/` folder, which is not tracked by git.
