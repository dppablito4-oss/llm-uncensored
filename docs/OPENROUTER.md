# Configurar OpenRouter

1. Crea una API key en tu cuenta OpenRouter y añade saldo si el modelo lo requiere.
2. Guarda la clave únicamente como secreto `OPENROUTER_API_KEY` en Supabase Edge Functions.
3. Añade `ALLOWED_ORIGINS` y despliega `chat-stream` según la guía Supabase.
4. Inicia sesión y envía un mensaje corto. La respuesta debe aparecer por fragmentos y sobrevivir a una recarga.

Modelo inicial: `cognitivecomputations/dolphin-mistral-24b-venice-edition`. Su ID apareció en el catálogo público consultado durante la preparación del proyecto el 30 de octubre de 2026. Eso confirma que estaba listado, no que se haya ejecutado una inferencia ni garantiza disponibilidad futura.

El backend usa `POST https://openrouter.ai/api/v1/chat/completions`, `stream: true`, `stream_options.include_usage: true`, parámetros guardados y un contexto construido por el servidor. La allowlist se administra en `public.models`. Un ID enviado por el navegador no basta para autorizar un modelo.

HTTP 402 se presenta como saldo insuficiente, 429 como límite del proveedor y 404 como modelo no disponible. Otros errores se presentan sin reenviar cuerpos de depuración potencialmente sensibles. Un stream sin `[DONE]` se considera incompleto. El límite de longitud deja la respuesta marcada como parcial.

La función no calcula precios usando datos del navegador. Guarda tokens/costo reportados por el proveedor cuando existen y usa una estimación conservadora de tokens en caso contrario. Un costo ausente se representa como `null`. La factura y el consumo real deben contrastarse con OpenRouter.

No pegues claves en issues, presets, memorias ni mensajes. Ningún archivo de este proyecto necesita una clave OpenRouter en una variable `VITE_`.
