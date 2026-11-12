import { readFile } from "node:fs/promises";


async function readProcTicks(pid: number): Promise<number | undefined> {

    const statFilePath = `/proc/${pid}/stat`;

    try {
        const procStatContent = await readFile(statFilePath, { encoding: "utf-8" });
        console.log(procStatContent);

        const remaining = procStatContent.slice(procStatContent.lastIndexOf(")") + 1).trim();
        return Number(remaining.split(" ")?.[11]) + Number(remaining.split(" ")?.[12]);
    }
    catch (error) {
        console.error(`Error reading ${statFilePath}:`, error);
        throw error;
    }
}

async function readTotalTicks(): Promise<number | undefined> {
    const statFilePath = `/proc/stat`;

    try {
        const procStatContent = await readFile(statFilePath, { encoding: "utf-8" });
        console.log(procStatContent);

        const cpuLine = procStatContent.split("\n").find(line => line.startsWith("cpu "));
        if (!cpuLine) {
            throw new Error("CPU line not found in /proc/stat");
        }
        const cpuValues = cpuLine.slice(4).trim().split(" ").map(Number);
        return cpuValues.reduce((sum, value) => sum + value, 0);
    } catch (error) {
        console.error(`Error reading ${statFilePath}:`, error);
        throw error;
    }
}