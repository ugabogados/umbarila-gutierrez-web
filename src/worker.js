import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DEFAULT_TEMPLATES } from "./templates.js";

const SESSION_COOKIE = "ug_portal_session";
const SESSION_DAYS = 14;
const SIGNING_DAYS = 30;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/portal") return Response.redirect(`${url.origin}/portal/`, 308);
      if (url.pathname.startsWith("/firmar/") || url.pathname.startsWith("/f/")) {
        return env.ASSETS.fetch(new Request(`${url.origin}/portal/firma`, request));
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
  if (url.pathname === "/api/portal/preview" && request.method === "POST") return previewDocument(request, env);
  if (url.pathname === "/api/portal/actions" && request.method === "POST") return actions(request, env, user);

  const backgroundMatch = url.pathname.match(/^\/api\/portal\/templates\/([^/]+)\/background$/);
  if (backgroundMatch && request.method === "GET") return templateBackground(env, backgroundMatch[1]);

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
  await ensureTemplates(env);
  await env.PORTAL_DB.prepare("UPDATE portal_documents SET status='expired',updated_at=? WHERE status='pending' AND deleted_at IS NULL AND expires_at<=?")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
  const [clients, stages, cases, documents, users, templates, documentLinks] = await Promise.all([
    env.PORTAL_DB.prepare("SELECT * FROM portal_clients ORDER BY updated_at DESC").all(),
    env.PORTAL_DB.prepare("SELECT * FROM portal_stages WHERE active=1 ORDER BY position").all(),
    env.PORTAL_DB.prepare("SELECT c.*,cl.full_name AS client_name,s.name AS stage_name FROM portal_cases c JOIN portal_clients cl ON cl.id=c.client_id JOIN portal_stages s ON s.id=c.stage_id ORDER BY c.updated_at DESC").all(),
    env.PORTAL_DB.prepare("SELECT d.*,cl.full_name AS client_name,COALESCE(c.title,'Sin caso asociado') AS case_title FROM portal_documents d JOIN portal_clients cl ON cl.id=d.client_id LEFT JOIN portal_cases c ON c.id=d.case_id WHERE d.deleted_at IS NULL ORDER BY d.updated_at DESC").all(),
    user.role === "admin" ? env.PORTAL_DB.prepare("SELECT id,email,name,role,active,created_at FROM portal_users ORDER BY name").all() : Promise.resolve({ results: [] }),
    env.PORTAL_DB.prepare("SELECT id,name,description,content,background_key,active,updated_at FROM portal_templates WHERE active=1 ORDER BY name").all(),
    env.PORTAL_DB.prepare("SELECT l.id,l.document_id,l.token,l.expires_at,l.created_at,l.revoked_at,l.used_at FROM portal_document_links l JOIN portal_documents d ON d.id=l.document_id WHERE d.deleted_at IS NULL ORDER BY l.created_at DESC").all(),
  ]);
  return json({ user, clients: clients.results, stages: stages.results, cases: cases.results, documents: documents.results, documentLinks: documentLinks.results, users: users.results, templates: templates.results });
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
  if (body.action === "template.update") {
    const name = clean(body.name, 160); const content = String(body.content || "").trim();
    if (!name || !content) return json({ error: "La plantilla necesita un nombre y contenido válido." }, 400);
    const result = await env.PORTAL_DB.prepare("UPDATE portal_templates SET name=?,description=?,content=?,updated_at=?,updated_by=? WHERE id=? AND active=1")
      .bind(name, clean(body.description, 500), content.slice(0, 100000), now, user.id, body.templateId).run();
    if (!result.meta.changes) return json({ error: "No se encontró la plantilla." }, 404);
    await audit(env, null, user.id, "template.updated", `Plantilla actualizada: ${name}`);
    return json({ ok: true });
  }
  if (body.action === "template.create") {
    const name = clean(body.name, 160); const content = String(body.content || "").trim();
    if (!name || !content) return json({ error: "La plantilla necesita un nombre y contenido válido." }, 400);
    const id = crypto.randomUUID();
    await env.PORTAL_DB.prepare("INSERT INTO portal_templates (id,name,description,content,active,created_at,updated_at,updated_by) VALUES (?,?,?,?,1,?,?,?)")
      .bind(id, name, clean(body.description, 500), content.slice(0, 100000), now, now, user.id).run();
    await audit(env, null, user.id, "template.created", `Plantilla creada: ${name}`);
    return json({ ok: true, id }, 201);
  }
  if (body.action === "template.background.update") {
    const template = await env.PORTAL_DB.prepare("SELECT id FROM portal_templates WHERE id=? AND active=1").bind(body.templateId).first();
    if (!template) return json({ error: "No se encontró la plantilla." }, 404);
    const contentType = String(body.contentType || "").toLowerCase();
    if (!['image/png','image/jpeg'].includes(contentType)) return json({ error: "El fondo debe ser una imagen PNG o JPG." }, 400);
    let bytes;
    try { bytes = base64ToBytes(String(body.data || "")); } catch { return json({ error: "No fue posible leer la imagen." }, 400); }
    if (!bytes.length || bytes.length > 3500000) return json({ error: "La imagen debe pesar menos de 3,5 MB." }, 413);
    const validPng = contentType === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const validJpeg = contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!validPng && !validJpeg) return json({ error: "La imagen seleccionada no es válida." }, 400);
    const key = `template-backgrounds/${template.id}/${crypto.randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
    await putFile(env, key, bytes, contentType);
    await env.PORTAL_DB.prepare("UPDATE portal_templates SET background_key=?,updated_at=?,updated_by=? WHERE id=?").bind(key, now, user.id, template.id).run();
    await audit(env, null, user.id, "template.background.updated", `Fondo actualizado: ${template.id}`);
    return json({ ok: true });
  }
  if (body.action === "template.background.remove") {
    const result = await env.PORTAL_DB.prepare("UPDATE portal_templates SET background_key=NULL,updated_at=?,updated_by=? WHERE id=? AND active=1").bind(now, user.id, body.templateId).run();
    if (!result.meta.changes) return json({ error: "No se encontró la plantilla." }, 404);
    await audit(env, null, user.id, "template.background.removed", `Fondo institucional restaurado: ${body.templateId}`);
    return json({ ok: true });
  }
  if (body.action === "document.link.regenerate") {
    const document = await env.PORTAL_DB.prepare("SELECT id,status FROM portal_documents WHERE id=? AND deleted_at IS NULL").bind(body.documentId).first();
    if (!document) return json({ error: "No se encontró el documento." }, 404);
    const token = randomToken(9); const expiresAt = new Date(Date.now() + SIGNING_DAYS * 86400000).toISOString();
    await env.PORTAL_DB.prepare("UPDATE portal_document_links SET revoked_at=? WHERE document_id=? AND revoked_at IS NULL")
      .bind(now, document.id).run();
    await env.PORTAL_DB.prepare("UPDATE portal_documents SET signing_token=?,signing_token_hash=?,expires_at=?,status=CASE WHEN status='expired' THEN 'pending' ELSE status END,updated_at=? WHERE id=?")
      .bind(token, await sha256(token), expiresAt, now, document.id).run();
    await env.PORTAL_DB.prepare("INSERT INTO portal_document_links (id,document_id,token,token_hash,expires_at,created_at,created_by) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), document.id, token, await sha256(token), expiresAt, now, user.id).run();
    await audit(env, document.id, user.id, "document.link.regenerated", "Enlace de firma regenerado");
    const base = String(env.PUBLIC_ORIGIN || "https://ugabogados.com").replace(/\/$/, "");
    return json({ ok: true, signingUrl: `${base}/f/${token}` });
  }
  if (body.action === "document.delete") {
    const document = await env.PORTAL_DB.prepare("SELECT id,title FROM portal_documents WHERE id=? AND deleted_at IS NULL").bind(body.documentId).first();
    if (!document) return json({ error: "No se encontró el documento." }, 404);
    await audit(env, document.id, user.id, "document.deleted", `Documento eliminado: ${document.title}`);
    await env.PORTAL_DB.prepare("UPDATE portal_document_links SET revoked_at=? WHERE document_id=? AND revoked_at IS NULL").bind(now, document.id).run();
    await env.PORTAL_DB.prepare("UPDATE portal_documents SET deleted_at=?,deleted_by=?,updated_at=? WHERE id=?").bind(now, user.id, now, document.id).run();
    return json({ ok: true });
  }
  if (body.action === "document.create") return createDocument(env, user, body);
  return json({ error: "Acción desconocida." }, 400);
}

async function createDocument(env, user, body) {
  await ensureTemplates(env);
  const context = await documentContext(env, body);
  if (context.error) return json({ error: context.error }, context.status);
  const { record, template } = context;
  const variables = sanitizeVariables(body.variables);
  const id = crypto.randomUUID(); const token = randomToken(9); const now = new Date();
  const renderedContent = renderTemplate(template.content, record, variables);
  const pdf = await buildTemplatePdf(env, template.name, renderedContent, template.background_key);
  const unsignedKey = `documents/${id}/original.pdf`;
  await putFile(env, unsignedKey, pdf, "application/pdf");
  await env.PORTAL_DB.prepare("INSERT INTO portal_documents (id,case_id,client_id,title,status,unsigned_key,signing_token_hash,expires_at,created_by,created_at,updated_at,template_id,template_name,content_snapshot,signing_token,custom_title,custom_reference,custom_description,email_to,email_subject,email_body,variables_snapshot,background_key_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, record.case_id, record.client_id, template.name, "pending", unsignedKey, await sha256(token), new Date(now.getTime() + SIGNING_DAYS * 86400000).toISOString(), user.id, now.toISOString(), now.toISOString(), template.id, template.name, renderedContent, token, clean(body.customTitle, 500), clean(body.customReference, 500), clean(body.customDescription, 5000), normalizeOptionalEmail(body.emailTo), cleanHeader(body.emailSubject, 200), clean(body.emailBody, 5000), JSON.stringify(variables), template.background_key || null).run();
  await env.PORTAL_DB.prepare("INSERT INTO portal_document_links (id,document_id,token,token_hash,expires_at,created_at,created_by) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), id, token, await sha256(token), new Date(now.getTime() + SIGNING_DAYS * 86400000).toISOString(), now.toISOString(), user.id).run();
  await audit(env, id, user.id, "document.created", "Documento generado");
  const base = String(env.PUBLIC_ORIGIN || new URL(body.origin || "https://ugabogados.com").origin).replace(/\/$/, "");
  return json({ ok: true, id, signingUrl: `${base}/f/${token}` }, 201);
}

async function previewDocument(request, env) {
  await ensureTemplates(env);
  const body = await readJson(request);
  const context = await documentContext(env, body, true);
  if (context.error) return json({ error: context.error }, context.status);
  const content = body.content ? String(body.content).slice(0, 100000) : context.template.content;
  const name = clean(body.name, 160) || context.template.name;
  const pdf = await buildTemplatePdf(env, name, renderTemplate(content, context.record, sanitizeVariables(body.variables)), context.template.background_key);
  return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=\"${safeFilename(name)}.pdf\"`, "cache-control": "no-store" } });
}

