import { handler } from "./handler.ts";
Deno.serve((req) => handler(req, (name) => Deno.env.get(name)));
