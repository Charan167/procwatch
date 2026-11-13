import { argv } from "node:process";
import { readFile } from "node:fs/promises";
import { readProcTicks, readTotalTicks, cpuPercent } from "./cpu.js";

const [, , arg3, arg4] = argv;

console.log("Arguments passed to the script:", arg3, arg4);

try{
  if(arg3 && arg4) {
  await pidProcessor(arg3, arg4);
  }
  else {
    console.error("Insufficient arguments. Usage: node index.js --pid <process_id>");
  }
}
catch (error) {
  if(error instanceof Error && "code" in error){

    if(error.code === "ENOENT") {
      console.error(`No process found with PID ${arg4}. Please ensure the PID is correct and the process is running.`);
    }
    else if(error.code === "EACCES") {
      console.error(`Permission denied while trying to access process with PID ${arg4}. Please run the script with appropriate permissions.`);
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



async function pidProcessor(arg3: string, arg4: string) {

if(arg3 === "--pid" && Number(arg4)) {
  const pid = Number(arg4);
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
  console.log(`Virtual Memory Size: ${VmSize}`);
  // console.log(`Resident Set Size: ${VmRSS}`);
  console.log(`PID: ${Pid}`);

  const a = {
    proc: await readProcTicks(pid),
    total: await readTotalTicks(),
  };

  await new Promise(resolve => setTimeout(resolve, 1000));

  const b = {
    proc: await readProcTicks(pid),
    total: await readTotalTicks(),
  };

  console.log(a, b, "proc details")

  console.log(`CPU: ${cpuPercent(a, b).toFixed(1)}%`);

} else {
  console.error("Invalid arguments. Usage: node index.js --pid <process_id>");
}
}
