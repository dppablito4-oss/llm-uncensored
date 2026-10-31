import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

// Support the modern npm CLI shim without passing arguments through a shell.
// CLI output may contain private keys; callers must never log raw results.
export function runSupabase(args, options = {}) {
  const entry =
    process.env.SUPABASE_CLI_ENTRY ||
    (process.env.PATH || "")
      .split(delimiter)
      .map((dir) => join(dir, "..", "supabase", "dist", "supabase.js"))
      .find((path) => existsSync(path));
  return execFileSync(
    entry
      ? process.execPath
      : process.platform === "win32"
        ? "supabase.exe"
        : "supabase",
    entry ? [entry, ...args] : args,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options },
  );
}
