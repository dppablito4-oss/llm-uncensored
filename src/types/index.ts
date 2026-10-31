export type Conversation = {
  id: string;
  title: string;
  model_id: string;
  preset_id: string | null;
  archived_at: string | null;
  created_at: string;
};
export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "partial" | "error";
  seq: number;
  created_at: string;
};
export type Preset = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  model_id: string;
  memory_enabled: boolean;
  reasoning_effort: string;
};
export type Memory = {
  id: string;
  content: string;
  category: string;
  enabled: boolean;
};
export type Profile = {
  id: string;
  default_model: string;
  default_preset_id: string | null;
  memory_enabled: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  context_tokens: number;
  memory_tokens: number;
  reasoning_effort: string;
};
export type Model = { id: string; name: string };
export type Usage = {
  id: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  status: string;
};
