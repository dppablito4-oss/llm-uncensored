# Estado de entrega y validación

Fecha: 30 de octubre de 2026, America/Lima.

## Implementado

Frontend React/TypeScript con Auth, rutas protegidas, chat SSE, cancelación, regeneración/edición, historial persistido, CRUD de presets/memorias y ajustes. Migración SQL con RLS y transacciones privilegiadas para idempotencia, propiedad y cuotas. Edge Function Deno con JWT, CORS, OpenRouter, contexto desde base de datos y persistencia completa/parcial. Workflow de validación y Pages; documentación de configuración.

## Ejecutado y comprobado

| Comprobación                                                                     | Resultado                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                   | Pasa                                                                                                                                                    |
| `npm run typecheck`                                                              | Pasa                                                                                                                                                    |
| `npm test`                                                                       | 46 pruebas, 5 archivos, todas pasan                                                                                                                     |
| `npm run build`                                                                  | Pasa; base `/llm-uncensored/`, assets divididos en chunks                                                                                               |
| `npm run verify:dist`                                                            | Pasa; rutas de Pages y frontera de secretos en el JS compilado                                                                                          |
| Deno 2 `check --node-modules-dir=manual supabase/functions/chat-stream/index.ts` | Pasa                                                                                                                                                    |
| Migración SQL                                                                    | Ejecutada por la suite en PostgreSQL PGlite con roles y Auth mínimos de prueba                                                                          |
| RLS y transacciones                                                              | Aislamiento A/B, CRUD, claves compuestas, mensajes solo servidor, consumo/cuotas solo servidor, idempotencia, estados parciales, edición y regeneración |
| Protocolo SSE                                                                    | UTF-8 fragmentado, uso, confirmación, HTTP 402/404/429/500, error intermedio, EOF incompleto y cancelación                                              |
| Flujo React                                                                      | Login, envío, SSE con proveedor simulado y recuperación desde historial; registro y recuperación por correo con API simulada                            |
| Edge handler                                                                     | SDK Supabase real con transporte simulado; JWT inválido, origen inválido, propiedad, solicitudes inválidas, error de proveedor y cancelación            |
| Catálogo público OpenRouter                                                      | El ID inicial estaba listado; no se ejecutó una inferencia                                                                                              |
| Navegador de escritorio                                                          | Pantalla de configuración y diseño de acceso renderizados; variables públicas ficticias utilizadas solo para la revisión de acceso y eliminadas después |

La compilación puede mostrar avisos de Rollup sobre comentarios de optimización de Zod; no son errores. No se ocultaron fallos de pruebas para obtener este resultado.

## Pendiente de configuración externa

- El repositorio remoto ya existe en `dppablito4-oss/llm-uncensored`; se carga este código conservando su licencia MIT. Verificar el resultado del workflow en GitHub Actions.
- Conectar el proyecto Supabase, aplicar la migración y desplegar `chat-stream`.
- Configurar las dos variables públicas, secretos de backend, orígenes CORS y redirecciones de Auth.
- Verificar confirmación/recuperación por correo real e inferencia OpenRouter con saldo.
- Habilitar Pages, ejecutar GitHub Actions y comprobar su URL desplegada.
- Ejecutar pgTAP en el stack Supabase local: no hay Docker/CLI Supabase instalada en este entorno. La migración sí fue probada en PGlite.
- Probar Android real y el chat conectado en el navegador. Los tests UI no sustituyen estas verificaciones.

El código está preparado para el repositorio indicado. No se afirma que exista un backend conectado ni un sitio publicado. Si faltan las variables públicas, CI valida el proyecto y omite el despliegue con una nota explicativa.
