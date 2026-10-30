import { create } from "zustand";
import { persist } from "zustand/middleware";
export const useUI = create<{
  theme: "dark" | "light";
  sidebar: boolean;
  setTheme: (v: "dark" | "light") => void;
  toggle: () => void;
}>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebar: typeof window !== "undefined" && window.innerWidth > 700,
      setTheme: (theme) => set({ theme }),
      toggle: () => set((s) => ({ sidebar: !s.sidebar })),
    }),
    { name: "forma-ui", partialize: (s) => ({ theme: s.theme }) },
  ),
);
