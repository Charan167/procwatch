import { readFile } from "node:fs/promises";
export async function readProcTicks(pid: number): Promise<number> {
  const statFilePath = `/proc/${pid}/stat`;
  const procStatContent = await readFile(statFilePath, { encoding: "utf-8" });
  const remaining = procStatContent
    .slice(procStatContent.lastIndexOf(")") + 1)
    .trim();
  return (
    Number(remaining.split(" ")?.[11]) + Number(remaining.split(" ")?.[12])
  );
}

export async function readTotalTicks(): Promise<number> {
  const statFilePath = `/proc/stat`;

  const procStatContent = await readFile(statFilePath, { encoding: "utf-8" });
  const cpuLine = procStatContent
    .split("\n")
    .find((line) => line.startsWith("cpu "));
  if (!cpuLine) {
    throw new Error("CPU line not found in /proc/stat");
  }
  const cpuValues = cpuLine
    .slice(4)
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map(Number);
  return cpuValues.reduce((sum, value) => sum + value, 0);
}

export function cpuPercent(
  a: { proc: number; total: number },
  b: { proc: number; total: number },
): number {
  const procDiff = b.proc - a.proc;
  const totalDiff = b.total - a.total;

  if (totalDiff === 0) {
    return 0;
  }

  return (procDiff / totalDiff) * 100;
}

export async function bootTime(): Promise<number> {
  const statFilePath = `/proc/uptime`;

  const bootStatContent = await readFile(statFilePath, { encoding: "utf-8" });
  const value = bootStatContent.trim().split(/\s+/)[0];
  const bootSec = Number(value);
  if (!value || !Number.isFinite(bootSec) || bootSec < 0) {
    throw new Error(`Invalid system uptime in ${statFilePath}`);
  }
  return bootSec;
}
