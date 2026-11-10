param([int]$IntervalMs = 2000, [int]$Count = 0)
# Emits one compact JSON line per interval with the readings Node cannot get natively:
# thermal zones, battery, disks, network throughput and per-app CPU / memory.
# Needs no admin rights and no extra modules.
$ErrorActionPreference = 'SilentlyContinue'
$cores = [Environment]::ProcessorCount
$prevCpu = @{}
$prevAt = $null
$disks = @()
$i = 0

while ($true) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $now = [DateTime]::UtcNow

    # Thermal zones: HighPrecisionTemperature is tenths of a Kelvin.
    $zones = @(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation |
        Where-Object { $_.HighPrecisionTemperature -gt 0 } |
        ForEach-Object {
            @{ name = ($_.Name -replace '^\\+', ''); c = [math]::Round($_.HighPrecisionTemperature / 10 - 273.15, 1) }
        })

    $bat = $null
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    if ($b) {
        $bat = @{ pct = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -ne 1); status = [int]$b.BatteryStatus }
    }

    $rx = 0.0; $tx = 0.0
    Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | ForEach-Object {
        $rx += [double]$_.BytesReceivedPersec; $tx += [double]$_.BytesSentPersec
    }

    # Disks change slowly; refresh them every 15th pass.
    if ($i % 15 -eq 0) {
        $disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
            @{ name = $_.DeviceID; size = [double]$_.Size; free = [double]$_.FreeSpace }
        })
    }

    # Per-app CPU % (delta of processor time) and memory, grouped by process name.
    $elapsed = if ($prevAt) { ($now - $prevAt).TotalSeconds } else { 0 }
    $curCpu = @{}
    $apps = @{}
    foreach ($p in [Diagnostics.Process]::GetProcesses()) {
        $cpuSec = $null
        try { $cpuSec = $p.TotalProcessorTime.TotalSeconds } catch {}
        $pct = 0.0
        if ($null -ne $cpuSec) {
            $curCpu[$p.Id] = $cpuSec
            if ($elapsed -gt 0 -and $prevCpu.ContainsKey($p.Id)) {
                $d = $cpuSec - $prevCpu[$p.Id]
                if ($d -gt 0) { $pct = $d / $elapsed / $cores * 100 }
            }
        }
        $n = $p.ProcessName
        if (-not $apps.ContainsKey($n)) { $apps[$n] = @{ name = $n; cpu = 0.0; mem = 0.0; n = 0 } }
        $a = $apps[$n]
        $a.cpu += $pct; $a.mem += [double]$p.WorkingSet64; $a.n += 1
        $p.Dispose()
    }
    $prevCpu = $curCpu
    $prevAt = $now

    $list = $apps.Values | Where-Object { $_.name -ne 'Idle' }
    $top = @{}
    $list | Sort-Object { $_.cpu } -Descending | Select-Object -First 12 | ForEach-Object { $top[$_.name] = $_ }
    $list | Sort-Object { $_.mem } -Descending | Select-Object -First 12 | ForEach-Object { $top[$_.name] = $_ }
    $procs = @($top.Values | ForEach-Object {
        @{ name = $_.name; cpu = [math]::Round($_.cpu, 1); mem = [math]::Round($_.mem / 1MB); n = $_.n }
    })

    $out = @{ zones = $zones; battery = $bat; rx = [math]::Round($rx); tx = [math]::Round($tx); disks = $disks; procs = $procs; ms = $sw.ElapsedMilliseconds }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()

    $i++
    if ($Count -gt 0 -and $i -ge $Count) { break }
    $rest = $IntervalMs - $sw.ElapsedMilliseconds
    if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }
}
