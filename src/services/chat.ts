import { supabase } from "../lib/supabase";
import { sseData } from "../../shared/sse";
export type ChatEvent = {
  type: "accepted" | "delta" | "done" | "error";
  text?: string;
  status?: string;
  message?: string;
  code?: string;
  conversation_id?: string;
  request_id?: string;
};
export async function streamChat(
  request: Record<string, unknown>,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión ha caducado");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!response.ok) {
    let message = `Error HTTP ${response.status}`;
    try {
      message = (await response.json()).error || message;
    } catch {
      /* no provider body */
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("Respuesta vacía");
  let confirmed = false;
  for await (const data of sseData(response.body, signal)) {
    const event = JSON.parse(data) as ChatEvent;
    if (event.type === "error")
      throw new Error(event.message || "Error de generación");
    if (event.type === "done") confirmed = true;
    onEvent(event);
  }
  if (!confirmed && !signal.aborted)
    throw new Error(
      "Se interrumpió la conexión. La respuesta puede ser parcial; actualiza el historial.",
    );
}
