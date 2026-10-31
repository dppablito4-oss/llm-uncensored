// Explicit integration check: creates two temporary confirmed users, runs one
// short paid generation, and deletes both accounts and their data in finally.
// Admin keys remain in memory; never print or write credentials.
import { runSupabase } from "./supabase-cli.mjs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(ref, process.argv[2], "Pass the exact linked project ref");
const keys = JSON.parse(
  runSupabase(
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
  const model = "z-ai/glm-5.3-flash-uncensored";
  const models = check(await a.client.from("models").select("id"));
  assert(models.some((item) => item.id === model));
  console.log(
    `Auth, bootstrap and model catalog: OK (${models.length} models)`,
  );
  const conversation = check(
    await a.client
      .from("conversations")
      .insert({
        user_id: a.id,
        model_id: model,
        title: "Temporary integration check",
      })
      .select("id")
      .single(),
  );
  assert.equal(
    check(
      await b.client
        .from("conversations")
        .select("id")
        .eq("id", conversation.id),
    ).length,
    0,
  );
  console.log("Cross-user RLS: OK");
  check(
    await a.client
      .from("profiles")
      .update({ max_tokens: 512, context_tokens: 2000 })
      .eq("id", a.id),
  );
  const response = await fetch(`${url}/functions/v1/chat-stream`, {
    method: "POST",
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${a.session.access_token}`,
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_id: conversation.id,
      request_id: randomUUID(),
      content: "Responde únicamente OK, sin explicación.",
      model_id: model,
      preset_id: null,
      action: "send",
    }),
    signal: AbortSignal.timeout(140000),
  });
  const stream = await response.text();
  assert(response.ok, `Chat HTTP ${response.status}: ${stream}`);
  assert(
    stream.includes('"type":"done"'),
    `Generation not confirmed: ${stream.slice(-1500)}`,
  );
  const persisted = check(
    await a.client
      .from("messages")
      .select("role,status,content")
      .eq("conversation_id", conversation.id),
  );
  assert(
    persisted.some(
      (message) =>
        message.role === "assistant" &&
        message.status === "complete" &&
        message.content.length > 0,
    ),
  );
  const usage = check(
    await a.client
      .from("usage_events")
      .select("status,input_tokens,output_tokens,estimated_cost_usd")
      .eq("conversation_id", conversation.id),
  );
  console.log(
    "Live GLM generation, SSE and persistence: OK",
    JSON.stringify(usage),
  );
} finally {
  for (const user of users) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) {
      console.error(`Temporary user cleanup failed: ${user.id}`);
      process.exitCode = 1;
    }
  }
  console.log(`Temporary accounts removed: ${users.length}`);
}
