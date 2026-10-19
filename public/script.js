(() => {
  const config = window.DAUREL_CONFIG || {};

  const state = {
    persona: "particular",
    situation: "",
    category: "general",
    detail: "",
    urgency: ""
  };

  let turnstileWidgetId = null;
  let turnstileToken = "";
  let turnstileRendering = false;
  let sendingRequest = false;

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const situation = $("#situation");
  const heroForm = $("#heroForm");
  const charCount = $("#charCount");
  const heroError = $("#heroError");
  const modal = $("#intakeModal");
  const privacyModal = $("#privacyModal");
  const contactError = $("#contactError");
  const submitRequestButton = $("#submitRequest");

  const yearElement = $("#year");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // MENÚ MÓVIL
  const menuBtn = $("#menuButton");
  const mobileMenu = $("#mobileMenu");

  menuBtn?.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });

  $$("#mobileMenu a").forEach((link) => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
    });
  });

  // PARTICULAR / EMPRESA
  $$(".persona").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".persona").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      state.persona = button.dataset.persona || "particular";
    });
  });

  // DESCRIPCIÓN
  situation?.addEventListener("input", () => {
    if (charCount) {
      charCount.textContent = String(situation.value.length);
    }

    if (heroError) {
      heroError.textContent = "";
    }
  });

  // TARJETAS
  $$(".issue-card").forEach((card) => {
    card.addEventListener("click", () => {
      const text = card.dataset.fill || "";

      situation.value = text;

      if (charCount) {
        charCount.textContent = String(text.length);
      }

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

      setTimeout(() => {
        situation.focus();
      }, 550);
    });
  });

  // BOTONES EMPEZAR
  $$(".js-start").forEach((button) => {
    button.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

      setTimeout(() => {
        situation.focus();
      }, 550);
    });
  });

  // EMPRESAS
  $$(".js-enterprise").forEach((button) => {
    button.addEventListener("click", () => {
      state.persona = "empresa";

      $$(".persona").forEach((item) => {
        item.classList.toggle(
          "active",
          item.dataset.persona === "empresa"
        );
      });

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

      setTimeout(() => {
        situation.focus();
      }, 550);
    });
  });

  // CLASIFICACIÓN
  function classify(text) {
    const value = String(text || "").toLowerCase();

    if (/(despid|renuncia|patr[oó]n|trabaj|n[oó]mina|liquidaci)/.test(value)) {
      return "laboral";
    }

    if (/(choqu|accident|carro|veh[ií]culo|seguro|aseguradora|tr[aá]nsito)/.test(value)) {
      return "accidente";
    }

    if (/(debe|deuda|pagar|pr[eé]stamo|cobrar)/.test(value)) {
      return "deuda";
    }

    if (/(divor|pensi[oó]n|custodia|hijo|familiar|pareja)/.test(value)) {
      return "familiar";
    }

    if (/(marca|nombre comercial|canci[oó]n|obra|autor|impi|indautor)/.test(value)) {
      return "marca";
    }

    if (/(citatorio|audiencia|demanda|ministerio p[uú]blico|fiscal[ií]a)/.test(value)) {
      return "citatorio";
    }

    if (/(contrato|cl[aá]usula|arrend|renta)/.test(value)) {
      return "contrato";
    }

    return "general";
  }

  const questions = {
    laboral: {
      text: "¿Firmaste o te entregaron algún documento relacionado con tu salida?",
      choices: [
        "Sí, firmé algo",
        "Me entregaron un documento",
        "No",
        "No estoy seguro"
      ]
    },

    accidente: {
      text: "¿Intervino una aseguradora o alguna autoridad después del accidente?",
      choices: [
        "Aseguradora",
        "Autoridad",
        "Ambas",
        "Ninguna"
      ]
    },

    deuda: {
      text: "¿Tienes mensajes, transferencias, contrato o algún comprobante relacionado con la deuda?",
      choices: [
        "Sí",
        "No",
        "Tengo algunos",
        "No estoy seguro"
      ]
    },

    familiar: {
      text: "¿Hay menores de edad involucrados en la situación?",
      choices: [
        "Sí",
        "No",
        "No aplica",
        "Prefiero explicarlo después"
      ]
    },

    marca: {
      text: "¿El nombre, marca o creación ya se está usando públicamente?",
      choices: [
        "Sí",
        "No",
        "Está por lanzarse",
        "No estoy seguro"
      ]
    },

    citatorio: {
      text: "¿Tienes el citatorio o documento que recibiste?",
      choices: [
        "Sí, lo tengo",
        "Sólo tengo una foto",
        "No",
        "No estoy seguro"
      ]
    },

    contrato: {
      text: "¿Ya existe un documento que podamos revisar?",
      choices: [
        "Sí",
        "Todavía no",
        "Sólo tengo un borrador",
        "No estoy seguro"
      ]
    },

    general: {
      text: "¿Existe algún documento, mensaje o comunicación relacionada con lo ocurrido?",
      choices: [
        "Sí",
        "No",
        "Tengo algunos",
        "No estoy seguro"
      ]
    }
  };

  function openModal() {
    state.situation = situation.value.trim();
    state.category = classify(state.situation);
    state.detail = "";
    state.urgency = "";

    const question = questions[state.category] || questions.general;

    const questionText = $("#dynamicQuestionText");

    if (questionText) {
      questionText.textContent = question.text;
    }

    const choicesWrapper = $("#dynamicChoices");

    if (choicesWrapper) {
      choicesWrapper.innerHTML = question.choices
        .map(
          (choice) =>
            `<button type="button" class="choice">${choice}</button>`
        )
        .join("");

      $$(".choice", choicesWrapper).forEach((button) => {
        button.addEventListener("click", () => {
          $$(".choice", choicesWrapper).forEach((item) => {
            item.classList.remove("selected");
          });

          button.classList.add("selected");
          state.detail = button.textContent.trim();

          const nextButton = $("#stepOneNext");

          if (nextButton) {
            nextButton.disabled = false;
          }
        });
      });
    }

    const stepOneNext = $("#stepOneNext");

    if (stepOneNext) {
      stepOneNext.disabled = true;
    }

    const stepTwoNext = $("#stepTwoNext");

    if (stepTwoNext) {
      stepTwoNext.disabled = true;
    }

    $$(".choice[data-urgency]").forEach((item) => {
      item.classList.remove("selected");
    });

    goStep(1);

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    resetTurnstile();
  }

  function goStep(step) {
    $$(".modal-step", modal).forEach((item) => {
      item.classList.remove("active");
    });

    $(`[data-step="${step}"]`, modal)?.classList.add("active");

    const progress = $$(".progress span", modal);

    if (step === "success") {
      progress.forEach((item) => {
        item.classList.remove("active");
      });
    } else {
      progress.forEach((item, index) => {
        item.classList.toggle(
          "active",
          index <= Number(step) - 1
        );
      });
    }

    if (Number(step) === 3) {
      setTimeout(() => {
        ensureTurnstileRendered();
      }, 100);
    }
  }

  heroForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (situation.value.trim().length < 12) {
      heroError.textContent =
        "Cuéntanos un poco más para poder continuar.";

      situation.focus();

      return;
    }

    openModal();
  });

  $("#stepOneNext")?.addEventListener("click", () => {
    goStep(2);
  });

  $$(".choice[data-urgency]").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".choice[data-urgency]").forEach((item) => {
        item.classList.remove("selected");
      });

      button.classList.add("selected");

      state.urgency =
        button.dataset.urgency || "unknown";

      const nextButton = $("#stepTwoNext");

      if (nextButton) {
        nextButton.disabled = false;
      }
    });
  });

  $("#stepTwoNext")?.addEventListener("click", () => {
    goStep(3);
  });

  // TURNSTILE
  function waitForTurnstile(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      const check = () => {
        if (
          window.turnstile &&
          typeof window.turnstile.render === "function"
        ) {
          resolve(window.turnstile);
          return;
        }

        if (Date.now() - started > timeout) {
          reject(
            new Error("Turnstile no pudo cargarse.")
          );

          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  async function ensureTurnstileRendered() {
    const container = $("#turnstileWidget");

    if (!container) {
      if (contactError) {
        contactError.textContent =
          "No se encontró el módulo de seguridad del formulario.";
      }

      return false;
    }

    if (
      !config.turnstileSiteKey ||
      config.turnstileSiteKey.includes("PEGA_AQUI")
    ) {
      if (contactError) {
        contactError.textContent =
          "La verificación de seguridad todavía no está configurada.";
      }

      return false;
    }

    if (turnstileWidgetId !== null) {
      return true;
    }

    if (turnstileRendering) {
      return false;
    }

    turnstileRendering = true;

    try {
      const turnstile = await waitForTurnstile();

      turnstileWidgetId = turnstile.render(
        container,
        {
          sitekey: config.turnstileSiteKey,
          theme: "auto",

          callback(token) {
            turnstileToken = token || "";

            if (contactError) {
              contactError.textContent = "";
            }
          },

          "expired-callback"() {
            turnstileToken = "";
          },

          "error-callback"() {
            turnstileToken = "";

            if (contactError) {
              contactError.textContent =
                "No se pudo completar la verificación de seguridad. Intenta nuevamente.";
            }
          }
        }
      );

      return true;
    } catch (error) {
      console.error("Turnstile:", error);

      if (contactError) {
        contactError.textContent =
          "No fue posible cargar la verificación de seguridad.";
      }

      return false;
    } finally {
      turnstileRendering = false;
    }
  }

  function getTurnstileToken() {
    if (turnstileToken) {
      return turnstileToken;
    }

    if (
      turnstileWidgetId !== null &&
      window.turnstile
    ) {
      try {
        return (
          window.turnstile.getResponse(
            turnstileWidgetId
          ) || ""
        );
      } catch (error) {
        console.error(
          "Turnstile response:",
          error
        );
      }
    }

    return "";
  }

  function resetTurnstile() {
    turnstileToken = "";

    if (
      turnstileWidgetId !== null &&
      window.turnstile
    ) {
      try {
        window.turnstile.reset(
          turnstileWidgetId
        );
      } catch (error) {
        console.error(
          "Turnstile reset:",
          error
        );
      }
    }
  }

  function getApiUrl(path) {
    const base = String(
      config.apiBaseUrl || ""
    ).replace(/\/+$/, "");

    return `${base}${path}`;
  }

  // ENVIAR SOLICITUD
  submitRequestButton?.addEventListener(
    "click",
    async () => {
      if (sendingRequest) {
        return;
      }

      const name =
        $("#contactName").value.trim();

      const whatsapp =
        $("#contactWhatsapp")
          .value
          .replace(/\D/g, "");

      const location =
        $("#contactLocation").value.trim();

      const consent =
        $("#privacyConsent").checked;

      if (name.length < 2) {
        contactError.textContent =
          "Escribe tu nombre.";

        return;
      }

      if (
        whatsapp.length < 10 ||
        whatsapp.length > 15
      ) {
        contactError.textContent =
          "Escribe un número de WhatsApp válido.";

        return;
      }

      if (location.length < 2) {
        contactError.textContent =
          "Indica tu municipio o alcaldía.";

        return;
      }

      if (!consent) {
        contactError.textContent =
          "Es necesario aceptar el Aviso de Privacidad para continuar.";

        return;
      }

      if (!config.apiBaseUrl) {
        contactError.textContent =
          "El servicio de DAUREL todavía no está configurado.";

        return;
      }

      await ensureTurnstileRendered();

      const token =
        getTurnstileToken();

      if (!token) {
        contactError.textContent =
          "Completa la verificación de seguridad para continuar.";

        return;
      }

      contactError.textContent = "";

      const payload = {
        persona: state.persona,
        situation: state.situation,
        key_answer: state.detail,
        category_front: state.category,
        category_internal: state.category,

        urgency:
          state.urgency || "unknown",

        priority:
          state.urgency === "48h"
            ? "high"
            : "normal",

        name,
        whatsapp,
        location,

        privacy_consent: true,

        turnstile_token: token
      };

      sendingRequest = true;

      const originalButtonText =
        submitRequestButton.innerHTML;

      submitRequestButton.disabled = true;
      submitRequestButton.textContent = "Enviando...";

      try {
        const response = await fetch(
          getApiUrl("/solicitudes"),
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            body: JSON.stringify(payload)
          }
        );

        let result = {};

        try {
          result = await response.json();
        } catch {
          result = {};
        }

        if (
          !response.ok ||
          !result.success
        ) {
          resetTurnstile();

          throw new Error(
            result.message ||
              "No pudimos procesar la solicitud."
          );
        }

        const requestIdElement =
          $("#requestId");

        if (requestIdElement) {
          requestIdElement.textContent =
            result.request_id;
        }

        const successMessage =
          $("#successMessage");

        if (successMessage) {
          successMessage.textContent =
            result.message ||
            "Recibimos tu solicitud. Nos comunicaremos contigo por WhatsApp para continuar.";
        }

        const successKicker =
          $(".success-step .kicker");

        if (successKicker) {
          successKicker.textContent =
            "SOLICITUD RECIBIDA";
        }

        goStep("success");

        resetTurnstile();
      } catch (error) {
        console.error(
          "DAUREL API:",
          error
        );

        contactError.textContent =
          error.message ||
          "No pudimos enviar la solicitud en este momento. Intenta nuevamente.";

        resetTurnstile();
      } finally {
        sendingRequest = false;

        submitRequestButton.disabled = false;
        submitRequestButton.innerHTML =
          originalButtonText;
      }
    }
  );

  // CERRAR MODAL
  $$("[data-close-modal]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        closeModal
      );
    }
  );

  // AVISO DE PRIVACIDAD
  function openPrivacy() {
    privacyModal.classList.add("open");

    privacyModal.setAttribute(
      "aria-hidden",
      "false"
    );
  }

  function closePrivacy() {
    privacyModal.classList.remove("open");

    privacyModal.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  $("#privacyLink")?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      openPrivacy();
    }
  );

  $("#openPrivacyInline")?.addEventListener(
    "click",
    openPrivacy
  );

  $$("#heroForm a[href='#privacidad']")
    .forEach((link) => {
      link.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          openPrivacy();
        }
      );
    });

  $$("[data-close-privacy]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        closePrivacy
      );
    }
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeModal();
        closePrivacy();
      }
    }
  );
})();
