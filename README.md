# Forma · AI Workspace

MVP de chat personal construido para el repositorio **llm-uncensored**. React + TypeScript + Vite, Tailwind 4, componentes de estilo shadcn/ui con Radix, React Router (hash), Zustand, TanStack Query, React Hook Form/Zod, Markdown/GFM y Supabase. Frontend estático, sin servidor Node permanente. La interfaz usa identidad propia: **Forma**, verde salvia sobre carbón, tema claro opcional.

El nombre del repositorio no garantiza que un modelo acepte cualquier petición. Las respuestas dependen del modelo y las condiciones del proveedor. No se añaden respuestas simuladas a la aplicación: los mocks viven únicamente en `tests/`.

## Desarrollo local

El backend conectado usa nueve tablas dentro del esquema separado `forma`, con autorización para compartir el proyecto Supabase. La instalación conserva las tablas de la otra aplicación y no agrega triggers de registro a Auth. Consulta [configuración de Supabase](docs/SUPABASE.md).

Necesitas Node.js 22.22.2 o posterior de la rama 22 (versión comprobada: `.nvmrc`, 22.23.4), Git, una cuenta Supabase y una clave NanoGPT con saldo. También se admiten Node 24.15.0 o posterior y Node 26+. Para la CLI Supabase, utiliza la distribución oficial o `npx supabase` (no instalar globalmente con npm).

```bash
npm ci
cp .env.example .env
```

En PowerShell: `Copy-Item .env.example .env`. Completa SOLO las dos variables públicas:

```dotenv
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
```

Después configura Supabase según [docs/SUPABASE.md](docs/SUPABASE.md) y la inferencia según [docs/NANOGPT.md](docs/NANOGPT.md). Son necesarios la migración SQL, el secreto de NanoGPT, CORS y el despliegue de la función; rellenar `.env` por sí solo no crea el backend.

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
node scripts/install-forma.mjs TU_PROJECT_REF
npx supabase functions deploy chat-stream image-generate
npm run dev
```

Con el CNAME actual, abre `http://localhost:5173/`. Sin CNAME, la base es `/llm-uncensored/`. Si Vite elige otro puerto, añádelo explícitamente a CORS y a las redirecciones de Auth. Sin variables públicas la app muestra instrucciones de configuración y no intenta generar contenido.

## Arquitectura y flujo vertical

1. Supabase Auth administra registro por email, confirmación, login, recuperación y renovación de sesión PKCE.
2. El navegador crea la conversación mediante RLS. Envía a `chat-stream` solo IDs, acción y mensaje actual; nunca un historial arbitrario ni costos.
3. El gateway mantiene `verify_jwt = true`; la función también verifica el JWT contra Auth con `getUser`.
4. Una transacción de PostgreSQL comprueba propiedad, modelo autorizado, preset del mismo dueño, idempotencia, solicitudes activas y cuotas. Reserva la salida y guarda el mensaje de usuario. El backend confirma por SSE que el mensaje se guardó antes de vaciar el editor.
5. El backend lee preset, preferencias, memorias activas e historial de PostgreSQL; prioriza el mensaje actual y arma un contexto limitado con pares completos. Otra transacción reserva únicamente ese contexto más la salida antes de llamar al proveedor.
6. NanoGPT transmite SSE. El frontend presenta los fragmentos mediante un lector compatible con UTF-8 y eventos partidos entre chunks.
7. El servidor finaliza mensaje y uso en una transacción. Solo después emite `done`. El consumo reportado reemplaza la reserva para la cuota; los fallos anteriores al proveedor consumen cero tokens. Las reservas inciertas siguen contando. Cancelaciones/errores guardan texto disponible como `partial`, o uso `error` cuando no hay texto.

`SUPABASE_SERVICE_ROLE_KEY` se utiliza exclusivamente dentro de la función para las transacciones privilegiadas. Nunca se incluye en el frontend.

## Funcionalidades

- 41 modelos de NanoGPT del catálogo `Uncensored` o identificados como uncensored/abliterated, con GLM 5.3 Flash Uncensored predeterminado. Selector con precios de entrada/salida por millón de tokens y ficha de contexto, salida máxima y capacidades. Actualiza la instantánea con `npm run sync:models`.

