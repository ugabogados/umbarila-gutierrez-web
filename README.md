# Umbarila Gutiérrez & Asociados

Sitio público y portal jurídico interno de la firma. GitHub es la fuente del proyecto.

## Desarrollo y publicación

Requiere Node.js 20 o posterior. La landing se compila en `dist/` y Cloudflare Workers sirve tanto los recursos públicos como las rutas privadas del portal.

El build usa `SITE_URL` o `CF_PAGES_URL` para el sitemap. La compilación de producción permite indexación en ugabogados.com. Las ramas de revisión en Pages o SITE_PREVIEW=true permanecen bloqueadas. Esta actualización no cambia el alojamiento ni el dominio.

## Identidad y contenido 2026

- Fotografía de Bogotá y emblema dorado proporcionados por la firma.
- Azul #022e68, gris #383838 y dorado #edc773.
- Cinco áreas: Administrativo, Laboral, Civil, Familia y Comercial.
- Textos de compromiso, proceso y preguntas frecuentes actualizados.
- Se retiran la sección de equipo y el selector de área de consulta.
- `assets/css/refresh.css` contiene la adaptación visual y móvil.
- El logo horizontal actualizado se conserva en `assets/images/logo-horizontal.png`; la cabecera y el banner combinan el emblema original dorado con texto accesible.

## Contacto y opiniones

`assets/js/config.js` centraliza el WhatsApp 573194532248, el correo umbarilagutierrez.asoc@gmail.com y los enlaces sociales. Instagram, Facebook y LinkedIn se muestran con sus iconos solo cuando la firma proporciona sus URLs HTTPS oficiales; no se inventan perfiles.

El botón flotante indica que el visitante viene de la web. El formulario de asesoría prepara un mensaje con los datos y el consentimiento. El visitante revisa y confirma el envío en WhatsApp; abrirlo no equivale a una recepción confirmada.

El formulario público no almacena datos ni realiza envíos automáticos. El backend se limita al portal autenticado y al flujo de firma mediante enlaces individuales. Si la apertura de WhatsApp es bloqueada, se ofrece un enlace para continuar. Sin JavaScript el formulario permanece deshabilitado y los enlaces directos de contacto siguen disponibles. La sección “Tu experiencia” muestra las dos capturas de testimonios proporcionadas por la firma.

La representación requiere los acuerdos descritos en las preguntas frecuentes. El portal conserva los PDFs y registros asociados en recursos privados de Cloudflare.

## Navegación móvil

Servicios, valores y pasos de atención se presentan como tarjetas horizontales hasta 760 px, con desplazamiento nativo, ajuste al inicio de cada tarjeta, botones anterior/siguiente y contador solo para lectores de pantalla. El teclado admite flechas, Inicio y Fin; se respeta la preferencia de movimiento reducido. Sin JavaScript sigue disponible el desplazamiento nativo. En escritorio se conserva la distribución original. Los iconos SVG son decorativos y acompañan los títulos accesibles.


## SEO, política y navegación

El dominio canónico confirmado es https://ugabogados.com. El código incluye título y descripción con enfoque en Colombia y Cundinamarca, contenido geográfico visible, idioma es-CO, Open Graph, canonical, sitemap y JSON-LD Organization con canales y áreas de atención reales. No se inventan dirección, sedes, horarios, reseñas ni calificaciones públicas.

El build usa SITE_URL si se configura; de lo contrario usa ugabogados.com. Nunca usa la URL temporal de Pages como canonical. SITE_PREVIEW=true o CF_PAGES_BRANCH distinta de main bloquea la indexación; producción permite rastreo y declara el sitemap en robots.txt. Publicar y conectar el dominio es necesario para que Google pueda acceder a estos cambios. Search Console y el perfil empresarial requieren acciones externas y no se configuran desde esta página.

La política PDF original, sin modificaciones, se encuentra en assets/documents/politica-tratamiento-datos-2026.pdf y se enlaza desde el consentimiento y el pie de página. El número también se muestra como texto con enlace tel:.

El menú móvil incluye panel de navegación y botón animado. Las entradas de contenido se animan una vez al aparecer, sin librerías y sin ocultar contenido si JavaScript falla. Se respeta prefers-reduced-motion. Los carruseles conservan solo flechas visibles; las instrucciones y el contador quedan disponibles para lectores de pantalla.

En pantallas de hasta 760 px, la portada se reduce al mensaje principal, la solicitud de asesoría y las garantías. El bloque editorial del emblema se oculta porque repite la marca visible en el encabezado; permanece completo en escritorio. Las garantías se recorren horizontalmente y el encabezado, incluido su menú desplegable, usa el color #011b36.

Referencias: https://developers.google.com/search/docs/appearance/structured-data/organization y https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
## Portal interno y desarrollo local

```bash
npm install
npm run build
npx wrangler d1 migrations apply ug-portal-db --local
npx wrangler dev --local --persist-to .wrangler/state
```

El portal se abre en `/portal/`. En el primer inicio solicita el código definido
como `PORTAL_SETUP_TOKEN` para crear la cuenta administradora.

## Recursos de producción

El Worker utiliza:

- D1 mediante el binding `PORTAL_DB` para usuarios, clientes, casos y auditoría.
- D1 también conserva los PDFs originales y firmados en una tabla privada del portal.
- Los secretos `PORTAL_SETUP_TOKEN` y `AUDIT_SALT`.

Antes del primer despliegue se debe crear la base D1, reemplazar su identificador
en `wrangler.jsonc`, aplicar las migraciones y registrar
los secretos con Wrangler. Nunca se deben guardar contraseñas o secretos en Git.
