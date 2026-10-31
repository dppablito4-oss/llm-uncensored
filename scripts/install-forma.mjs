import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { runSupabase } from "./supabase-cli.mjs";

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
    "supabase/migrations/20261031003417_chat_quota_accounting.sql",
    "supabase/migrations/20261031004538_image_gallery_management.sql",
    "supabase/migrations/20261031004954_chat_response_budget.sql",
    "supabase/migrations/20261031021036_qwen_image_3.sql",
    "supabase/migrations/20261031023635_conversation_summaries.sql",
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
  runSupabase(["db", "query", "--linked", "--file", file], {
    stdio: "inherit",
  });
} finally {
  unlinkSync(file);
}
