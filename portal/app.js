(() => {
  const state = { user: null, clients: [], stages: [], cases: [], documents: [], documentLinks: [], templates: [], users: [] };
  let activeTemplateId = null;
  const authScreen = document.querySelector("#auth-screen");
  const app = document.querySelector("#portal-app");
  const authStatus = document.querySelector("#auth-status");
  const globalStatus = document.querySelector("#global-status");

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      credentials: "same-origin",
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || "No fue posible completar la solicitud.");
    return data;
  }

  async function boot() {
    try {
      const status = await api("/api/portal/status");
      if (status.user) return enterPortal();
      showAuth(status.setupRequired);
    } catch (error) {
      showAuth(false);
      setStatus(authStatus, error.message);
    }
  }

  function showAuth(setupRequired) {
    authScreen.hidden = false;
    app.hidden = true;
    document.querySelector("#login-form").hidden = setupRequired;
    document.querySelector("#setup-form").hidden = !setupRequired;
    document.querySelector("#auth-title").textContent = setupRequired ? "Configura el portal" : "Acceso del equipo";
    document.querySelector("#auth-copy").textContent = setupRequired
      ? "Crea la primera cuenta administradora para comenzar."
      : "Ingresa con las credenciales asignadas por la firma.";
  }

  async function enterPortal() {
    authScreen.hidden = true;
    app.hidden = false;
    await refresh();
  }

  async function refresh(message) {
    const data = await api("/api/portal/snapshot");
    Object.assign(state, data);
    render();
    if (message) setStatus(globalStatus, message, true);
  }

  function render() {
    document.querySelector("#sidebar-name").textContent = state.user.name;
    document.querySelector("#sidebar-email").textContent = state.user.email;
    document.querySelectorAll(".admin-only").forEach(el => el.hidden = state.user.role !== "admin");
    renderMetrics(); renderCases(); renderPipeline(); renderClients(); renderDocuments(); renderTemplates(); renderSettings(); fillSelects();
  }

  function renderMetrics() {
    const signed = state.documents.filter(item => item.status === "signed").length;
    const values = [[state.clients.length,"Clientes"],[state.cases.length,"Casos activos"],[state.documents.length,"Documentos"],[signed,"Firmados"]];
    document.querySelector("#metric-grid").innerHTML = values.map(([number,label]) => `<article class="metric"><strong>${number}</strong><span>${label}</span></article>`).join("");
  }

  function renderCases() {
    document.querySelector("#recent-cases").innerHTML = state.cases.slice(0,8).map(item => `<article class="list-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.client_name)} · ${esc(item.stage_name)}</small></div><span class="badge">${esc(item.reference || "Sin referencia")}</span></article>`).join("") || empty("Aún no hay casos registrados.");
  }

  function renderPipeline() {
    const board = document.querySelector("#pipeline-board");
    board.innerHTML = state.stages.map(stage => {
      const cases = state.cases.filter(item => item.stage_id === stage.id);
      return `<section class="stage-column" style="border-top-color:${esc(stage.color)}"><header class="stage-head"><h2>${esc(stage.name)}</h2><span class="badge">${cases.length}</span></header>${cases.map(item => `<article class="case-card"><strong>${esc(item.title)}</strong><small>${esc(item.client_name)}</small><select class="move-case" data-case="${item.id}" aria-label="Mover ${esc(item.title)}">${state.stages.map(option => `<option value="${option.id}" ${option.id===stage.id?"selected":""}>${esc(option.name)}</option>`).join("")}</select></article>`).join("") || `<p class="muted">Sin casos</p>`}</section>`;
    }).join("");
  }

  function renderClients() {
    document.querySelector("#clients-list").innerHTML = state.clients.map(item => {
      const documents = state.documents.filter(document => document.client_id === item.id);
      return `<article class="client-card"><div class="client-head"><div><h3>${esc(item.full_name)}</h3><p>${esc(item.identification || "Sin identificación")}</p></div><span class="badge">${documents.length} documento${documents.length === 1 ? "" : "s"}</span></div><p>${esc(item.email || "Sin correo")}</p><p>${esc(item.phone || "Sin teléfono")}</p><button class="secondary client-document-button" type="button" data-client-document="${item.id}">Generar documento</button><div class="client-documents"><strong>Documentos relacionados</strong>${documents.length ? documents.map(document => `<div class="client-document"><div><span>${esc(document.title)}</span><small>${esc(formatDate(document.created_at))}</small></div><span class="badge ${document.status}">${documentStatus(document.status)}</span><a href="/api/portal/documents/${document.id}/file">Descargar</a></div>`).join("") : `<small>Aún no hay documentos para este cliente.</small>`}</div></article>`;
    }).join("") || empty("Aún no hay clientes registrados.");
  }

  function renderDocuments() {
    document.querySelector("#documents-list").innerHTML = state.documents.map(item => {
      const links = (state.documentLinks || []).filter(link => link.document_id === item.id);
      const signingUrl = item.signing_token ? `${location.origin}/firmar/${item.signing_token}` : "";
      const activeLink = signingUrl && item.status !== "expired";
      const expiry = item.expires_at ? new Intl.DateTimeFormat("es-CO", { dateStyle:"medium" }).format(new Date(item.expires_at)) : "";
      return `<article class="list-row document-row"><div class="document-info"><strong>${esc(item.title)}</strong><small>Cliente: ${esc(item.client_name)} · ${esc(item.case_title)}</small><small>${item.status === "signed" && item.signed_at ? `Firmado el ${esc(formatDate(item.signed_at))}` : `Creado el ${esc(formatDate(item.created_at))} · Enlace vigente hasta ${esc(expiry)}`}</small>${activeLink ? `<div class="generated-link"><span>${esc(signingUrl)}</span></div>` : ""}<details class="link-history"><summary>Historial de enlaces (${links.length})</summary>${links.map(link => `<div><span>${link.used_at ? "Usado para firmar" : link.revoked_at ? "Reemplazado" : new Date(link.expires_at) <= new Date() ? "Vencido" : "Activo"}</span><small>${esc(formatDate(link.created_at))}</small></div>`).join("") || `<small>Sin enlaces registrados.</small>`}</details></div><div class="row-actions"><span class="badge ${item.status}">${documentStatus(item.status)}</span><a href="/api/portal/documents/${item.id}/file">Descargar</a>${activeLink ? `<a href="${esc(signingUrl)}" target="_blank" rel="noopener">Abrir enlace</a><button type="button" data-copy-signing="${esc(signingUrl)}">Copiar</button><a href="https://wa.me/?text=${encodeURIComponent(`Hola. Umbarila Gutiérrez & Asociados te ha enviado un documento para revisar y firmar: ${signingUrl}`)}" target="_blank" rel="noopener">WhatsApp</a>` : `<button type="button" data-regenerate-link="${item.id}">Generar nuevo enlace</button>`}</div></article>`;
    }).join("") || empty("Aún no se han generado documentos.");
  }

  function renderTemplates() {
    const templates = state.templates || [];
    if (!templates.length) {
      document.querySelector("#templates-list").innerHTML = empty("No hay plantillas disponibles.");
      return;
    }
    if (!templates.some(item => item.id === activeTemplateId)) activeTemplateId = templates[0].id;
    document.querySelector("#templates-list").innerHTML = templates.map(item => `
      <button class="template-option ${item.id === activeTemplateId ? "active" : ""}" type="button" data-template-id="${item.id}">
        <strong>${esc(item.name)}</strong><span>${esc(item.description || "Plantilla editable")}</span>
      </button>`).join("");
    const selected = templates.find(item => item.id === activeTemplateId);
    const form = document.querySelector("#template-editor");
    form.elements.templateId.value = selected.id;
    form.elements.name.value = selected.name;
    form.elements.description.value = selected.description || "";
    form.elements.content.value = selected.content;
  }

  function renderSettings() {
    document.querySelector("#users-list").innerHTML = state.users.map(item => `<article class="list-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.email)}</small></div><span class="badge">${item.role === "admin" ? "Administrador" : "Equipo"}</span></article>`).join("") || empty("No hay usuarios adicionales.");
    document.querySelector("#stages-list").innerHTML = state.stages.map(item => `<article class="list-row"><div><strong>${esc(item.name)}</strong><small>Posición ${item.position}</small></div><span style="width:18px;height:18px;border-radius:50%;background:${esc(item.color)}"></span></article>`).join("");
  }

  function fillSelects() {
    const clientOptions = `<option value="">Selecciona un cliente</option>` + state.clients.map(item => `<option value="${item.id}">${esc(item.full_name)}</option>`).join("");
    const stageOptions = state.stages.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
    document.querySelector("#case-client").innerHTML = clientOptions;
    document.querySelector("#case-stage").innerHTML = stageOptions;
    document.querySelector("#document-client").innerHTML = clientOptions;
    document.querySelector("#template-preview-client").innerHTML = `<option value="">Datos de ejemplo</option>` + state.clients.map(item => `<option value="${item.id}">${esc(item.full_name)}</option>`).join("");
    document.querySelector("#document-template").innerHTML = (state.templates || []).map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
    updateDocumentCases();
  }

  document.querySelector("#login-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus(authStatus, "Ingresando…", true);
    try { await api("/api/portal/login", { method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await enterPortal(); }
    catch (error) { setStatus(authStatus, error.message); }
  });
  document.querySelector("#setup-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus(authStatus, "Creando la cuenta…", true);
    try { await api("/api/portal/setup", { method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await enterPortal(); }
    catch (error) { setStatus(authStatus, error.message); }
  });
  document.querySelector("#logout-button").addEventListener("click", async () => { await api("/api/portal/logout", { method:"POST" }); location.reload(); });

  document.querySelector("#portal-nav").addEventListener("click", event => {
    const button = event.target.closest("[data-view]"); if (!button) return;
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === button.dataset.view));
    document.querySelector("#view-title").textContent = button.textContent;
    document.querySelector(".sidebar").classList.remove("open");
  });
  document.querySelector("#mobile-nav").addEventListener("click", event => {
    const open = document.querySelector(".sidebar").classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", event => {
    const opener = event.target.closest("[data-open]"); if (opener) document.querySelector(`#${opener.dataset.open}`).showModal();
    const closer = event.target.closest("[data-close-dialog]"); if (closer) closer.closest("dialog").close();
  });

  document.querySelector("#document-client").addEventListener("change", updateDocumentCases);

  document.querySelector("#clients-list").addEventListener("click", event => {
    const button = event.target.closest("[data-client-document]");
    if (!button) return;
    document.querySelector("#document-client").value = button.dataset.clientDocument;
    updateDocumentCases();
    document.querySelector("#document-dialog").showModal();
  });

  document.querySelector("#templates-list").addEventListener("click", event => {
    const option = event.target.closest("[data-template-id]");
    if (!option) return;
    activeTemplateId = option.dataset.templateId;
    renderTemplates();
  });

  document.querySelector("#template-editor").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.action = "template.update";
    try {
      await api("/api/portal/actions", { method:"POST", body:JSON.stringify(data) });
      await refresh("Plantilla guardada correctamente.");
    } catch (error) { setStatus(globalStatus, error.message); }
  });

  document.querySelector("#preview-template").addEventListener("click", () => {
    const form = document.querySelector("#template-editor");
    previewPdf({ templateId: form.elements.templateId.value, name: form.elements.name.value, content: form.elements.content.value, clientId: document.querySelector("#template-preview-client").value });
  });

  document.querySelector("#preview-document").addEventListener("click", () => {
    previewPdf({ templateId: document.querySelector("#document-template").value, clientId: document.querySelector("#document-client").value, caseId: document.querySelector("#document-case").value });
  });

  function updateDocumentCases() {
    const clientId = document.querySelector("#document-client").value;
    const options = state.cases.filter(item => !clientId || item.client_id === clientId);
    document.querySelector("#document-case").innerHTML = `<option value="">Sin caso asociado</option>` + options.map(item => `<option value="${item.id}">${esc(item.title)}</option>`).join("");
  }

  document.querySelectorAll("dialog form[data-action]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form)); data.action = form.dataset.action; data.origin = location.origin;
    try {
      const result = await api("/api/portal/actions", { method:"POST", body:JSON.stringify(data) });
      form.closest("dialog").close(); form.reset();
      if (result.signingUrl) await shareSigningLink(result.signingUrl);
      await refresh(result.signingUrl ? "Documento generado. El enlace quedó listo para compartir." : "Cambios guardados.");
    } catch (error) { setStatus(globalStatus, error.message); }
  }));

  document.querySelector("#pipeline-board").addEventListener("change", async event => {
    if (!event.target.matches(".move-case")) return;
    try { await api("/api/portal/actions", { method:"POST", body:JSON.stringify({ action:"case.move", caseId:event.target.dataset.case, stageId:event.target.value }) }); await refresh("Caso actualizado."); }
    catch (error) { setStatus(globalStatus, error.message); }
  });

  document.querySelector("#documents-list").addEventListener("click", async event => {
    const copy = event.target.closest("[data-copy-signing]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copySigning); setStatus(globalStatus, "Enlace copiado.", true); }
      catch { setStatus(globalStatus, "No fue posible copiar el enlace."); }
      return;
    }
    const regenerate = event.target.closest("[data-regenerate-link]");
    if (!regenerate) return;
    regenerate.disabled = true;
    try {
      const result = await api("/api/portal/actions", { method:"POST", body:JSON.stringify({ action:"document.link.regenerate", documentId:regenerate.dataset.regenerateLink }) });
      try { await navigator.clipboard.writeText(result.signingUrl); } catch {}
      await refresh("Nuevo enlace generado y copiado.");
    } catch (error) { regenerate.disabled = false; setStatus(globalStatus, error.message); }
  });

  async function shareSigningLink(url) {
    const text = `Hola. Umbarila Gutiérrez & Asociados te ha enviado un documento para revisar y firmar: ${url}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }
  async function previewPdf(payload) {
    const preview = window.open("", "_blank");
    if (preview) preview.document.write("<title>Generando vista previa…</title><p style='font:16px Arial;padding:24px'>Generando vista previa…</p>");
    try {
      const response = await fetch("/api/portal/preview", { method:"POST", headers:{ "content-type":"application/json" }, credentials:"same-origin", body:JSON.stringify(payload) });
      if (!response.ok) {
        const data = (response.headers.get("content-type") || "").includes("json") ? await response.json() : null;
        throw new Error(data?.error || "No fue posible generar la vista previa.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (preview) preview.location.href = url; else location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) {
      if (preview) preview.close();
      setStatus(globalStatus, error.message);
    }
  }
  function setStatus(element, message, success=false) { element.textContent=message; element.classList.toggle("success", success); if (message) setTimeout(()=>{ if(element.textContent===message) element.textContent=""; },5000); }
  function empty(message) { return `<p class="muted">${esc(message)}</p>`; }
  function formatDate(value) { return new Intl.DateTimeFormat("es-CO", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value)); }
  function documentStatus(status) { return ({ pending:"Sin firmar", signed:"Firmado", expired:"Enlace vencido" })[status] || "Sin firmar"; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }
  boot();
})();
