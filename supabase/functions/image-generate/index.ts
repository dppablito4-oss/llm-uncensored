import { imageHandler } from "./handler.ts";
Deno.serve((req) => imageHandler(req, (name) => Deno.env.get(name)));
