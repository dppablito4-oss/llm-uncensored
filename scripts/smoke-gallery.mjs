// No model inference: upload a tiny fixture to verify private deletion and RLS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runSupabase } from "./supabase-cli.mjs";
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(ref, process.argv[2], "Pass the exact linked project ref");
const keys = JSON.parse(
  runSupabase([
    "projects",
    "api-keys",
    "--project-ref",
    ref,
    "--reveal",
    "--output",
    "json",
  ]),
);
const publicKey = keys.find(
  (k) => k.type === "publishable" || k.name === "anon",
)?.api_key;
const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
assert(publicKey && serviceKey, "Missing API keys");
const url = `https://${ref}.supabase.co`,
  options = {
    db: { schema: "forma" },
    auth: { persistSession: false, autoRefreshToken: false },
  };
const admin = createClient(url, serviceKey, options),
  users = [],
  paths = [];
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
try {
  for (let i = 0; i < 2; i++) {
    const email = `forma-gallery-${randomUUID()}@example.invalid`,
      password = randomUUID() + randomUUID();
    const { user } = check(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    users.push({ id: user.id });
    const client = createClient(url, publicKey, options),
      { session } = check(
        await client.auth.signInWithPassword({ email, password }),
      );
    users[i] = { id: user.id, client, session };
    check(await client.rpc("ensure_workspace"));
  }
  const [a, b] = users;
  const id = check(
    await admin.rpc("begin_image_generation", {
      p_uid: a.id,
      p_request: randomUUID(),
      p_model: "nsfw-gen-illustrious",
      p_prompt: "Temporary fixture",
      p_size: "512x512",
      p_steps: 12,
      p_cfg: 7.5,
      p_seed: null,
    }),
  );
  const path = `${a.id}/${id}.png`;
  paths.push(path);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  check(
    await admin.storage
      .from("forma-images")
      .upload(path, bytes, { contentType: "image/png" }),
  );
  check(
    await admin
      .from("image_generations")
      .update({ status: "complete", object_path: path, cost_usd: 0 })
      .eq("id", id),
  );
  const erase = (user) =>
    fetch(`${url}/functions/v1/image-generate`, {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${user.session.access_token}`,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "delete", id }),
      signal: AbortSignal.timeout(30000),
    });
  const denied = await erase(b);
  assert.equal(denied.status, 404);
  await denied.body?.cancel();
  const removed = await erase(a);
  assert.equal(removed.status, 200);
  await removed.body?.cancel();
  assert((await a.client.storage.from("forma-images").download(path)).error);
  const row = check(
    await a.client
      .from("image_generations")
      .select("deleted_at,prompt,object_path,cost_usd")
      .eq("id", id)
      .single(),
  );
  assert(row.deleted_at);
  assert.equal(row.prompt, "[Imagen eliminada]");
  assert.equal(row.object_path, null);
  assert.equal(Number(row.cost_usd), 0);
  assert.equal(
    check(
      await a.client
        .from("image_generations")
        .select("id")
        .is("deleted_at", null),
    ).length,
    0,
  );
  assert.equal(
    check(await b.client.from("image_generations").select("id")).length,
    0,
  );
  console.log(
    "Private deletion, prompt removal, retained quota event and cross-user RLS: OK",
  );
} finally {
  if (paths.length) {
    const result = await admin.storage.from("forma-images").remove(paths);
    if (result.error) {
      console.error("Fixture cleanup failed");
      process.exitCode = 1;
    }
  }
  for (const user of users) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) {
      console.error(`Temporary user cleanup failed: ${user.id}`);
      process.exitCode = 1;
    }
  }
  console.log(`Temporary accounts removed: ${users.length}`);
}
