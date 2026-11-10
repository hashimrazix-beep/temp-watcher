# TempWatch

A local dashboard for Windows, macOS and Linux laptops that shows temperature, CPU and memory usage live, and sends a desktop notification when a limit is crossed.

No dependencies beyond [Node.js](https://nodejs.org) (version 16 or newer) and the tools that ship with the operating system. No admin rights needed. Nothing leaves your machine: the server only listens on `127.0.0.1`.

## Run it

### Quickest: one command, nothing to download

With Node.js and git installed, on any system:

```
npx github:hashimrazix-beep/temp-watcher
```

This fetches the app, starts it and opens the dashboard. Press Ctrl+C to stop. Settings are kept in `~/.tempwatch`.

### Or download it

Clone the repo (or use **Code → Download ZIP** on GitHub and unzip it):

```
git clone https://github.com/hashimrazix-beep/temp-watcher.git
```

Then start it:

| System | How |
|---|---|
| Windows | Double-click **`Start TempWatch.bat`**. For no window at all, use **`Start TempWatch (background).vbs`** and stop it from Settings → Data → Quit monitor. |
| macOS | Double-click **`Start TempWatch.command`**. |
| Linux | Run `./Start\ TempWatch.command` or `node server.js` in a terminal. |
| Any | `node server.js` from a terminal in the folder. |

The dashboard opens at <http://127.0.0.1:4517>. Add `--no-open` to stop it opening a browser, or set the `PORT` environment variable to use a different port. The launchers tell you if Node.js is missing.

### If your system blocks the launcher

Files downloaded as a ZIP are flagged by the operating system as "from the internet". Cloning with git or using the `npx` command above avoids this entirely.

- **Windows** — if a security prompt appears, choose **Run** (or **More info → Run anyway**). To clear the flag for good, right-click the ZIP before unzipping → Properties → tick **Unblock**.
- **macOS** — if it says the file can't be opened, right-click `Start TempWatch.command` → **Open** → **Open**. Or clear the flag from a terminal in the folder: `xattr -dr com.apple.quarantine .`

## What each system shows

| | Windows | macOS | Linux |
|---|---|---|---|
| CPU, memory, top apps, battery, disk, network | yes | yes | yes |
| Temperature | ACPI thermal zones | battery sensor built in; CPU with a helper | kernel thermal zones and CPU sensor |
| Desktop notifications | yes | yes | yes, with `notify-send` installed |

**macOS CPU temperature.** macOS has no built-in way to read CPU temperature, so out of the box TempWatch shows the battery temperature sensor. For CPU temperature install the free `smctemp` helper: the `.command` launcher offers to do this for you once if you have Homebrew, or run `brew install narugit/tap/smctemp` (Intel Macs can use `brew install osx-cpu-temp` instead). Battery temperature runs cooler than the CPU, so lower the alert limits if you rely on it.

**Windows temperature.** Readings come from the ACPI thermal zones exposed without admin rights, not per-core CPU sensors. They usually read a little cooler than tools such as HWMonitor, so lower the alert limits if you want earlier warnings.

macOS and Linux support has been checked against sample command output but not yet run on real hardware; please open an issue if a reading looks wrong.

## Features

- Live gauges with min / avg / max, history charts from 1 minute to 24 hours, per-thread CPU bars, top apps by CPU or memory, battery, disks, network and uptime.
- Alerts for high and critical temperature, sudden temperature spikes, high CPU and high memory, each with its own limit and duration.
- Desktop pop-up notifications, in-page sound and banner, alert log, repeat reminders, "back to normal" notices and snooze.
- °C / °F, dark and light themes, accent colour, compact layout, update speed, hide or rearrange cards, rename sensors, a small always-on-top mini window, CSV export and keyboard shortcuts.

Settings and the alert log are saved in a local `data/` folder next to the code, which is not tracked by git.
