import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/llm-uncensored/",
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