- Registro/login/logout, confirmación por email, recuperación y actualización de contraseña, rutas protegidas.
- Sidebar con búsqueda por título, renombrar, archivar/recuperar y eliminar conversaciones.
- Streaming progresivo, detener, regenerar y editar mensajes de usuario. Editar descarta los turnos siguientes; regenerar conserva el último turno de usuario y reemplaza su continuación.
- Markdown, tablas, código, copiar código/mensajes y exportar conversación a JSON/Markdown.
- CRUD de presets, duplicación e importación/exportación JSON validada. General, Programador y Creativo se crean por usuario al registrarse.
- Memorias explícitas, categoría, edición, eliminación, activar/desactivar y apagado global o por preset.
- Preferencias de modelo/preset, parámetros de generación, razonamiento compatible con cada modelo y presupuesto de contexto/memoria. Salida inicial de 4096 tokens; el razonamiento usa `low` cuando el modelo lo admite.
- Exportación completa de datos y estadísticas agregadas en servidor, sin cuota diaria de chat por defecto. El historial carga 50 mensajes recientes y permite recuperar los anteriores.
- RLS en todas las tablas, relaciones compuestas por dueño y límites transaccionales que no dependen del navegador.

## Comandos

| Comando                              | Propósito                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                        | Desarrollo local                                                             |
| `npm run lint`                       | ESLint                                                                       |
| `npm run typecheck`                  | TypeScript frontend y pruebas                                                |
| `npm test`                           | Suite Vitest, UI con jsdom, protocolo, Edge con mocks y PostgreSQL PGlite    |
| `npm run test:integration`           | Flujo React completo y handler Edge con proveedor simulado                   |
| `npm run test:hosted:chat -- REF`    | Prueba real facturada: diez turnos y un contexto largo en cuentas temporales |
| `npm run test:hosted:gallery -- REF` | Archivo de prueba, eliminación privada y RLS; sin inferencia                 |
| `npm run build`                      | Compilación para `/` con CNAME; `/llm-uncensored/` sin dominio propio        |
| `npm run verify:dist`                | Comprueba rutas de Pages y ausencia de secretos privados en JS compilado     |
| `npm run check:edge`                 | Deno 2, debe estar instalado en PATH                                         |
| `npm run test:db`                    | Supabase CLI instalada, stack local con Docker: ejecuta pgTAP                |
| `npm run format`                     | Formatea el código con Prettier                                              |

Para comprobar Deno sin instalarlo permanentemente: `npm exec --yes --package deno -- deno check --node-modules-dir=manual supabase/functions/chat-stream/index.ts`.

## Publicación

Ver [docs/GITHUB_PAGES.md](docs/GITHUB_PAGES.md). El workflow primero instala, valida, prueba y compila. El despliegue solo continúa si existen las dos variables públicas del repositorio y Pages está habilitado con GitHub Actions. El secreto de NanoGPT no se introduce en GitHub Actions.

