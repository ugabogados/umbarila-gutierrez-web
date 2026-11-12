import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const SESSION_COOKIE = "ug_portal_session";
const SESSION_DAYS = 14;
const SIGNING_DAYS = 30;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/portal") return Response.redirect(`${url.origin}/portal/`, 308);
      if (url.pathname.startsWith("/firmar/")) {
        return env.ASSETS.fetch(new Request(`${url.origin}/portal/firma.html`, request));
      }
      if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "No fue posible completar la solicitud." }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  if (!env.PORTAL_DB) {
    return json({ error: "El portal aún no tiene configurados sus recursos de almacenamiento." }, 503);
  }

  if (url.pathname === "/api/portal/status" && request.method === "GET") {
    const count = await env.PORTAL_DB.prepare("SELECT COUNT(*) AS total FROM portal_users").first();
    const user = await currentUser(request, env);
    return json({ setupRequired: Number(count?.total || 0) === 0, user });
  }
  if (url.pathname === "/api/portal/setup" && request.method === "POST") return setupAdmin(request, env);
  if (url.pathname === "/api/portal/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/api/portal/logout" && request.method === "POST") return logout(request, env);

  const signMatch = url.pathname.match(/^\/api\/sign\/([^/]+)(?:\/(file|email))?$/);
  if (signMatch) return signingApi(request, env, signMatch[1], signMatch[2]);

  const user = await requireUser(request, env);
  if (!user) return json({ error: "Debes iniciar sesión." }, 401);
  if (url.pathname === "/api/portal/snapshot" && request.method === "GET") return snapshot(env, user);
  if (url.pathname === "/api/portal/actions" && request.method === "POST") return actions(request, env, user);

  const fileMatch = url.pathname.match(/^\/api\/portal\/documents\/([^/]+)\/file$/);
  if (fileMatch && request.method === "GET") return internalDocument(env, fileMatch[1]);
  return json({ error: "Ruta no encontrada." }, 404);
}

async function setupAdmin(request, env) {
  const count = await env.PORTAL_DB.prepare("SELECT COUNT(*) AS total FROM portal_users").first();
  if (Number(count?.total || 0) > 0) return json({ error: "El portal ya fue configurado." }, 409);
  const body = await readJson(request);
  if (!env.PORTAL_SETUP_TOKEN || body.setupToken !== env.PORTAL_SETUP_TOKEN) {
    return json({ error: "Código de configuración incorrecto." }, 403);
  }
  const error = validateAccount(body);
  if (error) return json({ error }, 400);
  const now = new Date().toISOString();
  const salt = randomToken(18);
  const passwordHash = await hashPassword(body.password, salt);
  const id = crypto.randomUUID();
  await env.PORTAL_DB.prepare("INSERT INTO portal_users (id,email,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)")
    .bind(id, normalizeEmail(body.email), clean(body.name, 120), "admin", passwordHash, salt, now, now).run();
  return createSessionResponse(env, { id, email: normalizeEmail(body.email), name: clean(body.name, 120), role: "admin" }, request, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const user = await env.PORTAL_DB.prepare("SELECT * FROM portal_users WHERE email = ? AND active = 1").bind(email).first();
  if (!user || !(await verifyPassword(String(body.password || ""), user.password_salt, user.password_hash))) {
    return json({ error: "Correo o contraseña incorrectos." }, 401);
  }
  return createSessionResponse(env, user, request);
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.PORTAL_DB.prepare("DELETE FROM portal_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly;${new URL(request.url).protocol === "https:" ? " Secure;" : ""} SameSite=Lax; Max-Age=0`);
  return response;
}

async function createSessionResponse(env, user, request, status = 200) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await env.PORTAL_DB.prepare("INSERT INTO portal_sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), user.id, await sha256(token), expires.toISOString(), new Date().toISOString()).run();
  const response = json({ user: publicUser(user) }, status);
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${new URL(request.url).protocol === "https:" ? " Secure;" : ""} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  return response;
}

async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.PORTAL_DB.prepare("SELECT u.id,u.email,u.name,u.role,u.active,s.expires_at FROM portal_sessions s JOIN portal_users u ON u.id=s.user_id WHERE s.token_hash=?")
    .bind(await sha256(token)).first();
  if (!row || !row.active || new Date(row.expires_at) <= new Date()) return null;
  return publicUser(row);
}

async function requireUser(request, env) { return currentUser(request, env); }
function publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role }; }

