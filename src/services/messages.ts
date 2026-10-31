import { supabase } from "../lib/supabase";
import type { Message } from "../types";
export const messagePageSize = 50;
export async function messagePage(conversation: string, before?: number) {
  let request = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversation)
    .order("seq", { ascending: false })
    .limit(messagePageSize);
  if (before !== undefined) request = request.lt("seq", before);
  const { data, error } = await request;
  if (error) throw error;
  return data as Message[];
}
export async function allMessages(conversation: string) {
  const rows: Message[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await messagePage(conversation, before);
    rows.push(...page);
    if (page.length < messagePageSize) return rows.reverse();
    before = page.at(-1)!.seq;
  }
}
