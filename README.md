# Forma · AI Workspace

MVP de chat personal construido para el repositorio **llm-uncensored**. React + TypeScript + Vite, Tailwind 4, componentes de estilo shadcn/ui con Radix, React Router (hash), Zustand, TanStack Query, React Hook Form/Zod, Markdown/GFM y Supabase. Frontend estático, sin servidor Node permanente. La interfaz usa identidad propia: **Forma**, verde salvia sobre carbón, tema claro opcional.

El nombre del repositorio no garantiza que un modelo acepte cualquier petición. Las respuestas dependen del modelo y las condiciones del proveedor. No se añaden respuestas simuladas a la aplicación: los mocks viven únicamente en `tests/`.

## Para empezar al llegar a casa

El backend conectado usa nueve tablas dentro del esquema separado `forma`, con autorización para compartir el proyecto Supabase. La instalación conserva las tablas de la otra aplicación y no agrega triggers de registro a Auth. Consulta [configuración de Supabase](docs/SUPABASE.md).

Necesitas Node.js 22 LTS, Git, una cuenta Supabase y una clave NanoGPT con saldo. Para la CLI Supabase, utiliza la distribución oficial o `npx supabase` (no instalar globalmente con npm).

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
npx supabase functions deploy chat-stream
npm run dev
```

Abre `http://localhost:5173/llm-uncensored/`. Si Vite elige otro puerto, añádelo explícitamente a CORS y a las redirecciones de Auth. Sin variables públicas la app muestra instrucciones de configuración y no intenta generar contenido.

## Arquitectura y flujo vertical

1. Supabase Auth administra registro por email, confirmación, login, recuperación y renovación de sesión PKCE.
2. El navegador crea la conversación mediante RLS. Envía a `chat-stream` solo IDs, acción y mensaje actual; nunca un historial arbitrario ni costos.
3. El gateway mantiene `verify_jwt = true`; la función también verifica el JWT contra Auth con `getUser`.
4. Una transacción de PostgreSQL comprueba propiedad, modelo autorizado, preset del mismo dueño, idempotencia, solicitudes activas y cuotas. Reserva presupuesto y guarda el mensaje de usuario.
5. El backend lee preset, preferencias, memorias activas e historial de PostgreSQL; arma un contexto limitado.
6. NanoGPT transmite SSE. El frontend presenta los fragmentos mediante un lector compatible con UTF-8 y eventos partidos entre chunks.
7. El servidor finaliza mensaje y uso en una transacción. Solo después emite `done`. Cancelaciones/errores guardan texto disponible como `partial`, o uso `error` cuando no hay texto.

`SUPABASE_SERVICE_ROLE_KEY` se utiliza exclusivamente dentro de la función para las transacciones privilegiadas. Nunca se incluye en el frontend.

## Funcionalidades

- 41 modelos de NanoGPT del catálogo `Uncensored` o identificados como uncensored/abliterated, con GLM 5.3 Flash Uncensored predeterminado. Selector con precios de entrada/salida por millón de tokens y ficha de contexto, salida máxima y capacidades. Actualiza la instantánea con `npm run sync:models`.

- Registro/login/logout, confirmación por email, recuperación y actualización de contraseña, rutas protegidas.
- Sidebar con búsqueda por título, renombrar, archivar/recuperar y eliminar conversaciones.
- Streaming progresivo, detener, regenerar y editar mensajes de usuario. Editar descarta los turnos siguientes; regenerar conserva el último turno de usuario y reemplaza su continuación.
- Markdown, tablas, código, copiar código/mensajes y exportar conversación a JSON/Markdown.
- CRUD de presets, duplicación e importación/exportación JSON validada. General, Programador y Creativo se crean por usuario al registrarse.
- Memorias explícitas, categoría, edición, eliminación, activar/desactivar y apagado global o por preset.
- Preferencias de modelo/preset, parámetros de generación y presupuesto de contexto/memoria.
- Exportación de datos y estadísticas de uso, diferenciando estimación y factura del proveedor.
- RLS en todas las tablas, relaciones compuestas por dueño y límites transaccionales que no dependen del navegador.

## Comandos

