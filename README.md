# Umbarila Gutiérrez & Asociados

Landing estática migrada el 6 de septiembre de 2026 desde https://umbarila-gutierrez-asociados.brcris.chatgpt.site. GitHub es la fuente mantenible desde esta versión.

## Archivos

- `index.html`: contenido, anclas, FAQ nativa con `details` y formulario visual.
- `assets/css/styles.css`: estilos e identidad visual originales, conservando la cascada y todos los breakpoints.
- `assets/js/main.js`: menú, selección del área, año, CTA y preparación del formulario.
- `assets/js/config.js`: configuración pública inicialmente vacía. Nunca incluir secretos.
- `assets/images/`: ambos logos originales, sin modificar.
- `robots.txt`: bloqueo de rastreo durante la preparación.
- `sitemap.xml`: plantilla vacía; el build incorpora la URL real del despliegue.
- `scripts/build.mjs`: copia los archivos públicos a `dist/`, sin dependencias.

Se retiró el script de desafío inyectado por el alojamiento original. No hay dependencias de chatgpt.site, frameworks ni fuentes remotas.

## Cloudflare Pages

Conectar este repositorio desde Workers & Pages → Create application → Pages → Import an existing Git repository.

| Opción                 | Valor                        |
| ---------------------- | ---------------------------- |
| Rama de producción     | `main`                       |
| Framework preset       | `None`                       |
| Root directory         | raíz del repositorio (vacío) |
| Build command          | `node scripts/build.mjs`     |
| Build output directory | `dist`                       |

Requiere Node.js 18 o posterior, sin instalar paquetes. `CF_PAGES_URL`, proporcionada por Pages, genera el sitemap del despliegue. Al conectar el dominio definitivo, definir `SITE_URL` con su origen HTTPS y volver a desplegar. Esta migración no crea el proyecto de Pages ni modifica DNS.

Guía oficial: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Revisión local

Ejecutar `node scripts/build.mjs` y servir `dist/` con un servidor HTTP estático. Las rutas comienzan por `/`: abrir desde la raíz HTTP, no mediante `file://` ni desde un subdirectorio de GitHub Pages.

## Formulario y siguiente fase

El formulario conserva su apariencia, campos y aviso de preparación. El `fieldset` permanece deshabilitado también sin JavaScript. Con la configuración vacía no se carga Turnstile ni se envían solicitudes. No hay backend ni almacenamiento de consultas.

El código original está preparado para un endpoint HTTPS, una clave pública Turnstile y la URL HTTPS de una política aprobada. Solo cuando existan los tres se habilita el flujo. El futuro servidor debe validar datos y consentimiento, verificar Turnstile (incluidos hostname y action `contact`), atender el honeypot y limitar solicitudes. Recibe JSON con `name`, `email`, `phone`, `area`, `message`, `website`, `consent` booleano y `token`; el cliente espera `{ "ok": true }` al confirmar el registro. Esta integración todavía no está probada ni activada.

`whatsappNumber` y `contactEmail` siguen vacíos; los enlaces se muestran al configurarlos. Se conservan los avisos de equipo y testimonios pendientes.

No se crea `privacy/index.html`: la fuente no incluye una política aprobada y `privacyPolicyUrl` está vacío. Incorporar y enlazar la política definitiva antes de activar el formulario.

## Lanzamiento definitivo

1. Conectar Pages y revisar su URL temporal.
2. Asociar el dominio real y confirmar HTTPS.
3. Completar política, canales e integración del formulario en la siguiente fase.
4. Tras aprobar la publicación, retirar `noindex,nofollow` del HTML y cambiar `Disallow: /` por `Allow: /` en `robots.txt`. Añadir allí la URL absoluta del sitemap, configurar `SITE_URL` y añadir canonical con el dominio real.

## Verificación de migración

Comparación estructural del HTML y de las reglas CSS frente a la fuente, revisión de recursos y anclas, seis áreas de práctica, cinco FAQ y comprobación de menú/selección del área con configuración inactiva. La comparación visual en navegador queda pendiente. No se activó ni probó el backend.
