import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { readProcTicks, readTotalTicks, cpuPercent } from "./cpu.js";
import { formatBytes } from "./memory.js";
import { getProcessUptime } from "./process.js";

const usage = "Usage: node dist/index.js --pid <process_id> [--interval <milliseconds>]";
let pid: number | undefined;

try {
  const { values } = parseArgs({
    options: {
      pid: { type: "string" },
      interval: { type: "string", default: "1000" },
    },
  });

  pid = Number(values.pid);
  const interval = Number(values.interval);

  if (!Number.isSafeInteger(pid) || pid <= 0 ||
      !Number.isSafeInteger(interval) || interval <= 0 || interval > 2_147_483_647) {
    console.error(usage);
    process.exit(1);
  }

  await pidProcessor(pid, interval);
}
catch (error) {
  if(error instanceof Error && "code" in error){

    if(typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS_")) {
      console.error(usage);
    }
    else if(error.code === "ENOENT") {
      console.error(`No process found with PID ${pid}. Please ensure the PID is correct and the process is running.`);
    }
    else if(error.code === "EACCES") {
      console.error(`Permission denied while trying to access process with PID ${pid}. Please run the script with appropriate permissions.`);
    }
    else {
      console.error("An unexpected error occurred:", error);
    }
  }
  else{
    console.error("An unexpected error occurred:", error);
  }
  process.exit(1);
}

async function pidProcessor(pid: number, interval: number) {
  console.log(`Monitoring process with PID: ${pid}`);

  const processInfo = await readFile(`/proc/${pid}/status`, "utf-8");
  // console.log(`Process Info for PID ${pid}:\n${processInfo}`); 

 const {Name, State, VmSize, VmRSS, Pid} = Object.fromEntries(
    processInfo.split("\n")
      .filter(line => line.includes(":"))
      .map(line => line.split(":").map(s => s.trim()))
  );

  console.log(`Name: ${Name}`);
  console.log(`State: ${State}`);
console.log(`Virtual Memory Size: ${formatBytes(parseInt(VmSize, 10) * 1024)}`);
console.log(`Resident Set Size: ${formatBytes(parseInt(VmRSS, 10) * 1024)}`);
  console.log(`PID: ${Pid}`);

  const a = {
    proc: await readProcTicks(pid),
    total: await readTotalTicks(),
  };

  await new Promise(resolve => setTimeout(resolve, interval));

  const b = {
    proc: await readProcTicks(pid),
    total: await readTotalTicks(),
  };

  console.log(a, b, "proc details")

  console.log(`CPU: ${cpuPercent(a, b).toFixed(1)}%`);
  console.log(`Uptime: ${(await getProcessUptime(pid)).toFixed(1)} s`);

}
