# Supabase: backend aislado de Forma

Proyecto conectado: `goegjuglstapjwcckawp`. Las ocho tablas base `models`, `profiles`, `presets`, `conversations`, `messages`, `memories`, `usage_events` y `user_limits` viven en el esquema **forma**. Se conservan las tablas ajenas de `public` y la tabla inicial `public.forma_connection_checks`.

Frontend y Edge usan `db.schema = forma`. Al iniciar sesión, `forma.ensure_workspace()` crea de forma idempotente el perfil, las cuotas y tres presets del usuario autenticado. No se agrega un trigger de registro a `auth.users`: los usuarios de la otra aplicación no reciben perfiles Forma automáticamente.

## Instalación en otro proyecto

```bash
npm ci
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
node scripts/install-forma.mjs TU_PROJECT_REF
```

Además se agregó `forma.image_generations` y el bucket privado `forma-images`; consulta [IMAGES.md](IMAGES.md). El instalador comprueba el proyecto vinculado y ejecuta las siete migraciones SQL en una transacción. Falla si `forma` ya existe. No borra ni reinstala datos. En el proyecto compartido no uses `db push`, `db reset` ni `migration repair`: conserva el historial de la otra aplicación.

Expón `forma` en la Data API conservando todos los esquemas existentes. En este proyecto se verificó la lista anterior `public,graphql_public` y se amplió mediante configuración PostgreSQL:

```sql
alter role authenticator set pgrst.db_schemas='public,graphql_public,forma';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

En otro proyecto lee primero la lista expuesta. Este ajuste por rol puede prevalecer sobre la lista del dashboard; mantenlo actualizado al añadir esquemas.

## Variables y despliegue

`.env.local`, excluido de Git, solo contiene `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Esta app usa Vite, no variables `NEXT_PUBLIC_*`. La clave publishable está sujeta a permisos y RLS.

Secretos Edge: `LLM_UNC_API_KEY` y `FORMA_ALLOWED_ORIGINS`. Los orígenes son exactos, separados por comas, sin rutas ni barra final. Se configuraron `http://localhost:5173`, `http://127.0.0.1:5173`, `https://dppablito4-oss.github.io` y `https://chat.sypablitodp.site`. El nombre específico de CORS evita modificar otras funciones.

```bash
npx supabase functions deploy chat-stream --project-ref TU_PROJECT_REF
```

Se conserva `verify_jwt = true` y la función además verifica el token contra Auth. Las variables reservadas `SUPABASE_*` las proporciona el runtime. Las claves privadas nunca se envían al navegador. Ver [NANOGPT.md](NANOGPT.md).

## Auth y verificación

Añade las redirecciones de esta app a Auth conservando las anteriores. No sustituyas la Site URL de la otra aplicación sin revisar el impacto. PKCE requiere abrir los enlaces en el navegador donde se inició la solicitud. Login y bootstrap fueron probados en producción; los correos reales quedan pendientes.

Solo el administrador modifica cuotas en `forma.user_limits` o habilita modelos en `forma.models`.

Las correcciones incrementales son `20261031003417_chat_quota_accounting.sql`, `20261031004538_image_gallery_management.sql` y `20261031004954_chat_response_budget.sql`. Ya se aplicaron al proyecto conectado. En otra instalación existente, aplica únicamente las pendientes, en ese orden, con `supabase db query --linked --file RUTA`, después de verificar el proyecto vinculado. No vuelvas a ejecutar el instalador completo.

`prepare_generation` ajusta la reserva al contexto preparado antes de llamar al proveedor. `finish_generation` usa los conteos reportados cuando están disponibles, libera los intentos anteriores al proveedor y mantiene las reservas inciertas. Todas las modificaciones de cuotas bloquean primero la misma fila de `user_limits`. `usage_summary` agrega estadísticas con permisos del usuario y RLS.

La salida inicial subió de 2048 a 4096 tokens. Se actualizaron los perfiles que seguían en 2048 y los tres presets originales que conservaban su prompt y presupuesto de fábrica. Los presets personalizados conservan su presupuesto. El razonamiento usa `low` cuando es compatible.

Los handlers registran fase, código e identificadores en logs estructurados; no registran prompts, respuestas, JWT ni claves. Las generaciones de chat obsoletas se cierran al iniciar otra solicitud, conservando su reserva desconocida. La galería deja de sondear indefinidamente los intentos antiguos y permite eliminarlos.

## Pruebas alojadas reproducibles

Qwen Image 3 se añade mediante `20261031021036_qwen_image_3.sql`: amplía la lista de modelos, valida resolución/proporción y hasta 10.000 caracteres, y guarda pasos/CFG/semilla como null para Qwen. El parámetro opcional `p_aspect` de la función de reserva conserva las llamadas anteriores de los modelos existentes. Los permisos privilegiados y RLS se mantienen. No cambies las migraciones originales de instalaciones existentes.

Con Node de `.nvmrc` y la CLI autenticada:

```bash
npm exec --package=supabase -- node scripts/smoke-chat-quota.mjs TU_PROJECT_REF
npm exec --package=supabase -- node scripts/smoke-gallery.mjs TU_PROJECT_REF
```

El primer comando realiza inferencia facturada con cuentas temporales, diez turnos cortos y un turno con historial largo. El segundo usa un PNG mínimo, sin inferencia, para probar borrado privado, conservación del evento de cuota y rechazo entre usuarios. Ambos limpian sus cuentas en `finally`. Las claves administrativas se mantienen en memoria. Si la CLI npm no se detecta en PATH, configura `SUPABASE_CLI_ENTRY` con la ruta a su `dist/supabase.js`.

`npm run check:supabase` es de solo lectura. La prueba explícita `node --env-file=.env.local scripts/smoke-hosted.mjs TU_PROJECT_REF` crea dos cuentas temporales, comprueba RLS y ejecuta una generación corta facturada; elimina las cuentas en `finally`. Las claves administrativas de la CLI permanecen en memoria.

La suite local usa PostgreSQL PGlite y prueba también que se conserva una tabla ajena `public.profiles`. pgTAP con Supabase local requiere Docker.

## Estado actual de confirmación por correo

Revisión del 30 de octubre de 2026: email habilitado, confirmación obligatoria, dominio `https://chat.sypablitodp.site/` autorizado. No hay servidor SMTP personalizado ni hook de envío configurado. El límite de email reportado es 2 mensajes por hora.

Se validó una cuenta temporal sin enviar correo: el login antes de confirmar devuelve email_not_confirmed, el token de confirmación es aceptado y después se obtiene sesión. La cuenta se eliminó. Esto valida el flujo de confirmación, no la entrega real a una bandeja de entrada.

Para enviar confirmaciones y recuperaciones a usuarios externos configura SMTP en Supabase Authentication: host, puerto, usuario, contraseña del servicio SMTP y correo remitente verificado. Las credenciales quedan en Supabase; no se agregan a VITE ni a GitHub Pages. La configuración de Auth/SMTP es compartida con la otra aplicación de este proyecto.

El servidor predeterminado de Supabase solo envía a direcciones del equipo y no está pensado para producción. Fuente: https://supabase.com/docs/guides/auth/auth-smtp.
