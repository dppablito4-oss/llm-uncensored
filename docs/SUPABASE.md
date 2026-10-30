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

Adem?s se agreg? `forma.image_generations` y el bucket privado `forma-images`; consulta [IMAGES.md](IMAGES.md). El instalador comprueba el proyecto vinculado y ejecuta las tres migraciones SQL en una transacción. Falla si `forma` ya existe. No borra ni reinstala datos. En el proyecto compartido no uses `db push`, `db reset` ni `migration repair`: conserva el historial de la otra aplicación.

Expón `forma` en la Data API conservando todos los esquemas existentes. En este proyecto se verificó la lista anterior `public,graphql_public` y se amplió mediante configuración PostgreSQL:

```sql
alter role authenticator set pgrst.db_schemas='public,graphql_public,forma';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

En otro proyecto lee primero la lista expuesta. Este ajuste por rol puede prevalecer sobre la lista del dashboard; mantenlo actualizado al añadir esquemas.

## Variables y despliegue

`.env.local`, excluido de Git, solo contiene `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Esta app usa Vite, no variables `NEXT_PUBLIC_*`. La clave publishable está sujeta a permisos y RLS.

Secretos Edge: `LLM_UNC_API_KEY` y `FORMA_ALLOWED_ORIGINS`. Los orígenes son exactos, separados por comas, sin rutas ni barra final. Se configuraron `http://localhost:5173`, `http://127.0.0.1:5173` y `https://dppablito4-oss.github.io`. El nombre específico de CORS evita modificar otras funciones.

```bash
npx supabase functions deploy chat-stream --project-ref TU_PROJECT_REF
```

Se conserva `verify_jwt = true` y la función además verifica el token contra Auth. Las variables reservadas `SUPABASE_*` las proporciona el runtime. Las claves privadas nunca se envían al navegador. Ver [NANOGPT.md](NANOGPT.md).

## Auth y verificación

Añade las redirecciones de esta app a Auth conservando las anteriores. No sustituyas la Site URL de la otra aplicación sin revisar el impacto. PKCE requiere abrir los enlaces en el navegador donde se inició la solicitud. Login y bootstrap fueron probados en producción; los correos reales quedan pendientes.

Solo el administrador modifica cuotas en `forma.user_limits` o habilita modelos en `forma.models`.

`npm run check:supabase` es de solo lectura. La prueba explícita `node --env-file=.env.local scripts/smoke-hosted.mjs TU_PROJECT_REF` crea dos cuentas temporales, comprueba RLS y ejecuta una generación corta facturada; elimina las cuentas en `finally`. Las claves administrativas de la CLI permanecen en memoria.

La suite local usa PostgreSQL PGlite y prueba también que se conserva una tabla ajena `public.profiles`. pgTAP con Supabase local requiere Docker.

## Estado actual de confirmación por correo

Revisión del 30 de octubre de 2026: email habilitado, confirmación obligatoria, dominio `https://chat.sypablitodp.site/` autorizado. No hay servidor SMTP personalizado ni hook de envío configurado. El límite de email reportado es 2 mensajes por hora.

Se validó una cuenta temporal sin enviar correo: el login antes de confirmar devuelve email_not_confirmed, el token de confirmación es aceptado y después se obtiene sesión. La cuenta se eliminó. Esto valida el flujo de confirmación, no la entrega real a una bandeja de entrada.

Para enviar confirmaciones y recuperaciones a usuarios externos configura SMTP en Supabase Authentication: host, puerto, usuario, contraseña del servicio SMTP y correo remitente verificado. Las credenciales quedan en Supabase; no se agregan a VITE ni a GitHub Pages. La configuración de Auth/SMTP es compartida con la otra aplicación de este proyecto.

El servidor predeterminado de Supabase solo envía a direcciones del equipo y no está pensado para producción. Fuente: https://supabase.com/docs/guides/auth/auth-smtp.
