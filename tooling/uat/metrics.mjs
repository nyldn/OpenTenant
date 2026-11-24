import { readFile } from "node:fs/promises";
export async function processTreeRss(pid) {
  if (!pid) return 0;
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const own = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
    const children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number);
    return own + (await Promise.all(children.map(processTreeRss))).reduce((a,b) => a+b, 0);
  } catch { return 0; }
}
