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
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) collapse();
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      mobile.matches &&
      menu.getAttribute("aria-expanded") === "true"
    ) {
      collapse();
      menu.focus();
    }
  });
  document.querySelector("#year").textContent = new Date().getFullYear();
  document.querySelectorAll("[data-area]").forEach((link) =>
    link.addEventListener("click", () => {
      document.querySelector("#area").value = link.dataset.area;
    }),
  );
  if (/^\d{8,15}$/.test(config.whatsappNumber || "")) {
    const a = document.querySelector("#whatsapp");
    a.href = `https://wa.me/${config.whatsappNumber}`;
    a.hidden = false;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contactEmail || "")) {
    const a = document.querySelector("#email-contact");
    a.href = `mailto:${config.contactEmail}`;
    a.textContent = config.contactEmail;
    a.hidden = false;
  }
  const form = document.querySelector("#contact-form");
  const fields = document.querySelector("#form-fields");
  const status = document.querySelector("#form-status");
  const button = form.querySelector("button");
  function message(text, kind = "") {
    status.textContent = text;
    status.dataset.kind = kind;
  }
  function httpsUrl(value) {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }
  if (
    !httpsUrl(config.formEndpoint) ||
    !config.turnstileSiteKey ||
    !httpsUrl(config.privacyPolicyUrl)
  )
    return;
  document.querySelector("#privacy-link").href = config.privacyPolicyUrl;
  let token = "",
    widget;
  window.onTurnstileReady = () => {
    widget = window.turnstile.render("#turnstile-widget", {
      sitekey: config.turnstileSiteKey,
      action: "contact",
      language: "es",
      size: "flexible",
      callback: (value) => {
        token = value;
        button.disabled = false;
        if (!status.dataset.kind) message("Puede enviar su solicitud.");
      },
      "expired-callback": () => {
        token = "";
        button.disabled = true;
        message("Renueve la verificación para continuar.");
      },
      "error-callback": () => {
        token = "";
        button.disabled = true;
        message(
          "No se pudo completar la verificación. Recargue la página para reintentar.",
          "error",
        );
      },
    });
    fields.disabled = false;
    button.disabled = true;
    message("Complete sus datos y la verificación de seguridad.");
  };
  const script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit";
  script.async = true;
  script.defer = true;
  script.onerror = () =>
    message(
      "La verificación no está disponible. Recargue la página para reintentar.",
      "error",
    );
  document.head.append(script);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity() || !token) return;
    const payload = Object.fromEntries(new FormData(form));
    payload.consent = payload.consent === "on";
    payload.token = token;
    fields.disabled = true;
    form.setAttribute("aria-busy", "true");
    message("Enviando su solicitud…");
    try {
      const response = await fetch(config.formEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true)
        throw new Error(
          data.message || "No pudimos enviar la solicitud. Intente nuevamente.",
        );
      form.reset();
      message(
        "Su solicitud fue registrada. La firma podrá contactarlo por los datos que proporcionó.",
        "success",
      );
    } catch (error) {
      message(
        error.name === "TimeoutError"
          ? "No recibimos confirmación. La solicitud podría haberse registrado; confirme con la firma antes de reenviarla."
          : error instanceof TypeError
            ? "No recibimos confirmación de envío. Revise su conexión antes de reintentar."
            : error.message,
        "error",
      );
    } finally {
      token = "";
      fields.disabled = false;
      button.disabled = true;
      form.removeAttribute("aria-busy");
      window.turnstile.reset(widget);
    }
  });
})();
