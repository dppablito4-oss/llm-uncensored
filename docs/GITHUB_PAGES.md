# Publicar en GitHub Pages

## Obtener el proyecto

El repositorio ya existe en [dppablito4-oss/llm-uncensored](https://github.com/dppablito4-oss/llm-uncensored), con la licencia MIT original conservada.

```bash
git clone https://github.com/dppablito4-oss/llm-uncensored.git
cd llm-uncensored
npm ci
```

## Variables públicas y Pages

En Settings → Secrets and variables → Actions → Variables crea:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

No configures `LLM_UNC_API_KEY` aquí; solo pertenece al backend Supabase. Las variables VITE son públicas y quedan compiladas en JavaScript.

En Settings → Pages selecciona **GitHub Actions** como fuente. Ejecuta el workflow “Validate and deploy Pages” o haz push a `main`. Se necesita la política de permisos de Actions que permita Pages y OIDC. Las PR ejecutan validación/compilación pero no publican.

La URL esperada tiene la forma `https://TU_USUARIO.github.io/llm-uncensored/`. Con CNAME configurado, Vite publica desde `/` y copia CNAME al artefacto; sin dominio personalizado utiliza `/llm-uncensored/`. HashRouter permite abrir rutas como `/#/chat/...` dentro de esa base sin 404 de servidor. Si cambias el nombre del repositorio o publicas en la raíz de un dominio propio, actualiza `base` en `vite.config.ts` y la comprobación de `scripts/verify-dist.mjs`.

El workflow valida, prueba y compila aunque falten variables públicas. En ese caso omite el job de despliegue y deja una nota en el resumen de Actions. Tras añadir ambas variables, vuelve a ejecutar el workflow. Una compilación sin ellas sigue siendo válida para revisar la pantalla de configuración, pero no se presenta como chat operativo.

## Verificar después del despliegue

- Comprueba la URL retornada por Actions y que los assets no respondan 404.
- Añade el origen exacto de Pages a `FORMA_ALLOWED_ORIGINS` de Supabase.
- Configura Site URL/Redirect URLs de Auth incluyendo `/llm-uncensored/`.
- Registra una cuenta, confirma correo, inicia sesión y prueba un stream real.
- Abre el historial en una segunda sesión y confirma persistencia.

El workflow se entrega preparado, pero su ejecución remota y publicación necesitan acceso al repositorio y tu configuración externa.


## Dominio personalizado

CNAME contiene `chat.sypablitodp.site`. El dominio apunta a GitHub Pages y usa HTTPS. La compilaci?n lee ese archivo, usa la ra?z para los assets y publica una copia en dist/CNAME. `verify:dist` comprueba el prefijo y la existencia de cada asset, adem?s de la coincidencia de CNAME.
