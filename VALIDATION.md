# Validación y despliegue

Fecha de revisión: 30 de octubre de 2026, America/Bogota.

## Estado

La aplicación está alojada en https://chat.sypablitodp.site/ con GitHub Pages y HTTPS. El backend usa el proyecto `goegjuglstapjwcckawp`, nueve tablas de `forma` y el bucket privado `forma-images`. Las nuevas migraciones y ambas funciones Edge se desplegaron y comprobaron. La interfaz corregida se publica mediante el workflow Validate and deploy Pages, que ejecuta las validaciones antes de publicar. Las ejecuciones se consultan en [GitHub Actions](https://github.com/dppablito4-oss/llm-uncensored/actions/workflows/deploy.yml).

Se conservaron el historial de migraciones y las tablas de la otra aplicación del proyecto compartido. No se añadieron triggers a Auth ni se modificó su Site URL. Las claves privadas permanecen en Supabase.

## Causa del bloqueo

La lógica anterior contabilizaba la reserva máxima como consumo permanente: 15 generaciones completadas acumulaban 210.720 tokens reservados frente a 26.409 tokens registrados. Además había dos errores `OUTPUT_LIMIT` con salida máxima de 2048 tokens y sin respuesta visible.

Ahora se reserva la salida, se prepara y reserva el contexto realmente enviado, y los conteos reportados reemplazan la reserva al finalizar. Los errores anteriores al proveedor consumen cero tokens. Sin conteos completos se conserva la reserva. La migración ajustó las generaciones históricas completadas; las parciales o fallidas inciertas conservan su reserva.

Se añadió razonamiento compatible con cada modelo, preferencia inicial `low` y salida inicial de 4096 tokens. Se actualizaron los perfiles que seguían en 2048 y los presets originales que conservaban nombre, prompt y presupuesto. Los presets personalizados mantienen su presupuesto. El parser recoge el uso que llega después del límite de salida.

## Pruebas alojadas

- Login, bootstrap, consulta de cuotas y aislamiento RLS con cuentas temporales.
- Diez interacciones seguidas con GLM y cuota temporal de 30.000 tokens: todas visibles, completas y persistidas. Primera ejecución: 1247 tokens y USD 0,0002896 reportados.
- Historial sintético de 40 mensajes, mayor que el presupuesto de contexto: con salida de 4096 se completó la respuesta, se conservaron los 42 mensajes y se contabilizaron 2403 tokens, USD 0,0004884 reportados. Una prueba inicial con salida artificial de 512 reprodujo `OUTPUT_LIMIT`, confirmando la diferencia entre contexto y longitud de salida.
- Eliminación privada de un PNG mínimo: otro usuario recibe 404; el dueño elimina archivo y prompt, conserva el evento de consumo y deja de verlo en la galería. Sin inferencia de imágenes.
- Cuentas eliminadas en `finally`. Consulta final: cero usuarios de las pruebas de cuotas y galería.
- Advisors de seguridad, nivel error: sin hallazgos. Los avisos de rendimiento correspondían a políticas de la otra aplicación en `public`; no se modificaron.

Scripts reproducibles: `scripts/smoke-chat-quota.mjs` y `scripts/smoke-gallery.mjs`. El primero realiza inferencia facturada. Las claves administrativas permanecen en memoria.

## Validación local

Con Node 22.23.4 pasan 75 pruebas en ocho archivos, ESLint, TypeScript, compilación, Deno para ambas funciones y `verify:dist`. La versión mínima está declarada en `engines` y la probada en `.nvmrc`.

Las regresiones cubren doce turnos sin consumir reservas máximas permanentes, uso desconocido, idempotencia, funciones privilegiadas, memorias grandes, historial por pares, uso tras truncamiento, niveles de razonamiento, recuperación del editor tras un corte, paginación de mensajes y eliminación privada de imágenes.

`npm audit --omit=dev` no reportó vulnerabilidades. La auditoría completa señaló avisos moderados en ESLint/minimatch; queda pendiente una actualización compatible, sin aplicar las degradaciones automáticas sugeridas por npm.

## Pendientes y límites

- Entrega de confirmación y recuperación a una bandeja real. La revisión anterior documentó ausencia de SMTP personalizado. No se configuró un proveedor de correo en esta intervención.
- Android, recorrido automatizado en navegador y pgTAP con Docker. Las pruebas React con jsdom se denominan `test:integration`; no se presentan como E2E de navegador.
- El listado lateral y los gestores de presets/memorias todavía descargan sus metadatos completos. Los mensajes cargan 50 por página, la galería 24 y las estadísticas se agregan en servidor.
- Los logs estructurados identifican fase, código y solicitud sin guardar prompts, respuestas ni credenciales. No hay alertas externas ni un presupuesto global en USD; las cuotas son por usuario.
- El contexto usa una cota conservadora por bytes UTF-8. El texto recortado permanece en el historial, pero ya no se envía al modelo.
- Timeout de chat: 120 segundos. Una terminación abrupta puede dejar consumo sin confirmar y conserva su reserva. Los intentos obsoletos de chat se cierran al iniciar otra solicitud.
- No se añadió edición de imágenes de referencia.
