(() => {
  const token = location.pathname.split("/").filter(Boolean).pop();
  const loading = document.querySelector("#loading");
  const unavailable = document.querySelector("#unavailable");
  const signing = document.querySelector("#signing");
  const signed = document.querySelector("#signed");
  const canvas = document.querySelector("#signature");
  const context = canvas.getContext("2d");
  let drawing = false;
  let hasSignature = false;

  async function api(path, options) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No fue posible completar la solicitud.");
    return data;
  }

  async function boot() {
    try {
      const data = await api(`/api/sign/${encodeURIComponent(token)}`);
      loading.hidden = true;
      if (data.status === "signed") return showSigned();
      signing.hidden = false;
      document.querySelector('[name="signerName"]').value = data.clientName || "";
      document.querySelector('[name="signerIdentification"]').value = data.identification || "";
      document.querySelector('[name="signerEmail"]').value = data.email || "";
      document.querySelector("#review-document").href = `/api/sign/${encodeURIComponent(token)}/file`;
      prepareCanvas();
    } catch (error) {
      loading.hidden = true; unavailable.hidden = false;
      document.querySelector("#unavailable-message").textContent = error.message;
    }
  }

  function prepareCanvas() {
    context.lineWidth = 5; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "#011b36";
    const point = event => { const rect=canvas.getBoundingClientRect(); const source=event.touches?.[0] || event; return { x:(source.clientX-rect.left)*(canvas.width/rect.width), y:(source.clientY-rect.top)*(canvas.height/rect.height) }; };
    const start = event => { event.preventDefault(); drawing=true; hasSignature=true; const p=point(event); context.beginPath(); context.moveTo(p.x,p.y); };
    const move = event => { if(!drawing) return; event.preventDefault(); const p=point(event); context.lineTo(p.x,p.y); context.stroke(); };
    const stop = () => { drawing=false; };
    canvas.addEventListener("pointerdown", start); canvas.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  document.querySelector("#clear-signature").addEventListener("click", () => { context.clearRect(0,0,canvas.width,canvas.height); hasSignature=false; });
  document.querySelector("#sign-form").addEventListener("submit", async event => {
    event.preventDefault(); const status=document.querySelector("#sign-status");
    if(!hasSignature){ status.textContent="Dibuja tu firma dentro del recuadro."; return; }
    const button=event.currentTarget.querySelector("button[type=submit]"); button.disabled=true; status.textContent="Guardando tu documento…";
    const data=Object.fromEntries(new FormData(event.currentTarget)); data.consent=true; data.signature=canvas.toDataURL("image/png");
    try { await api(`/api/sign/${encodeURIComponent(token)}`, { method:"POST", body:JSON.stringify(data) }); signing.hidden=true; showSigned(); }
    catch(error){ status.textContent=error.message; button.disabled=false; }
  });

  function showSigned(){ loading.hidden=true; signed.hidden=false; document.querySelector("#download-signed").href=`/api/sign/${encodeURIComponent(token)}/file`; document.querySelector("#prepare-email").href=`/api/sign/${encodeURIComponent(token)}/email`; }
  boot();
})();
