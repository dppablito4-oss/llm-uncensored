# Configurar Supabase

## Proyecto y esquema

Crea un proyecto Supabase nuevo y conserva su Project Ref. No uses una base con datos ajenos para experimentar. Desde la raíz:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

La migración crea `profiles`, `conversations`, `messages`, `presets`, `memories`, `usage_events`, `models` y `user_limits`, con UUID, índices, triggers y RLS. Los perfiles/presets iniciales se crean para usuarios nuevos mediante el trigger de Auth. Regístrate después de aplicar la migración.

## Auth por correo

En Authentication → URL Configuration configura:

- Site URL: `https://TU_USUARIO.github.io/llm-uncensored/`.
- Redirect URLs: esa misma URL y `http://localhost:5173/llm-uncensored/`.
- Proveedor email habilitado y confirmación por email activada.
- SMTP propio si vas a admitir usuarios externos; revisa las restricciones y cuotas del servicio de correo del proyecto.

La app utiliza PKCE y `detectSessionInUrl`; permite que Supabase consuma `?code=...` antes de limpiar la URL. HashRouter mantiene las rutas del cliente detrás de `#` sin necesitar rewrites del servidor de Pages. Los enlaces PKCE deben abrirse en el navegador/dispositivo donde se inició el proceso.

La recuperación muestra un formulario de nueva contraseña cuando Auth emite `PASSWORD_RECOVERY`. No pidas ni guardes contraseñas en las tablas públicas.

## Claves y orígenes

Copia Project URL y la clave publishable a `.env` (las dos únicas variables VITE). Estas claves públicas no conceden acceso a datos de otros usuarios: eso depende de RLS.

Configura `OPENROUTER_API_KEY` y `ALLOWED_ORIGINS` en los secretos de Edge Functions mediante el dashboard. Ejemplo del valor de orígenes:

```text
http://localhost:5173,https://TU_USUARIO.github.io
```

Son orígenes exactos sin ruta ni barra final. Nunca uses `*`. Si usas otro dominio, puerto o preview, añádelo expresamente. No envíes claves privadas al navegador. Las variables reservadas `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las proporciona el runtime de Supabase; no se agregan al `.env` frontend.

## Función

```bash
npx supabase functions deploy chat-stream
```

`supabase/config.toml` mantiene `verify_jwt = true`. Además, el handler consulta Auth con el JWT del usuario. La cabecera `Authorization` debe contener el access token de sesión del usuario; la publishable key se envía en `apikey`, nunca como sustituto del JWT.

Si recibes 401: revisa el proyecto de las claves, la sesión, su caducidad, el despliegue correcto y la compatibilidad de las signing keys con el gateway de tu proyecto. No despliegues con `--no-verify-jwt` para ocultar el problema. Actualiza la CLI/runtime siguiendo la documentación del proveedor cuando corresponda.

## Cuotas y modelos autorizados (solo administrador)

Ejecuta SQL en el dashboard, sustituyendo un UUID real:

```sql
update public.user_limits
set requests_per_minute = 8, daily_requests = 80, daily_tokens = 250000
where user_id = 'UUID_DEL_USUARIO';
```

El usuario puede leer su cuota, pero no modificarla. Los límites usan eventos de uso que permanecen aunque borres la conversación.

Para admitir otro modelo, confirma primero el ID en OpenRouter y añade una fila al catálogo backend:

```sql
insert into public.models(id,name,enabled)
values ('ID_VALIDO_DE_OPENROUTER','Nombre visible',true);
```

La interfaz lo recupera del backend. Para retirarlo: `update public.models set enabled=false where id='ID';`. No se permite cambiar modelos del catálogo desde el cliente. Un modelo autorizado puede dejar de estar disponible en el proveedor; la función devuelve un error claro ante HTTP 404 y no inventa una respuesta.

## Verificaciones después de conectar

1. Crear dos cuentas A/B y confirmar sus correos.
2. A crea conversación, preset y memoria. B no debe poder verlos ni modificarlos desde la API.
3. Enviar un mensaje, ver fragmentos progresivos, recargar y comprobar que persiste.
4. Detener una respuesta larga y actualizar historial para comprobar el estado parcial.
5. Cambiar cuotas mediante SQL y comprobar HTTP 429.
6. Inspeccionar Network: la clave OpenRouter nunca debe aparecer en solicitudes del navegador.
7. Probar recuperación de contraseña con el correo real y acceso desde Android.

Pruebas locales completas de Supabase requieren Docker y la CLI:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

La suite `npm test` no requiere Docker: ejecuta la migración SQL en PostgreSQL PGlite con un Auth mínimo de prueba y comprueba RLS, CRUD, cuotas y transacciones privilegiadas.
