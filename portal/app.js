(() => {
  const state = { user: null, clients: [], stages: [], cases: [], documents: [], documentLinks: [], templates: [], users: [] };
  let activeTemplateId = null;
  let documentPage = 1;
  let casePage = 1;
  let savedEditorRange = null;
  const DOCUMENT_PAGE_SIZE = 12;
  const CASE_PAGE_SIZE = 15;
  const AUTOMATIC_VARIABLES = new Set(["cliente_nombre","cliente_identificacion","cliente_correo","cliente_telefono","caso_titulo","caso_referencia","caso_descripcion","fecha_larga"]);
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
    renderMetrics(); renderCases(); renderCaseList(); renderPipeline(); renderClients(); renderDocuments(); renderTemplates(); renderSettings(); fillSelects();
  }

  function renderMetrics() {
    const signed = state.documents.filter(item => item.status === "signed").length;
    const values = [[state.clients.length,"Clientes"],[state.cases.length,"Casos activos"],[state.documents.length,"Documentos"],[signed,"Firmados"]];
    document.querySelector("#metric-grid").innerHTML = values.map(([number,label]) => `<article class="metric"><strong>${number}</strong><span>${label}</span></article>`).join("");
  }

  function renderCases() {
    document.querySelector("#recent-cases").innerHTML = state.cases.slice(0,8).map(item => `<article class="list-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.client_name)} · ${esc(item.stage_name)}</small></div><span class="badge">${esc(item.reference || "Sin referencia")}</span></article>`).join("") || empty("Aún no hay casos registrados.");
  }

  function renderCaseList() {
    const search = document.querySelector("#case-search").value.trim().toLowerCase();
    const stageId = document.querySelector("#case-stage-filter").value;
    const filtered = state.cases.filter(item => {
      const haystack = `${item.title} ${item.client_name} ${item.reference || ""} ${item.description || ""}`.toLowerCase();
      return (!search || haystack.includes(search)) && (!stageId || item.stage_id === stageId);
    });
    const pages = Math.max(1, Math.ceil(filtered.length / CASE_PAGE_SIZE));
    casePage = Math.min(casePage, pages);
    const visible = filtered.slice((casePage - 1) * CASE_PAGE_SIZE, casePage * CASE_PAGE_SIZE);
    document.querySelector("#case-count").textContent = `${filtered.length} caso${filtered.length === 1 ? "" : "s"}`;
    document.querySelector("#cases-page").textContent = `Página ${casePage} de ${pages}`;
    document.querySelector("#cases-prev").disabled = casePage <= 1;
    document.querySelector("#cases-next").disabled = casePage >= pages;
    document.querySelector("#cases-list").innerHTML = visible.map(item => `<article class="case-list-row"><div class="case-list-main"><strong>${esc(item.title)}</strong><small>${esc(item.client_name)}</small></div><span class="case-reference">${esc(item.reference || "Sin referencia")}</span><span class="badge" style="border-left:3px solid ${esc(state.stages.find(stage => stage.id === item.stage_id)?.color || "#edc773")}">${esc(item.stage_name)}</span><time>${esc(formatDate(item.updated_at))}</time></article>`).join("") || empty("No se encontraron casos.");
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
      return `<article class="client-card"><div class="client-head"><div><h3>${esc(item.full_name)}</h3><p>${esc(item.identification || "Sin identificación")}</p></div><span class="badge">${documents.length} documento${documents.length === 1 ? "" : "s"}</span></div><p>${esc(item.email || "Sin correo")}</p><p>${esc(item.phone || "Sin teléfono")}</p><button class="secondary client-document-button" type="button" data-client-document="${item.id}">Generar documento</button><div class="client-documents"><strong>Documentos relacionados</strong>${documents.length ? documents.slice(0,3).map(document => `<div class="client-document"><div><span>${esc(document.title)}</span><small>${esc(formatDate(document.created_at))}</small></div><span class="badge ${document.status}">${documentStatus(document.status)}</span><a href="/api/portal/documents/${document.id}/file" target="_blank" rel="noopener">Previsualizar</a></div>`).join("") + (documents.length > 3 ? `<small>Y ${documents.length - 3} documento${documents.length - 3 === 1 ? "" : "s"} más en la sección Documentos.</small>` : "") : `<small>Aún no hay documentos para este cliente.</small>`}</div></article>`;
    }).join("") || empty("Aún no hay clientes registrados.");
  }

  function renderDocuments() {
    const query = document.querySelector("#document-search").value.trim().toLowerCase();
    const statusFilter = document.querySelector("#document-status-filter").value;
    const filtered = state.documents.filter(item => {
      const haystack = `${item.title} ${item.client_name} ${item.case_title} ${item.custom_reference || ""} ${item.custom_title || ""}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!statusFilter || item.status === statusFilter);
    });
    const pages = Math.max(1, Math.ceil(filtered.length / DOCUMENT_PAGE_SIZE));
    documentPage = Math.min(documentPage, pages);
    const visible = filtered.slice((documentPage - 1) * DOCUMENT_PAGE_SIZE, documentPage * DOCUMENT_PAGE_SIZE);
    document.querySelector("#document-count").textContent = `${filtered.length} documento${filtered.length === 1 ? "" : "s"}`;
    document.querySelector("#documents-page").textContent = `Página ${documentPage} de ${pages}`;
    document.querySelector("#documents-prev").disabled = documentPage <= 1;
    document.querySelector("#documents-next").disabled = documentPage >= pages;
    document.querySelector("#documents-list").innerHTML = visible.map(item => {
      const links = (state.documentLinks || []).filter(link => link.document_id === item.id);
      const signingUrl = item.signing_token ? `${location.origin}/${item.signing_token.length <= 16 ? "f" : "firmar"}/${item.signing_token}` : "";
      const activeLink = signingUrl && item.status !== "expired";
      const expiry = item.expires_at ? new Intl.DateTimeFormat("es-CO", { dateStyle:"medium" }).format(new Date(item.expires_at)) : "";
      const signatureRecord = item.status === "signed" ? signatureMetadata(item) : "";
      return `<article class="document-compact"><div class="document-main"><strong>${esc(item.title)}</strong><small>${esc(item.client_name)} · ${esc(item.case_title)}</small></div><span class="document-date">${esc(formatDate(item.created_at))}</span><span class="badge ${item.status}">${documentStatus(item.status)}</span><details class="document-menu"><summary>Acciones</summary><div><a href="/api/portal/documents/${item.id}/file" target="_blank" rel="noopener">Previsualizar PDF</a>${activeLink ? `<a href="${esc(signingUrl)}" target="_blank" rel="noopener">Abrir enlace</a><button type="button" data-copy-signing="${esc(signingUrl)}">Copiar enlace</button><a href="https://wa.me/?text=${encodeURIComponent(`Hola. Umbarila Gutiérrez & Asociados te ha enviado un documento para revisar y firmar: ${signingUrl}`)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : `<button type="button" data-regenerate-link="${item.id}">Generar nuevo enlace</button>`}${signatureRecord}<details class="compact-history"><summary>Historial (${links.length})</summary>${links.map(link => `<small>${link.used_at ? "Usado" : link.revoked_at ? "Reemplazado" : new Date(link.expires_at) <= new Date() ? "Vencido" : `Activo hasta ${expiry}`}</small>`).join("")}</details><button class="danger-action" type="button" data-delete-document="${item.id}" data-document-title="${esc(item.title)}">Eliminar</button></div></details></article>`;
    }).join("") || empty("No se encontraron documentos.");
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
    const backgroundPreview = document.querySelector("#template-background-preview");
    backgroundPreview.innerHTML = selected.background_key
      ? `<img src="/api/portal/templates/${encodeURIComponent(selected.id)}/background?v=${encodeURIComponent(selected.updated_at || "")}" alt="Fondo personalizado de ${esc(selected.name)}" />`
      : `<div class="institutional-background-sample"><strong>UG</strong><span>UMBARILA GUTIÉRREZ &amp; ASOCIADOS</span><small>Fondo institucional predeterminado</small></div>`;
    document.querySelector("#remove-template-background").disabled = !selected.background_key;
    const editor = document.querySelector("#template-rich-editor");
    editor.innerHTML = sanitizeTemplateHtml(looksLikeHtml(selected.content) ? selected.content : plainToEditorHtml(selected.content));
    syncRichEditor();
    renderTemplateVariableList();
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
    const stageFilter = document.querySelector("#case-stage-filter"); const selectedStage = stageFilter.value;
    stageFilter.innerHTML = `<option value="">Todas</option>` + stageOptions; stageFilter.value = selectedStage;
    document.querySelector("#document-client").innerHTML = clientOptions;
    document.querySelector("#template-preview-client").innerHTML = `<option value="">Datos de ejemplo</option>` + state.clients.map(item => `<option value="${item.id}">${esc(item.full_name)}</option>`).join("");
    document.querySelector("#document-template").innerHTML = (state.templates || []).map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
    updateDocumentCases();
    renderDocumentVariableFields();
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
  document.querySelector("#document-template").addEventListener("change", renderDocumentVariableFields);

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
    syncRichEditor();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.action = "template.update";
    try {
      await api("/api/portal/actions", { method:"POST", body:JSON.stringify(data) });
      await refresh("Plantilla guardada correctamente.");
    } catch (error) { setStatus(globalStatus, error.message); }
  });

  document.querySelector("#template-background-file").addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png','image/jpeg'].includes(file.type)) { setStatus(globalStatus, "Selecciona una imagen PNG o JPG."); event.target.value = ""; return; }
    if (file.size > 3500000) { setStatus(globalStatus, "La imagen debe pesar menos de 3,5 MB."); event.target.value = ""; return; }
    setStatus(globalStatus, "Guardando el fondo…", true);
    try {
      await api("/api/portal/actions", { method:"POST", body:JSON.stringify({ action:"template.background.update", templateId:activeTemplateId, contentType:file.type, data:await fileBase64(file) }) });
      event.target.value = ""; await refresh("Fondo de la plantilla actualizado.");
    } catch (error) { event.target.value = ""; setStatus(globalStatus, error.message); }
  });
  document.querySelector("#remove-template-background").addEventListener("click", async event => {
    if (!confirm("¿Restaurar el fondo institucional para esta plantilla?")) return;
    event.currentTarget.disabled = true;
    try {
      await api("/api/portal/actions", { method:"POST", body:JSON.stringify({ action:"template.background.remove", templateId:activeTemplateId }) });
      await refresh("Fondo institucional restaurado.");
    } catch (error) { event.currentTarget.disabled = false; setStatus(globalStatus, error.message); }
  });

  const richEditor = document.querySelector("#template-rich-editor");
  richEditor.addEventListener("input", () => { rememberEditorRange(); syncRichEditor(); });
  richEditor.addEventListener("keyup", rememberEditorRange);
  richEditor.addEventListener("mouseup", rememberEditorRange);
  richEditor.addEventListener("focus", rememberEditorRange);
  document.addEventListener("selectionchange", rememberEditorRange);
  document.querySelector(".rich-toolbar").addEventListener("mousedown", event => event.preventDefault());
  document.querySelector(".rich-toolbar").addEventListener("click", event => {
    const command = event.target.closest("[data-rich-command]")?.dataset.richCommand;
    const block = event.target.closest("[data-rich-block]")?.dataset.richBlock;
    if (!command && !block) return;
    richEditor.focus();
    document.execCommand(block ? "formatBlock" : command, false, block ? `<${block}>` : null);
    syncRichEditor();
  });
  document.querySelector("#insert-template-variable").addEventListener("click", () => {
    const input = document.querySelector("#template-variable-name");
    const key = variableKey(input.value);
    if (!key) return;
    insertVariable(key); input.value = "";
  });
  document.querySelector("#template-variable-name").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); document.querySelector("#insert-template-variable").click();
  });

  document.querySelector("#template-variable-list").addEventListener("click", event => {
    const chip = event.target.closest("[data-variable-key]");
    if (chip) insertVariable(chip.dataset.variableKey);
  });
  document.querySelector("#template-variable-list").addEventListener("dragstart", event => {
    const chip = event.target.closest("[data-variable-key]");
    if (!chip) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", `{{${chip.dataset.variableKey}}}`);
    chip.classList.add("dragging");
  });
  document.querySelector("#template-variable-list").addEventListener("dragend", event => event.target.closest("[data-variable-key]")?.classList.remove("dragging"));
  richEditor.addEventListener("dragover", event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; richEditor.classList.add("drag-target"); });
  richEditor.addEventListener("dragleave", event => { if (!richEditor.contains(event.relatedTarget)) richEditor.classList.remove("drag-target"); });
  richEditor.addEventListener("drop", event => {
    event.preventDefault(); richEditor.classList.remove("drag-target");
    const token = event.dataTransfer.getData("text/plain");
    const match = /^\{\{([^{}]+)\}\}$/.exec(token);
    if (match) insertVariable(match[1], editorRangeAtPoint(event.clientX, event.clientY));
  });

  document.querySelector("#preview-template").addEventListener("click", () => {
    const form = document.querySelector("#template-editor");
    syncRichEditor();
    previewPdf({ templateId: form.elements.templateId.value, name: form.elements.name.value, content: form.elements.content.value, clientId: document.querySelector("#template-preview-client").value });
  });

  document.querySelector("#preview-document").addEventListener("click", () => {
    const form = document.querySelector("#document-dialog form");
    previewPdf(documentFormData(form));
  });

  function updateDocumentCases() {
    const clientId = document.querySelector("#document-client").value;
    const options = state.cases.filter(item => !clientId || item.client_id === clientId);
    document.querySelector("#document-case").innerHTML = `<option value="">Sin caso asociado</option>` + options.map(item => `<option value="${item.id}">${esc(item.title)}</option>`).join("");
  }

  function renderDocumentVariableFields() {
    const template = state.templates.find(item => item.id === document.querySelector("#document-template").value);
    const variables = extractVariables(template?.content || "");
    let builtinVisible = false;
    document.querySelectorAll("[data-builtin-variable]").forEach(label => {
      const visible = variables.includes(label.dataset.builtinVariable);
      label.hidden = !visible; if (visible) builtinVisible = true; else label.querySelector("input,textarea").value = "";
    });
    document.querySelector("#builtin-document-data").hidden = !builtinVisible;
    const custom = variables.filter(key => !AUTOMATIC_VARIABLES.has(key));
    document.querySelector("#custom-variable-fields").innerHTML = custom.map(key => `<label>${esc(variableLabel(key))}<input data-variable-key="${esc(key)}" placeholder="Valor para {{${esc(key)}}}" /></label>`).join("");
    document.querySelector("#custom-template-variables").hidden = custom.length === 0;
  }

  function renderTemplateVariableList() {
    const content = document.querySelector("#template-rich-editor").textContent;
    const used = new Set(extractVariables(content));
    const automatic = [...AUTOMATIC_VARIABLES];
    const custom = [...new Set([...extractVariables(content), ...(state.templates || []).flatMap(template => extractVariables(template.content || ""))].filter(key => !AUTOMATIC_VARIABLES.has(key)))];
    document.querySelector("#template-variable-list").innerHTML = `
      <section class="variable-group"><h4>Datos automáticos</h4><div class="variable-chips">${automatic.map(key => variableChip(key, used.has(key))).join("")}</div></section>
      <section class="variable-group"><h4>Variables personalizadas</h4><div class="variable-chips">${custom.length ? custom.map(key => variableChip(key, used.has(key))).join("") : `<p>Aún no has creado variables personalizadas.</p>`}</div></section>`;
  }

  function variableChip(key, used) {
    return `<button class="variable-chip ${used ? "used" : ""}" type="button" draggable="true" data-variable-key="${esc(key)}" title="Arrastrar o insertar ${esc(variableLabel(key))}"><span>${esc(variableLabel(key))}</span><code>{{${esc(key)}}}</code></button>`;
  }

  function rememberEditorRange() {
    const selection = window.getSelection();
    if (selection?.rangeCount && richEditor.contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
  }

  function editorRangeAtPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const position = document.caretPositionFromPoint?.(x, y);
    if (!position) return null;
    const range = document.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); return range;
  }

  function insertVariable(key, range = null) {
    const token = `{{${key}}}`; const selection = window.getSelection();
    richEditor.focus(); selection.removeAllRanges();
    const target = range || savedEditorRange;
    if (target && richEditor.contains(target.commonAncestorContainer)) selection.addRange(target);
    else { const end = document.createRange(); end.selectNodeContents(richEditor); end.collapse(false); selection.addRange(end); }
    if (!document.execCommand("insertText", false, token)) selection.getRangeAt(0).insertNode(document.createTextNode(token));
    rememberEditorRange(); syncRichEditor();
  }

  function syncRichEditor() {
    const editor = document.querySelector("#template-rich-editor");
    const content = sanitizeTemplateHtml(editor.innerHTML);
    document.querySelector("#template-editor textarea[name=content]").value = content;
    renderTemplateVariableList();
  }

  function looksLikeHtml(content) { return /<(p|div|h[1-3]|ul|ol|li|strong|b|em|i|u|br)\b/i.test(String(content || "")); }

  function plainToEditorHtml(content) {
    return String(content || "").replace(/\r/g, "").split(/\n{2,}/).map(block => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`).join("");
  }

  function sanitizeTemplateHtml(html) {
    const holder = document.createElement("template"); holder.innerHTML = String(html || "");
    const allowed = new Set(["P","DIV","H1","H2","H3","STRONG","B","EM","I","U","UL","OL","LI","BR"]);
    const cleanNode = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        if (["SCRIPT","STYLE","IFRAME","OBJECT"].includes(child.tagName)) { child.remove(); return; }
        cleanNode(child);
        if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
        const alignment = (child.style.textAlign || child.getAttribute("align") || "").toLowerCase();
        [...child.attributes].forEach(attribute => child.removeAttribute(attribute.name));
        if (["left","center","right","justify"].includes(alignment)) child.style.textAlign = alignment;
      });
    };
    cleanNode(holder.content);
    return holder.innerHTML;
  }

  function documentFormData(form) {
    const data = Object.fromEntries(new FormData(form)); const variables = {};
    form.querySelectorAll("[data-variable-key]").forEach(input => { variables[input.dataset.variableKey] = input.value; });
    data.variables = variables; return data;
  }

  function extractVariables(content) {
    const variables = []; const seen = new Set(); const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g; let match;
    while ((match = pattern.exec(content))) { const key = match[1].trim(); if (key && !seen.has(key)) { seen.add(key); variables.push(key); } }
    return variables;
  }

  function variableKey(value) { return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function variableLabel(key) { const value = String(key).replace(/[_-]+/g, " "); return value.charAt(0).toUpperCase() + value.slice(1); }

  async function fileBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
    for (let index=0; index<bytes.length; index+=8192) binary += String.fromCharCode(...bytes.subarray(index,index+8192));
    return btoa(binary);
  }

  document.querySelectorAll("dialog form[data-action]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = form.dataset.action === "document.create" ? documentFormData(form) : Object.fromEntries(new FormData(form)); data.action = form.dataset.action; data.origin = location.origin;
    try {
      const result = await api("/api/portal/actions", { method:"POST", body:JSON.stringify(data) });
      if (form.dataset.action === "template.create" && result.id) activeTemplateId = result.id;
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

  document.querySelector("#document-search").addEventListener("input", () => { documentPage = 1; renderDocuments(); });
  document.querySelector("#document-status-filter").addEventListener("change", () => { documentPage = 1; renderDocuments(); });
  document.querySelector("#documents-prev").addEventListener("click", () => { if (documentPage > 1) { documentPage--; renderDocuments(); } });
  document.querySelector("#documents-next").addEventListener("click", () => { documentPage++; renderDocuments(); });
  document.querySelector("#case-search").addEventListener("input", () => { casePage = 1; renderCaseList(); });
  document.querySelector("#case-stage-filter").addEventListener("change", () => { casePage = 1; renderCaseList(); });
  document.querySelector("#cases-prev").addEventListener("click", () => { if (casePage > 1) { casePage--; renderCaseList(); } });
  document.querySelector("#cases-next").addEventListener("click", () => { casePage++; renderCaseList(); });

  document.querySelector("#documents-list").addEventListener("click", async event => {
    const remove = event.target.closest("[data-delete-document]");
    if (remove) {
      const confirmed = confirm(`¿Eliminar "${remove.dataset.documentTitle}"? El enlace de firma dejará de funcionar.`);
      if (!confirmed) return;
      remove.disabled = true;
      try {
        await api("/api/portal/actions", { method:"POST", body:JSON.stringify({ action:"document.delete", documentId:remove.dataset.deleteDocument }) });
        await refresh("Documento eliminado.");
      } catch (error) { remove.disabled = false; setStatus(globalStatus, error.message); }
      return;
    }
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
  function signatureMetadata(item) {
    let location = {};
    try { location = JSON.parse(item.signer_location || "{}"); } catch {}
    const place = [location.city, location.region, location.country].filter(Boolean).join(", ") || "No disponible para esta firma";
    const coordinates = location.latitude && location.longitude ? `${location.latitude}, ${location.longitude}` : "Sin coordenadas disponibles";
    const timezone = location.timezone ? `Zona horaria: ${location.timezone}` : "";
    return `<div class="signature-metadata"><strong>Registro de firma</strong><small><b>UTC:</b> ${esc(formatUtc(item.signed_at))}</small><small><b>Ubicación aproximada:</b> ${esc(place)}</small><small>${esc(coordinates)}${timezone ? ` · ${esc(timezone)}` : ""}</small></div>`;
  }
  function empty(message) { return `<p class="muted">${esc(message)}</p>`; }
  function formatDate(value) { return new Intl.DateTimeFormat("es-CO", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value)); }
  function formatUtc(value) { if (!value) return "No disponible"; return new Intl.DateTimeFormat("es-CO", { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false, timeZone:"UTC", timeZoneName:"short" }).format(new Date(value)); }
  function documentStatus(status) { return ({ pending:"Sin firmar", signed:"Firmado", expired:"Enlace vencido" })[status] || "Sin firmar"; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }
  boot();
})();