async function documentContext(env, body, allowSample = false) {
  const template = await env.PORTAL_DB.prepare("SELECT id,name,description,content,background_key FROM portal_templates WHERE id=? AND active=1").bind(body.templateId).first();
  if (!template) return { error: "Selecciona una plantilla.", status: 400 };
  const caseId = clean(body.caseId, 80) || null;
  let record;
  if (caseId) {
    record = await env.PORTAL_DB.prepare("SELECT c.id AS case_id,c.title,c.reference,c.description,cl.id AS client_id,cl.full_name,cl.identification,cl.email,cl.phone FROM portal_cases c JOIN portal_clients cl ON cl.id=c.client_id WHERE c.id=?").bind(caseId).first();
    if (!record) return { error: "No se encontró el caso seleccionado.", status: 404 };
  } else if (body.clientId) {
    record = await env.PORTAL_DB.prepare("SELECT id AS client_id,full_name,identification,email,phone,NULL AS case_id,NULL AS title,NULL AS reference,NULL AS description FROM portal_clients WHERE id=?").bind(body.clientId).first();
    if (!record) return { error: "Selecciona un cliente.", status: 400 };
  } else if (allowSample) {
    record = { client_id: null, full_name: "NOMBRE DEL CLIENTE", identification: "NÚMERO DE IDENTIFICACIÓN", email: "correo@ejemplo.com", phone: "300 000 0000", case_id: null, title: "ASUNTO JURÍDICO", reference: "REFERENCIA DEL PROCESO", description: "DESCRIPCIÓN DEL OBJETO O ACTUACIÓN JURÍDICA" };
  } else return { error: "Selecciona un cliente para generar el documento.", status: 400 };
  record.title = clean(body.customTitle, 500) || record.title;
  record.reference = clean(body.customReference, 500) || record.reference;
  record.description = clean(body.customDescription, 5000) || record.description;
  return { record, template };
}

