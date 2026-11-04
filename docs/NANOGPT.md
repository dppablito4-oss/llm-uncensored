# NanoGPT

El handler conecta a `POST https://nano-gpt.com/api/v1/chat/completions` con el secreto **LLM_UNC_API_KEY** guardado en Supabase. No se necesita su valor en el repositorio ni en el frontend.

El modelo inicial es `z-ai/glm-5.3-flash-uncensored`. El catálogo contiene 41 modelos: categoría `Uncensored` o nombre/ID identificado como `uncensored` o `abliterated`, incluida la variante TEE. Es la clasificación del proveedor, no una garantía sobre cada respuesta.

## Selector, precios y parámetros

El selector aparece en chat, configuración y presets. Cada opción muestra tarifas en **USD por millón de tokens**. El panel desplegable muestra descripción oficial, contexto, salida máxima, capacidades y esfuerzos de razonamiento publicados. Los datos ausentes se muestran como sin publicar.

GLM inicial: USD 0.20 de entrada y USD 0.80 de salida por millón, contexto de 1 048 576 y salida de hasta 32 768. Esta app limita el contexto a 24 000 y la salida a 8 192, respetando máximos inferiores del modelo. El presupuesto inicial de salida es 4096. Envía texto, temperatura, Top P, máximo de salida y el esfuerzo de razonamiento compatible configurado. Visión y herramientas todavía no están implementadas.

## Cuotas, contexto y longitud de respuesta

La app no impone cuota diaria de tokens ni de solicitudes de chat. Se mantiene el control de frecuencia por minuto y los límites por respuesta y contexto. Los límites y el saldo de NanoGPT siguen aplicándose. Antes de generar se reserva el contexto realmente enviado más la salida máxima; al terminar, los conteos completos reportados por NanoGPT reemplazan esa reserva. Si no se llamó al proveedor, la reserva se libera. Si se desconoce el consumo, sigue contando por prudencia.

El presupuesto de contexto prioriza el mensaje actual, después memorias y pares completos de conversación reciente. Los turnos antiguos se recortan del contexto, pero permanecen en el historial y la exportación. Se usa una cota por bytes UTF-8, no un tokenizador exacto del modelo.

El máximo de salida incluye razonamiento interno: un modelo puede gastar ese presupuesto antes de producir texto visible. Se usa `low` cuando el catálogo publica ese nivel. Configuración y presets permiten cambiarlo; `auto` conserva la decisión del proveedor. Si un nivel no existe en el modelo elegido se usa `low` o el primer nivel publicado; si no tiene niveles publicados no se envía el parámetro. El preset activo tiene prioridad sobre las preferencias globales.

El parser sigue leyendo el uso después de `finish_reason: length` para contabilizar una respuesta truncada. No reintenta automáticamente una petición facturable. Un error explica si se agotó la cuota diaria, el contexto o la longitud de salida.

Fuentes: [razonamiento y niveles por modelo](https://nano-gpt.com/blog/how-to-choose-ai-reasoning-effort), [soporte sobre límites y razonamiento](https://nano-gpt.com/support).

Los precios son una instantánea fechada de lista. No presuponen descuentos o recargos de la cuenta. Se guarda `usage.cost` reportado por el proveedor; si falta permanece `null`.

## Actualizar catálogo

```bash
npm run sync:models
```

Actualiza `shared/model-catalog.json` y `supabase/migrations/202610300002_nanogpt_models.sql` desde el endpoint público oficial. Revisa los cambios y ejecuta pruebas. Para un backend existente aplica solo el SQL del catálogo, vuelve a desplegar `chat-stream` y recompila el frontend. No ejecutes el instalador completo. La sincronización conserva los modelos deshabilitados por el administrador.

La interfaz consulta los modelos habilitados de `forma.models` y sus detalles de la instantánea compartida. El backend valida ambas listas antes de usar la clave. El navegador no puede autorizar IDs arbitrarios.

Se solicita SSE con `stream_options.include_usage`. `[DONE]` confirma el final; la UI recibe `done` después de persistir. HTTP 402 indica saldo insuficiente, 429 límite del proveedor y 404 modelo no disponible. No se reenvían cuerpos privados de error.

Fuentes: [API](https://nano-gpt.com/api), [catálogo](https://nano-gpt.com/api/v1/models?detailed=true), [chat](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion), [SSE](https://docs.nano-gpt.com/api-reference/miscellaneous/streaming-protocol).

## Resúmenes de conversaciones largas

Cada ocho intercambios completos (16 mensajes anteriores), el siguiente envío usa una única llamada para responder y generar una ficha acumulativa que fusiona la memoria anterior con el nuevo bloque. La compactación puede adelantarse si se acerca al presupuesto de contexto. La respuesta del proveedor es un JSON con `answer` y `summary`: el parser incremental solo transmite el texto decodificado de `answer`; no imprime el bloque de memoria ni la envoltura JSON.

La ficha tiene un objetivo aproximado de 800 tokens, organizado en hechos/nombres, objetivos, decisiones/correcciones y pendientes. No se acumulan resúmenes en la entrada. El límite duro de almacenamiento sigue siendo 6000 bytes UTF-8; nunca se trunca la memoria para avanzar el cursor. Los mensajes enormes pueden aportar extractos señalizados para respetar el presupuesto. Si el mensaje actual no deja espacio, se conserva la ficha anterior y se difiere la actualización.

Si la memoria se omite, es inválida o se trunca después de completar `answer`, hay como máximo dos reintentos exclusivos de resumen al mismo modelo. Se muestran como estado de actualización; no se genera otra respuesta visible. El consumo/coste de todas las llamadas se suma al evento y la reserva incierta se mantiene. Un fallo de guardado se reintenta en base de datos sin repetir inferencia. El límite total del turno sigue siendo 120 segundos.

El editor conserva la posición de lectura durante streaming y al finalizar. Solo se desplaza al abrir el historial, posicionar la pregunta nueva, cargar mensajes anteriores conservando anclaje o pulsar explícitamente «Ir al último mensaje». El primer chat conserva la posición al navegar a su URL persistida.

## Elección de modelo

La selección de modelo del chat se guarda en `forma.profiles.default_model` (nombre histórico de la columna, ahora última selección). Tiene prioridad en todos los chats sobre sus modelos históricos y los de presets. Cambiar un preset conserva el modelo seleccionado. Si no se puede guardar el cambio se informa al usuario y se mantiene la selección anterior.

La actualización automática de resumen utiliza `input.model_id`, igual que la respuesta, tras validar el modelo autorizado. No se usa GLM como auxiliar ni se cambia de proveedor/modelo ante errores. Normalmente respuesta y resumen comparten una llamada. Solo los reintentos de recuperación son llamadas adicionales y se contabilizan. Desactivar el resumen automático elimina la generación y recuperación de esa ficha.