async function snapshot(env, user) {
  const [clients, stages, cases, documents, users] = await Promise.all([
    env.PORTAL_DB.prepare("SELECT * FROM portal_clients ORDER BY updated_at DESC").all(),
    env.PORTAL_DB.prepare("SELECT * FROM portal_stages WHERE active=1 ORDER BY position").all(),
    env.PORTAL_DB.prepare("SELECT c.*,cl.full_name AS client_name,s.name AS stage_name FROM portal_cases c JOIN portal_clients cl ON cl.id=c.client_id JOIN portal_stages s ON s.id=c.stage_id ORDER BY c.updated_at DESC").all(),
    env.PORTAL_DB.prepare("SELECT d.*,cl.full_name AS client_name,COALESCE(c.title,'Sin caso asociado') AS case_title FROM portal_documents d JOIN portal_clients cl ON cl.id=d.client_id LEFT JOIN portal_cases c ON c.id=d.case_id ORDER BY d.updated_at DESC").all(),
    user.role === "admin" ? env.PORTAL_DB.prepare("SELECT id,email,name,role,active,created_at FROM portal_users ORDER BY name").all() : Promise.resolve({ results: [] }),
  ]);
  return json({ user, clients: clients.results, stages: stages.results, cases: cases.results, documents: documents.results, users: users.results });
}

