import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { readProcTicks, readTotalTicks, cpuPercent } from "./cpu.js";
import { formatBytes } from "./memory.js";
import { getProcessUptime } from "./process.js";

const usage =
  "Usage: node dist/index.js --pid <process_id> [--interval <milliseconds>] [--json]";
let pid: number;
let interval: number;
let json: boolean;
let timer: NodeJS.Timeout | undefined;
let previous: { proc: number; total: number } | undefined;

try {
  const { values } = parseArgs({
    options: {
      pid: { type: "string" },
      interval: { type: "string", default: "1000" },
      json: { type: "boolean" },
    },
  });

  pid = Number(values.pid);
  interval = Number(values.interval);
  json = values.json ?? false;

  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(interval) ||
    interval <= 0 ||
    interval > 2_147_483_647
  ) {
    console.error(usage);
    process.exit(1);
  }
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("ERR_PARSE_ARGS_")
  ) {
    console.error(usage);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
}

async function sampleAndPrint() {
  const processInfo = await readFile(`/proc/${pid}/status`, "utf-8");
  const { Name, State, VmSize, VmRSS, Pid } = Object.fromEntries(
    processInfo
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => line.split(":").map((s) => s.trim())),
  );

  const current = {
    proc: await readProcTicks(pid),
    total: await readTotalTicks(),
  };
  const uptimeSec = await getProcessUptime(pid);
  const vmSizeBytes = parseInt(VmSize, 10) * 1024;
  const rssBytes = parseInt(VmRSS, 10) * 1024;
  const cpuPct = previous ? cpuPercent(previous, current) : null;

  if (json) {
    console.log(
      JSON.stringify({
        ts: Date.now(),
        pid,
        cpuPct,
        rssBytes,
        vmSizeBytes,
        uptimeSec,
      }),
    );
  } else {
    const cpu = cpuPct === null ? "N/A" : `${cpuPct.toFixed(1)}%`;
    const line =
      `PID: ${Pid} | Name: ${Name} | State: ${State}` +
      ` | Virtual Memory Size: ${formatBytes(vmSizeBytes)} | Resident Set Size: ${formatBytes(rssBytes)}` +
      ` | CPU: ${cpu} | Uptime: ${uptimeSec.toFixed(1)} s`;
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(line);
  }
  previous = current;
}

async function tick() {
  try {
    await sampleAndPrint();
    timer = setTimeout(tick, interval);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      "path" in error &&
      typeof error.path === "string" &&
      error.path.startsWith("/proc/")
    ) {
      if (error.code === "ENOENT" || error.code === "ESRCH") {
        console.error(`Process ${pid} has exited.`);
        process.exit(1);
      }
      if (error.code === "EACCES") {
        console.error(`Permission denied for ${pid}.`);
        process.exit(1);
      }
    }
    console.error(error);
    process.exit(1);
  }
}

tick();

process.on("SIGINT", () => {
  clearTimeout(timer);
  process.stdout.write("\n");
  process.exit(0);
});
