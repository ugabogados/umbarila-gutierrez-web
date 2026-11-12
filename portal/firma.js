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
  let signerData = { name: "", identification: "", email: "" };

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
      if (data.status === "signed") return showSigned(false);
      signing.hidden = false;
      document.querySelector("#document-title").textContent = data.title || "Documento para firma";
      signerData = { name: data.clientName || "", identification: data.identification || "", email: data.email || "" };
      document.querySelector("#review-document").href = `/api/sign/${encodeURIComponent(token)}/file`;
      prepareCanvas();
    } catch (error) {
      loading.hidden = true; unavailable.hidden = false;
      document.querySelector("#unavailable-message").textContent = error.message;
    }
  }

  function prepareCanvas() {
    context.lineWidth = 7; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "#011b36";
    const point = event => { const rect=canvas.getBoundingClientRect(); const source=event.touches?.[0] || event; return { x:(source.clientX-rect.left)*(canvas.width/rect.width), y:(source.clientY-rect.top)*(canvas.height/rect.height) }; };
    const start = event => { event.preventDefault(); drawing=true; hasSignature=true; const p=point(event); context.beginPath(); context.moveTo(p.x,p.y); };
    const move = event => { if(!drawing) return; event.preventDefault(); const p=point(event); context.lineTo(p.x,p.y); context.stroke(); };
    const stop = () => { drawing=false; };
    canvas.addEventListener("pointerdown", start); canvas.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  const clearSignature = () => { context.clearRect(0,0,canvas.width,canvas.height); hasSignature=false; };
  document.querySelector("#clear-signature").addEventListener("click", clearSignature);
  document.querySelector("#clear-signature").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clearSignature(); } });
  document.querySelector("#sign-form").addEventListener("submit", async event => {
    event.preventDefault(); const status=document.querySelector("#sign-status");
    if(!hasSignature){ status.textContent="Dibuja tu firma dentro del recuadro."; return; }
    const button=event.currentTarget.querySelector("button[type=submit]"); button.disabled=true; button.textContent="Guardando firma…"; status.textContent="Estamos incorporando tu firma al documento. No cierres esta ventana.";
    const data={ consent:true, signerName:signerData.name, signerIdentification:signerData.identification, signerEmail:signerData.email, signature:canvas.toDataURL("image/png") };
    try { await api(`/api/sign/${encodeURIComponent(token)}`, { method:"POST", body:JSON.stringify(data) }); signing.hidden=true; showSigned(true); }
    catch(error){ status.textContent=error.message; button.disabled=false; button.textContent="Firmar documento"; }
  });

  function showSigned(autoShare=false){ loading.hidden=true; signed.hidden=false; document.querySelector("#download-signed").href=`/api/sign/${encodeURIComponent(token)}/file`; if(autoShare) shareSignedDocument(); }

  async function shareSignedDocument() {
    const status = document.querySelector("#email-status");
    status.textContent = "Abriendo las opciones de envío del dispositivo…";
    try {
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}/file`);
      if (!response.ok) throw new Error("No fue posible preparar el documento firmado.");
      const file = new File([await response.blob()], "documento-firmado.pdf", { type:"application/pdf" });
      const shareData = { title:"Documento firmado", text:"Adjunto remito el documento debidamente firmado.", files:[file] };
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        status.textContent = "Documento entregado a la aplicación seleccionada.";
        return;
      }
      status.textContent = "Abriendo el correo preparado con el PDF adjunto…";
      location.href = `/api/sign/${encodeURIComponent(token)}/email`;
    } catch (error) {
      if (error.name === "AbortError") {
        status.textContent = "Envío cancelado. Puedes intentarlo nuevamente con el botón.";
        return;
      }
      status.textContent = "Abriendo el correo preparado con el PDF adjunto…";
      location.href = `/api/sign/${encodeURIComponent(token)}/email`;
    }
  }

  document.querySelector("#prepare-email").addEventListener("click", shareSignedDocument);
  boot();
})();
