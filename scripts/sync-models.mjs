import { writeFileSync } from "node:fs";

const source = "https://nano-gpt.com/api/v1/models?detailed=true";
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`NanoGPT catalog HTTP ${response.status}`);
const { data } = await response.json();
const defaultModel = "z-ai/glm-5.3-flash-uncensored";
const models = data
  .filter(
    (m) =>
      m.category === "Uncensored" ||
      /uncensored|abliterated/i.test(`${m.id} ${m.name}`),
  )
  .map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description || "",
    context_length: m.context_length ?? null,
    max_output_tokens: m.max_output_tokens ?? null,
    pricing: m.pricing ?? null,
    capabilities: m.capabilities ?? {},
    reasoning_efforts: m.reasoning_efforts ?? [],
  }))
  .sort((a, b) =>
    a.id === defaultModel
      ? -1
      : b.id === defaultModel
        ? 1
        : a.name.localeCompare(b.name),
  );
if (!models.length || !models.some((m) => m.id === defaultModel))
  throw new Error("Incomplete NanoGPT catalog");
writeFileSync(
  "shared/model-catalog.json",
  JSON.stringify(
    {
      source,
      fetched_at: new Date().toISOString(),
      default_model: defaultModel,
      models,
    },
    null,
    2,
  ) + "\n",
);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
writeFileSync(
  "supabase/migrations/202610300002_nanogpt_models.sql",
  "-- Generated from the public NanoGPT catalog.\ninsert into forma.models(id,name,enabled) values\n" +
    models
      .map((model) => `(${quote(model.id)},${quote(model.name)},true)`)
      .join(",\n") +
    "\non conflict(id) do update set name=excluded.name;\n",
);
console.log(
  `Catalog synchronized: ${models.length} models, default ${defaultModel}`,
);
