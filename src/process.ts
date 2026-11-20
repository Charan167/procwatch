import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { bootTime } from "./cpu.js";

const ticksPerSecond = Number(
  execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }),
);

export async function getProcessUptime(pid: number): Promise<number> {
  const data = await readFile(`/proc/${pid}/stat`, "utf8");

  const end = data.lastIndexOf(")");

  if (end === -1) {
    throw new Error("Invalid process stat file");
  }

  const fields = data
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const startTime = Number(fields[19]);

  if (!Number.isSafeInteger(startTime) || startTime < 0) {
    throw new Error("Invalid process start time");
  }

  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) {
    throw new Error("Invalid clock tick rate");
  }

  const startTimeSec = startTime / ticksPerSecond;
  const systemUptime = await bootTime();
  const processUptime = systemUptime - startTimeSec;

  if (!Number.isFinite(processUptime) || processUptime < 0) {
    throw new Error("Invalid process uptime");
  }

  return processUptime;
}
