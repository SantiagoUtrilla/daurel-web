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
  const prelaunch = $("#prelaunch");

  if (config.mode !== "live") prelaunch.hidden = false;
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
  $("#stepTwoNext").addEventListener("click", () => goStep(3));

  function requestId(){
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    const rand = Math.floor(1000 + Math.random()*9000);
    return `DAU-${date}-${rand}`;
  }

  $("#submitRequest").addEventListener("click", async () => {
    const name = $("#contactName").value.trim();
    const whatsapp = $("#contactWhatsapp").value.replace(/\D/g,"");
    const location = $("#contactLocation").value.trim();
    const consent = $("#privacyConsent").checked;
    const error = $("#contactError");

    if (!name || whatsapp.length < 10 || !location || !consent) {
      error.textContent = "Completa nombre, WhatsApp, ubicación y aceptación del Aviso de Privacidad.";
      return;
    }
    error.textContent = "";

    const id = requestId();
    const payload = {
      request_id:id,
      created_at:new Date().toISOString(),
      persona:state.persona,
      situation:state.situation,
      category:state.category,
      key_answer:state.detail,
      urgency:state.urgency,
      name,
      whatsapp,
      location,
      source:"website"
    };

    if (config.mode === "live" && config.n8nWebhookUrl) {
      try {
        const res = await fetch(config.n8nWebhookUrl, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("HTTP "+res.status);
        $("#successMessage").textContent = "Recibimos tu solicitud. Nos comunicaremos contigo por WhatsApp para continuar.";
      } catch(err) {
        error.textContent = "No pudimos enviar la solicitud en este momento. Intenta nuevamente.";
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
