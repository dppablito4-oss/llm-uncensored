import { supabase as db } from "../lib/supabase";
export async function list<T>(
  table: string,
  order = "created_at",
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(order, { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return all;
}
export async function save(table: string, values: Record<string, unknown>) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Inicia sesión");
  const { data, error } = await db
    .from(table)
    .upsert({
      ...values,
      ...(table === "profiles" ? { id: user.id } : { user_id: user.id }),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function remove(table: string, id: string) {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}
export async function change(
  table: string,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await db.from(table).update(values).eq("id", id);
  if (error) throw error;
}
