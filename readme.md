# procwatch

Inspect a Linux process from your terminal and learn how Linux reports process and CPU statistics.

The current CLI reads one process once and prints its name, state, virtual memory size, and process ID (PID).
CPU-reading helpers are in progress; the CLI does **not** display CPU percentages or refresh periodically yet.

## Requirements

- Linux with `/proc` available. On Windows, run the project inside a Linux environment such as WSL.
- Node.js and npm. Node.js 22.22.2 and npm 10.9.7 were used to verify the commands below.
- A running process whose details your user can read.

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
Arguments passed to the script: --pid 1234
Monitoring process with PID: 1234
Name: bash
State: S (sleeping)
Virtual Memory Size: 8000 kB
PID: 1234
```

The values depend on your process. Despite the word “Monitoring,” the current command takes one snapshot and exits.

## Usage and development

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile the source into `dist/`. |
| `npm start -- --pid 1234` | Inspect a process using the compiled program. |
| `npm run dev -- --pid 1234` | Run TypeScript directly and restart after source changes. |
| `npm run typecheck` | Check TypeScript without generating files. |

Rebuild after changing the source if you use `npm start`.
Development mode watches **source files**, not changes in the inspected process. Press `Ctrl+C` to stop it.
The only implemented CLI option is `--pid <PID>`; there is no sampling interval option.

`npm test` is currently a placeholder that exits with an error. There is no automated test suite yet.

### Understanding the output

| Output | Meaning |
| --- | --- |
| Name | The process name reported by Linux. |
| State | Its current state, such as `R` for running or `S` for sleeping. |
| Virtual Memory Size | Its virtual address space (`VmSize`), not the amount of physical RAM it occupies. |
| PID | The number Linux uses to identify this process. |

The source also reads `VmRSS`, which estimates resident memory, but does not currently print it.
See the [Linux process status reference](https://www.man7.org/linux/man-pages/man5/proc_pid_status.5.html) for the underlying fields.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Missing `dist/index.js` | Run `npm run build` before `npm start`. |
| “Insufficient arguments” or “Invalid arguments” | Use `npm start -- --pid 1234`, replacing `1234` with a live PID. |
| “No process found” | Check the PID with `ps`. A process may exit before the program reads its details. |
| “Permission denied” | Try a process owned by your user; system settings can restrict access to other processes. |
| `/proc` is unavailable | Run inside Linux with procfs mounted. |
| Output does not change after editing code | Rebuild, or use `npm run dev -- --pid 1234`. |

Read failures exit with status 1. Missing or invalid arguments currently print a message without setting a failing exit status.

## Where the data comes from

`/proc` is a virtual filesystem: Linux generates its contents from current kernel information rather than ordinary files on disk.
Running `cat /proc/stat` prints those contents; it does not start CPU measurement itself.

| Path | Contents | Role in this project |
| --- | --- | --- |
| `/proc/<PID>/status` | Labelled process details. | Used by the working CLI. |
| `/proc/<PID>/stat` | Positional process statistics, including CPU time. | Used by the unfinished process CPU helper. |
| `/proc/stat` | System statistics, including CPU time across the machine. | Used by the unfinished total CPU helper. |

Replace `<PID>` with a process ID when reading a process-specific file.
The [kernel's procfs documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) explains this interface in more detail.

## How CPU measurement works

This section explains the intended calculation. It is **not yet connected to the CLI**.

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

These values use `USER_HZ` ticks, usually 100 per second. Check your system with:

```bash
getconf CLK_TCK
```

`iowait` is approximate and can sometimes decrease. See the [system stat manual](https://www.man7.org/linux/man-pages/man5/proc_stat.5.html).

The intended total includes the first eight values, including idle time:

```text
total ticks = user + nice + system + idle + iowait + irq + softirq + steal
            = 512752 in the example above
```

`guest` is already included in `user`, and `guest_nice` in `nice`.
Adding them again would double-count guest time; see `account_guest_time` in the [kernel's CPU accounting source](https://github.com/torvalds/linux/blob/master/kernel/sched/cputime.c).

**Current limitation:** `readTotalTicks()` adds all numeric fields instead of only the first eight.
It can therefore double-count guest time when the guest fields are nonzero.
Both CPU helpers are currently unexported, print raw input, and are unused by the CLI.

### 3. Compare two samples

A sample is a pair of counters read at approximately the same time:

```text
{ proc: number, total: number }
```

Take sample `a`, wait for an interval, then take sample `b` for the same process.
A delta means the difference between the later and earlier values.

```text
process delta = b.proc - a.proc
total delta   = b.total - a.total

CPU percentage = process delta / total delta × 100
```

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
This is average usage, not an increase in CPU percentage. Tick units cancel, so no conversion to seconds is needed.

The intended `cpuPercent(a, b)` contract returns `0` when the total delta is zero to avoid division by zero.
That fallback means no usable interval was measured; it does not prove the process used no CPU.
This pure calculation function has not been implemented yet.

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

## Design decisions

These notes describe the current implementation and its tradeoffs, rather than a complete architecture history.

| Choice | Practical consequence |
| --- | --- |
| Read Linux procfs directly using Node's built-in filesystem API. | The program uses asynchronous reads without a runtime monitoring library, but requires Linux. |
| Inspect one PID in one pass. | The CLI stays small; output describes one snapshot, not a continuous stream. |
| Write strict TypeScript and compile to ESM JavaScript. | Types are checked during development; `npm start` runs the generated files in `dist/`. |
| Keep CPU readers in a separate module. | CPU collection has its own source file, although it is not wired into the CLI yet. |
| Report virtual memory explicitly as virtual memory. | Readers can distinguish address space from physical RAM consumption. |

The intended CPU design separates filesystem reads from the arithmetic in `cpuPercent(a, b)`.
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
src/index.ts   CLI arguments, process status read, and text output
src/cpu.ts     CPU-reading helpers, currently unused
dist/          Generated build output
```

The project declares the ISC license in `package.json`.