async function internalDocument(env, id) {
  const row = await env.PORTAL_DB.prepare("SELECT signed_key,unsigned_key,title FROM portal_documents WHERE id=? AND deleted_at IS NULL").bind(id).first();
  if (!row) return json({ error: "Documento no encontrado." }, 404);
  return storedFile(env, row.signed_key || row.unsigned_key, `${safeFilename(row.title)}.pdf`, "inline");
}

async function templateBackground(env, id) {
  const template = await env.PORTAL_DB.prepare("SELECT background_key FROM portal_templates WHERE id=? AND active=1").bind(id).first();
  if (!template?.background_key) return json({ error: "Esta plantilla utiliza el fondo institucional." }, 404);
  return storedFile(env, template.background_key, "fondo-plantilla", "inline");
}

async function signingApi(request, env, token, suffix) {
  const tokenHash = await sha256(token);
  const doc = await env.PORTAL_DB.prepare("SELECT d.*,l.id AS link_id,l.expires_at AS link_expires_at,cl.full_name,cl.identification,cl.email,COALESCE(c.title,'Sin caso asociado') AS case_title FROM portal_document_links l JOIN portal_documents d ON d.id=l.document_id JOIN portal_clients cl ON cl.id=d.client_id LEFT JOIN portal_cases c ON c.id=d.case_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND d.deleted_at IS NULL").bind(tokenHash).first();
  if (!doc || new Date(doc.link_expires_at) <= new Date()) return json({ error: "Este enlace no está disponible o venció." }, 404);
  if (suffix === "file" && request.method === "GET") return storedFile(env, doc.signed_key || doc.unsigned_key, "documento-firmado.pdf", "inline");
  if (suffix === "email" && request.method === "GET") {
    if (!doc.signed_key) return json({ error: "El documento aún no ha sido firmado." }, 409);
    const object = await getFile(env, doc.signed_key); const bytes = new Uint8Array(object.data);
    const eml = buildEmailDraft(doc, bytes);
    return new Response(eml, { headers: { "content-type": "message/rfc822", "content-disposition": "attachment; filename=correo-poder-ley-2213.eml", "cache-control": "no-store" } });
  }
  if (request.method === "GET") {
    const email = emailDraftData(doc);
    return json({ title: doc.title, clientName: doc.full_name, identification: doc.identification || "", email: doc.email || "", status: doc.status, expiresAt: doc.expires_at, emailTo: email.to, emailSubject: email.subject, emailBody: email.body });
  }
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (doc.status === "signed") return json({ ok: true, alreadySigned: true });
  const body = await readJson(request);
  if (!body.consent || !clean(body.signerName, 140) || !clean(body.signerIdentification, 40) || !/^data:image\/png;base64,/.test(body.signature || "")) {
    return json({ error: "Completa tus datos, firma y aceptación." }, 400);
  }
  if (body.signature.length > 1500000) return json({ error: "La firma es demasiado grande." }, 413);
  const original = await getFile(env, doc.unsigned_key); let originalBytes = new Uint8Array(original.data);
  try {
    const existingPdf = await PDFDocument.load(originalBytes); const hasLayoutMarker = /^UG_(?:CONTENT_BOTTOM|LAYOUT):/.test(existingPdf.getSubject() || "");
    if (!hasLayoutMarker && doc.content_snapshot) originalBytes = await buildTemplatePdf(env, doc.template_name || doc.title, doc.content_snapshot, doc.background_key_snapshot);
  } catch {}
  const signedAt = new Date().toISOString();
  const signerLocation = signingLocation(request);
  const signedPdf = await addSignature(env, new Uint8Array(originalBytes), body.signature, { name: clean(body.signerName, 140), identification: clean(body.signerIdentification, 40), email: normalizeOptionalEmail(body.signerEmail), signedAt }, doc.background_key_snapshot);
  const signedKey = `documents/${doc.id}/signed.pdf`; const pdfHash = await sha256Bytes(signedPdf);
  await putFile(env, signedKey, signedPdf, "application/pdf", { sha256: pdfHash });
  await env.PORTAL_DB.prepare("UPDATE portal_documents SET status='signed',signed_key=?,signer_name=?,signer_identification=?,signer_email=?,signed_at=?,signer_location=?,pdf_hash=?,updated_at=? WHERE id=?")
    .bind(signedKey, clean(body.signerName, 140), clean(body.signerIdentification, 40), normalizeOptionalEmail(body.signerEmail), signedAt, signerLocation, pdfHash, signedAt, doc.id).run();
  await env.PORTAL_DB.prepare("UPDATE portal_document_links SET used_at=? WHERE id=?").bind(signedAt, doc.link_id).run();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  await audit(env, doc.id, null, "document.signed", `Firmado por ${clean(body.signerName, 140)}`, await sha256(`${env.AUDIT_SALT || "ug"}:${ip}`));
  return json({ ok: true, signedAt });
}

