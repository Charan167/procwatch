import { argv } from "node:process";

const [, , arg3, arg4] = argv;

console.log("Arguments passed to the script:", arg3, arg4);

if(arg3 === "--pid" && Number(arg4)) {
  const pid = Number(arg4);
  console.log(`Monitoring process with PID: ${pid}`);
} else {
  console.error("Invalid arguments. Usage: node index.js --pid <process_id>");
}