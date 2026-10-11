(() => {
  const config = window.DAUREL_CONFIG || {};
  const state = {
    persona: "particular",
    situation: "",
    category: "general",
    detail: "",
    urgency: ""
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];

  const situation = $("#situation");
  const heroForm = $("#heroForm");
  const charCount = $("#charCount");
  const heroError = $("#heroError");
  const modal = $("#intakeModal");
  const privacyModal = $("#privacyModal");
  let submissionInFlight = false;
  let pendingRequestId = null;
  let pendingCreatedAt = null;
  let turnstileWidgetId = null;
  let turnstileToken = "";
  let turnstileSubmitPending = false;

  function ensureTurnstile() {
    if (!config.turnstileSiteKey || turnstileWidgetId !== null) return;
    if (!window.turnstile || !$("#turnstileWidget")) {
      setTimeout(ensureTurnstile, 150);
      return;
    }

    turnstileWidgetId = window.turnstile.render("#turnstileWidget", {
      sitekey: config.turnstileSiteKey,
      theme: "light",
      language: "es-MX",
      appearance: "execute",
      execution: "execute",
      callback: (token) => {
        turnstileToken = token || "";
        $("#turnstileWidget")?.classList.remove("active");
        const error = $("#contactError");
        if (error && error.textContent.includes("verificación de seguridad")) {
          error.textContent = "";
        }
        if (turnstileSubmitPending && turnstileToken) {
          turnstileSubmitPending = false;
          $("#submitRequest")?.click();
        }
      },
      "expired-callback": () => {
        turnstileToken = "";
        turnstileSubmitPending = false;
        $("#turnstileWidget")?.classList.remove("active");
      },
      "error-callback": () => {
        turnstileToken = "";
        turnstileSubmitPending = false;
        $("#turnstileWidget")?.classList.remove("active");
        const error = $("#contactError");
        if (error) error.textContent = "No pudimos completar la verificación de seguridad. Intenta nuevamente.";
        return true;
      }
    });
  }

  function resetTurnstile() {
    turnstileToken = "";
    turnstileSubmitPending = false;
    $("#turnstileWidget")?.classList.remove("active");
    if (turnstileWidgetId !== null && window.turnstile) {
      try {
        window.turnstile.reset(turnstileWidgetId);
      } catch (_) {}
    }
  }

  $("#year").textContent = new Date().getFullYear();

  // Mobile menu
  const menuBtn = $("#menuButton");
  const mobileMenu = $("#mobileMenu");
  menuBtn?.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  $$("#mobileMenu a").forEach(a => a.addEventListener("click", () => mobileMenu.classList.remove("open")));

  // Persona selector
  $$(".persona").forEach(btn => btn.addEventListener("click", () => {
    $$(".persona").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    state.persona = btn.dataset.persona;
  }));

  situation.addEventListener("input", () => {
    charCount.textContent = situation.value.length;
    heroError.textContent = "";
  });

  // Fill from issue cards
  $$(".issue-card").forEach(card => card.addEventListener("click", () => {
    const text = card.dataset.fill || "";
    if (text) {
      situation.value = text;
      charCount.textContent = situation.value.length;
    } else {
      situation.value = "";
      charCount.textContent = "0";
    }
    window.scrollTo({top:0, behavior:"smooth"});
    setTimeout(() => situation.focus(), 550);
  }));

  $$(".js-start").forEach(btn => btn.addEventListener("click", () => {
    window.scrollTo({top:0, behavior:"smooth"});
    setTimeout(() => situation.focus(), 550);
  }));
  $$(".js-enterprise").forEach(btn => btn.addEventListener("click", () => {
    state.persona = "empresa";
    $$(".persona").forEach(x => x.classList.toggle("active", x.dataset.persona === "empresa"));
    window.scrollTo({top:0, behavior:"smooth"});
    setTimeout(() => situation.focus(), 550);
  }));

  function classify(text){
    const t = text.toLowerCase();
    if (/(despid|renuncia|patr[oó]n|trabaj|n[oó]mina|liquidaci)/.test(t)) return "laboral";
    if (/(choqu|accident|carro|veh[ií]culo|seguro|aseguradora|tr[aá]nsito)/.test(t)) return "accidente";
    if (/(debe|deuda|pagar|pr[eé]stamo|cobrar)/.test(t)) return "deuda";
    if (/(divor|pensi[oó]n|custodia|hijo|familiar|pareja)/.test(t)) return "familiar";
    if (/(marca|nombre comercial|canci[oó]n|obra|autor|impi|indautor)/.test(t)) return "marca";
    if (/(citatorio|audiencia|demanda|ministerio p[uú]blico|fiscal[ií]a)/.test(t)) return "citatorio";
    if (/(contrato|cl[aá]usula|arrend|renta)/.test(t)) return "contrato";
    return "general";
  }

  const questions = {
    laboral:{
      text:"¿Firmaste o te entregaron algún documento relacionado con tu salida?",
      choices:["Sí, firmé algo","Me entregaron un documento","No","No estoy seguro"]
    },
    accidente:{
      text:"¿Intervino una aseguradora o alguna autoridad después del accidente?",
      choices:["Aseguradora","Autoridad","Ambas","Ninguna"]
    },
    deuda:{
      text:"¿Tienes mensajes, transferencias, contrato o algún comprobante relacionado con la deuda?",
      choices:["Sí","No","Tengo algunos","No estoy seguro"]
    },
    familiar:{
      text:"¿Hay menores de edad involucrados en la situación?",
      choices:["Sí","No","No aplica","Prefiero explicarlo después"]
    },
    marca:{
      text:"¿El nombre, marca o creación ya se está usando públicamente?",
      choices:["Sí","No","Está por lanzarse","No estoy seguro"]
    },
    citatorio:{
      text:"¿Tienes el citatorio o documento que recibiste?",
      choices:["Sí, lo tengo","Sólo tengo una foto","No","No estoy seguro"]
    },
    contrato:{
      text:"¿Ya existe un documento que podamos revisar?",
      choices:["Sí","Todavía no","Sólo tengo un borrador","No estoy seguro"]
    },
    general:{
      text:"¿Existe algún documento, mensaje o comunicación relacionada con lo ocurrido?",
      choices:["Sí","No","Tengo algunos","No estoy seguro"]
    }
  };

  function openModal(){
    submissionInFlight = false;
    pendingRequestId = null;
    pendingCreatedAt = null;
    resetTurnstile();
    const submitButton = $("#submitRequest");
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Enviar solicitud <span>→</span>';
    }

    state.situation = situation.value.trim();
    state.category = classify(state.situation);
    state.detail = "";
    state.urgency = "";

    const q = questions[state.category];
    $("#dynamicQuestionText").textContent = q.text;
    const wrap = $("#dynamicChoices");
    wrap.innerHTML = q.choices.map(c => `<button type="button" class="choice">${c}</button>`).join("");

    $$(".choice", wrap).forEach(btn => btn.addEventListener("click", () => {
      $$(".choice", wrap).forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      state.detail = btn.textContent.trim();
      $("#stepOneNext").disabled = false;
    }));

    goStep(1);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
  }

  function goStep(step){
    $$(".modal-step", modal).forEach(x => x.classList.remove("active"));
    $(`[data-step="${step}"]`, modal)?.classList.add("active");
    const progress = $$(".progress span", modal);
    if (step === "success") progress.forEach(x => x.classList.remove("active"));
    else progress.forEach((x,i) => x.classList.toggle("active", i <= Number(step)-1));
  }

  heroForm.addEventListener("submit", e => {
    e.preventDefault();
    if (situation.value.trim().length < 12) {
      heroError.textContent = "Cuéntanos un poco más para poder continuar.";
      situation.focus();
      return;
    }
    openModal();
  });

  $("#stepOneNext").addEventListener("click", () => goStep(2));

  $$('.choice[data-urgency]').forEach(btn => btn.addEventListener("click", () => {
    $$('.choice[data-urgency]').forEach(x => x.classList.remove("selected"));
    btn.classList.add("selected");
    state.urgency = btn.dataset.urgency;
    $("#stepTwoNext").disabled = false;
  }));
  $("#stepTwoNext").addEventListener("click", () => {
    goStep(3);
    ensureTurnstile();
  });


  // Catálogo inicial de ubicaciones para la zona de operación actual de DAUREL:
  // 16 Alcaldías de Ciudad de México + 125 Municipios del Estado de México.
  // El campo sigue aceptando texto libre para ubicaciones fuera de este catálogo.
  const locationCatalog = [
    "Álvaro Obregón — Alcaldía, Ciudad de México",
    "Azcapotzalco — Alcaldía, Ciudad de México",
    "Benito Juárez — Alcaldía, Ciudad de México",
    "Coyoacán — Alcaldía, Ciudad de México",
    "Cuajimalpa de Morelos — Alcaldía, Ciudad de México",
    "Cuauhtémoc — Alcaldía, Ciudad de México",
    "Gustavo A. Madero — Alcaldía, Ciudad de México",
    "Iztacalco — Alcaldía, Ciudad de México",
    "Iztapalapa — Alcaldía, Ciudad de México",
    "La Magdalena Contreras — Alcaldía, Ciudad de México",
    "Miguel Hidalgo — Alcaldía, Ciudad de México",
    "Milpa Alta — Alcaldía, Ciudad de México",
    "Tláhuac — Alcaldía, Ciudad de México",
    "Tlalpan — Alcaldía, Ciudad de México",
    "Venustiano Carranza — Alcaldía, Ciudad de México",
    "Xochimilco — Alcaldía, Ciudad de México",

    "Acambay de Ruíz Castañeda — Municipio, Estado de México",
    "Acolman — Municipio, Estado de México",
    "Aculco — Municipio, Estado de México",
    "Almoloya de Alquisiras — Municipio, Estado de México",
    "Almoloya de Juárez — Municipio, Estado de México",
    "Almoloya del Río — Municipio, Estado de México",
    "Amanalco — Municipio, Estado de México",
    "Amatepec — Municipio, Estado de México",
    "Amecameca — Municipio, Estado de México",
    "Apaxco — Municipio, Estado de México",
    "Atenco — Municipio, Estado de México",
    "Atizapán — Municipio, Estado de México",
    "Atizapán de Zaragoza — Municipio, Estado de México",
    "Atlacomulco — Municipio, Estado de México",
    "Atlautla — Municipio, Estado de México",
    "Axapusco — Municipio, Estado de México",
    "Ayapango — Municipio, Estado de México",
    "Calimaya — Municipio, Estado de México",
    "Capulhuac — Municipio, Estado de México",
    "Coacalco de Berriozábal — Municipio, Estado de México",
    "Coatepec Harinas — Municipio, Estado de México",
    "Cocotitlán — Municipio, Estado de México",
    "Coyotepec — Municipio, Estado de México",
    "Cuautitlán — Municipio, Estado de México",
    "Chalco — Municipio, Estado de México",
    "Chapa de Mota — Municipio, Estado de México",
    "Chapultepec — Municipio, Estado de México",
    "Chiautla — Municipio, Estado de México",
    "Chicoloapan — Municipio, Estado de México",
    "Chiconcuac — Municipio, Estado de México",
    "Chimalhuacán — Municipio, Estado de México",
    "Donato Guerra — Municipio, Estado de México",
    "Ecatepec de Morelos — Municipio, Estado de México",
    "Ecatzingo — Municipio, Estado de México",
    "Huehuetoca — Municipio, Estado de México",
    "Hueypoxtla — Municipio, Estado de México",
    "Huixquilucan — Municipio, Estado de México",
    "Isidro Fabela — Municipio, Estado de México",
    "Ixtapaluca — Municipio, Estado de México",
    "Ixtapan de la Sal — Municipio, Estado de México",
    "Ixtapan del Oro — Municipio, Estado de México",
    "Ixtlahuaca — Municipio, Estado de México",
    "Xalatlaco — Municipio, Estado de México",
    "Jaltenco — Municipio, Estado de México",
    "Jilotepec — Municipio, Estado de México",
    "Jilotzingo — Municipio, Estado de México",
    "Jiquipilco — Municipio, Estado de México",
    "Jocotitlán — Municipio, Estado de México",
    "Joquicingo — Municipio, Estado de México",
    "Juchitepec — Municipio, Estado de México",
    "Lerma — Municipio, Estado de México",
    "Malinalco — Municipio, Estado de México",
    "Melchor Ocampo — Municipio, Estado de México",
    "Metepec — Municipio, Estado de México",
    "Mexicaltzingo — Municipio, Estado de México",
    "Morelos — Municipio, Estado de México",
    "Naucalpan de Juárez — Municipio, Estado de México",
    "Nezahualcóyotl — Municipio, Estado de México",
    "Nextlalpan — Municipio, Estado de México",
    "Nicolás Romero — Municipio, Estado de México",
    "Nopaltepec — Municipio, Estado de México",
    "Ocoyoacac — Municipio, Estado de México",
    "Ocuilan — Municipio, Estado de México",
    "El Oro — Municipio, Estado de México",
    "Otumba — Municipio, Estado de México",
    "Otzoloapan — Municipio, Estado de México",
    "Otzolotepec — Municipio, Estado de México",
    "Ozumba — Municipio, Estado de México",
    "Papalotla — Municipio, Estado de México",
    "La Paz — Municipio, Estado de México",
    "Polotitlán — Municipio, Estado de México",
    "Rayón — Municipio, Estado de México",
    "San Antonio la Isla — Municipio, Estado de México",
    "San Felipe del Progreso — Municipio, Estado de México",
    "San Martín de las Pirámides — Municipio, Estado de México",
    "San Mateo Atenco — Municipio, Estado de México",
    "San Simón de Guerrero — Municipio, Estado de México",
    "Santo Tomás — Municipio, Estado de México",
    "Soyaniquilpan de Juárez — Municipio, Estado de México",
    "Sultepec — Municipio, Estado de México",
    "Tecámac — Municipio, Estado de México",
    "Tejupilco — Municipio, Estado de México",
    "Temamatla — Municipio, Estado de México",
    "Temascalapa — Municipio, Estado de México",
    "Temascalcingo — Municipio, Estado de México",
    "Temascaltepec — Municipio, Estado de México",
    "Temoaya — Municipio, Estado de México",
    "Tenancingo — Municipio, Estado de México",
    "Tenango del Aire — Municipio, Estado de México",
    "Tenango del Valle — Municipio, Estado de México",
    "Teoloyucan — Municipio, Estado de México",
    "Teotihuacán — Municipio, Estado de México",
    "Tepetlaoxtoc — Municipio, Estado de México",
    "Tepetlixpa — Municipio, Estado de México",
    "Tepotzotlán — Municipio, Estado de México",
    "Tequixquiac — Municipio, Estado de México",
    "Texcaltitlán — Municipio, Estado de México",
    "Texcalyacac — Municipio, Estado de México",
    "Texcoco — Municipio, Estado de México",
    "Tezoyuca — Municipio, Estado de México",
    "Tianguistenco — Municipio, Estado de México",
    "Timilpan — Municipio, Estado de México",
    "Tlalmanalco — Municipio, Estado de México",
    "Tlalnepantla de Baz — Municipio, Estado de México",
    "Tlatlaya — Municipio, Estado de México",
    "Toluca — Municipio, Estado de México",
    "Tonatico — Municipio, Estado de México",
    "Tultepec — Municipio, Estado de México",
    "Tultitlán — Municipio, Estado de México",
    "Valle de Bravo — Municipio, Estado de México",
    "Villa de Allende — Municipio, Estado de México",
    "Villa del Carbón — Municipio, Estado de México",
    "Villa Guerrero — Municipio, Estado de México",
    "Villa Victoria — Municipio, Estado de México",
    "Xonacatlán — Municipio, Estado de México",
    "Zacazonapan — Municipio, Estado de México",
    "Zacualpan — Municipio, Estado de México",
    "Zinacantepec — Municipio, Estado de México",
    "Zumpahuacán — Municipio, Estado de México",
    "Zumpango — Municipio, Estado de México",
    "Cuautitlán Izcalli — Municipio, Estado de México",
    "Valle de Chalco Solidaridad — Municipio, Estado de México",
    "Luvianos — Municipio, Estado de México",
    "San José del Rincón — Municipio, Estado de México",
    "Tonanitla — Municipio, Estado de México"
  ];

  const normalizeLocation = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const locationInput = $("#contactLocation");
  const locationSuggestions = $("#locationSuggestions");

  function closeLocationSuggestions() {
    if (!locationSuggestions || !locationInput) return;
    locationSuggestions.classList.remove("open");
    locationSuggestions.innerHTML = "";
    locationInput.setAttribute("aria-expanded", "false");
  }

  function showLocationSuggestions() {
    if (!locationSuggestions || !locationInput) return;

    const query = normalizeLocation(locationInput.value);
    if (!query) {
      closeLocationSuggestions();
      return;
    }

    const matches = locationCatalog
      .filter(item => normalizeLocation(item).startsWith(query))
      .slice(0, 8);

    if (!matches.length) {
      closeLocationSuggestions();
      return;
    }

    locationSuggestions.innerHTML = matches
      .map(item => '<button type="button" class="location-suggestion" role="option">' + item + '</button>')
      .join("");

    locationSuggestions.classList.add("open");
    locationInput.setAttribute("aria-expanded", "true");

    $(".location-suggestion", locationSuggestions).forEach(button => {
      button.addEventListener("click", () => {
        locationInput.value = button.textContent.trim();
        closeLocationSuggestions();
        locationInput.focus();
      });
    });
  }

  locationInput?.addEventListener("input", showLocationSuggestions);
  locationInput?.addEventListener("focus", showLocationSuggestions);
  locationInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLocationSuggestions();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".location-autocomplete")) {
      closeLocationSuggestions();
    }
  });

  function requestId(){
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    const rand = Math.floor(1000 + Math.random()*9000);
    return `DAU-${date}-${rand}`;
  }

  $("#submitRequest").addEventListener("click", async () => {
    const submitButton = $("#submitRequest");
    if (submissionInFlight) return;

    const name = $("#contactName").value.trim();
    const whatsapp = $("#contactWhatsapp").value.replace(/\D/g,"");
    const location = $("#contactLocation").value.trim();
    const consent = $("#privacyConsent").checked;
    const error = $("#contactError");

    if (!name || whatsapp.length < 10 || !location || !consent) {
      error.textContent = "Completa nombre, WhatsApp, ubicación y la autorización de privacidad y contacto.";
      return;
    }

    if (config.mode === "live" && !turnstileToken) {
      ensureTurnstile();

      if (turnstileWidgetId !== null && window.turnstile) {
        turnstileSubmitPending = true;
        $("#turnstileWidget")?.classList.add("active");
        error.textContent = "";
        try {
          window.turnstile.execute(turnstileWidgetId);
        } catch (_) {
          turnstileSubmitPending = false;
          $("#turnstileWidget")?.classList.remove("active");
          error.textContent = "No pudimos iniciar la verificación de seguridad. Intenta nuevamente.";
        }
      } else {
        error.textContent = "Espera un momento mientras preparamos la verificación de seguridad.";
      }

      return;
    }

    error.textContent = "";

    submissionInFlight = true;
    submitButton.disabled = true;
    submitButton.textContent = "Enviando solicitud…";

    if (!pendingRequestId) {
      pendingRequestId = requestId();
      pendingCreatedAt = new Date().toISOString();
    }

    const id = pendingRequestId;
    const payload = {
      request_id:id,
      created_at:pendingCreatedAt,
      persona:state.persona,
      situation:state.situation,
      category:state.category,
      key_answer:state.detail,
      urgency:state.urgency,
      name,
      whatsapp,
      location,
      privacy_consent:consent,
      privacy_consent_at:new Date().toISOString(),
      privacy_version:"2026-10-10-v1",
      turnstile_token:turnstileToken,
      source:"website",
      landing_page:window.location.href,
      referrer:document.referrer || "",
      utm_source:new URLSearchParams(window.location.search).get("utm_source") || "",
      utm_medium:new URLSearchParams(window.location.search).get("utm_medium") || "",
      utm_campaign:new URLSearchParams(window.location.search).get("utm_campaign") || "",
      utm_content:new URLSearchParams(window.location.search).get("utm_content") || "",
      utm_term:new URLSearchParams(window.location.search).get("utm_term") || ""
    };

    if (config.mode === "live" && config.apiUrl) {
      try {
        const res = await fetch(config.apiUrl, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload)
        });

        let data = {};
        try { data = await res.json(); } catch (_) {}

        if (!res.ok || data.ok === false) {
          const code = data.code || "";
          if (code.startsWith("TURNSTILE")) resetTurnstile();
          throw new Error(code || ("HTTP "+res.status));
        }

        $("#successMessage").textContent = data.message || "Recibimos tu solicitud. Nos comunicaremos contigo por WhatsApp para continuar.";
      } catch(err) {
        submissionInFlight = false;
        submitButton.disabled = false;
        submitButton.innerHTML = 'Enviar solicitud <span>→</span>';
        error.textContent = String(err.message || "").startsWith("TURNSTILE")
          ? "La verificación de seguridad venció o no pudo completarse. Intenta enviar nuevamente."
          : "No pudimos confirmar el envío en este momento. Intenta nuevamente; conservaremos el mismo folio para evitar duplicados.";
        return;
      }
    } else {
      console.log("DAUREL DEMO PAYLOAD", payload);
      $("#successMessage").textContent = "La interfaz ya está lista. Antes del lanzamiento conectaremos este formulario con n8n para que esta solicitud llegue a DAUREL y continúe por WhatsApp.";
    }

    $("#requestId").textContent = id;
    goStep("success");
  });

  $$("[data-close-modal]").forEach(x => x.addEventListener("click", closeModal));

  // Privacy placeholder modal
  function openPrivacy(){
    privacyModal.classList.add("open");
    privacyModal.setAttribute("aria-hidden","false");
  }
  function closePrivacy(){
    privacyModal.classList.remove("open");
    privacyModal.setAttribute("aria-hidden","true");
  }
  $("#privacyLink")?.addEventListener("click", e => {e.preventDefault(); openPrivacy();});
  $("#openPrivacyInline")?.addEventListener("click", openPrivacy);
  $$("#heroForm a[href='#privacidad']").forEach(a => a.addEventListener("click", e => {e.preventDefault(); openPrivacy();}));
  $$("[data-close-privacy]").forEach(x => x.addEventListener("click", closePrivacy));

  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){ closeModal(); closePrivacy(); }
  });
})();
