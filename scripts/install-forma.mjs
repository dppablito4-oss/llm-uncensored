import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const expected = process.argv[2];
const linked = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (!expected || expected !== linked)
  throw new Error("Pass the exact linked project ref to install Forma.");
// Shared projects have their own migration history. Do not repair or rewrite it.
// CREATE SCHEMA fails atomically if Forma is already installed.
const sql =
  "begin;\n" +
  [
    "supabase/migrations/202610300001_initial.sql",
    "supabase/migrations/202610300002_nanogpt_models.sql",
    "supabase/migrations/202610300003_images.sql",
  ]
    .map((file) =>
      readFileSync(file, "utf8")
        .replace(/^begin;\s*/i, "")
        .replace(/commit;\s*$/i, ""),
    )
    .join("\n") +
  "\ncommit;\n";
const file = "supabase/.temp/forma-install.sql";
writeFileSync(file, sql);
try {
  const result = spawnSync(
    process.platform === "win32" ? "supabase.exe" : "supabase",
    ["db", "query", "--linked", "--file", file],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(file);
}
