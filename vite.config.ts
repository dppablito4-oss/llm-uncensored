import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
const domain = existsSync("CNAME") ? readFileSync("CNAME", "utf8").trim() : "";
const domainPlugin: Plugin = {
  name: "pages-custom-domain",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "CNAME", source: domain + "\n" });
  },
};
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(domain ? [domainPlugin] : [])],
  base: domain ? "/" : "/llm-uncensored/",
  server: { allowedHosts: ["terminal.local"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/")) {
            if (id.includes("/@supabase/")) return "supabase";
            if (
              [
                "/react/",
                "/react-dom/",
                "/react-router/",
                "/react-router-dom/",
                "/scheduler/",
              ].some((p) => id.includes(p))
            )
              return "react";
          }
        },
      },
    },
  },
});
