(() => {
  const state = { user: null, clients: [], stages: [], cases: [], documents: [], users: [] };
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
    renderMetrics(); renderCases(); renderPipeline(); renderClients(); renderDocuments(); renderSettings(); fillSelects();
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
    document.querySelector("#clients-list").innerHTML = state.clients.map(item => `<article class="client-card"><h3>${esc(item.full_name)}</h3><p>${esc(item.identification || "Sin identificación")}</p><p>${esc(item.email || "Sin correo")}</p><p>${esc(item.phone || "Sin teléfono")}</p></article>`).join("") || empty("Aún no hay clientes registrados.");
  }

  function renderDocuments() {
    document.querySelector("#documents-list").innerHTML = state.documents.map(item => {
      const status = item.status === "signed" ? "Firmado" : "Pendiente";
      return `<article class="list-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.client_name)} · ${esc(item.case_title)}</small></div><div class="row-actions"><span class="badge ${item.status}">${status}</span><a href="/api/portal/documents/${item.id}/file">Descargar</a></div></article>`;
    }).join("") || empty("Aún no se han generado documentos.");
  }

  function renderSettings() {
    document.querySelector("#users-list").innerHTML = state.users.map(item => `<article class="list-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.email)}</small></div><span class="badge">${item.role === "admin" ? "Administrador" : "Equipo"}</span></article>`).join("") || empty("No hay usuarios adicionales.");
    document.querySelector("#stages-list").innerHTML = state.stages.map(item => `<article class="list-row"><div><strong>${esc(item.name)}</strong><small>Posición ${item.position}</small></div><span style="width:18px;height:18px;border-radius:50%;background:${esc(item.color)}"></span></article>`).join("");
  }

  function fillSelects() {
    const clientOptions = `<option value="">Selecciona un cliente</option>` + state.clients.map(item => `<option value="${item.id}">${esc(item.full_name)}</option>`).join("");
    const stageOptions = state.stages.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
    const caseOptions = `<option value="">Selecciona un caso</option>` + state.cases.map(item => `<option value="${item.id}">${esc(item.client_name)} · ${esc(item.title)}</option>`).join("");
    document.querySelector("#case-client").innerHTML = clientOptions;
    document.querySelector("#case-stage").innerHTML = stageOptions;
    document.querySelector("#document-case").innerHTML = caseOptions;
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
  });

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

  async function shareSigningLink(url) {
    const text = `Hola. Umbarila Gutiérrez & Asociados te ha enviado un documento para revisar y firmar: ${url}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }
  function setStatus(element, message, success=false) { element.textContent=message; element.classList.toggle("success", success); if (message) setTimeout(()=>{ if(element.textContent===message) element.textContent=""; },5000); }
  function empty(message) { return `<p class="muted">${esc(message)}</p>`; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }
  boot();
})();
