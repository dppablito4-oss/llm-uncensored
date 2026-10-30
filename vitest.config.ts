import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: { include: ["tests/**/*.test.{ts,tsx}"], testTimeout: 30000 },
  resolve: {
    alias: {
      "npm:zod@4.6.7": "zod",
      "npm:@supabase/supabase-js@2.118.0": "@supabase/supabase-js",
    },
  },
});
