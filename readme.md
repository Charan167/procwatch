# procwatch

Inspect a Linux process from your terminal and learn how Linux reports process and CPU statistics.

The CLI updates one terminal line with a process's name, state, memory sizes, PID, CPU usage, and uptime.
It waits about one second after each sample finishes before starting the next by default. Press `Ctrl+C` to stop.

## Requirements

- Linux with `/proc` available. On Windows, run the project inside a Linux environment such as WSL.
- Node.js and npm. Node.js 22.22.2 and npm 10.9.7 were used to verify the commands below.
- A running process whose details your user can read.
- `getconf` available on `PATH` to read the system's clock-tick rate with `getconf CLK_TCK`.

Node.js 22 is the recommended baseline. The project does not currently declare a minimum Node.js version.
Native Windows and macOS do not provide the Linux `/proc` files this program reads.

## Quick start

Open Bash in the repository directory and run:

```bash
npm ci
npm run build
npm start -- --pid "$$"
```

`npm ci` installs dependencies from the lockfile. The build compiles TypeScript into JavaScript in `dist/`.
The `--` after `npm start` forwards the remaining arguments to the program.
In Bash, `$$` expands to the current shell's PID, giving you a process to inspect.

You can also supply a PID directly:

```bash
npm start -- --pid 1234
```

Replace `1234` with a running process's PID. Run `ps -u "$USER"` to list your processes.

An illustrative output looks like this, after npm's script messages:

```text
PID: 1234 | Name: bash | State: S (sleeping) | Virtual Memory Size: 7.81 MiB | Resident Set Size: 3.00 MiB | CPU: 0.0% | Uptime: 121.5 s
```

The values depend on your process and machine. The first sample shows `CPU: N/A` because no previous CPU sample exists.
Each later sample replaces the terminal line and calculates CPU usage from the previous and current counters. Sampling time adds to the configured interval.

## Usage and development

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile the source into `dist/`. |
| `npm start -- --pid 1234` | Inspect a process using the compiled program. |
| `npm run dev -- --pid 1234` | Run TypeScript directly and restart after source changes. |
| `npm run typecheck` | Check TypeScript without generating files. |
| `npm test` | Build and run the CLI regression tests. |

Rebuild after changing the source if you use `npm start`.
Development mode restarts the monitor after source changes. Both development mode and the compiled program sample continuously until stopped.
Use `--pid <PID>` to select a process and optionally `--interval <milliseconds>` to change the sampling interval (default: `1000`).

Add `--json` for one JSON object per sample, suitable for piping or saving:

```bash
node dist/index.js --pid "$$" --interval 1000 --json
```

Each object contains `ts` (Unix time in milliseconds), `pid`, `cpuPct`, `rssBytes`, `vmSizeBytes`, and `uptimeSec`.
Memory values are numeric bytes; uptime is numeric seconds. `cpuPct` is `null` for the first sample, then a numeric percentage.
Errors go to stderr. `Ctrl+C` cancels the timer, writes a final newline, and exits with status 0 in either output mode.

### Understanding the output

| Output | Meaning |
| --- | --- |
| Name | The process name reported by Linux. |
| State | Its current state, such as `R` for running or `S` for sleeping. |
| Virtual Memory Size | Its virtual address space (`VmSize`), not the amount of physical RAM it occupies. |
| Resident Set Size | Its approximate resident memory (`VmRSS`). |
| PID | The number Linux uses to identify this process. |
| CPU | Average share of total CPU capacity across all logical CPUs between consecutive samples, rounded to one decimal place; `N/A` on the first line. |
| Uptime | Elapsed time since the process started, in seconds, rounded to one decimal place. |

