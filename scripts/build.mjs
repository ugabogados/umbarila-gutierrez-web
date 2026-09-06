import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
// Publicar únicamente los recursos de la landing.
for (const file of ["index.html", "assets", "robots.txt", "sitemap.xml"]) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
const configuredUrl = process.env.SITE_URL || process.env.CF_PAGES_URL;
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
} else {
  console.log("Sin dominio configurado: sitemap vacío para revisión local.");
}
console.log("Landing estática lista en dist/.");
