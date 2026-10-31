# Generación de imágenes

La sección Imágenes usa NanoGPT con `LLM_UNC_API_KEY` desde la Edge Function `image-generate`. Se ofrecen exclusivamente los modelos solicitados:

- Animagine XL 4.0: ID `nsfw-gen-illustrious`.
- Moxie Diffusion XL: ID `hassaku-hentai`.
- **Qwen Image 3 Uncensored** (predeterminado): ID `qwen-image-3-uncensored`.

Los nombres e IDs se verificaron en el [catálogo oficial](https://nano-gpt.com/api/v1/image-models). La instantánea está en `shared/image-models.json`. Animagine y Moxie cuestan USD 0.0034 por imagen de 512×512, USD 0.0051 a 1024×1024 y USD 0.0068 a 2048×2048. Qwen cuesta USD 0.04 tanto en 1K como en 2K. La interfaz muestra la tarifa antes de generar. Se guarda el costo real reportado por el proveedor, o null si no lo reporta. La denominación Uncensored es del proveedor y no garantiza la aceptación de cualquier petición.

## Interfaz y límites

Texto a imagen, una imagen por solicitud. Qwen admite 1K/2K y ocho proporciones: 1:1, 3:2, 16:9, 21:9, 9:16, 2:3, 3:4 y 4:5. Admite hasta 10.000 caracteres Unicode; el editor limita conservadoramente a 10.000 unidades UTF-16. No se envían pasos, CFG ni semilla a Qwen porque no publica esos controles. Los otros dos modelos mantienen nueve resoluciones, 1–50 pasos, CFG 0–20, hasta 3000 caracteres y semilla opcional entre 0 y 2147483647. Sus valores iniciales son 1024×1024, 12 pasos y CFG 7.5. Una misma semilla no garantiza imágenes idénticas. No se implementa edición con imágenes de referencia.

La galería carga 24 solicitudes por página y permite cargar anteriores. La eliminación borra el archivo y reemplaza el prompt por `[Imagen eliminada]`; se conserva un registro oculto con modelo, parámetros y consumo, de modo que borrar una imagen no devuelve cuota ni permite eludir límites. Solo se eliminan generaciones terminadas o intentos de más de tres minutos. No se reintentan automáticamente solicitudes facturables. Si se interrumpe la conexión, actualiza la galería antes de generar de nuevo.

El servidor reserva la solicitud antes de llamar al proveedor, verifica los modelos y tamaños permitidos y aplica una generación activa por usuario, 4 solicitudes por minuto y `forma.user_limits.daily_images` por día UTC (20 por defecto). Los intentos fallidos también cuentan, porque un error o una desconexión no demuestran ausencia de cargo. La reserva se identifica por usuario/request_id para evitar cobros duplicados del mismo envío.

## Almacenamiento y seguridad

La tabla `forma.image_generations` tiene RLS de lectura por dueño. El navegador no puede escribir estados, consumos ni reservas. La función privilegiada `forma.begin_image_generation` solo se concede a service_role. Las imágenes se guardan en el bucket privado `forma-images` con rutas usuario/UUID; una política permite al usuario firmar y descargar únicamente sus archivos. Los enlaces de vista previa vencen después de una hora y se renuevan desde la galería.

El backend acepta solo PNG, JPEG y WebP, hasta 20 MB. No devuelve claves ni cuerpos privados de error. El costo y la imagen persisten también al cambiar de página, siempre que la función termine; una terminación abrupta del runtime puede dejar una solicitud en ejecución sin archivo.

## Instalación y pruebas

Para este proyecto se aplicaron el esquema de imágenes, la gestión de galería y `20261031021036_qwen_image_3.sql` sobre la instalación Forma existente y se desplegó `image-generate`. En una instalación nueva, `scripts/install-forma.mjs` incluye las siete migraciones dentro de su transacción. El proyecto alojado mantiene el historial de migraciones de la otra aplicación; no uses db reset ni migration repair.

```bash
supabase functions deploy image-generate --project-ref TU_PROJECT_REF
node --env-file=.env.local scripts/smoke-images.mjs TU_PROJECT_REF
npm exec --package=supabase -- node scripts/smoke-images.mjs TU_PROJECT_REF --qwen
```

La prueba original genera un paisaje con Animagine y Moxie; ambos pasaron con USD 0.0034 reportados. `--qwen` realiza una sola generación Qwen en 2K y 16:9, descarga una muestra a `test-results/` (ignorado por Git) para inspección visual, comprueba persistencia y aislamiento, y elimina los archivos/cuentas temporales del backend. Las claves administrativas no se guardan. Se necesita Node de `.nvmrc` y la CLI autenticada.

Los tres modelos utilizan [Image Generation OpenAI-Compatible](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai), `POST https://nano-gpt.com/api/v1/images/generations`. Se solicita base64; la ruta de Qwen devuelve una URL firmada en la práctica. El servidor admite ambos formatos y descarga las URLs del proveedor sin credenciales ni redirecciones, con límite de 20 MB y comprobación PNG/JPEG/WebP, antes de guardar en el bucket privado. Las URLs temporales del proveedor no se guardan ni se envían al navegador. Qwen envía size (1k/2k), aspect_ratio y output_format; los otros modelos envían size, num_inference_steps, guidance_scale y seed. Los parámetros y precios de Qwen se verifican en sus [metadatos de endpoint](https://nano-gpt.com/api/v1/images/models/qwen-image-3-uncensored/endpoints).