function signingLocation(request) {
  const cf = request.cf || {};
  const location = {
    city: clean(cf.city, 120),
    region: clean(cf.region, 120),
    regionCode: clean(cf.regionCode, 20),
    country: clean(cf.country, 20),
    postalCode: clean(cf.postalCode, 30),
    timezone: clean(cf.timezone, 80),
    latitude: clean(cf.latitude, 30),
    longitude: clean(cf.longitude, 30),
  };
  return Object.values(location).some(Boolean) ? JSON.stringify(location) : null;
}

async function buildTemplatePdf(env, title, content, backgroundKey = null) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const timesBoldItalic = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  const courier = await pdf.embedFont(StandardFonts.Courier);
  const courierBold = await pdf.embedFont(StandardFonts.CourierBold);
  const courierItalic = await pdf.embedFont(StandardFonts.CourierOblique);
  const courierBoldItalic = await pdf.embedFont(StandardFonts.CourierBoldOblique);
  const navy = rgb(2 / 255, 46 / 255, 104 / 255);
  const ink = rgb(.12, .14, .17);
  const compact = /poder/i.test(title);
  let logo = null;
  let background = null;
  try {
    const response = await env.ASSETS.fetch(new Request("https://assets.local/assets/images/simbolo-azul.png"));
    if (response.ok) logo = await pdf.embedPng(await response.arrayBuffer());
  } catch {}
  if (backgroundKey) {
    try {
      const object = await getFile(env, backgroundKey); const bytes = new Uint8Array(object.data);
      background = object.content_type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch { background = null; }
  }

  let page; let y;
  const addPage = () => {
    page = pdf.addPage([612, 792]);
    if (background) page.drawImage(background, { x:0, y:0, width:612, height:792 });
    else if (logo) {
      const size = logo.scaleToFit(74, 58);
      page.drawImage(logo, { x: (612 - size.width) / 2, y: 716, width: size.width, height: size.height });
    }
    if (!background) drawInstitutionalBase(page, regular, navy);
    y = 668;
  };
  addPage();

  if (looksLikeRichText(content)) {
    const blocks = parseRichText(content);
    let signaturePlacement = null;
    const fontFor = (run, forceBold = false) => {
      const strong = forceBold || run.bold;
      const family = /courier/i.test(run.family || "")
        ? { regular:courier, bold:courierBold, italic:courierItalic, boldItalic:courierBoldItalic }
        : /(times|georgia)/i.test(run.family || "")
          ? { regular:times, bold:timesBold, italic:timesItalic, boldItalic:timesBoldItalic }
          : { regular, bold, italic, boldItalic };
      return strong && run.italic ? family.boldItalic : strong ? family.bold : run.italic ? family.italic : family.regular;
    };
    for (const block of blocks) {
      if (block.tag === "signature") {
        if (y - 105 < 76) addPage();
        signaturePlacement = { pageIndex:pdf.getPageCount() - 1, top:y };
        page.drawRectangle({ x:80, y:y - 82, width:190, height:72, borderColor:rgb(.62,.68,.73), borderWidth:.8, color:rgb(.97,.98,.99) });
        page.drawText("ESPACIO PARA FIRMA", { x:117, y:y - 49, size:8.5, font:bold, color:rgb(.42,.46,.5) });
        page.drawLine({ start:{ x:98, y:y - 68 }, end:{ x:252, y:y - 68 }, thickness:.6, color:rgb(.62,.68,.73) });
        y -= 105;
        continue;
      }
      const heading = /^h[1-3]$/.test(block.tag);
      const size = block.tag === "h1" ? 15 : block.tag === "h2" ? 13 : block.tag === "h3" ? 11.5 : (compact ? 9.1 : 9.7);
      const lines = wrapRichRuns(block.runs, run => fontFor(run, heading), run => richFontSize(run, size), 452);
      if (!lines.length) { y -= heading ? size * 1.35 : (compact ? 11.7 : 13.5); continue; }
      for (const line of lines) {
        const lineSize = Math.max(...line.map(segment => segment.size), size);
        const lineHeight = heading ? lineSize * 1.35 : lineSize * (compact ? 1.28 : 1.4);
        if (y - lineHeight < 76) addPage();
        const lineWidth = line.reduce((total, segment) => total + segment.width, 0);
        let x = 80;
        if (block.align === "center") x += (452 - lineWidth) / 2;
        if (block.align === "right") x += 452 - lineWidth;
        for (const segment of line) {
          page.drawText(segment.text, { x, y, size:segment.size, font: segment.font, color: heading ? navy : ink });
          if (segment.underline) page.drawLine({ start:{ x, y:y - 1.5 }, end:{ x:x + segment.width, y:y - 1.5 }, thickness:.65, color:heading ? navy : ink });
          x += segment.width;
        }
        y -= lineHeight;
      }
      y -= heading ? 6 : 4;
    }
    pdf.setSubject(signaturePlacement
      ? `UG_LAYOUT:${Math.max(0, y).toFixed(2)}:${signaturePlacement.pageIndex}:${signaturePlacement.top.toFixed(2)}`
      : `UG_CONTENT_BOTTOM:${Math.max(0, y).toFixed(2)}`);
    return pdf.save();
  }

  const paragraphs = String(content || "").replace(/\r/g, "").split("\n");
  for (const raw of paragraphs) {
    const text = raw.trim();
    if (!text) { y -= compact ? 4 : 8; continue; }
    const isTitle = text === title.toUpperCase() || text === title;
    const isHeading = isTitle || /^(CLÁUSULA|PARÁGRAFO|AUTORIZACIÓN|ASUNTO:|REFERENCIA:|PODERDANTE|ACEPTA|TITULAR DE LOS DATOS|EL CONTRATANTE|LA CONTRATISTA)/i.test(text) || (/^[A-ZÁÉÍÓÚÑ0-9 .,:;()%-]+$/.test(text) && text.length < 110);
    const font = isHeading ? bold : regular;
    const size = isTitle ? 13.5 : isHeading ? (compact ? 10.1 : 10.5) : (compact ? 9.1 : 9.7);
    const lineHeight = isTitle ? 18 : (compact ? 11.7 : 13.5);
    const lines = wrapPdfText(text, font, size, 452);
    const needed = lines.length * lineHeight + (isHeading ? 6 : 4);
    if (y - needed < 76) addPage();
    for (const line of lines) {
      if (y - lineHeight < 76) addPage();
      const x = isTitle ? (612 - font.widthOfTextAtSize(line, size)) / 2 : 80;
      page.drawText(line, { x, y, size, font, color: isTitle ? navy : ink });
      y -= lineHeight;
    }
    y -= compact ? 2 : isHeading ? 5 : 4;
  }
  pdf.setSubject(`UG_CONTENT_BOTTOM:${Math.max(0, y).toFixed(2)}`);
  return pdf.save();
}