See the [Linux process status reference](https://www.man7.org/linux/man-pages/man5/proc_pid_status.5.html) for the underlying fields.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Missing `dist/index.js` | Run `npm run build` before `npm start`. |
| Usage message | Use `npm start -- --pid 1234`, replacing `1234` with a live PID. |
| `Process <pid> has exited.` | The process is missing or exited during monitoring. Check the PID with `ps`. |
| `Permission denied for <pid>.` | Try a process owned by your user; system settings can restrict access to other processes. |
| `/proc` is unavailable | Run inside Linux with procfs mounted. |
| Unable to read clock tick rate | Ensure `getconf CLK_TCK` succeeds and `getconf` is on `PATH`. |
| Output does not change after editing code | Rebuild, or use `npm run dev -- --pid 1234`. |

Read failures, invalid uptime values, and missing or invalid arguments exit with status 1.
During procfs reads, `ENOENT` or `ESRCH` prints the process-exit message; `EACCES` prints the permission message.
Other errors are logged to stderr and exit with status 1.

## Where the data comes from

`/proc` is a virtual filesystem: Linux generates its contents from current kernel information rather than ordinary files on disk.
Running `cat /proc/stat` prints those contents; it does not start CPU measurement itself.

| Path | Contents | Role in this project |
| --- | --- | --- |
| `/proc/<PID>/status` | Labelled process details. | Used by the working CLI. |
| `/proc/<PID>/stat` | Positional process statistics, including CPU time and start time. | Used by `readProcTicks()` for CPU samples and `getProcessUptime()` for field 22. |
| `/proc/stat` | System statistics, including CPU time across the machine. | Used by `readTotalTicks()` for every CPU sample. |
| `/proc/uptime` | System uptime and accumulated idle time, in seconds. | `bootTime()` reads the first number for the process uptime calculation. |

Replace `<PID>` with a process ID when reading a process-specific file.
The [kernel's procfs documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) explains this interface in more detail.

## How CPU measurement works

The CLI uses the following calculation between consecutive samples, about one second apart by default.

### 1. Read the process's accumulated CPU time

In `/proc/<PID>/stat`, field 14 is `utime`: time spent executing application code.
Field 15 is `stime`: time spent executing kernel code for the process.

```text
process ticks = utime + stime
```

These counters accumulate over the process's lifetime. A tick is a unit of CPU time, not an instruction or hardware clock cycle.
See [the process stat manual, fields 14 and 15](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html).

The existing parser skips through the last `)` before reading numeric fields because the process name can contain spaces and parentheses.

### 2. Read the machine's accumulated CPU time

The aggregate `cpu` line in `/proc/stat` records time across all logical CPUs since boot:

```text
cpu  13571 0 5644 491240 1180 0 1117 0 0 0
```

| Position after `cpu` | Field | Meaning |
| --- | --- | --- |
| 1 | `user` | Running normal application code. |
| 2 | `nice` | Running lower-priority application code. |
| 3 | `system` | Running kernel code. |
| 4 | `idle` | Idle time. |
| 5 | `iowait` | Idle time accounted to outstanding I/O. |
| 6 | `irq` | Handling hardware interrupts. |
| 7 | `softirq` | Handling deferred interrupt work. |
| 8 | `steal` | Time a virtual CPU could not run while the host served other workloads. |
| 9 | `guest` | Running guest virtual CPUs. |
| 10 | `guest_nice` | Running lower-priority guest virtual CPUs. |

These values use `USER_HZ` clock ticks.

`iowait` is approximate and can sometimes decrease. See the [system stat manual](https://www.man7.org/linux/man-pages/man5/proc_stat.5.html).

`readTotalTicks()` sums the first eight values, including idle time:

```text
total ticks = user + nice + system + idle + iowait + irq + softirq + steal
            = 512752 in the example above
```

`guest` is already included in `user`, and `guest_nice` in `nice`.
Adding them again would double-count guest time; see `account_guest_time` in the [kernel's CPU accounting source](https://github.com/torvalds/linux/blob/master/kernel/sched/cputime.c).

Both CPU readers are exported and used by the CLI.

### 3. Compare two samples

A sample is a pair of counters read at approximately the same time:

```text
{ proc: number, total: number }
```

Keep the previous sample `a`, wait for an interval, then take sample `b` for the same process.
After printing the CPU percentage, save `b` as the previous sample for the next iteration.
A delta means the difference between the later and earlier values.

```text
process delta = b.proc - a.proc
total delta   = b.total - a.total

CPU percentage = process delta / total delta × 100
```

Both counters use clock ticks (usually 100 per second; see `getconf CLK_TCK`).
The units cancel; CPU% is a share of total capacity across all logical CPUs.

This is the ordinary percentage formula: part divided by whole, multiplied by 100.
The part is CPU time used by the process. The whole is CPU time available across all logical CPUs, including idle time.

For example:

| Counter | Sample `a` | Sample `b` | Delta |
| --- | ---: | ---: | ---: |
| Process ticks | 200 | 300 | 100 |
| Total ticks | 10000 | 11200 | 1200 |

```text
CPU percentage = 100 / 1200 × 100 ≈ 8.33%
```

The process used about 8.33% of the machine's total CPU time **during that interval**.
This is average usage, not an increase in CPU percentage.

`cpuPercent(a, b)` returns `0` when the total delta is zero to avoid division by zero.
That fallback means no usable interval was measured; it does not prove the process used no CPU.

### Why not divide one sample's counters?

`sample.proc / sample.total × 100` compares accumulated histories, not recent usage.
The process counter starts when the process starts; the machine counter starts at boot.

Imagine one logical CPU, a machine running for 100 seconds, and a process running fully for only the latest second.
The accumulated ratio is `1 / 100 × 100 = 1%`, although that process used 100% during the latest second.
Subtracting two samples isolates the interval you want to measure.

Even “current CPU usage” needs an interval. Two readings 200 milliseconds apart approximate usage now; longer intervals smooth brief spikes.

### Logical CPUs and the percentage scale

A physical core executes instructions. With simultaneous multithreading (SMT), one physical core can expose multiple logical CPUs that share its hardware.
Linux schedules work on these logical CPUs.

For example, six physical cores with two logical CPUs each appear as `cpu0` through `cpu11`.
Those labels alone do not prove the physical core count; virtual machines can also expose virtual CPUs.
Run `lscpu` to inspect the topology Linux sees.

Assuming 12 logical CPUs and 100 ticks per second, about 1200 total ticks accumulate each second.
A process fully occupying one logical CPU uses about 100 ticks, or 8.33% of the machine's total time.
This scale treats the whole machine as 100%; some monitoring tools instead treat one fully occupied logical CPU as 100%.
It measures accounted time, not a guarantee that all logical CPUs deliver equal performance.

### Other lines in `/proc/stat`

| Line | Meaning |
| --- | --- |
| `cpu0`, `cpu1`, … | The same CPU time fields for individual logical CPUs. |
| `intr` | Total interrupts since boot, followed by counts per interrupt number. |
| `ctxt` | Total task context switches since boot. |
| `btime` | Boot time as seconds since the Unix epoch. |
| `processes` | Processes and threads created since boot, including those that have exited. |
| `procs_running` | Threads running or ready to run now. |
| `procs_blocked` | Processes blocked waiting for I/O now. |
| `softirq` | Total software interrupts since boot, followed by counts per type. |

The `softirq` CPU column measures **time**; the separate `softirq` line counts **events**.
See the [kernel's system statistics reference](https://www.kernel.org/doc/html/latest/filesystems/proc.html#miscellaneous-kernel-statistics-in-proc-stat).

## How process uptime works

`getProcessUptime(pid)` calculates the elapsed seconds since the process started:

```text
uptimeSec = bootSec - starttime / ticksPerSecond
```

`bootSec` is the first number in `/proc/uptime`, including time spent suspended.
`starttime` is field 22 of `/proc/<PID>/stat`, measured in clock ticks since boot.
After skipping through the last `)` and splitting on whitespace, this field is at zero-based index `19`.
The clock-tick rate comes from `getconf CLK_TCK`; when it is `100`, the formula becomes `bootSec - starttime / 100`.

For example, `bootSec = 1000` and `starttime = 25000` at `100` ticks per second give an uptime of `750` seconds.
Missing or invalid numeric values produce an error instead of printing `NaN`.
See the [system uptime reference](https://man7.org/linux/man-pages/man5/proc_uptime.5.html) and [process stat reference, field 22](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).

## Design decisions

These notes describe the current implementation and its tradeoffs, rather than a complete architecture history.

| Choice | Practical consequence |
| --- | --- |
| Read Linux procfs directly using Node's built-in filesystem API. | The program uses asynchronous reads without a runtime monitoring library, but requires Linux. |
| Inspect one PID continuously. | The CLI updates one terminal line, or prints one JSON object per sample with `--json`, until interrupted or the process becomes unavailable. |
| Write strict TypeScript and compile to ESM JavaScript. | Types are checked during development; `npm start` runs the generated files in `dist/`. |
| Keep CPU readers in a separate module. | The CLI uses exported helpers for CPU collection and percentage calculation. |
| Report virtual memory explicitly as virtual memory. | Readers can distinguish address space from physical RAM consumption. |

The CPU design separates filesystem reads from the arithmetic in `cpuPercent(a, b)`.
A pure function only uses its inputs, changes nothing outside itself, and returns the same result for the same inputs.
That makes the percentage calculation easy to check with fixed sample values without reading live `/proc` files.

## Glossary

| Term | Meaning |
| --- | --- |
| Process | A running instance of a program. |
| PID | Process ID: a number Linux uses to identify a process. |
| Thread | A stream of execution within a process. |
| Kernel | The part of the operating system that manages hardware, memory, and scheduling. |
| procfs | The virtual filesystem usually mounted at `/proc`. |
| Physical core | A hardware processing unit inside a CPU chip. |
| Logical CPU | An execution slot the operating system can schedule work on. |
| SMT | Simultaneous multithreading: multiple logical CPUs sharing one physical core. Intel calls its implementation Hyper-Threading. |
| Tick | A unit used to account for CPU time. |
| Cumulative counter | A running total, such as process CPU ticks since the process started. |
| Sample | Counter values captured at approximately one point in time. |
| Delta | A later value minus an earlier value. |
| Sampling interval | The time between two samples. |
| CPU usage | The share of accounted CPU time used during an interval. |
| I/O | Input/output, such as reading a file or receiving network data. |
| Interrupt | A notification that requires the CPU's attention, often from hardware. |
| Context switch | Linux switching execution from one task to another. |
| Virtual memory | A process's address space; its size does not equal physical RAM usage. |
| Resident memory | Memory currently present in RAM; `VmRSS` is an approximate measure. |
| Unix epoch | January 1, 1970, at 00:00:00 UTC, used as a timestamp starting point. |

## Project layout

```text
src/index.ts   CLI arguments, process status read, CPU sampling, and terminal/JSON output
src/cpu.ts     CPU-reading helpers, system uptime reader, and percentage calculation
src/process.ts Process uptime calculation using procfs and the system clock-tick rate
dist/          Generated build output
```

The project declares the ISC license in `package.json`.
