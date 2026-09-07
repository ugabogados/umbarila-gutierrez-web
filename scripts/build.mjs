import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
// Publicar únicamente los recursos de la landing.
for (const file of ["index.html", "assets", "robots.txt", "sitemap.xml"]) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
// La URL canónica nunca usa el subdominio temporal de un despliegue.
const configuredUrl = process.env.SITE_URL || "https://ugabogados.com";
const isPreview = process.env.SITE_PREVIEW === "true" ||
  (process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== "main");
if (configuredUrl) {
  const url = new URL(configuredUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "SITE_URL debe ser un origen HTTPS sin ruta, credenciales ni parámetros.",
    );
  }
  const origin = url.origin
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  await writeFile(
    path.join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`,
  );
  let html = await readFile(path.join(output, "index.html"), "utf8");
  html = html.replaceAll("https://ugabogados.com", origin);
  if (isPreview) html = html.replace("index,follow,max-image-preview:large", "noindex,nofollow");
  await writeFile(path.join(output, "index.html"), html);
  await writeFile(path.join(output, "robots.txt"), isPreview
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`);
} else {
  console.log("Sin dominio configurado: sitemap vacío para revisión local.");
}
console.log("Landing estática lista en dist/.");
