(() => {
  const config = window.SITE_CONFIG || {};
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#navigation");
  const mobile = matchMedia("(max-width: 760px)");
  function collapse() {
    nav.dataset.collapsed = String(mobile.matches);
    menu.setAttribute("aria-expanded", "false");
  }
  menu.hidden = false;
  collapse();
  mobile.addEventListener("change", collapse);
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.dataset.collapsed = String(!open);
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) collapse();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobile.matches && menu.getAttribute("aria-expanded") === "true") {
      collapse();
      menu.focus();
    }
  });
  document.querySelector("#year").textContent = new Date().getFullYear();
  const number = config.whatsappNumber;
  const validNumber = /^\d{8,15}$/.test(number || "");
  const intro = "Hola, vengo de la web de Umbarila Gutiérrez & Asociados";
  const whatsappUrl = (text) => "https://wa.me/" + number + "?text=" + encodeURIComponent(text);
  if (validNumber) {
    document.querySelectorAll("#whatsapp, .whatsapp-float").forEach((link) => {
      link.href = whatsappUrl(intro + " y deseo solicitar una asesoría.");
    });
  }
  const email = document.querySelector("#email-contact");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contactEmail || "")) {
    email.href = "mailto:" + config.contactEmail;
    email.textContent = config.contactEmail;
  }
  const socialNames = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
  const socialIcons = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".7"/>',
    facebook: '<path d="M14 21v-8h3l.5-4H14V7c0-1 .5-2 2-2h2V2h-3c-3 0-5 2-5 5v2H7v4h3v8"/>',
    linkedin: '<rect x="3" y="9" width="4" height="12"/><circle cx="5" cy="4" r="2"/><path d="M11 21V9h4v2c2-3 6-2 6 2v8h-4v-7c0-2-2-2-2 0v7Z"/>',
  };
  const socials = document.querySelector(".social-links");
  Object.entries(socialNames).forEach(([key, name]) => {
    let url;
    try { url = new URL(config.socialLinks?.[key]); } catch { return; }
    if (url.protocol !== "https:") return;
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", name + " de la firma (abre otra pestaña)");
    link.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' + socialIcons[key] + '</svg><span>' + name + '</span>';
    socials.append(link);
  });
  socials.hidden = !socials.children.length;

  // El visitante confirma el envío en WhatsApp; no se almacenan datos en la web.
  const contact = document.querySelector("#contact-form");
  const fields = document.querySelector("#form-fields");
  const status = document.querySelector("#form-status");
  fields.disabled = !validNumber;
  function handoff(text, output) {
    const url = whatsappUrl(text);
    window.open(url, "_blank", "noopener,noreferrer");
    output.replaceChildren(document.createTextNode("Tu mensaje está preparado. Confirma el envío en WhatsApp. Si no se abrió, "));
    const retry = document.createElement("a");
    retry.href = url;
    retry.target = "_blank";
    retry.rel = "noopener noreferrer";
    retry.textContent = "abre tu mensaje aquí";
    output.append(retry, document.createTextNode("."));
  }
  contact.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validNumber || !contact.reportValidity()) return;
    const data = new FormData(contact);
    if (data.get("website")) return;
    const text = intro + " y deseo agendar una asesoría.\n\nNombre: " + data.get("name").trim()
      + "\nCorreo: " + data.get("email").trim()
      + "\nTeléfono: " + (data.get("phone").trim() || "No indicado")
      + "\nConsulta: " + data.get("message").trim()
      + "\n\nAutorizo el uso de estos datos para contactarme y atender mi solicitud.";
    handoff(text, status);
  });
  const feedback = document.querySelector("#feedback-form");
  document.querySelector("#feedback-fields").disabled = !validNumber;
  const feedbackStatus = document.querySelector("#feedback-status");
  feedback.querySelector("button").disabled = !validNumber;
  feedback.addEventListener("change", (event) => {
    if (event.target.name !== "rating") return;
    const rating = Number(new FormData(feedback).get("rating"));
    feedback.querySelectorAll(".rating input").forEach((input) => {
      input.parentElement.classList.toggle("is-filled", Number(input.value) <= rating);
    });
    document.querySelector("#rating-status").textContent = rating + " de 5 estrellas";
  });
  feedback.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validNumber || !feedback.reportValidity()) return;
    const data = new FormData(feedback);
    handoff(intro + " y quiero compartir mi experiencia.\n\nCalificación: " + data.get("rating") + "/5 estrellas\nComentario: " + data.get("feedback").trim(), feedbackStatus);
  });
})();
