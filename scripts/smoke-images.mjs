// Explicit integration check: creates two temporary confirmed users, generates
// one small image with each model, and removes their files and accounts.
// Admin keys remain in memory; never print or write credentials.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(ref, process.argv[2], "Pass the exact linked project ref");
const keys = JSON.parse(
  execFileSync(
    process.platform === "win32" ? "supabase.exe" : "supabase",
    ["projects", "api-keys", "--project-ref", ref, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const serviceKey = keys.find((key) => key.name === "service_role")?.api_key;
assert(serviceKey, "No administrative key available");
const url = `https://${ref}.supabase.co`;
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert(publicKey, "Missing public key");
const options = {
  db: { schema: "forma" },
  auth: { persistSession: false, autoRefreshToken: false },
};
const admin = createClient(url, serviceKey, options);
const users = [];
const check = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
try {
  for (let i = 0; i < 2; i++) {
    const email = `forma-smoke-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    users.push({ id: user.id });
    const client = createClient(url, publicKey, options);
    const { session } = check(
      await client.auth.signInWithPassword({ email, password }),
    );
    users[i] = { id: user.id, client, session };
    check(await client.rpc("ensure_workspace"));
    assert.equal(check(await client.from("profiles").select("id")).length, 1);
    assert.equal(check(await client.from("presets").select("id")).length, 3);
  }
  const [a, b] = users;
  for (const model of ["nsfw-gen-illustrious", "hassaku-hentai"]) {
    const response = await fetch(url + "/functions/v1/image-generate", {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + a.session.access_token,
        Origin: "https://dppablito4-oss.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_id: randomUUID(),
        model_id: model,
        prompt:
          "A peaceful alpine lake surrounded by pine forests, distant snowy mountains, sunrise, landscape illustration, no people, no text",
        size: "512x512",
        steps: 12,
        cfg_scale: 7.5,
        seed: 42,
      }),
      signal: AbortSignal.timeout(125000),
    });
    const result = await response.json();
    assert(
      response.ok,
      "Image generation HTTP " +
        response.status +
        ": " +
        JSON.stringify(result),
    );
    const row = check(
      await a.client
        .from("image_generations")
        .select("*")
        .eq("id", result.id)
        .single(),
    );
    assert.equal(row.status, "complete");
    const signed = check(
      await a.client.storage
        .from("forma-images")
        .createSignedUrl(row.object_path, 60),
    );
    const image = await fetch(signed.signedUrl);
    assert.equal(image.status, 200);
    assert((await image.arrayBuffer()).byteLength > 100);
    assert.equal(
      check(
        await b.client.from("image_generations").select("id").eq("id", row.id),
      ).length,
      0,
    );
    const denied = await b.client.storage
      .from("forma-images")
      .createSignedUrl(row.object_path, 60);
    assert(denied.error, "Other user must not sign an image URL");
    console.log(
      model +
        ": real generation, persistence, signed URL and isolation OK; cost USD " +
        row.cost_usd,
    );
  }
} finally {
  for (const user of users) {
    const rows = await admin
      .from("image_generations")
      .select("object_path")
      .eq("user_id", user.id);
    const paths = (rows.data || [])
      .map((row) => row.object_path)
      .filter(Boolean);
    if (paths.length)
      check(await admin.storage.from("forma-images").remove(paths));
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) {
      console.error(`Temporary user cleanup failed: ${user.id}`);
      process.exitCode = 1;
    }
  }
  console.log(`Temporary accounts removed: ${users.length}`);
}
