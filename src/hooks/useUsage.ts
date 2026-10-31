import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
export type UsageSummary = {
  requests_total: number;
  tokens_total: number;
  cost_total: number;
  requests_today: number;
  tokens_today: number;
  reserved_today: number;
  daily_requests: number;
  daily_tokens: number;
  resets_at: string;
};
export function useUsage() {
  return useQuery({
    queryKey: ["usage-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("usage_summary");
      if (error) throw error;
      return data as UsageSummary | null;
    },
    refetchInterval: 60000,
  });
}
