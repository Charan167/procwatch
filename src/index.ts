import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { readProcTicks, readTotalTicks, cpuPercent } from "./cpu.js";
import { formatBytes } from "./memory.js";
import { getProcessUptime } from "./process.js";

const usage = "Usage: node dist/index.js --pid <process_id> [--interval <milliseconds>]";
let pid: number;
let interval: number;

try {
  const { values } = parseArgs({
    options: {
      pid: { type: "string" },
      interval: { type: "string", default: "1000" },
    },
  });

  pid = Number(values.pid);
  interval = Number(values.interval);

  if (!Number.isSafeInteger(pid) || pid <= 0 ||
      !Number.isSafeInteger(interval) || interval <= 0 || interval > 2_147_483_647) {
    console.error(usage);
    process.exit(1);
  }
}
catch (error) {
  if (error instanceof Error && "code" in error &&
      typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS_")) {
    console.error(usage);
    process.exit(1);
  }
  throw error;
}

await pidProcessor(pid, interval);

async function pidProcessor(pid: number, interval: number) {
  let previous: { proc: number; total: number } | undefined;

  while (true) {
    try {
      const processInfo = await readFile(`/proc/${pid}/status`, "utf-8");
      const { Name, State, VmSize, VmRSS, Pid } = Object.fromEntries(
        processInfo.split("\n")
          .filter(line => line.includes(":"))
          .map(line => line.split(":").map(s => s.trim()))
      );

      const current = {
        proc: await readProcTicks(pid),
        total: await readTotalTicks(),
      };
      const uptime = await getProcessUptime(pid);
      const virtualMemory = formatBytes(parseInt(VmSize, 10) * 1024);
      const residentMemory = formatBytes(parseInt(VmRSS, 10) * 1024);

      let cpu = "N/A";
      if (previous) {
        cpu = `${cpuPercent(previous, current).toFixed(1)}%`;
      }

      console.log(
        `PID: ${Pid} | Name: ${Name} | State: ${State}` +
        ` | Virtual Memory Size: ${virtualMemory} | Resident Set Size: ${residentMemory}` +
        ` | CPU: ${cpu} | Uptime: ${uptime.toFixed(1)} s`
      );
      previous = current;
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") {
          console.error(`Process ${pid} has exited.`);
          process.exit(1);
        }
        if (error.code === "EACCES") {
          console.error(`Permission denied for ${pid}.`);
          process.exit(1);
        }
      }
      throw error;
    }

    await sleep(interval);
  }
}
