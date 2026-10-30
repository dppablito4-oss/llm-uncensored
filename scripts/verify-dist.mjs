import { existsSync, readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync("dist/index.html", "utf8");
const domain = existsSync("CNAME") ? readFileSync("CNAME", "utf8").trim() : "";
const base = domain ? "/" : "/llm-uncensored/";
const assetPaths = [
  ...html.matchAll(/(?:src|href)="([^"\s]*\/assets\/[^"\s]+)"/g),
].map((match) => match[1]);
assert(assetPaths.length > 0, "No compiled assets in HTML");
for (const path of assetPaths) {
  assert(
    path.startsWith(base + "assets/"),
    "Asset uses wrong deployment base: " + path,
  );
  assert(
    existsSync("dist/" + path.slice(base.length)),
    "Missing compiled asset: " + path,
  );
}
if (domain)
  assert.equal(
    readFileSync("dist/CNAME", "utf8").trim(),
    domain,
    "Custom domain not included in deployment",
  );
const files = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
assert(files.length > 0);
for (const file of files) {
  const source = readFileSync("dist/assets/" + file, "utf8");
  for (const forbidden of [
    "OPENROUTER_API_KEY",
    "LLM_UNC_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PRIVATE_OPENROUTER_SECRET",
    "PRIVATE_SERVICE_SECRET",
  ])
    assert(
      !source.includes(forbidden),
      "Private identifier in frontend bundle: " + forbidden,
    );
  assert(
    !/sk-or-v1-[a-zA-Z0-9]{20}/.test(source),
    "Potential OpenRouter secret in bundle",
  );
}
console.log(
  "Pages paths and private-secret boundary verified in " +
    files.length +
    " JS chunks.",
);