function drawInstitutionalBase(page, regular, navy) {
  const firm = "UMBARILA GUTIÉRREZ & ASOCIADOS";
  page.drawText(firm, { x: (page.getWidth() - regular.widthOfTextAtSize(firm, 11)) / 2, y: page.getHeight() - 95, size: 11, font: regular, color: navy });
  page.drawLine({ start: { x: 76, y: 55 }, end: { x: page.getWidth() - 76, y: 55 }, thickness: 1.2, color: navy });
  const email = "umbarilagutierrez.asoc@gmail.com"; const phones = "305 459 1405 - 319 453 2248";
  page.drawText(email, { x: (page.getWidth() - regular.widthOfTextAtSize(email, 9.5)) / 2, y: 39, size: 9.5, font: regular, color: navy });
  page.drawText(phones, { x: (page.getWidth() - regular.widthOfTextAtSize(phones, 9)) / 2, y: 25, size: 9, font: regular, color: navy });
}

function looksLikeRichText(content) {
  return /<(p|div|h[1-3]|ul|ol|li|strong|b|em|i|u|br)\b/i.test(String(content || ""));
}

function parseRichText(html) {
  const source = String(html || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, "");
  const tokens = source.match(/<[^>]+>|[^<]+/g) || [];
  const blocks = []; const style = { bold:0, italic:0, underline:0, families:[], sizes:[] }; const lists = [];
  let current = null; let signatureMarker = false;
  const finish = () => {
    if (!current) return;
    current.runs = current.runs.filter(run => run.text).map(run => ({ ...run, text:run.text.replace(/[ \t]+/g, " ") }));
    if (current.runs.some(run => run.text.trim())) blocks.push(current);
    current = null;
  };
  const start = (tag, rawTag = "") => {
    finish();
    const align = (/text-align\s*:\s*(left|center|right|justify)/i.exec(rawTag) || /align\s*=\s*["']?(left|center|right|justify)/i.exec(rawTag) || [])[1] || "left";
    current = { tag, align:align.toLowerCase(), runs:[] };
    if (tag === "li") {
      const list = lists[lists.length - 1];
      const prefix = list?.type === "ol" ? `${++list.count}. ` : "• ";
      current.runs.push({ text:prefix, bold:true, italic:false, underline:false });
    }
  };
  const addText = text => {
    if (text === "\n") {
      if (!current) start("p");
      current.runs.push({ text:"\n", bold:style.bold > 0, italic:style.italic > 0, underline:style.underline > 0, family:style.families.at(-1) || "", size:style.sizes.at(-1) || "" });
      return;
    }
    const decoded = decodeHtmlEntities(text).replace(/\r?\n/g, " ");
    if (!decoded) return;
    if (!current) start("p");
    current.runs.push({ text:decoded, bold:style.bold > 0, italic:style.italic > 0, underline:style.underline > 0, family:style.families.at(-1) || "", size:style.sizes.at(-1) || "" });
  };
  for (const token of tokens) {
    if (!token.startsWith("<")) { if (!signatureMarker) addText(token); continue; }
    const closing = /^<\s*\//.test(token); const name = (token.match(/^<\s*\/?\s*([a-z0-9]+)/i) || [])[1]?.toLowerCase();
    if (!name) continue;
    if (!closing && name === "div" && /data-signature-marker\s*=\s*["']?true/i.test(token)) { finish(); blocks.push({ tag:"signature", align:"left", runs:[] }); signatureMarker = true; continue; }
    if (signatureMarker) { if (closing && name === "div") signatureMarker = false; continue; }
    if (!closing && ["p","div","h1","h2","h3","li"].includes(name)) start(name, token);
    else if (closing && ["p","div","h1","h2","h3","li"].includes(name)) finish();
    else if (!closing && (name === "ul" || name === "ol")) { finish(); lists.push({ type:name, count:0 }); }
    else if (closing && (name === "ul" || name === "ol")) { finish(); lists.pop(); }
    else if (name === "br" && !closing) addText("\n");
    else if (["strong","b"].includes(name)) style.bold = Math.max(0, style.bold + (closing ? -1 : 1));
    else if (["em","i"].includes(name)) style.italic = Math.max(0, style.italic + (closing ? -1 : 1));
    else if (name === "u") style.underline = Math.max(0, style.underline + (closing ? -1 : 1));
    else if (name === "font") {
      if (closing) { style.families.pop(); style.sizes.pop(); }
      else {
        style.families.push((/face\s*=\s*["']?([^"'>]+)/i.exec(token) || [])[1] || "");
        style.sizes.push((/size\s*=\s*["']?([1-7])/i.exec(token) || [])[1] || "");
      }
    }
  }
  finish();
  return blocks;
}

function decodeHtmlEntities(text) {
  const named = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", "#39":"'", nbsp:" " };
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return named[key] ?? `&${entity};`;
  });
}

function richFontSize(run, fallback) {
  return ({ 1:7.5, 2:8.5, 3:9.7, 4:11.5, 5:14, 6:18, 7:24 })[Number(run.size)] || fallback;
}

function wrapRichRuns(runs, fontFor, sizeFor, width) {
  const lines = []; let line = []; let lineWidth = 0; let pendingSpace = false;
  const pushLine = () => { if (line.length) lines.push(line); line = []; lineWidth = 0; pendingSpace = false; };
  for (const run of runs) {
    const font = fontFor(run);
    const size = sizeFor(run);
    for (const token of run.text.split(/(\n|\s+)/)) {
      if (!token) continue;
      if (token === "\n") { pushLine(); continue; }
      if (/^\s+$/.test(token)) { pendingSpace = line.length > 0; continue; }
      const prefix = pendingSpace && line.length ? " " : "";
      let value = prefix + token; let tokenWidth = font.widthOfTextAtSize(value, size);
      if (line.length && lineWidth + tokenWidth > width) { pushLine(); value = token; tokenWidth = font.widthOfTextAtSize(value, size); }
      line.push({ text:value, width:tokenWidth, font, size, underline:run.underline }); lineWidth += tokenWidth; pendingSpace = false;
    }
  }
  pushLine(); return lines;
}

function wrapPdfText(text, font, size, width) {
  const words = text.split(/\s+/); const lines = []; let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function renderTemplate(content, record, customVariables = {}) {
  const fallback = "____________________________";
  const values = {
    ...customVariables,
    cliente_nombre: record.full_name || fallback,
    cliente_identificacion: record.identification || fallback,
    cliente_correo: record.email || fallback,
    cliente_telefono: record.phone || fallback,
    caso_titulo: record.title || fallback,
    caso_referencia: record.reference || record.title || fallback,
    caso_descripcion: record.description || record.title || fallback,
    fecha_larga: new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" }).format(new Date()),
  };
  return String(content || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => values[key] || fallback);
}

function sanitizeVariables(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const variables = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || "").trim().replace(/[{}]/g, "").slice(0, 200);
    if (key) variables[key] = clean(rawValue, 10000);
  }
  return variables;
}

async function addSignature(env, original, signatureDataUrl, signer, backgroundKey = null) {
  const pdf = await PDFDocument.load(original);
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(1/255,27/255,54/255); const ink = rgb(.18,.2,.23);
  const subject = pdf.getSubject() || ""; const bottomMatch = /^UG_CONTENT_BOTTOM:([0-9.]+)$/.exec(subject); const layoutMatch = /^UG_LAYOUT:([0-9.]+):(\d+):([0-9.]+)$/.exec(subject);
  const contentBottom = bottomMatch ? Number(bottomMatch[1]) : layoutMatch ? Number(layoutMatch[1]) : null;
  const pages = pdf.getPages(); const placedSignature = Boolean(layoutMatch); let page = placedSignature ? pages[Math.min(Number(layoutMatch[2]), pages.length - 1)] : pages[pages.length - 1]; let top = placedSignature ? Number(layoutMatch[3]) : contentBottom ? contentBottom - 8 : 0;
  const blockHeight = 145; const pageBottom = 72;
  if (!placedSignature && (!contentBottom || top - blockHeight < pageBottom)) {
    const { width, height } = page.getSize(); page = pdf.addPage([width, height]); top = height - 118;
    let customBackground = null;
    if (backgroundKey) {
      try {
        const object = await getFile(env, backgroundKey); const bytes = new Uint8Array(object.data);
        customBackground = object.content_type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      } catch { customBackground = null; }
    }
    if (customBackground) page.drawImage(customBackground, { x:0, y:0, width, height });
    else {
      try {
        const response = await env.ASSETS.fetch(new Request("https://assets.local/assets/images/simbolo-azul.png"));
        if (response.ok) {
          const logo = await pdf.embedPng(await response.arrayBuffer()); const size = logo.scaleToFit(74, 58);
          page.drawImage(logo, { x:(width - size.width) / 2, y:height - 76, width:size.width, height:size.height });
        }
      } catch {}
      drawInstitutionalBase(page, regular, rgb(2/255,46/255,104/255));
    }
  }
  const left = 80; const usableWidth = page.getWidth() - 160;
  if (!placedSignature) {
    page.drawLine({ start:{ x:left, y:top + 10 }, end:{ x:left + usableWidth, y:top + 10 }, thickness:.7, color:rgb(.72,.76,.8) });
    page.drawText("CONSTANCIA DE FIRMA", { x:left, y:top, size:12.5, font:bold, color:navy });
    drawWrapped(page, "La persona identificada manifiesta su aceptación y firma el documento mediante el enlace individual suministrado por la firma.", left, top - 18, usableWidth, 8.8, regular, ink, 11);
  }
  const pngBytes = Uint8Array.from(atob(signatureDataUrl.split(",")[1]), c => c.charCodeAt(0));
  const signature = await pdf.embedPng(pngBytes); const box = { x:left, y:placedSignature ? top - 82 : top - 137, width:190, height:placedSignature ? 72 : 82 }; const scaled = signature.scaleToFit(174, placedSignature ? 58 : 68);
  page.drawRectangle({ ...box, borderColor:rgb(.72,.76,.8), borderWidth:.8, color:rgb(1,1,1), opacity:1 });
  page.drawImage(signature, { x:box.x + (box.width - scaled.width) / 2, y:box.y + (box.height - scaled.height) / 2, width:scaled.width, height:scaled.height });
  const detailX = left + 215; let detailY = placedSignature ? top - 18 : top - 65;
  page.drawText("Firmado por", { x:detailX, y:detailY, size:8.2, font:regular, color:rgb(.38,.42,.47) }); detailY -= 15;
  detailY = drawWrapped(page, signer.name, detailX, detailY, usableWidth - 215, 9.5, bold, navy, 11); detailY -= 3;
  page.drawText(`Identificación: ${signer.identification}`, { x:detailX, y:detailY, size:8.5, font:regular, color:ink }); detailY -= 13;
  detailY = drawWrapped(page, `Correo: ${signer.email || "No indicado"}`, detailX, detailY, usableWidth - 215, 8.5, regular, ink, 10.5); detailY -= 2;
  const signedUtc = new Date(signer.signedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  page.drawText(`Fecha y hora UTC: ${signedUtc}`, { x:detailX, y:detailY, size:8.2, font:regular, color:ink });
  pdf.setModificationDate(new Date(signer.signedAt));
  pdf.setSubject("Documento firmado electrónicamente por Umbarila Gutiérrez & Asociados");
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
  const boundary = `ug-${crypto.randomUUID()}`; const { to, subject, body } = emailDraftData(doc);
  const base64 = bytesToBase64(pdfBytes).replace(/(.{76})/g, "$1\r\n");
  return [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary=\"${boundary}\"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body, "", `--${boundary}`, "Content-Type: application/pdf; name=\"documento-firmado.pdf\"", "Content-Transfer-Encoding: base64", "Content-Disposition: attachment; filename=\"documento-firmado.pdf\"", "", base64, `--${boundary}--`, ""].join("\r\n");
}

function emailDraftData(doc) {
  const isPower = doc.template_id === "template-special-power" || /poder/i.test(doc.title || "");
  return {
    to: normalizeOptionalEmail(doc.email_to) || "umbarilagutierrez.asoc@gmail.com",
    subject: cleanHeader(doc.email_subject, 200) || (isPower ? "PODER ESPECIAL - LEY 2213 DE 2022" : `DOCUMENTO FIRMADO - ${String(doc.title || "DOCUMENTO").toUpperCase()}`),
    body: clean(doc.email_body, 5000) || (isPower ? "En cumplimiento de lo dispuesto en la Ley 2213 del 13 de junio de 2022, y de conformidad con lo establecido en su artículo 5.º, por medio del presente escrito confiero poder especial, amplio y suficiente a los abogados relacionados en el documento adjunto, para que, en mi nombre y representación, promuevan, adelanten y lleven hasta su culminación el medio de control de nulidad y restablecimiento del derecho en contra de la Subred Integrada de Servicios de Salud Sur Occidente E.S.E., con las facultades inherentes al ejercicio del presente mandato." : `Adjunto remito el documento ${doc.title || "solicitado"}, debidamente firmado, para su revisión y trámite correspondiente.`),
  };
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

async function storedFile(env, key, filename, disposition = "attachment") {
  if (!key) return json({ error: "Archivo no disponible." }, 404);
  const object = await getFile(env, key); if (!object) return json({ error: "Archivo no encontrado." }, 404);
  return new Response(new Uint8Array(object.data), { headers: { "content-type": object.content_type, "content-disposition": `${disposition}; filename=\"${filename}\"`, "cache-control": "no-store" } });
}

async function audit(env, documentId, userId, event, detail, ipHash = null) {
  await env.PORTAL_DB.prepare("INSERT INTO portal_audit (id,document_id,actor_user_id,event,detail,ip_hash,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), documentId, userId, event, detail, ipHash, new Date().toISOString()).run();
}

async function ensureTemplates(env) {
  const now = new Date().toISOString();
  for (const template of DEFAULT_TEMPLATES) {
    await env.PORTAL_DB.prepare("INSERT OR IGNORE INTO portal_templates (id,name,description,content,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)")
      .bind(template.id, template.name, template.description, template.content, now, now).run();
  }
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
function base64ToBytes(value) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i); return bytes; }
function cookieValue(request, name) { const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`)); return match ? match[1] : null; }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeOptionalEmail(value) { const email=normalizeEmail(value); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""; }
function clean(value, max) { return String(value || "").trim().slice(0,max); }
function cleanHeader(value, max) { return clean(value, max).replace(/[\r\n]+/g, " "); }
function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#edc773"; }
function safeFilename(value) { return String(value || "documento").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase(); }
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function json(data, status=200) { return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