async function actions(request, env, user) {
  const body = await readJson(request);
  const now = new Date().toISOString();
  if (body.action === "client.create") {
    if (!clean(body.fullName, 140)) return json({ error: "Escribe el nombre del cliente." }, 400);
    const id = crypto.randomUUID();
    await env.PORTAL_DB.prepare("INSERT INTO portal_clients (id,full_name,identification,email,phone,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, clean(body.fullName, 140), clean(body.identification, 40), normalizeOptionalEmail(body.email), clean(body.phone, 40), clean(body.notes, 2000), now, now).run();
    return json({ ok: true, id }, 201);
  }
  if (body.action === "case.create") {
    const client = await env.PORTAL_DB.prepare("SELECT id FROM portal_clients WHERE id=?").bind(body.clientId).first();
    const stage = await env.PORTAL_DB.prepare("SELECT id FROM portal_stages WHERE id=? AND active=1").bind(body.stageId).first();
    if (!client || !stage || !clean(body.title, 180)) return json({ error: "Completa cliente, etapa y nombre del caso." }, 400);
    const id = crypto.randomUUID();
    await env.PORTAL_DB.prepare("INSERT INTO portal_cases (id,client_id,stage_id,title,reference,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, body.clientId, body.stageId, clean(body.title, 180), clean(body.reference, 100), clean(body.description, 2000), now, now).run();
    return json({ ok: true, id }, 201);
  }
  if (body.action === "case.move") {
    await env.PORTAL_DB.prepare("UPDATE portal_cases SET stage_id=?,updated_at=? WHERE id=?").bind(body.stageId, now, body.caseId).run();
    return json({ ok: true });
  }
  if (body.action === "stage.create") {
    if (!clean(body.name, 80)) return json({ error: "Escribe el nombre de la etapa." }, 400);
    const position = await env.PORTAL_DB.prepare("SELECT COALESCE(MAX(position),0)+1 AS next FROM portal_stages").first();
    await env.PORTAL_DB.prepare("INSERT INTO portal_stages (id,name,color,position,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
      .bind(crypto.randomUUID(), clean(body.name, 80), safeColor(body.color), position.next, now, now).run();
    return json({ ok: true }, 201);
  }
  if (body.action === "stage.update") {
    await env.PORTAL_DB.prepare("UPDATE portal_stages SET name=?,color=?,updated_at=? WHERE id=?")
      .bind(clean(body.name, 80), safeColor(body.color), now, body.stageId).run();
    return json({ ok: true });
  }
  if (body.action === "user.create") {
    if (user.role !== "admin") return json({ error: "Solo un administrador puede crear usuarios." }, 403);
    const error = validateAccount(body); if (error) return json({ error }, 400);
    const salt = randomToken(18); const id = crypto.randomUUID();
    await env.PORTAL_DB.prepare("INSERT INTO portal_users (id,email,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)")
      .bind(id, normalizeEmail(body.email), clean(body.name, 120), body.role === "admin" ? "admin" : "staff", await hashPassword(body.password, salt), salt, now, now).run();
    return json({ ok: true, id }, 201);
  }
  if (body.action === "document.create") return createDocument(env, user, body);
  return json({ error: "Acción desconocida." }, 400);
}

async function createDocument(env, user, body) {
  let record;
  let caseId = clean(body.caseId, 80) || null;
  if (caseId) {
    record = await env.PORTAL_DB.prepare("SELECT c.id AS case_id,c.title,c.reference,cl.id AS client_id,cl.full_name,cl.identification,cl.email FROM portal_cases c JOIN portal_clients cl ON cl.id=c.client_id WHERE c.id=?")
      .bind(caseId).first();
    if (!record) return json({ error: "No se encontró el caso seleccionado." }, 404);
  } else {
    record = await env.PORTAL_DB.prepare("SELECT id AS client_id,full_name,identification,email,NULL AS case_id,NULL AS title,NULL AS reference FROM portal_clients WHERE id=?")
      .bind(body.clientId).first();
    if (!record) return json({ error: "Selecciona un cliente para generar el documento." }, 400);
  }
  const id = crypto.randomUUID(); const token = randomToken(32); const now = new Date();
  const pdf = await buildInstructionPdf(record);
  const unsignedKey = `documents/${id}/original.pdf`;
  await putFile(env, unsignedKey, pdf, "application/pdf");
  await env.PORTAL_DB.prepare("INSERT INTO portal_documents (id,case_id,client_id,title,status,unsigned_key,signing_token_hash,expires_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, record.case_id, record.client_id, "Instrucciones para otorgar poder — Ley 2213 de 2022", "pending", unsignedKey, await sha256(token), new Date(now.getTime() + SIGNING_DAYS * 86400000).toISOString(), user.id, now.toISOString(), now.toISOString()).run();
  await audit(env, id, user.id, "document.created", "Documento generado");
  const base = String(env.PUBLIC_ORIGIN || new URL(body.origin || "https://ugabogados.com").origin).replace(/\/$/, "");
  return json({ ok: true, id, signingUrl: `${base}/firmar/${token}` }, 201);
}

async function internalDocument(env, id) {
  const row = await env.PORTAL_DB.prepare("SELECT signed_key,unsigned_key,title FROM portal_documents WHERE id=?").bind(id).first();
  if (!row) return json({ error: "Documento no encontrado." }, 404);
  return storedFile(env, row.signed_key || row.unsigned_key, `${safeFilename(row.title)}.pdf`);
}

async function signingApi(request, env, token, suffix) {
  const tokenHash = await sha256(token);
  const doc = await env.PORTAL_DB.prepare("SELECT d.*,cl.full_name,cl.identification,cl.email,COALESCE(c.title,'Sin caso asociado') AS case_title FROM portal_documents d JOIN portal_clients cl ON cl.id=d.client_id LEFT JOIN portal_cases c ON c.id=d.case_id WHERE d.signing_token_hash=?").bind(tokenHash).first();
  if (!doc || new Date(doc.expires_at) <= new Date()) return json({ error: "Este enlace no está disponible o venció." }, 404);
  if (suffix === "file" && request.method === "GET") return storedFile(env, doc.signed_key || doc.unsigned_key, "documento-firmado.pdf");
  if (suffix === "email" && request.method === "GET") {
    if (!doc.signed_key) return json({ error: "El documento aún no ha sido firmado." }, 409);
    const object = await getFile(env, doc.signed_key); const bytes = new Uint8Array(object.data);
    const eml = buildEmailDraft(doc, bytes);
    return new Response(eml, { headers: { "content-type": "message/rfc822", "content-disposition": "attachment; filename=correo-poder-ley-2213.eml", "cache-control": "no-store" } });
  }
  if (request.method === "GET") return json({ title: doc.title, clientName: doc.full_name, identification: doc.identification || "", email: doc.email || "", status: doc.status, expiresAt: doc.expires_at });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (doc.status === "signed") return json({ ok: true, alreadySigned: true });
  const body = await readJson(request);
  if (!body.consent || !clean(body.signerName, 140) || !clean(body.signerIdentification, 40) || !/^data:image\/png;base64,/.test(body.signature || "")) {
    return json({ error: "Completa tus datos, firma y aceptación." }, 400);
  }
  if (body.signature.length > 1500000) return json({ error: "La firma es demasiado grande." }, 413);
  const original = await getFile(env, doc.unsigned_key); const originalBytes = original.data;
  const signedAt = new Date().toISOString();
  const signedPdf = await addSignature(new Uint8Array(originalBytes), body.signature, { name: clean(body.signerName, 140), identification: clean(body.signerIdentification, 40), email: normalizeOptionalEmail(body.signerEmail), signedAt });
  const signedKey = `documents/${doc.id}/signed.pdf`; const pdfHash = await sha256Bytes(signedPdf);
  await putFile(env, signedKey, signedPdf, "application/pdf", { sha256: pdfHash });
  await env.PORTAL_DB.prepare("UPDATE portal_documents SET status='signed',signed_key=?,signer_name=?,signer_identification=?,signer_email=?,signed_at=?,pdf_hash=?,updated_at=? WHERE id=?")
    .bind(signedKey, clean(body.signerName, 140), clean(body.signerIdentification, 40), normalizeOptionalEmail(body.signerEmail), signedAt, pdfHash, signedAt, doc.id).run();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  await audit(env, doc.id, null, "document.signed", `Firmado por ${clean(body.signerName, 140)}`, await sha256(`${env.AUDIT_SALT || "ug"}:${ip}`));
  return json({ ok: true, signedAt });
}

async function buildInstructionPdf(record) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(1 / 255, 27 / 255, 54 / 255); const gold = rgb(237 / 255, 199 / 255, 115 / 255);
  page.drawRectangle({ x: 0, y: 775, width: 595.28, height: 67, color: navy });
  page.drawText("UMBARILA GUTIÉRREZ & ASOCIADOS", { x: 42, y: 805, size: 15, font: bold, color: gold });
  let y = 742;
  y = drawWrapped(page, "INSTRUCCIONES PARA OTORGAR PODER", 42, y, 511, 17, bold, navy, 23);
  y = drawWrapped(page, `Cliente: ${record.full_name}${record.identification ? ` · C.C. ${record.identification}` : ""}`, 42, y - 5, 511, 10, regular, rgb(.2,.2,.2), 15);
  const paragraphs = [
    "Todos los documentos deben ir firmados. No se requiere autenticación en notaría, de conformidad con la Ley 2213 de 2022.",
    "Para otorgar poder, envía desde tu correo personal todos los documentos firmados y una copia de tu cédula de ciudadanía a umbarilagutierrez.asoc@gmail.com.",
    "ASUNTO: PODER ESPECIAL - LEY 2213 DE 2022.",
    "En el cuerpo del correo indica: En cumplimiento de lo dispuesto en la Ley 2213 del 13 de junio de 2022, y de conformidad con lo establecido en su artículo 5.º, por medio del presente escrito confiero poder especial, amplio y suficiente a los abogados relacionados en el documento adjunto, para que, en mi nombre y representación, promuevan, adelanten y lleven hasta su culminación el medio de control de nulidad y restablecimiento del derecho en contra de la Subred Integrada de Servicios de Salud Sur Occidente E.S.E., con las facultades inherentes al ejercicio del presente mandato.",
    "DOCUMENTOS: 1. Contrato de Prestación de Servicios. 2. Poder. 3. Política de Tratamiento de Datos. 4. Copia de la cédula de ciudadanía.",
    "Si necesitas ayuda para remitir el correo o adjuntar los documentos, comunícate con nosotros para guiarte en el proceso.",
    "Recuerda: cada proceso es único y aquí estamos para ayudarte.",
  ];
  for (const paragraph of paragraphs) y = drawWrapped(page, paragraph, 42, y - 13, 511, 10.5, paragraph.startsWith("ASUNTO") || paragraph.startsWith("DOCUMENTOS") ? bold : regular, rgb(.17,.17,.17), 15);
  page.drawText("Documento preparado para firma electrónica", { x: 42, y: 32, size: 8, font: regular, color: rgb(.4,.4,.4) });
  return pdf.save();
}

async function addSignature(original, signatureDataUrl, signer) {
  const pdf = await PDFDocument.load(original); const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("CONSTANCIA DE FIRMA", { x: 42, y: 780, size: 18, font: bold, color: rgb(1/255,27/255,54/255) });
  drawWrapped(page, "La persona identificada a continuación manifiesta su aceptación y firma el documento mediante el enlace individual suministrado por la firma.", 42, 744, 511, 11, regular, rgb(.2,.2,.2), 16);
  const pngBytes = Uint8Array.from(atob(signatureDataUrl.split(",")[1]), c => c.charCodeAt(0));
  const signature = await pdf.embedPng(pngBytes); const scaled = signature.scaleToFit(450, 230);
  page.drawRectangle({ x: 42, y: 400, width: 511, height: 270, borderColor: rgb(.75,.75,.75), borderWidth: 1 });
  page.drawImage(signature, { x: 42 + (511 - scaled.width) / 2, y: 420 + (230 - scaled.height) / 2, width: scaled.width, height: scaled.height });
  page.drawText(`Nombre: ${signer.name}`, { x: 42, y: 355, size: 11, font: bold });
  page.drawText(`Identificación: ${signer.identification}`, { x: 42, y: 332, size: 11, font: regular });
  page.drawText(`Correo: ${signer.email || "No indicado"}`, { x: 42, y: 309, size: 11, font: regular });
  page.drawText(`Fecha UTC: ${signer.signedAt}`, { x: 42, y: 286, size: 10, font: regular });
  return pdf.save();
}

function drawWrapped(page, text, x, y, width, size, font, color, lineHeight) {
  const words = text.split(/\s+/); let line = ""; const lines = [];
  for (const word of words) { const test = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(test, size) > width && line) { lines.push(line); line = word; } else line = test; }
  if (line) lines.push(line);
  for (const value of lines) { page.drawText(value, { x, y, size, font, color }); y -= lineHeight; }
  return y;
}

function buildEmailDraft(doc, pdfBytes) {
  const boundary = `ug-${crypto.randomUUID()}`; const subject = "PODER ESPECIAL - LEY 2213 DE 2022";
  const body = "En cumplimiento de lo dispuesto en la Ley 2213 del 13 de junio de 2022, y de conformidad con lo establecido en su artículo 5.º, por medio del presente escrito confiero poder especial, amplio y suficiente a los abogados relacionados en el documento adjunto, para que, en mi nombre y representación, promuevan, adelanten y lleven hasta su culminación el medio de control de nulidad y restablecimiento del derecho en contra de la Subred Integrada de Servicios de Salud Sur Occidente E.S.E., con las facultades inherentes al ejercicio del presente mandato.";
  const base64 = bytesToBase64(pdfBytes).replace(/(.{76})/g, "$1\r\n");
  return [`To: umbarilagutierrez.asoc@gmail.com`, `Subject: ${subject}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary=\"${boundary}\"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body, "", `--${boundary}`, "Content-Type: application/pdf; name=\"documento-firmado.pdf\"", "Content-Transfer-Encoding: base64", "Content-Disposition: attachment; filename=\"documento-firmado.pdf\"", "", base64, `--${boundary}--`, ""].join("\r\n");
}

async function putFile(env, key, bytes, contentType, metadata = null) {
  const data = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  await env.PORTAL_DB.prepare("INSERT OR REPLACE INTO portal_files (key,data,content_type,metadata,created_at) VALUES (?,?,?,?,?)")
    .bind(key, data, contentType, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()).run();
}

async function getFile(env, key) {
  if (!key) return null;
  return env.PORTAL_DB.prepare("SELECT data,content_type,metadata FROM portal_files WHERE key=?").bind(key).first();
}

async function storedFile(env, key, filename) {
  if (!key) return json({ error: "Archivo no disponible." }, 404);
  const object = await getFile(env, key); if (!object) return json({ error: "Archivo no encontrado." }, 404);
  return new Response(new Uint8Array(object.data), { headers: { "content-type": object.content_type, "content-disposition": `attachment; filename=\"${filename}\"`, "cache-control": "no-store" } });
}

async function audit(env, documentId, userId, event, detail, ipHash = null) {
  await env.PORTAL_DB.prepare("INSERT INTO portal_audit (id,document_id,actor_user_id,event,detail,ip_hash,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), documentId, userId, event, detail, ipHash, new Date().toISOString()).run();
}

function validateAccount(body) {
  if (!clean(body.name, 120)) return "Escribe el nombre del usuario.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(body.email))) return "Escribe un correo válido.";
  if (String(body.password || "").length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  return null;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}
async function verifyPassword(password, salt, expected) { return constantTime(await hashPassword(password, salt), expected); }
function constantTime(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
async function sha256(value) { return sha256Bytes(encoder.encode(value)); }
async function sha256Bytes(value) { const digest = await crypto.subtle.digest("SHA-256", value); return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join(""); }
function randomToken(bytes) { const values = crypto.getRandomValues(new Uint8Array(bytes)); return bytesToBase64(values).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function bytesToBase64(bytes) { let out=""; for (let i=0;i<bytes.length;i+=8192) out += String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(out); }
function cookieValue(request, name) { const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`)); return match ? match[1] : null; }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeOptionalEmail(value) { const email=normalizeEmail(value); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""; }
function clean(value, max) { return String(value || "").trim().slice(0,max); }
function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#edc773"; }
function safeFilename(value) { return String(value || "documento").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase(); }
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function json(data, status=200) { return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