Repositorio: [dppablito4-oss/llm-uncensored](https://github.com/dppablito4-oss/llm-uncensored). El backend y Pages están configurados; una instalación nueva requiere sus propias variables y secretos. El estado exacto de entrega está en [VALIDATION.md](VALIDATION.md).

## Estructura

```text
src/app/                 sesión, rutas y layout
src/components/ui/       primitivas locales de estilo shadcn sobre Radix
src/features/auth/       formularios Auth
src/features/chat/       chat y Markdown
src/features/presets/    gestor de presets
src/features/memory/     memorias explícitas
src/features/settings/   configuración y estadísticas
src/services/            datos y transporte SSE
src/stores/              estado visual persistido
shared/                  contexto y parsers compartidos con Edge
supabase/functions/      handler y entrada Deno chat-stream
supabase/migrations/     esquema y funciones SQL
supabase/tests/          pgTAP para el stack Supabase local
tests/                   pruebas unitarias e integración reproducibles
.github/workflows/       validación y Pages
```

## Límites conocidos

- Backend alojado, streaming real, cuotas y aislamiento fueron comprobados con cuentas temporales. Queda pendiente la entrega de correos de confirmación/recuperación con SMTP y la prueba en Android. PGlite complementa las comprobaciones alojadas.
- El parser y la UI están probados con SSE real de `ReadableStream` y proveedor simulado. La revisión visual en navegador cubre acceso/configuración en escritorio; queda una prueba real en Android y del chat conectado.
- Memoria V1: se consideran las 100 memorias activas más recientes; se priorizan coincidencias léxicas con el mensaje actual y luego recencia. No hay embeddings ni memoria automática.
- Contexto: resumen progresivo por conversación más hasta 60 mensajes recientes completos, leídos desde el servidor. Al acercarse al presupuesto o acumular 50 mensajes sin resumir, se fusiona el resumen previo con un lote antiguo. Se conservan los mensajes originales. Se usa una cota conservadora por bytes UTF-8 y margen por mensaje, no el tokenizador exacto del modelo. El texto parcial no se reutiliza como respuesta confirmada.
- Resúmenes: activados inicialmente y desactivables en Configuración. Como máximo una llamada adicional al mismo modelo elegido por envío (entrada acotada a 20 000 bytes estimados con márgenes; salida máxima 4096 tokens), con reserva conjunta para no gastar el espacio de la respuesta. El consumo y costo reportado se suman al turno; si el proveedor no informa uso, se conserva una reserva prudente. Los chats antiguos se procesan por lotes, sin llamadas en cadena. Mensajes individuales enormes usan extractos señalizados. Si falla, se conserva el resumen previo y se continúa con los mensajes recientes. Editar o regenerar fuentes invalida el resumen; borrar el chat lo elimina. No se crean recuerdos globales automáticos ni se consulta el historial de otros chats.
- Timeout de generación: 120 segundos. La cancelación intenta detener al proveedor y guardar parcial; si el runtime se termina abruptamente, puede quedar un evento `running` sin texto. El bloqueo de conversación caduca tras 3 minutos y la reserva sigue contando para evitar gasto sin contabilizar.
- Sin límites diarios de chat por defecto (`daily_tokens` y `daily_requests` son `NULL`). Si el administrador configura cuotas opcionales, se calculan según UTC. Se reserva el contexto enviado más la salida máxima; al reportar el proveedor ambos conteos de tokens, la cuota se ajusta al consumo confirmado, incluso en respuestas truncadas. Sin uso completo reportado se mantiene la reserva. La longitud de respuesta incluye razonamiento y es distinta de la cuota diaria. Modificar cuotas requiere SQL administrativo.
- Los costos son informativos: se utiliza el costo devuelto por NanoGPT si existe; sin costo reportado se guarda `null`, nunca un precio inventado. Los tokens sin reporte se estiman conservadoramente.
- Las exportaciones y estadísticas paginan en bloques de 500. La exportación no es una instantánea transaccional: evita enviar mensajes mientras la ejecutas.
- Las sesiones de una SPA se guardan en almacenamiento del navegador mediante Supabase; no hay cookies HttpOnly en GitHub Pages. No se renderiza HTML arbitrario ni se cargan scripts de terceros.
- Un preset en uso por una conversación o como predeterminado no puede eliminarse hasta quitar esas referencias. Es una restricción deliberada para no romper relaciones.
- Los reintentos de generación son manuales. No se repite automáticamente un POST con posibles cargos; cada regeneración explícita tiene un UUID nuevo.

Fuentes técnicas: [Supabase Auth en Edge](https://supabase.com/docs/guides/functions/auth), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [NanoGPT API](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion), [catálogo de modelos](https://nano-gpt.com/api/v1/models?detailed=true), [GitHub Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Imágenes

La sección **Imágenes** usa **Qwen Image 3 Uncensored** por defecto, con salida 1K/2K, ocho proporciones y precio de lista de USD 0,04 por imagen. También conserva Animagine XL 4.0 y Moxie Diffusion XL con sus controles de difusión. Los controles y límites se adaptan al modelo. Incluye galería privada paginada, descarga y eliminación del archivo y prompt, conservando el evento de consumo. Ver [docs/IMAGES.md](docs/IMAGES.md).

La app está publicada en [GitHub Pages](https://chat.sypablitodp.site/). Los despliegues desde main se validan antes de publicar.

El último modelo seleccionado se guarda en el perfil y se reutiliza en chats nuevos, antiguos y al iniciar sesión de nuevo. Los presets no cambian el modelo. El resumen automático usa exclusivamente el mismo modelo que la respuesta: puede haber dos llamadas secuenciales al mismo modelo, nunca un modelo auxiliar oculto. Se puede desactivar el resumen en Configuración.
