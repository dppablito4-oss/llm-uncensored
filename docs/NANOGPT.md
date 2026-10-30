# NanoGPT

El handler conecta a `POST https://nano-gpt.com/api/v1/chat/completions` con el secreto **LLM_UNC_API_KEY** guardado en Supabase. No se necesita su valor en el repositorio ni en el frontend.

El modelo inicial es `z-ai/glm-5.3-flash-uncensored`. El catálogo contiene 41 modelos: categoría `Uncensored` o nombre/ID identificado como `uncensored` o `abliterated`, incluida la variante TEE. Es la clasificación del proveedor, no una garantía sobre cada respuesta.

## Selector, precios y parámetros

El selector aparece en chat, configuración y presets. Cada opción muestra tarifas en **USD por millón de tokens**. El panel desplegable muestra descripción oficial, contexto, salida máxima, capacidades y esfuerzos de razonamiento publicados. Los datos ausentes se muestran como sin publicar.

GLM inicial: USD 0.20 de entrada y USD 0.80 de salida por millón, contexto de 1 048 576 y salida de hasta 32 768. Esta app limita el contexto a 24 000 y la salida a 8 192, respetando máximos inferiores del modelo. Envía texto, temperatura, Top P y máximo de salida. Las capacidades publicadas de visión/herramientas/razonamiento no significan que esas funciones adicionales estén implementadas en la interfaz.

Los precios son una instantánea fechada de lista. No presuponen descuentos o recargos de la cuenta. Se guarda `usage.cost` reportado por el proveedor; si falta permanece `null`.

## Actualizar catálogo

```bash
npm run sync:models
```

Actualiza `shared/model-catalog.json` y `supabase/migrations/202610300002_nanogpt_models.sql` desde el endpoint público oficial. Revisa los cambios y ejecuta pruebas. Para un backend existente aplica solo el SQL del catálogo, vuelve a desplegar `chat-stream` y recompila el frontend. No ejecutes el instalador completo. La sincronización conserva los modelos deshabilitados por el administrador.

La interfaz consulta los modelos habilitados de `forma.models` y sus detalles de la instantánea compartida. El backend valida ambas listas antes de usar la clave. El navegador no puede autorizar IDs arbitrarios.

Se solicita SSE con `stream_options.include_usage`. `[DONE]` confirma el final; la UI recibe `done` después de persistir. HTTP 402 indica saldo insuficiente, 429 límite del proveedor y 404 modelo no disponible. No se reenvían cuerpos privados de error.

Fuentes: [API](https://nano-gpt.com/api), [catálogo](https://nano-gpt.com/api/v1/models?detailed=true), [chat](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion), [SSE](https://docs.nano-gpt.com/api-reference/miscellaneous/streaming-protocol).
