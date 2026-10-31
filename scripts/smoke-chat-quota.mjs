// Explicit paid integration test. Only temporary users/data are created.
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
const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
const publicKey = keys.find(
  (k) => k.type === "publishable" || k.name === "anon",
)?.api_key;
assert(serviceKey && publicKey, "Missing API keys");
const url = `https://${ref}.supabase.co`;
const options = {
  db: { schema: "forma" },
  auth: { persistSession: false, autoRefreshToken: false },
};
const admin = createClient(url, serviceKey, options);
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const users = [];
try {
  for (let i = 0; i < 2; i++) {
    const email = `forma-quota-${randomUUID()}@example.invalid`,
      password = randomUUID() + randomUUID();
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
  }
  const [a, b] = users;
  check(
    await admin
      .from("user_limits")
      .update({ daily_tokens: 30000, requests_per_minute: 100 })
      .eq("user_id", a.id),
  );
  const model = "z-ai/glm-5.3-flash-uncensored";
  check(
    await a.client
      .from("profiles")
      .update({
        max_tokens: 512,
        context_tokens: 12000,
        reasoning_effort: "low",
      })
      .eq("id", a.id),
  );
  const conv = check(
    await a.client
      .from("conversations")
      .insert({
        user_id: a.id,
        model_id: model,
        title: "Temporary 10-turn quota test",
      })
      .select("id")
      .single(),
  );
  const turns = process.argv.includes("--long-only") ? 0 : 10;
  for (let turn = 1; turn <= turns; turn++) {
    const response = await fetch(`${url}/functions/v1/chat-stream`, {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${a.session.access_token}`,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation_id: conv.id,
        request_id: randomUUID(),
        content: `Turno ${turn}. Responde únicamente OK.`,
        model_id: model,
        preset_id: null,
        action: "send",
      }),
      signal: AbortSignal.timeout(140000),
    });
    const text = await response.text();
    assert(response.ok, `Turn ${turn}: HTTP ${response.status}`);
    assert(
      text.includes('"type":"done"'),
      `Turn ${turn} not confirmed: ${text.slice(-800)}`,
    );
    assert(
      text.includes('"type":"delta"'),
      `Turn ${turn} has no visible answer`,
    );
    console.log(`Live conversation: turn ${turn}/10 confirmed`);
  }
  const usage = check(await a.client.rpc("usage_summary"));
  assert.equal(usage.requests_today, turns);
  assert(usage.tokens_today < 30000);
  assert.equal(
    usage.reserved_today,
    0,
    "Provider usage should release reservations",
  );
  const rows = check(
    await a.client.from("messages").select("id").eq("conversation_id", conv.id),
  );
  assert.equal(rows.length, turns * 2);
  assert.equal(
    check(
      await b.client
        .from("messages")
        .select("id")
        .eq("conversation_id", conv.id),
    ).length,
    0,
  );
  assert.equal(check(await b.client.rpc("usage_summary")).requests_today, 0);
  const events = check(
    await a.client
      .from("usage_events")
      .select("reserved_tokens,quota_tokens,usage_reported,estimated_cost_usd")
      .eq("conversation_id", conv.id),
  );
  assert(events.every((e) => e.usage_reported));
  // Add more history than the configured context can hold; old pairs must be
  // clipped without rejecting the current message or altering stored history.
  const longHistory = Array.from({ length: 20 }, () => [
    {
      conversation_id: conv.id,
      user_id: a.id,
      role: "user",
      content: "Dato de prueba controlado. ".repeat(55),
      status: "complete",
    },
    {
      conversation_id: conv.id,
      user_id: a.id,
      role: "assistant",
      content: "Respuesta de prueba controlada. ".repeat(55),
      status: "complete",
    },
  ]).flat();
  check(
    await a.client.from("profiles").update({ max_tokens: 4096 }).eq("id", a.id),
  );
  check(await admin.from("messages").insert(longHistory));
  const longResponse = await fetch(`${url}/functions/v1/chat-stream`, {
    method: "POST",
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${a.session.access_token}`,
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_id: conv.id,
      request_id: randomUUID(),
      content: "Ignora los datos de prueba anteriores. Responde únicamente OK.",
      model_id: model,
      preset_id: null,
      action: "send",
    }),
    signal: AbortSignal.timeout(140000),
  });
  const longText = await longResponse.text();
  assert(
    longResponse.ok && longText.includes('"type":"done"'),
    `Long-context turn failed: ${longText.slice(-800)}`,
  );
  assert.equal(
    check(
      await a.client
        .from("messages")
        .select("id")
        .eq("conversation_id", conv.id),
    ).length,
    turns * 2 + 42,
  );
  const finalUsage = check(await a.client.rpc("usage_summary"));
  const finalEvents = check(
    await a.client
      .from("usage_events")
      .select("reserved_tokens,estimated_cost_usd")
      .eq("conversation_id", conv.id),
  );
  console.log(
    JSON.stringify({
      turns: turns + 1,
      long_context: "OK",
      tokens_charged: finalUsage.tokens_today,
      reserved_original: finalEvents.reduce((n, e) => n + e.reserved_tokens, 0),
      cost_reported_usd: finalEvents.reduce(
        (n, e) => n + Number(e.estimated_cost_usd || 0),
        0,
      ),
      cross_user_rls: "OK",
    }),
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
