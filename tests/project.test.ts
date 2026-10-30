import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import viteConfig from "../vite.config";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
}
describe("Límites de despliegue y secretos", () => {
  it("publica el dominio personalizado desde la raíz y conserva CNAME", () => {
    expect(readFileSync("CNAME", "utf8").trim()).toBe("chat.sypablitodp.site");
    expect(viteConfig.base).toBe("/");
    expect(viteConfig.plugins?.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "pages-custom-domain" }),
      ]),
    );
  });
  it("solo expone dos variables públicas", () => {
    expect(
      readFileSync(".env.example", "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")[0]),
    ).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  });
  it("no importa secretos de backend en módulos de frontend", () => {
    for (const file of files("src")) {
      if (file.endsWith(".d.ts")) continue;
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(
        /LLM_UNC_API_KEY|OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role|sk-or-v1-/,
      );
    }
  });
  it("mantiene gateway JWT y router estático", () => {
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(
      /verify_jwt\s*=\s*true/,
    );
    expect(readFileSync("src/main.tsx", "utf8")).toContain("HashRouter");
    expect(readFileSync("vite.config.ts", "utf8")).toContain(
      "/llm-uncensored/",
    );
  });
  it("workflow valida antes de desplegar sin secretos privados", () => {
    const y = readFileSync(".github/workflows/deploy.yml", "utf8");
    for (const step of [
      "npm ci",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm run verify:dist",
      "actions/deploy-pages",
    ])
      expect(y).toContain(step);
    expect(y).not.toContain("secrets.");
  });
});
