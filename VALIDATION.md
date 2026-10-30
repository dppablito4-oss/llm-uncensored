# Validaci?n y despliegue

Fecha: 30 de octubre de 2026, America/Lima.

## Publicaci?n

App: https://chat.sypablitodp.site/ (GitHub Pages, HTTPS).

Se habilit? Pages con GitHub Actions y las dos variables p?blicas VITE. El primer despliegue del chat pas? en https://github.com/dppablito4-oss/llm-uncensored/actions/runs/41123836855. Las redirecciones de Pages y localhost se a?adieron a Auth conservando la Site URL y las redirecciones anteriores de la otra aplicaci?n. Las claves privadas permanecen en Supabase.

## Backend probado

Proyecto goegjuglstapjwcckawp: nueve tablas en forma y bucket privado forma-images. Se conservan las 19 tablas originales y public.forma_connection_checks en public. Se expuso forma sin quitar public ni graphql_public. No se alter? el historial de migraciones ajeno ni se agregaron triggers de registro a Auth.

chat-stream e image-generate est?n desplegadas con gateway JWT, validaci?n de sesi?n contra Auth y CORS espec?fico FORMA_ALLOWED_ORIGINS. Usan el secreto existente LLM_UNC_API_KEY sin guardarlo en el repo.

Pruebas alojadas realizadas con cuentas temporales:

- Login, bootstrap idempotente, perfil, cuotas, tres presets y 41 modelos de texto.
- RLS entre dos usuarios; las filas y los archivos del otro usuario no son accesibles.
- GLM 5.3 Flash Uncensored: streaming, persistencia complete, 44 tokens de entrada, 8 de salida, USD 0.0000152 reportados.
- Animagine XL 4.0 y Moxie Diffusion XL: una imagen de paisaje de 512?512 por modelo, USD 0.0034 cada una; persistencia y acceso firmado comprobados.
- Los archivos y cuentas temporales se eliminaron al terminar.

## Validaci?n local

62 pruebas en 8 archivos pasan. Cubren selecci?n/cambio de modelos, tarifas, formularios de imagen, SSE, contexto, handler Edge, validaci?n de par?metros, errores privados, RLS, reservas, cuotas y PostgreSQL PGlite. ESLint, TypeScript, compilaci?n, Deno para las dos funciones y verify:dist pasan.

## Alcance y comprobaciones pendientes

El selector de texto tiene 41 modelos con precios y par?metros publicados. Solo GLM inicial tuvo inferencia real; los otros 40 se verificaron en cat?logo.

Im?genes admite los dos modelos solicitados, una imagen por env?o, nueve tama?os, pasos/CFG/semilla, galer?a de 50 solicitudes recientes y descarga privada. Las cuotas se aplican en servidor. No incluye todav?a edici?n de imagen de referencia.

Quedan pendientes correo real de confirmaci?n/recuperaci?n, prueba en Android y pgTAP con Docker. Las pruebas locales y las llamadas alojadas no sustituyen esas verificaciones.


## Correcci?n de pantalla en blanco

El dominio personalizado sirve desde la ra?z. Se corrigi? la base de Vite, antes /llm-uncensored/, que provocaba 404 en JavaScript/CSS. CNAME se incluye en el repositorio y en el artefacto de Pages. Se a?adi? una regresi?n del dominio y verificaci?n de archivos compilados. El dominio est? autorizado en CORS de ambas Edge Functions y en las redirecciones de Auth, conservando las direcciones anteriores. HTTPS est? habilitado en Pages.
