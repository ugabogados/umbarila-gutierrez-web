# Umbarila Gutiérrez & Asociados

Sitio estático de la firma. GitHub es la fuente del proyecto.

## Desarrollo y publicación

Requiere Node.js 18 o posterior. Ejecutar `node scripts/build.mjs` y servir `dist/` desde la raíz de un servidor HTTP. No requiere instalar dependencias de producción. Se conserva el flujo de Cloudflare Pages: rama de producción `main`, comando `node scripts/build.mjs` y directorio `dist`.

El build usa `SITE_URL` o `CF_PAGES_URL` para el sitemap. Se mantiene el bloqueo de indexación hasta la aprobación del lanzamiento. Esta actualización no cambia el alojamiento ni el dominio.

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

El botón flotante indica que el visitante viene de la web. El formulario de asesoría prepara un mensaje con los datos y el consentimiento. La calificación de 1 a 5 estrellas y el comentario preparan otro mensaje privado. El visitante revisa y confirma el envío en WhatsApp; abrirlo no equivale a una recepción confirmada.

Los formularios no almacenan datos ni publican testimonios. No hay backend, analítica ni envío automático. Si la apertura es bloqueada, se ofrece un enlace para continuar. Sin JavaScript los formularios permanecen deshabilitados y los enlaces directos de contacto siguen disponibles.

La representación requiere los acuerdos descritos en las preguntas frecuentes. Una futura recepción directa en la web requerirá implementar su servidor e incorporar la política de tratamiento aprobada por la firma.
