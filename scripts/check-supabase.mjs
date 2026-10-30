// Read-only: never creates users, writes rows, or invokes model inference.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error(
    "Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local.",
  );
  process.exit(1);
}
for (const [label, path] of [
  ["Supabase Auth", "/auth/v1/settings"],
  ["Tabla aislada", "/rest/v1/forma_connection_checks?select=id&limit=0"],
]) {
  try {
    const response = await fetch(new URL(path, url), {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) console.log(`${label}: OK (HTTP ${response.status})`);
    // An anonymous caller must not have access to the isolated table.
    else if (label === "Tabla aislada" && response.status === 401) {
      const body = await response.json();
      if (body.code !== "42501") throw new Error(`HTTP ${response.status}`);
      console.log(
        `${label}: permisos restringidos para anónimos (42501). Verifica el esquema con acceso administrativo.`,
      );
    } else {
      console.error(
        `${label}: HTTP ${response.status}${response.status === 404 ? " (recurso no disponible)" : ""}`,
      );
      process.exitCode = 1;
    }
    if (!response.bodyUsed) await response.body?.cancel();
  } catch (error) {
    console.error(`${label}: ${error.message}`);
    process.exitCode = 1;
  }
}
