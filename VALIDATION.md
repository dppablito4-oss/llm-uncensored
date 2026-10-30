# Estado de validación

Fecha: 30 de octubre de 2026, America/Lima.

## Backend alojado comprobado

- Proyecto `goegjuglstapjwcckawp` vinculado mediante CLI autenticada.
- Ocho tablas con RLS y 41 modelos habilitados en `forma`. Las 19 tablas originales y `public.forma_connection_checks` permanecen en `public`.
- Instalación transaccional sin reparar ni modificar el historial de migraciones de la otra aplicación. Ningún trigger nuevo de registro en `auth.users`.
- Esquema `forma` expuesto conservando `public,graphql_public`. Frontend y Edge usan ese esquema expresamente.
- `chat-stream` desplegado con gateway JWT, verificación adicional contra Auth y CORS específico `FORMA_ALLOWED_ORIGINS`.
- Se confirmó la presencia de `LLM_UNC_API_KEY` sin leer ni guardar su valor en el repo.
- Dos cuentas temporales: login, inicialización de perfil/cuotas/tres presets, catálogo de 41 modelos y aislamiento entre usuarios comprobados.
- Generación real con `z-ai/glm-5.3-flash-uncensored`: SSE confirmado y respuesta persistida como `complete`. Consumo reportado: 44 tokens de entrada, 8 de salida y USD 0.0000152.
- Las dos cuentas y sus datos se eliminaron al terminar.

## Validación local

ESLint, TypeScript, 52 pruebas en 6 archivos y compilación pasan. La suite cubre UI con proveedor simulado, cambio de modelo/tarifa, SSE, contexto, catálogo/precios, handler Edge, PostgreSQL PGlite, permisos, idempotencia y cuotas. El chequeo Deno de la Edge Function pasa. `verify:dist` comprueba rutas y ausencia de secretos de backend en el bundle. La prueba UI permite hasta 5 segundos tras streaming/navegación.

## Interfaz

Selector en chat, presets y configuración con precios de entrada/salida en USD por millón. Panel con descripción oficial, contexto, salida máxima y capacidades. GLM 5.3 Flash Uncensored predeterminado. Catálogo fechado actualizable con `npm run sync:models`.

## Pendiente

- Publicación del frontend actualizado en Pages y revisión visual con sesión real, especialmente Android.
- Confirmación/recuperación por correo real, conservando las URLs Auth de la otra aplicación.
- pgTAP con Docker/Supabase local.
- Solo se probó inferencia real con GLM inicial. Los otros 40 se verificaron en catálogo; no se facturó una llamada a cada uno.

El backend está operativo y probado. El frontend actualizado está en el workspace y compila; estos cambios aún no se han publicado.
