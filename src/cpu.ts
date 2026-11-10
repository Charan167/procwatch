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