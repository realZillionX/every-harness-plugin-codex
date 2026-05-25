import { spawnSync } from "node:child_process";
import fs from "node:fs";

export function getProcessIdentity(pid) {
  if (!pid || process.platform === "win32") return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.split(" ")[21] ?? null;
  } catch {
    return null;
  }
}

export function validateProcessIdentity(pid, identity) {
  if (!identity) return true;
  return getProcessIdentity(pid) === identity;
}

export function terminateProcessTree(pid) {
  if (!pid) return { terminated: false, detail: "No PID." };
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    return { terminated: result.status === 0, detail: result.stderr || result.stdout || "" };
  }
  try {
    process.kill(-pid, "SIGTERM");
    return { terminated: true, detail: "Sent SIGTERM to process group." };
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return { terminated: true, detail: "Sent SIGTERM to process." };
    } catch {
      return { terminated: false, detail: "Process not found." };
    }
  }
}
