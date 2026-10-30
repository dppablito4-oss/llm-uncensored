import { useQuery, useQueryClient } from "@tanstack/react-query";
import { list } from "../services/data";
export function useData<T>(table: string, order = "created_at") {
  return useQuery({
    queryKey: [table],
    queryFn: () => list<T>(table, order),
  });
}
export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}