| Comando               | Propósito                                                                 |
| --------------------- | ------------------------------------------------------------------------- |
| `npm run dev`         | Desarrollo local                                                          |
| `npm run lint`        | ESLint                                                                    |
| `npm run typecheck`   | TypeScript frontend y pruebas                                             |
| `npm test`            | Suite Vitest, UI con jsdom, protocolo, Edge con mocks y PostgreSQL PGlite |
| `npm run test:e2e`    | Flujo React completo y handler Edge con proveedor simulado                |
| `npm run build`       | Compilación para `/llm-uncensored/`                                       |
| `npm run verify:dist` | Comprueba rutas de Pages y ausencia de secretos privados en JS compilado  |
| `npm run check:edge`  | Deno 2, debe estar instalado en PATH                                      |
| `npm run test:db`     | Supabase CLI instalada, stack local con Docker: ejecuta pgTAP             |
| `npm run format`      | Formatea el código con Prettier                                           |

Para comprobar Deno sin instalarlo permanentemente: `npm exec --yes --package deno -- deno check --node-modules-dir=manual supabase/functions/chat-stream/index.ts`.

## Publicación

Ver [docs/GITHUB_PAGES.md](docs/GITHUB_PAGES.md). El workflow primero instala, valida, prueba y compila. El despliegue solo continúa si existen las dos variables públicas del repositorio y Pages está habilitado con GitHub Actions. El secreto de NanoGPT no se introduce en GitHub Actions.

Repositorio: [dppablito4-oss/llm-uncensored](https://github.com/dppablito4-oss/llm-uncensored). El backend y Pages requieren completar la configuración externa. El estado exacto de entrega está en [VALIDATION.md](VALIDATION.md).

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

- Falta verificar el backend alojado con tus credenciales, correos de confirmación/recuperación, una llamada facturada a NanoGPT y un despliegue real de Pages. PGlite ejecuta la migración con roles/Auth mínimos de prueba; no sustituye Supabase alojado.
- El parser y la UI están probados con SSE real de `ReadableStream` y proveedor simulado. La revisión visual en navegador cubre acceso/configuración en escritorio; queda una prueba real en Android y del chat conectado.
- Memoria V1: se consideran las 100 memorias activas más recientes; se priorizan coincidencias léxicas con el mensaje actual y luego recencia. No hay embeddings ni memoria automática.
- Contexto: hasta 60 mensajes recientes completos, leídos desde el servidor. Se usa una cota conservadora por bytes UTF-8 y margen por mensaje, no el tokenizador exacto del modelo. El texto parcial no se reutiliza como respuesta confirmada.
- Timeout de generación: 120 segundos. La cancelación intenta detener al proveedor y guardar parcial; si el runtime se termina abruptamente, puede quedar un evento `running` sin texto. El bloqueo de conversación caduca tras 3 minutos y la reserva sigue contando para evitar gasto sin contabilizar.
- Límites diarios según UTC. La reserva es contexto + salida máxima, y se conserva incluso si el proveedor consume menos; esto puede agotar la cuota antes de alcanzar el máximo de solicitudes. Modificar cuotas requiere SQL administrativo.
- Los costos son informativos: se utiliza el costo devuelto por NanoGPT si existe; sin costo reportado se guarda `null`, nunca un precio inventado. Los tokens sin reporte se estiman conservadoramente.
- Las exportaciones y estadísticas paginan en bloques de 500. La exportación no es una instantánea transaccional: evita enviar mensajes mientras la ejecutas.
- Las sesiones de una SPA se guardan en almacenamiento del navegador mediante Supabase; no hay cookies HttpOnly en GitHub Pages. No se renderiza HTML arbitrario ni se cargan scripts de terceros.
- Un preset en uso por una conversación o como predeterminado no puede eliminarse hasta quitar esas referencias. Es una restricción deliberada para no romper relaciones.
- Los reintentos de generación son manuales. No se repite automáticamente un POST con posibles cargos; cada regeneración explícita tiene un UUID nuevo.

Fuentes técnicas: [Supabase Auth en Edge](https://supabase.com/docs/guides/functions/auth), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [NanoGPT API](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion), [catálogo de modelos](https://nano-gpt.com/api/v1/models?detailed=true), [GitHub Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Imágenes

La sección **Imágenes** ofrece Animagine XL 4.0 y Moxie Diffusion XL, con tamaño, pasos, CFG, semilla opcional y precio antes de generar. Incluye galería privada y descarga. Ver [docs/IMAGES.md](docs/IMAGES.md).

La app está publicada en [GitHub Pages](https://chat.sypablitodp.site/). Los despliegues desde main se validan antes de publicar.
