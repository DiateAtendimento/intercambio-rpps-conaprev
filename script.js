const state = {
  tokens: {
    candidate: "",
    host: "",
    admin: "",
  },
  ui: {
    adminApproved: [],
    hostAccepted: [],
  },
};

let modalChoiceResolver = null;

const STORAGE_KEYS = {
  tokens: "intercambio_tokens_v1",
  screen: "intercambio_screen_v1",
};

const API_BASE =
  typeof window !== "undefined" && window.location.hostname.endsWith("netlify.app")
    ? "https://intercambio-rpps-conaprev.onrender.com"
    : "";

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDateToBr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return raw;
  return raw;
}

function isValidBrDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatFieldValue(field, value) {
  if (!value) return "-";
  return normalizeText(field?.label || field?.key || "").startsWith("data")
    ? normalizeDateToBr(value)
    : value;
}

function isStrongPassword(password) {
  const value = String(password || "");
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

async function apiFetch(url, options = {}) {
  const requestUrl = String(url || "").startsWith("/api/") ? `${API_BASE}${url}` : url;
  console.error("[apiFetch:start]", {
    method: options.method || "GET",
    url: requestUrl,
  });
  const response = await fetch(requestUrl, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[apiFetch:error]", {
      method: options.method || "GET",
      url: requestUrl,
      status: response.status,
      data,
    });
    throw new Error(data.error || "Falha na operação.");
  }
  return data;
}

async function probeBackendReachability(context) {
  const probeUrl = `${API_BASE}/api/health?probe=${encodeURIComponent(context)}&ts=${Date.now()}`;
  console.error("[apiProbe:start]", probeUrl);
  const response = await fetch(probeUrl, { method: "GET", mode: "cors" });
  console.error("[apiProbe:done]", { url: probeUrl, status: response.status });
  return response.ok;
}

function setFeedback(id, message, ok = false) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.textContent = message || "";
  el.style.color = ok ? "#0a6b43" : "#8d1d1d";
}

function showMessageModal(title, message, kind = "info") {
  const safeTitle = title || "Aviso";
  const safeMessage = message || "Não foi possível concluir a ação.";
  const kindClass = ["info", "success", "warning", "error"].includes(kind) ? kind : "info";
  openModal(
    safeTitle,
    `
      <div class="message-modal message-modal--${kindClass}">
        <div class="message-modal__hero">
          <div class="message-modal__icon" aria-hidden="true">
            <i class="fa-solid ${kindClass === "success" ? "fa-circle-check" : kindClass === "warning" ? "fa-triangle-exclamation" : kindClass === "error" ? "fa-circle-xmark" : "fa-circle-info"}"></i>
          </div>
          <div class="message-modal__copy">
            <strong>${escapeHtml(safeTitle)}</strong>
            <p>${escapeHtml(safeMessage)}</p>
          </div>
        </div>
      </div>
    `,
    { closeByBackdrop: false, closeByEsc: false, variant: "message" }
  );
}

function showAccessInfoModal(accessInfo) {
  if (!accessInfo) return;
  const registrationLine = accessInfo.inscricao
    ? `
        <div class="access-modal__item">
          <span>Inscricao</span>
          <strong>${escapeHtml(accessInfo.inscricao)}</strong>
        </div>
      `
    : "";
  openModal(
    accessInfo.titulo || "Dados de acesso",
    `
      <div class="access-modal">
        <div class="access-modal__alert">
          <div class="access-modal__icon" aria-hidden="true">
            <i class="fa-solid fa-key"></i>
          </div>
          <div>
            <h4>Informacoes de acesso</h4>
            <p>${escapeHtml(accessInfo.orientacao || "Guarde estas informacoes em local seguro.")}</p>
          </div>
        </div>
        <div class="access-modal__grid">
          ${registrationLine}
          <div class="access-modal__item">
            <span>Municipio</span>
            <strong>${escapeHtml(accessInfo.municipio || "-")}</strong>
          </div>
          <div class="access-modal__item">
            <span>UF</span>
            <strong>${escapeHtml(accessInfo.uf || "-")}</strong>
          </div>
          <div class="access-modal__item">
            <span>Usuario</span>
            <strong>${escapeHtml(accessInfo.usuario || "-")}</strong>
          </div>
          <div class="access-modal__item">
            <span>Senha provisoria</span>
            <strong>${escapeHtml(accessInfo.senha || "-")}</strong>
          </div>
        </div>
        <p class="access-modal__note">Este modal so fecha no botao <strong>X</strong>. Anote os dados antes de sair.</p>
      </div>
    `,
    { closeByBackdrop: false, closeByEsc: false }
  );
}

function saveTokens() {
  try {
    localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(state.tokens));
  } catch (_) {}
}

function loadTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.tokens);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.tokens.candidate = String(parsed?.candidate || "");
    state.tokens.host = String(parsed?.host || "");
    state.tokens.admin = String(parsed?.admin || "");
  } catch (_) {}
}

function saveScreen(screenId) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.screen, String(screenId || ""));
  } catch (_) {}
}

function loadScreen() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.screen) || "";
  } catch (_) {
    return "";
  }
}

function updateScreenHash(screenId) {
  try {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch (_) {}
}

function persistCurrentScreenFromDOM() {
  try {
    const workspace = qs("#workspace");
    if (!workspace || workspace.hidden) {
      saveScreen("home");
      updateScreenHash("home");
      return;
    }
    const active = qs(".workspace-screen.active");
    const activeId = active?.dataset?.screenId || "";
    if (!activeId) return;
    saveScreen(activeId);
    updateScreenHash(activeId);
  } catch (_) {}
}

const lottieUi = {
  animation: null,
  startedAt: 0,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playOverlayAnimation(filePath, message, loop = true) {
  const overlay = qs("#lottieOverlay");
  const player = qs("#lottieOverlayPlayer");
  const text = qs("#lottieOverlayMessage");
  if (!overlay || !player || !window.lottie || typeof window.lottie.loadAnimation !== "function") return false;

  if (lottieUi.animation) {
    lottieUi.animation.destroy();
    lottieUi.animation = null;
  }

  player.innerHTML = "";
  if (text) text.textContent = message || "Processando...";
  overlay.hidden = false;

  try {
    lottieUi.animation = window.lottie.loadAnimation({
      container: player,
      renderer: "svg",
      loop,
      autoplay: true,
      path: filePath,
    });
  } catch (error) {
    return false;
  }
  return true;
}

function forceHideLottieOverlay() {
  const overlay = qs("#lottieOverlay");
  if (lottieUi.animation) {
    lottieUi.animation.destroy();
    lottieUi.animation = null;
  }
  if (overlay) overlay.hidden = true;
}

async function runWithLottie(task, options = {}) {
  const hasOverlay = Boolean(qs("#lottieOverlay"));
  const hasPlayer = Boolean(window.lottie) && typeof window.lottie.loadAnimation === "function";
  if (!hasOverlay || !hasPlayer) return task();

  const loadingPath = options.loadingPath || "Loading.json";
  const loadingMessage = options.loadingMessage || "Processando...";
  const successPath = options.successPath || "Success.json";
  const successMessage = options.successMessage || "Concluído com sucesso.";
  const errorPath = options.errorPath || "lottie_error_generic.json";
  const minLoadingMs = Number(options.minLoadingMs || 450);
  const overlayDelayMs = Number(options.overlayDelayMs || 1000);
  let overlayVisible = false;
  let delayTimer = null;

  try {
    lottieUi.startedAt = Date.now();
    delayTimer = window.setTimeout(() => {
      overlayVisible = playOverlayAnimation(loadingPath, loadingMessage, true);
    }, overlayDelayMs);

    const result = await task();
    if (delayTimer) {
      window.clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (overlayVisible) {
      const elapsed = Date.now() - lottieUi.startedAt - overlayDelayMs;
      if (elapsed < minLoadingMs) await wait(minLoadingMs - elapsed);
      playOverlayAnimation(successPath, successMessage, false);
      await wait(700);
    }
    return result;
  } catch (error) {
    if (delayTimer) {
      window.clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (overlayVisible) {
      const elapsed = Date.now() - lottieUi.startedAt - overlayDelayMs;
      if (elapsed < minLoadingMs) await wait(minLoadingMs - elapsed);
      playOverlayAnimation(errorPath, error?.message || "Falha na operação.", false);
      await wait(1100);
    }
    throw error;
  } finally {
    forceHideLottieOverlay();
  }
}

function setupSmoothScroll() {
  qsa("[data-scroll]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      const targetSelector = el.getAttribute("data-target") || el.getAttribute("href");
      if (!targetSelector || !targetSelector.startsWith("#")) return;
      showHome();
      const target = qs(targetSelector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function setupNavbarToggle() {
  // O menu superior fica sempre visÃ­vel no desktop.
  // O hambÃºrguer controla o painel lateral das Ã¡reas do sistema.
}

function setupBackToTop() {
  const button = qs("#backToTop");
  if (!button) return;

  window.addEventListener("scroll", () => {
    const scrolled = window.scrollY || document.documentElement.scrollTop;
    button.classList.toggle("visible", scrolled > 300);
  });

  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setupRevealOnScroll() {
  const items = qsa(".reveal");
  if (!("IntersectionObserver" in window) || !items.length) {
    items.forEach((el) => el.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((el) => observer.observe(el));
}

function setupSystemPanel() {
  const toggle = qs("#navbarToggle");
  const panel = qs("#systemPanel");
  const overlay = qs("#systemPanelOverlay");
  const formsToggle = qs("#formsToggleBtn");
  const formsSubmenu = qs("#formsSubmenu");

  if (!toggle || !panel || !overlay) return;

  const openPanel = () => {
    panel.classList.add("open");
    overlay.classList.add("open");
    document.body.classList.add("system-menu-open");
    toggle.setAttribute("aria-expanded", "true");
  };

  const closePanel = () => {
    panel.classList.remove("open");
    overlay.classList.remove("open");
    document.body.classList.remove("system-menu-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("open")) {
      closePanel();
    } else {
      openPanel();
    }
  });

  qsa("[data-system-close]").forEach((el) => el.addEventListener("click", closePanel));

  formsToggle?.addEventListener("click", () => {
    const next = !formsSubmenu.classList.contains("open");
    formsSubmenu.classList.toggle("open", next);
    formsToggle.setAttribute("aria-expanded", String(next));
  });

  qsa("#systemPanel [data-screen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openWorkspace(btn.dataset.screen);
      closePanel();
    });
  });

  qsa("[data-go-home]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showHome();
      closePanel();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
}

function openWorkspace(screenId) {
  const workspace = qs("#workspace");
  const landing = qs("main");
  const footer = qs("footer.footer");
  const backTop = qs("#backToTop");
  const workspaceTop = qs(".workspace__top");
  if (!workspace || !landing) return;

  landing.hidden = true;
  if (footer) footer.hidden = true;
  if (backTop) backTop.hidden = true;
  workspace.hidden = false;

  qsa(".workspace-screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screenId === screenId);
  });

  const titles = {
    "form-host": "Formulário do Anfitrião",
    "form-candidate": "Formulário do Intercambista",
    "candidate-login": "Área Intercambista - Login",
    "candidate-first-access": "Área Intercambista - Primeiro Acesso",
    "candidate-area": "Área Intercambista",
    "host-login": "Área Anfitrião - Login",
    "host-first-access": "Área Anfitrião - Primeiro Acesso",
    "host-area": "Área Anfitrião",
    "admin-login": "Gerenciador Admin - Login",
    "admin-area": "Gerenciador Admin",
  };
  const title = qs("#workspaceTitle");
  if (title) title.textContent = titles[screenId] || "Módulo do Sistema";
  if (workspaceTop) workspaceTop.hidden = screenId === "form-host" || screenId === "form-candidate";
  saveScreen(screenId);
  updateScreenHash(screenId);

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
  const workspace = qs("#workspace");
  const landing = qs("main");
  const footer = qs("footer.footer");
  const backTop = qs("#backToTop");
  if (workspace) workspace.hidden = true;
  if (landing) landing.hidden = false;
  if (footer) footer.hidden = false;
  if (backTop) backTop.hidden = false;
  saveScreen("home");
  updateScreenHash("home");
}

function collectFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setupSmartInputs() {
  qsa('input[data-input="numeric"]').forEach((input) => {
    input.addEventListener("input", () => {
      const maxLen = Number(input.getAttribute("maxlength") || 0);
      let value = normalizeDigits(input.value);
      if (maxLen > 0) value = value.slice(0, maxLen);
      input.value = value;
    });
  });

  qsa('input[data-input="uf"]').forEach((input) => {
    input.addEventListener("input", () => {
      input.value = String(input.value || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 2);
    });
  });

  qsa('input[data-input="date"]').forEach((input) => {
    input.addEventListener("input", () => {
      const digits = normalizeDigits(input.value).slice(0, 8);
      let value = digits;
      if (digits.length > 2) value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      if (digits.length > 4) value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      input.value = value;
    });

    input.addEventListener("blur", () => {
      input.value = normalizeDateToBr(input.value);
    });
  });
}

function validateRequiredFields(form) {
  if (!form) return true;
  const requiredFields = [...form.querySelectorAll("[required]")];
  for (const field of requiredFields) {
    if (field.type === "checkbox" && !field.checked) return false;
    if (field.type !== "checkbox") {
      const value = String(field.value || "").trim();
      if (!value) return false;
      if (field.dataset.input === "date" && !isValidBrDate(value)) return false;
    }
  }
  return true;
}

function payloadHostRegister(form) {
  const formData = collectFormData(form);
  const equipeApoio = qsa('[name="equipeApoioItem"]')
    .map((input) => String(input.value || "").trim())
    .filter(Boolean)
    .join(", ");

  const payload = {
    "UF": String(formData.uf || "").trim().toUpperCase(),
    "Município": String(formData.municipio || "").trim(),
    "Município CNPJ": normalizeDigits(formData.municipioCnpj),
    "Unidade Gestora": String(formData.unidadeGestora || "").trim(),
    "Endereço": String(formData.endereco || "").trim(),
    "Nome do Dirigente ou Responsável Legal": String(formData.dirigente || "").trim(),
    "Cargo/Função (Dirigente)": String(formData.cargoDirigente || "").trim(),
    "Responsável pela coordenação local": String(formData.coordenadorLocal || "").trim(),
    "E-mail de contato": String(formData.email || "").trim(),
    "Telefone de contato": String(formData.telefone || "").trim(),
    "Nível do Pró-Gestão": normalizeProGestaoValue(formData.nivelProGestao),
    "Número de vagas oferecidas": String(formData.vagas || "").trim(),
    "Nº de áreas/setores disponíveis": String(formData.totalAreas || "").trim(),
    "Outros (especificar)": String(formData.areaOutrosTexto || "").trim(),
    "Equipe de apoio designada (nomes)": equipeApoio,
    "Breve descrição da proposta de intercâmbio": String(formData.proposta || "").trim(),
    "Responsável pelo preenchimento": String(formData.responsavel || "").trim(),
    "Cargo/Função (Responsável)": String(formData.cargoResponsavel || "").trim(),
    "Data": normalizeDateToBr(formData.dataPreenchimento),
    cnpj: normalizeDigits(formData.municipioCnpj),
  };
  payload["Área: Cadastro e Atendimento (Sim/Não)"] = form.querySelector('[name="areaCadastro"]')?.checked || false;
  payload["Área: Concessão e Revisão de Benefícios (Sim/Não)"] = form.querySelector('[name="areaConcessao"]')?.checked || false;
  payload["Área: Compensação Previdenciária (Sim/Não)"] = form.querySelector('[name="areaCompensacao"]')?.checked || false;
  payload["Área: Atuária (Sim/Não)"] = form.querySelector('[name="areaAtuaria"]')?.checked || false;
  payload["Área: Investimentos (Sim/Não)"] = form.querySelector('[name="areaInvestimentos"]')?.checked || false;
  payload["Área: Controle Interno (Sim/Não)"] = form.querySelector('[name="areaControleInterno"]')?.checked || false;
  payload["Área: Certificação/Pró-Gestão (Sim/Não)"] = form.querySelector('[name="areaCertificacao"]')?.checked || false;
  payload["Área: Governança e Transparência (Sim/Não)"] = form.querySelector('[name="areaGovernanca"]')?.checked || false;
  payload["Área: Gestão de Pessoal (Sim/Não)"] = form.querySelector('[name="areaPessoal"]')?.checked || false;
  payload["Área: Tecnologia/Sistemas (Sim/Não)"] = form.querySelector('[name="areaTecnologia"]')?.checked || false;
  payload["Área: Contabilidade (Sim/Não)"] = form.querySelector('[name="areaContabilidade"]')?.checked || false;
  payload["Outros (Sim/Não)"] = form.querySelector('[name="areaOutros"]')?.checked || false;
  return payload;
}

function setupSupportTeamField() {
  const list = qs("#supportTeamList");
  const addButton = qs("#addSupportMember");
  if (!list || !addButton) return;

  const updateRemoveButtons = () => {
    const rows = qsa("#supportTeamList .dynamic-list__row");
    rows.forEach((row, index) => {
      const btn = row.querySelector(".dynamic-remove-btn");
      if (!btn) return;
      btn.disabled = rows.length === 1;
      btn.style.opacity = rows.length === 1 ? "0.45" : "1";
      btn.style.cursor = rows.length === 1 ? "not-allowed" : "pointer";
      btn.setAttribute("aria-label", `Remover membro ${index + 1}`);
    });
  };

  const createRow = () => {
    const row = document.createElement("div");
    row.className = "dynamic-list__row";
    row.innerHTML = `
      <input name="equipeApoioItem" placeholder="Nome do membro da equipe" required />
      <button type="button" class="dynamic-remove-btn" aria-label="Remover membro da equipe">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    list.appendChild(row);
    updateRemoveButtons();
  };

  addButton.addEventListener("click", () => {
    createRow();
    const lastInput = list.querySelector(".dynamic-list__row:last-child input");
    lastInput?.focus();
  });

  list.addEventListener("click", (event) => {
    const btn = event.target.closest(".dynamic-remove-btn");
    if (!btn) return;
    const rows = qsa("#supportTeamList .dynamic-list__row");
    if (rows.length === 1) return;
    btn.closest(".dynamic-list__row")?.remove();
    updateRemoveButtons();
  });

  updateRemoveButtons();
}

function resetHostRegisterForm(form) {
  if (!form) return;
  form.reset();

  const levelInput = form.querySelector('[name="nivelProGestao"]');
  if (levelInput) {
    levelInput.classList.remove("progestao-input--none");
  }

  const list = qs("#supportTeamList");
  if (!list) return;
  const rows = qsa("#supportTeamList .dynamic-list__row");
  rows.slice(1).forEach((row) => row.remove());

  const remainingRows = qsa("#supportTeamList .dynamic-list__row");
  remainingRows.forEach((row) => {
    const input = row.querySelector("input");
    const btn = row.querySelector(".dynamic-remove-btn");
    if (input) input.value = "";
    if (!btn) return;
    btn.disabled = remainingRows.length === 1;
    btn.style.opacity = remainingRows.length === 1 ? "0.45" : "1";
    btn.style.cursor = remainingRows.length === 1 ? "not-allowed" : "pointer";
  });
}

function resetCandidateRegisterForm(form) {
  if (!form) return;
  form.reset();
  const levelInput = form.querySelector('[name="nivelProGestao"]');
  if (levelInput) {
    levelInput.classList.remove("progestao-input--none");
  }
}

function setupNoDraftInputs() {
  qsa("form").forEach((form) => {
    form.setAttribute("autocomplete", "off");
  });
  qsa("input, textarea, select").forEach((field) => {
    field.setAttribute("autocomplete", "off");
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
  });
}

function payloadCandidateRegister(form) {
  const formData = collectFormData(form);
  const payload = {
    "UF": String(formData.uf || "").trim().toUpperCase(),
    "Município": String(formData.municipio || "").trim(),
    "Município CNPJ": normalizeDigits(formData.municipioCnpj),
    "Unidade Gestora": String(formData.unidadeGestora || "").trim(),
    "Unidade Gestora CNPJ": normalizeDigits(formData.unidadeGestoraCnpj),
    "Nível do Pró-Gestão": normalizeProGestaoValue(formData.nivelProGestao),
    "Nome do Dirigente ou Responsável Legal": String(formData.dirigente || "").trim(),
    "Cargo/Função (Dirigente)": String(formData.cargoDirigente || "").trim(),
    "E-mail institucional": String(formData.email || "").trim(),
    "Telefone para contato": String(formData.telefone || "").trim(),
    "Participante - Nome completo": String(formData.p_nome || "").trim(),
    "Participante - Cargo/Função": String(formData.p_cargo || "").trim(),
    "Participante - Tipo de vínculo": String(formData.p_vinculo || "").trim(),
    "Participante - Área de atuação (RPPS/EFPC)": String(formData.p_area || "").trim(),
    "Participante - Certificação": String(formData.p_certificacao || "").trim(),
    "Anfitrião de interesse - Prioridade 1": String(formData.prioridade1Host || "").trim(),
    "Objetivo principal (Prioridade 1)": String(formData.prioridade1Objetivo || "").trim(),
    "Anfitrião de interesse - Prioridade 2": String(formData.prioridade2Host || "").trim(),
    "Objetivo principal (Prioridade 2)": String(formData.prioridade2Objetivo || "").trim(),
    "Anfitrião de interesse - Prioridade 3": String(formData.prioridade3Host || "").trim(),
    "Objetivo principal (Prioridade 3)": String(formData.prioridade3Objetivo || "").trim(),
    "Temas/áreas de interesse (texto)": String(formData.temas || "").trim(),
    "Atividades propostas (agenda por dia)": String(formData.atividades || "").trim(),
    "Objetivos e compromissos (o que pretende implementar/replicar)": String(formData.objetivosCompromissos || "").trim(),
    "Declaração: vínculo formal (Sim/Não)": form.querySelector('[name="declaracaoVinculo"]').checked,
    "Declaração: custeio pelo intercambista (Sim/Não)": form.querySelector('[name="declaracaoCusteio"]').checked,
    "Declaração: ciência dos termos (Sim/Não)": form.querySelector('[name="declaracaoCiencia"]').checked,
    "Responsável pelo preenchimento": String(formData.responsavel || "").trim(),
    "Cargo/Função (Responsável)": String(formData.cargoResponsavel || "").trim(),
    "Data": normalizeDateToBr(formData.dataPreenchimento),
    cpf: normalizeDigits(formData.cpf),
    genero: String(formData.genero || "").trim(),
    participantes: [{
      nome: formData.p_nome || "",
      cargo: formData.p_cargo || "",
      vinculo: formData.p_vinculo || "",
      area: formData.p_area || "",
      certificacao: formData.p_certificacao || "",
    }],
    declaracaoVinculo: form.querySelector('[name="declaracaoVinculo"]').checked,
    declaracaoCusteio: form.querySelector('[name="declaracaoCusteio"]').checked,
    declaracaoCiencia: form.querySelector('[name="declaracaoCiencia"]').checked,
  };

  payload.cpf = normalizeDigits(payload.cpf);
  return payload;
}

function normalizeProGestaoValue(value) {
  const clean = String(value || "").trim();
  return clean || "Sem Pró-Gestão";
}

function applyProGestaoFieldState(form, value) {
  if (!form) return;
  const input = form.querySelector('[name="nivelProGestao"]');
  if (!input) return;
  const normalized = normalizeProGestaoValue(value);
  input.value = normalized;
  const isNone = normalizeText(normalized) === normalizeText("Sem Pró-Gestão");
  input.classList.toggle("progestao-input--none", isNone);
}

function applyPrefillToHostForm(form, data) {
  if (!form || !data) return;
  const set = (name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = String(value || "");
  };

  set("municipio", data.municipio);
  set("uf", data.uf);
  set("municipioCnpj", normalizeDigits(data.municipioCnpj || ""));
  set("unidadeGestora", data.unidadeGestora);
  set("dirigente", data.dirigente);
  set("cargoDirigente", data.cargoDirigente);
  set("email", data.email);
  set("telefone", data.telefone);
  applyProGestaoFieldState(form, data.nivelProGestao);
  set("responsavel", data.responsavel);
  set("cargoResponsavel", data.cargoResponsavel);
  set("dataPreenchimento", normalizeDateToBr(data.dataPreenchimento));
}

function applyPrefillToCandidateForm(form, data) {
  if (!form || !data) return;
  const set = (name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = String(value || "");
  };

  set("municipio", data.municipio);
  set("uf", data.uf);
  set("municipioCnpj", normalizeDigits(data.municipioCnpj || ""));
  set("unidadeGestora", data.unidadeGestora);
  set("dirigente", data.dirigente);
  set("cargoDirigente", data.cargoDirigente);
  set("email", data.email);
  set("telefone", data.telefone);
  applyProGestaoFieldState(form, data.nivelProGestao);
  set("responsavel", data.responsavel);
  set("cargoResponsavel", data.cargoResponsavel);
  set("dataPreenchimento", normalizeDateToBr(data.dataPreenchimento));
}

function setupCnpjPrefill() {
  const hostForm = qs("#hostRegisterForm");
  const candidateForm = qs("#candidateRegisterForm");
  const hostBtn = qs("#hostPrefillByCnpj");
  const candidateBtn = qs("#candidatePrefillByCnpj");
  const hostProGestao = hostForm?.querySelector('[name="nivelProGestao"]');
  const candidateProGestao = candidateForm?.querySelector('[name="nivelProGestao"]');

  hostProGestao?.addEventListener("input", () => {
    const isNone = normalizeText(hostProGestao.value) === normalizeText("Sem Pró-Gestão");
    hostProGestao.classList.toggle("progestao-input--none", isNone);
  });

  candidateProGestao?.addEventListener("input", () => {
    const isNone = normalizeText(candidateProGestao.value) === normalizeText("Sem Pró-Gestão");
    candidateProGestao.classList.toggle("progestao-input--none", isNone);
  });

  if (hostProGestao) {
    const isNone = normalizeText(hostProGestao.value) === normalizeText("Sem Pró-Gestão");
    hostProGestao.classList.toggle("progestao-input--none", isNone);
  }

  if (candidateProGestao) {
    const isNone = normalizeText(candidateProGestao.value) === normalizeText("Sem Pró-Gestão");
    candidateProGestao.classList.toggle("progestao-input--none", isNone);
  }

  hostBtn?.addEventListener("click", async () => {
    const raw = hostForm?.querySelector('[name="municipioCnpj"]')?.value || "";
    const cnpj = normalizeDigits(raw);
    if (cnpj.length !== 14) {
      setFeedback("hostRegisterFeedback", "", false);
      showMessageModal("CNPJ inválido", "Informe um CNPJ do município válido para buscar.", "warning");
      return;
    }
    setFeedback("hostRegisterFeedback", "Buscando dados no Nosso Banco de dados...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch(`/api/prefill/municipio/${cnpj}`),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Buscando dados do município...",
          successPath: "Success.json",
          successMessage: "Dados encontrados.",
          overlayDelayMs: 2500,
        }
      );
      applyPrefillToHostForm(hostForm, data.prefill);
      setFeedback("hostRegisterFeedback", "Dados carregados. Revise e ajuste se necessário.", true);
    } catch (error) {
      setFeedback("hostRegisterFeedback", "", false);
      showMessageModal("Falha na busca", error.message, "error");
    }
  });

  candidateBtn?.addEventListener("click", async () => {
    const raw = candidateForm?.querySelector('[name="municipioCnpj"]')?.value || "";
    const cnpj = normalizeDigits(raw);
    if (cnpj.length !== 14) {
      setFeedback("candidateRegisterFeedback", "", false);
      showMessageModal("CNPJ inválido", "Informe um CNPJ do município válido para buscar.", "warning");
      return;
    }
    setFeedback("candidateRegisterFeedback", "Buscando dados no Nosso Banco de dados...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch(`/api/prefill/municipio/${cnpj}`),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Buscando dados do município...",
          successPath: "Success.json",
          successMessage: "Dados encontrados.",
          overlayDelayMs: 2500,
        }
      );
      applyPrefillToCandidateForm(candidateForm, data.prefill);
      setFeedback("candidateRegisterFeedback", "Dados carregados. Revise e ajuste se necessário.", true);
    } catch (error) {
      setFeedback("candidateRegisterFeedback", "", false);
      showMessageModal("Falha na busca", error.message, "error");
    }
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getStatusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("aceit")) return "status status--ok";
  if (value.includes("rejeit") || value.includes("negad")) return "status status--bad";
  if (value.includes("pend")) return "status status--pending";
  return "status";
}

function iconButton(action, rowNumber, icon, label, context = "") {
  return `
    <button type="button" class="icon-btn" data-action="${action}" data-row="${rowNumber}" data-context="${context}">
      <img src="${icon}" alt="${label}" />
    </button>
  `;
}

function openModal(title, html, options = {}) {
  const modal = qs("#detailsModal");
  const modalTitle = qs("#detailsModalTitle");
  const modalBody = qs("#detailsModalBody");
  if (!modal || !modalTitle || !modalBody) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.dataset.closeByBackdrop = options.closeByBackdrop === false ? "false" : "true";
  modal.dataset.closeByEsc = options.closeByEsc === false ? "false" : "true";
  modal.dataset.modalVariant = options.variant || "default";
  modal.hidden = false;
}

function closeModal() {
  const modal = qs("#detailsModal");
  if (!modal) return;
  if (typeof modalChoiceResolver === "function") {
    const resolver = modalChoiceResolver;
    modalChoiceResolver = null;
    resolver(false);
  }
  modal.hidden = true;
  modal.dataset.closeByBackdrop = "true";
  modal.dataset.closeByEsc = "true";
  modal.dataset.modalVariant = "default";
}

function forceModalClosed() {
  const modal = qs("#detailsModal");
  const modalBody = qs("#detailsModalBody");
  if (!modal) return;
  modal.hidden = true;
  modal.dataset.closeByBackdrop = "true";
  modal.dataset.closeByEsc = "true";
  modal.dataset.modalVariant = "default";
  if (modalBody) modalBody.innerHTML = "";
}

function showConfirmModal(title, message, confirmLabel = "Confirmar", cancelLabel = "Cancelar") {
  return new Promise((resolve) => {
    modalChoiceResolver = resolve;
    openModal(
      title || "Confirmação",
      `
        <div class="message-modal message-modal--info">
          <p>${escapeHtml(message || "Deseja continuar?")}</p>
          <div class="confirm-actions">
            <button type="button" class="btn btn-outline" data-modal-choice="cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="btn btn-primary" data-modal-choice="confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `,
      { closeByBackdrop: true, closeByEsc: true, variant: "message" }
    );
  });
}

function renderFieldList(data, fields) {
  const wideKeys = new Set([
    "Equipe de apoio designada (nomes)",
    "Breve descrição da proposta de intercâmbio",
    "Temas/áreas de interesse (texto)",
    "Atividades propostas (agenda por dia)",
    "Objetivos e compromissos (o que pretende implementar/replicar)",
  ]);

  return `
    <div class="read-sheet">
      ${fields
        .map(
          (field) => `
        <div class="read-field ${wideKeys.has(field.key) ? "read-field--wide" : ""}">
          <label class="read-field__label">${escapeHtml(field.label)}</label>
          <div class="read-field__value ${wideKeys.has(field.key) ? "read-field__value--multiline" : ""}">${escapeHtml(formatFieldValue(field, data[field.key]))}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

const HOST_FIELDS = [
  { key: "Município", label: "Município" },
  { key: "UF", label: "UF" },
  { key: "Município CNPJ", label: "Município CNPJ" },
  { key: "Unidade Gestora", label: "Unidade Gestora" },
  { key: "Endereço", label: "Endereço" },
  { key: "Nome do Dirigente ou Responsável Legal", label: "Dirigente" },
  { key: "Cargo/Função (Dirigente)", label: "Cargo/Função (Dirigente)" },
  { key: "Responsável pela coordenação local", label: "Coordenação local" },
  { key: "E-mail de contato", label: "E-mail de contato" },
  { key: "Telefone de contato", label: "Telefone de contato" },
  { key: "Nível do Pró-Gestão", label: "Nível do Pró-Gestão" },
  { key: "Número de vagas oferecidas", label: "Número de vagas oferecidas" },
  { key: "Nº de áreas/setores disponíveis", label: "Nº de áreas/setores disponíveis" },
  { key: "Equipe de apoio designada (nomes)", label: "Equipe de apoio designada (nomes)" },
  { key: "Breve descrição da proposta de intercâmbio", label: "Proposta" },
  { key: "Responsável pelo preenchimento", label: "Responsável pelo preenchimento" },
  { key: "Cargo/Função (Responsável)", label: "Cargo/Função (Responsável)" },
  { key: "Data", label: "Data" },
];

const CANDIDATE_FIELDS = [
  { key: "Município", label: "Município" },
  { key: "UF", label: "UF" },
  { key: "Município CNPJ", label: "Município CNPJ" },
  { key: "Unidade Gestora", label: "Unidade Gestora" },
  { key: "Unidade Gestora CNPJ", label: "Unidade Gestora CNPJ" },
  { key: "CPF", label: "CPF" },
  { key: "Gênero", label: "Gênero" },
  { key: "Nível do Pró-Gestão", label: "Nível do Pró-Gestão" },
  { key: "Nome do Dirigente ou Responsável Legal", label: "Dirigente" },
  { key: "Cargo/Função (Dirigente)", label: "Cargo/Função (Dirigente)" },
  { key: "E-mail institucional", label: "E-mail institucional" },
  { key: "Telefone para contato", label: "Telefone para contato" },
  { key: "Participante - Nome completo", label: "Participante(s)" },
  { key: "Participante - Cargo/Função", label: "Cargo/Função participante" },
  { key: "Participante - Tipo de vínculo", label: "Tipo de vínculo" },
  { key: "Participante - Área de atuação (RPPS/EFPC)", label: "Área de atuação" },
  { key: "Participante - Certificação", label: "Certificação" },
  { key: "Anfitrião de interesse - Prioridade 1", label: "Anfitrião prioridade 1" },
  { key: "Objetivo principal (Prioridade 1)", label: "Objetivo prioridade 1" },
  { key: "Anfitrião de interesse - Prioridade 2", label: "Anfitrião prioridade 2" },
  { key: "Objetivo principal (Prioridade 2)", label: "Objetivo prioridade 2" },
  { key: "Anfitrião de interesse - Prioridade 3", label: "Anfitrião prioridade 3" },
  { key: "Objetivo principal (Prioridade 3)", label: "Objetivo prioridade 3" },
  { key: "Temas/áreas de interesse (texto)", label: "Temas/áreas de interesse" },
  { key: "Atividades propostas (agenda por dia)", label: "Atividades propostas" },
  { key: "Objetivos e compromissos (o que pretende implementar/replicar)", label: "Objetivos e compromissos" },
  { key: "Responsável pelo preenchimento", label: "Responsável pelo preenchimento" },
  { key: "Cargo/Função (Responsável)", label: "Cargo/Função (Responsável)" },
  { key: "Data", label: "Data" },
];

function filterRows(rows, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
}

function renderEmptyRow(targetId, colspan, message) {
  const body = qs(`#${targetId}`);
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
}

function withActionLottie(task, loadingMessage) {
  return runWithLottie(task, {
    loadingPath: "Loading.json",
    loadingMessage,
    successMessage: "Concluído com sucesso.",
    successPath: "Success.json",
    overlayDelayMs: 2500,
  });
}

function formatStatus(status) {
  const text = String(status || "Sem solicitação");
  return `<span class="${getStatusClass(text)}">${escapeHtml(text)}</span>`;
}

async function refreshCandidateArea() {
  const status = await apiFetch("/api/candidate/status", { headers: { Authorization: `Bearer ${state.tokens.candidate}` } });
  const hostsData = await apiFetch("/api/candidate/hosts", { headers: { Authorization: `Bearer ${state.tokens.candidate}` } });

  const statusBody = qs("#candidateStatusTableBody");
  if (statusBody) {
    statusBody.innerHTML = `
      <tr>
        <td>${escapeHtml(status.inscricao || "-")}</td>
        <td>${escapeHtml(status.municipio || "-")}</td>
        <td>${escapeHtml(status.uf || "-")}</td>
        <td>${escapeHtml(status.unidadeGestora || "-")}</td>
        <td>${escapeHtml(status.dirigente || "-")}</td>
        <td>${escapeHtml(status.dataSolicitacao || "-")}</td>
        <td>${escapeHtml(status.dataDecisao || "-")}</td>
        <td>${formatStatus(status.status)}</td>
      </tr>
    `;
  }

  const cards = qs("#candidateHostsList");
  if (!cards) return;

  const hosts = hostsData.hosts || [];
  if (!hosts.length) {
    cards.innerHTML = `<p class="module-note">Nenhum anfitrião ativo disponível.</p>`;
    return;
  }

  cards.innerHTML = hosts
    .map(
      (host) => `
      <article class="host-card">
        <img src="${escapeHtml(host.bandeira || "")}" alt="Bandeira ${escapeHtml(host.uf)}" class="host-card__flag" onerror="this.src='logo-conaprev.svg'" />
        <h4>${escapeHtml(host.entidade)}</h4>
        <p>UF: ${escapeHtml(host.uf || "-")}</p>
        <p>Nível Pró-Gestão:
          <span class="${host.semProGestao ? "progestao-level progestao-level--none" : "progestao-level"}">
            ${escapeHtml(host.nivelProGestao || "Sem Pró-Gestão")}
          </span>
        </p>
        <p>Número de vagas: ${escapeHtml(host.vagas || "-")}</p>
        <p>Nº de áreas/setores disponíveis: ${escapeHtml((host.areas || []).length || "-")}</p>
        <button class="btn btn-primary" type="button" data-action="select-host" data-host="${escapeHtml(host.numeroInscricao)}">Candidatar-se</button>
      </article>`
    )
    .join("");
}

function buildHostRows(rows, targetId) {
  const body = qs(`#${targetId}`);
  if (!body) return;
  if (!rows.length) return renderEmptyRow(targetId, targetId === "hostPendingTableBody" ? 8 : 10, "Sem registros.");

  body.innerHTML = rows
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.inscricao || "-")}</td>
        <td>${escapeHtml(item.municipio || "-")}</td>
        <td>${escapeHtml(item.uf || "-")}</td>
        <td>${escapeHtml(item.unidadeGestora || "-")}</td>
        <td>${escapeHtml(item.dataSolicitacao || "-")}</td>
        ${
          targetId === "hostPendingTableBody"
            ? `<td>${iconButton("host-open-plan", item.rowNumber, "icone-plano-trabalho.svg", "Plano de trabalho")}</td>
               <td>
                 <div class="action-group">
                   <button class="btn btn-sm btn-action-accept" type="button" data-action="host-decision" data-row="${item.rowNumber}" data-decision="aceito">Aceitar</button>
                   <button class="btn btn-sm btn-action-reject" type="button" data-action="host-decision" data-row="${item.rowNumber}" data-decision="rejeitado">Rejeitar</button>
                 </div>
               </td>`
            : `<td>${escapeHtml(item.dirigente || "-")}</td>
               <td>${escapeHtml(item.dataDecisao || "-")}</td>
               <td>${iconButton("host-open-plan", item.rowNumber, "icone-plano-trabalho.svg", "Plano de trabalho")}</td>
               <td>${iconButton("host-remove-candidate", item.rowNumber, "icone-lixeira.svg", "Remover inscrição")}</td>`
        }
      </tr>`
    )
    .join("");
}

async function refreshHostArea() {
  const data = await apiFetch("/api/host/requests", { headers: { Authorization: `Bearer ${state.tokens.host}` } });
  const profile = qs("#hostProfileMeta");
  if (profile) {
    profile.textContent = `${data.host?.municipio || ""} - ${data.host?.uf || ""}`.trim();
  }

  const pendentes = data.pendentes || [];
  const cadastrados = data.cadastrados || [];
  state.ui.hostAccepted = cadastrados;
  buildHostRows(pendentes, "hostPendingTableBody");
  buildHostRows(cadastrados, "hostAcceptedTableBody");
  applyHostSearch();
}

function buildAdminRows(rows, targetId) {
  const body = qs(`#${targetId}`);
  if (!body) return;
  if (!rows.length) return renderEmptyRow(targetId, targetId === "adminPendingTableBody" ? 9 : 11, "Sem registros.");

  body.innerHTML = rows
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        ${
          targetId === "adminPendingTableBody"
            ? `
              <td>${escapeHtml(item.municipio || "-")}</td>
              <td>${escapeHtml(item.uf || "-")}</td>
              <td>${escapeHtml(item.entidade || "-")}</td>
              <td>${escapeHtml(item.dirigente || "-")}</td>
              <td>${escapeHtml(item.cargoDirigente || "-")}</td>
              <td>${escapeHtml(item.dataSolicitacao || "-")}</td>
              <td>${iconButton("admin-open-cred", item.rowNumber, "icone-credenciamento.svg", "Credenciamento")}</td>
              <td>
                <div class="action-group">
                  <button class="btn btn-sm btn-action-accept" type="button" data-action="admin-status" data-row="${item.rowNumber}" data-fingerprint="${escapeHtml(item.fingerprint || "")}" data-status="Concedido" data-cnpj="${escapeHtml(item.cnpj || "")}" data-inscricao="${escapeHtml(item.numeroInscricao || "")}" data-municipio="${escapeHtml(item.municipio || "")}" data-uf="${escapeHtml(item.uf || "")}" data-entidade="${escapeHtml(item.entidade || "")}" data-email="${escapeHtml(item.email || "")}" data-dirigente="${escapeHtml(item.dirigente || "")}" data-data="${escapeHtml(item.dataSolicitacao || "")}">Aceitar</button>
                  <button class="btn btn-sm btn-action-reject" type="button" data-action="admin-status" data-row="${item.rowNumber}" data-fingerprint="${escapeHtml(item.fingerprint || "")}" data-status="Negado" data-cnpj="${escapeHtml(item.cnpj || "")}" data-inscricao="${escapeHtml(item.numeroInscricao || "")}" data-municipio="${escapeHtml(item.municipio || "")}" data-uf="${escapeHtml(item.uf || "")}" data-entidade="${escapeHtml(item.entidade || "")}" data-email="${escapeHtml(item.email || "")}" data-dirigente="${escapeHtml(item.dirigente || "")}" data-data="${escapeHtml(item.dataSolicitacao || "")}">Rejeitar</button>
                </div>
              </td>`
            : `
              <td>${escapeHtml(item.numeroInscricao || "-")}</td>
              <td>${escapeHtml(item.municipio || "-")}</td>
              <td>${escapeHtml(item.uf || "-")}</td>
              <td>${escapeHtml(item.entidade || "-")}</td>
              <td>${escapeHtml(item.dirigente || "-")}</td>
              <td>${escapeHtml(item.dataSolicitacao || "-")}</td>
              <td>-</td>
              <td>${iconButton("admin-open-cred", item.rowNumber, "icone-credenciamento.svg", "Credenciamento")}</td>
              <td>${iconButton("admin-open-linked", item.rowNumber, "icone-intercambistas-vinculados.svg", "Intercambistas vinculados")}</td>
              <td>${iconButton("admin-remove-host", item.rowNumber, "icone-lixeira.svg", "Remover inscrição")}</td>`
        }
      </tr>`
    )
    .join("");
}

async function refreshAdminArea() {
  const data = await apiFetch("/api/admin/overview", { headers: { Authorization: `Bearer ${state.tokens.admin}` } });
  buildAdminRows(data.solicitacoes || [], "adminPendingTableBody");
  state.ui.adminApproved = data.cadastrados || [];
  buildAdminRows(state.ui.adminApproved, "adminApprovedTableBody");
  applyAdminSearch();
}

function applyAdminSearch() {
  const input = qs("#adminSearchInput");
  if (!input) return;
  const filtered = filterRows(state.ui.adminApproved, input.value);
  buildAdminRows(filtered, "adminApprovedTableBody");
  const count = qs("#adminSearchCount");
  if (count) count.textContent = `${filtered.length} resultado(s)`;
}

function applyHostSearch() {
  const input = qs("#hostSearchInput");
  if (!input) return;
  const filtered = filterRows(state.ui.hostAccepted, input.value);
  buildHostRows(filtered, "hostAcceptedTableBody");
  const count = qs("#hostSearchCount");
  if (count) count.textContent = `${filtered.length} resultado(s)`;
}

function setupWorkspaceActions() {
  qsa("[data-screen]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkspace(btn.dataset.screen));
  });

  const hostRegisterForm = qs("#hostRegisterForm");
  hostRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateRequiredFields(hostRegisterForm)) {
      const dateValue = hostRegisterForm.querySelector('[name="dataPreenchimento"]')?.value || "";
      return setFeedback(
        "hostRegisterFeedback",
        dateValue && !isValidBrDate(dateValue) ? "Informe a data no formato dd/mm/aaaa." : "Preencha todos os campos obrigatórios.",
        false
      );
    }
    setFeedback("hostRegisterFeedback", "Enviando cadastro...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/host/register", { method: "POST", body: JSON.stringify(payloadHostRegister(hostRegisterForm)) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Enviando cadastro do anfitrião...",
          successPath: "Success.json",
          successMessage: "Cadastro processado com sucesso.",
        }
      );
      setFeedback("hostRegisterFeedback", data.updated ? "Cadastro atualizado com sucesso." : "Cadastro concluído.", true);
      showAccessInfoModal(data.accessInfo);
      if (data.emailSent === false) {
        console.error("[EMAIL_HOST_REGISTER_FAIL]", data.mailError || "erro nao informado");
        showMessageModal(
          "Cadastro salvo, e-mail pendente",
          "As informações foram salvas no nosso banco de dados, mas houve falha no envio do e-mail com as instruções de acesso.",
          "warning"
        );
      }
      resetHostRegisterForm(hostRegisterForm);
    } catch (error) {
      setFeedback("hostRegisterFeedback", error.message, false);
    }
  });

  const candidateRegisterForm = qs("#candidateRegisterForm");
  candidateRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateRequiredFields(candidateRegisterForm)) {
      const dateValue = candidateRegisterForm.querySelector('[name="dataPreenchimento"]')?.value || "";
      return setFeedback(
        "candidateRegisterFeedback",
        dateValue && !isValidBrDate(dateValue) ? "Informe a data no formato dd/mm/aaaa." : "Preencha todos os campos obrigatórios.",
        false
      );
    }
    setFeedback("candidateRegisterFeedback", "Enviando cadastro...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/candidate/register", { method: "POST", body: JSON.stringify(payloadCandidateRegister(candidateRegisterForm)) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Enviando cadastro do intercambista...",
          successPath: "Success.json",
          successMessage: "Cadastro enviado com sucesso.",
        }
      );
      setFeedback("candidateRegisterFeedback", "Cadastro concluído. Realize o primeiro acesso para criar sua senha.", true);
      showAccessInfoModal(data.accessInfo);
      if (data?.emailSent === false) {
        console.error("[EMAIL_CANDIDATE_REGISTER_FAIL]", data.mailError || "erro nao informado");
        showMessageModal(
          "Cadastro salvo, e-mail pendente",
          "As informações foram salvas no nosso banco de dados, mas houve falha no envio do e-mail com as instruções de acesso.",
          "warning"
        );
      }
      resetCandidateRegisterForm(candidateRegisterForm);
    } catch (error) {
      setFeedback("candidateRegisterFeedback", error.message, false);
    }
  });

  const candidateFirstAccessForm = qs("#candidateFirstAccessForm");
  candidateFirstAccessForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = collectFormData(candidateFirstAccessForm);
    if (data.novaSenha !== data.confirmSenha) return setFeedback("candidateFirstAccessFeedback", "As senhas não conferem.", false);
    if (!isStrongPassword(data.novaSenha)) return setFeedback("candidateFirstAccessFeedback", "Senha fraca. Use letras, números e caractere especial.", false);
    setFeedback("candidateFirstAccessFeedback", "Processando primeiro acesso...", true);
    try {
      await runWithLottie(
        () => apiFetch("/api/candidate/first-access", { method: "POST", body: JSON.stringify({ cpf: normalizeDigits(data.cpf), email: data.email, novaSenha: data.novaSenha }) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Validando e criando senha...",
          successPath: "Success.json",
          successMessage: "Primeiro acesso concluído.",
        }
      );
      setFeedback("candidateFirstAccessFeedback", "Senha criada com sucesso. Faça login.", true);
      candidateFirstAccessForm.reset();
      openWorkspace("candidate-login");
    } catch (error) {
      setFeedback("candidateFirstAccessFeedback", error.message, false);
    }
  });

  const hostFirstAccessForm = qs("#hostFirstAccessForm");
  hostFirstAccessForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = collectFormData(hostFirstAccessForm);
    if (data.novaSenha !== data.confirmSenha) return setFeedback("hostFirstAccessFeedback", "As senhas não conferem.", false);
    if (!isStrongPassword(data.novaSenha)) return setFeedback("hostFirstAccessFeedback", "Senha fraca. Use letras, números e caractere especial.", false);
    setFeedback("hostFirstAccessFeedback", "Processando primeiro acesso...", true);
    try {
      await runWithLottie(
        () => apiFetch("/api/host/first-access", { method: "POST", body: JSON.stringify({ cnpj: normalizeDigits(data.cnpj), numeroInscricao: data.numeroInscricao, senhaInicial: data.senhaInicial, novaSenha: data.novaSenha }) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Validando e criando senha...",
          successPath: "Success.json",
          successMessage: "Primeiro acesso concluído.",
        }
      );
      setFeedback("hostFirstAccessFeedback", "Senha criada com sucesso. Faça login.", true);
      hostFirstAccessForm.reset();
      openWorkspace("host-login");
    } catch (error) {
      setFeedback("hostFirstAccessFeedback", error.message, false);
    }
  });

  const candidateLoginForm = qs("#candidateLoginForm");
  candidateLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = collectFormData(candidateLoginForm);
    setFeedback("candidateLoginFeedback", "Autenticando...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/candidate/login", { method: "POST", body: JSON.stringify({ cpf: normalizeDigits(payload.cpf), senha: payload.senha }) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Carregando informações para acesso do intercambista...",
          successPath: "Success.json",
          successMessage: "Login realizado.",
          overlayDelayMs: 2500,
        }
      );
      state.tokens.candidate = data.token;
      saveTokens();
      setFeedback("candidateLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("candidate-area");
      await refreshCandidateArea();
    } catch (error) {
      setFeedback("candidateLoginFeedback", error.message, false);
      state.tokens.candidate = "";
      saveTokens();
    }
  });

  const hostLoginForm = qs("#hostLoginForm");
  hostLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = collectFormData(hostLoginForm);
    setFeedback("hostLoginFeedback", "Autenticando...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/host/login", { method: "POST", body: JSON.stringify({ cnpj: normalizeDigits(payload.cnpj), senha: payload.senha }) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Carregando informações para acesso do anfitrião...",
          successPath: "Success.json",
          successMessage: "Login realizado.",
          overlayDelayMs: 2500,
        }
      );
      state.tokens.host = data.token;
      saveTokens();
      setFeedback("hostLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("host-area");
      await refreshHostArea();
    } catch (error) {
      setFeedback("hostLoginFeedback", error.message, false);
      state.tokens.host = "";
      saveTokens();
    }
  });

  const adminLoginForm = qs("#adminLoginForm");
  adminLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = collectFormData(adminLoginForm);
    const adminUser = String(payload.user || "").trim();
    const adminPassword = String(payload.password || "").trim();
    setFeedback("adminLoginFeedback", "Autenticando...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/admin/login", { method: "POST", body: JSON.stringify({ user: adminUser, password: adminPassword }) }),
        {
          loadingPath: "Loading.json",
          loadingMessage: "Carregando informações para acesso do administrador...",
          successPath: "Success.json",
          successMessage: "Login realizado.",
          overlayDelayMs: 2500,
        }
      );
      state.tokens.admin = data.token;
      saveTokens();
      setFeedback("adminLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("admin-area");
      await refreshAdminArea();
    } catch (error) {
      setFeedback("adminLoginFeedback", error.message, false);
      state.tokens.admin = "";
      saveTokens();
    }
  });

  qs("#adminSearchInput")?.addEventListener("input", applyAdminSearch);
  qs("#hostSearchInput")?.addEventListener("input", applyHostSearch);

  document.addEventListener("click", async (event) => {
    const modalChoiceEl = event.target.closest("[data-modal-choice]");
    if (modalChoiceEl && typeof modalChoiceResolver === "function") {
      const resolver = modalChoiceResolver;
      modalChoiceResolver = null;
      const confirmed = modalChoiceEl.dataset.modalChoice === "confirm";
      const modal = qs("#detailsModal");
      if (modal) {
        modal.hidden = true;
        modal.dataset.closeByBackdrop = "true";
        modal.dataset.closeByEsc = "true";
      }
      resolver(confirmed);
      return;
    }
    const closeEl = event.target.closest("[data-close-modal]");
    if (closeEl) {
      const modal = qs("#detailsModal");
      if (!modal) return;
      const isBackdrop = closeEl.classList.contains("data-modal__backdrop");
      if (isBackdrop && modal.dataset.closeByBackdrop === "false") return;
      if (!isBackdrop && event.detail === 0) return;
      closeModal();
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const rowNumber = Number(actionEl.dataset.row || 0);

    try {
      if (action === "select-host") {
        await withActionLottie(
          () =>
            apiFetch("/api/candidate/select-host", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.tokens.candidate}` },
              body: JSON.stringify({ numeroInscricao: actionEl.dataset.host || "" }),
            }),
          "Enviando solicitação ao anfitrião..."
        );
        await refreshCandidateArea();
      }

      if (action === "host-decision") {
        const note = "";
        await withActionLottie(
          () =>
            apiFetch("/api/host/decision", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.tokens.host}` },
              body: JSON.stringify({ candidateRow: rowNumber, decision: actionEl.dataset.decision, note }),
            }),
          actionEl.dataset.decision === "aceito" ? "Registrando aceite..." : "Registrando recusa..."
        );
        await refreshHostArea();
      }

      if (action === "admin-status") {
        await probeBackendReachability("admin-host-status");
        await withActionLottie(
          () =>
            apiFetch("/api/admin/host-status", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.tokens.admin}` },
              body: JSON.stringify({
                rowNumber,
                fingerprint: actionEl.dataset.fingerprint || "",
                status: actionEl.dataset.status,
                cnpj: actionEl.dataset.cnpj || "",
                numeroInscricao: actionEl.dataset.inscricao || "",
                municipio: actionEl.dataset.municipio || "",
                uf: actionEl.dataset.uf || "",
                entidade: actionEl.dataset.entidade || "",
                email: actionEl.dataset.email || "",
                dirigente: actionEl.dataset.dirigente || "",
                dataSolicitacao: actionEl.dataset.data || "",
              }),
            }),
          "Atualizando status do anfitrião..."
        );
        await refreshAdminArea();
      }

      if (action === "admin-open-cred") {
        const data = await withActionLottie(
          () =>
            apiFetch(`/api/admin/host-form/${rowNumber}`, {
              headers: { Authorization: `Bearer ${state.tokens.admin}` },
            }),
          "Carregando credenciamento..."
        );
        openModal("Formulário do Anfitrião", renderFieldList(data.data || {}, HOST_FIELDS));
      }

      if (action === "admin-open-linked") {
        const data = await withActionLottie(
          () =>
            apiFetch(`/api/admin/host-linked/${rowNumber}`, {
              headers: { Authorization: `Bearer ${state.tokens.admin}` },
            }),
          "Carregando vínculos..."
        );
        const rows = data.vinculados || [];
        const html = rows.length
          ? `<div class="table-wrap"><table class="env-table">
              <thead>
                <tr>
                  <th>#</th><th>Inscrição</th><th>Município</th><th>UF</th><th>Unidade Gestora</th><th>Data solicitação</th><th>Data aceite anfitrião</th><th>Plano de trabalho</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${escapeHtml(row.inscricao || "-")}</td>
                      <td>${escapeHtml(row.municipio || "-")}</td>
                      <td>${escapeHtml(row.uf || "-")}</td>
                      <td>${escapeHtml(row.unidadeGestora || "-")}</td>
                      <td>${escapeHtml(row.dataSolicitacao || "-")}</td>
                      <td>${escapeHtml(row.dataDecisao || "-")}</td>
                      <td>${iconButton("admin-open-plan", row.rowNumber, "icone-plano-trabalho.svg", "Plano de trabalho", "modal")}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table></div>`
          : "<p>Nenhum intercambista vinculado.</p>";
        openModal(`Intercambistas vinculados - ${data.host?.unidadeGestora || ""}`, html);
      }

      if (action === "admin-open-plan") {
        const data = await withActionLottie(
          () =>
            apiFetch(`/api/admin/candidate-form/${rowNumber}`, {
              headers: { Authorization: `Bearer ${state.tokens.admin}` },
            }),
          "Carregando plano de trabalho..."
        );
        openModal("Plano de Trabalho do Intercambista", renderFieldList(data.data || {}, CANDIDATE_FIELDS));
      }

      if (action === "host-open-plan") {
        const data = await withActionLottie(
          () =>
            apiFetch(`/api/host/candidate-form/${rowNumber}`, {
              headers: { Authorization: `Bearer ${state.tokens.host}` },
            }),
          "Carregando plano de trabalho..."
        );
        openModal("Plano de Trabalho do Intercambista", renderFieldList(data.data || {}, CANDIDATE_FIELDS));
      }

      if (action === "admin-remove-host") {
        const ok = await showConfirmModal("Confirmação", "Deseja remover a inscrição deste anfitrião?", "Remover");
        if (!ok) return;
        await withActionLottie(
          () =>
            apiFetch("/api/admin/remove-host", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.tokens.admin}` },
              body: JSON.stringify({ rowNumber }),
            }),
          "Removendo anfitrião..."
        );
        await refreshAdminArea();
      }

      if (action === "host-remove-candidate") {
        const ok = await showConfirmModal("Confirmação", "Deseja remover a inscrição deste intercambista?", "Remover");
        if (!ok) return;
        await withActionLottie(
          () =>
            apiFetch("/api/host/remove-candidate", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.tokens.host}` },
              body: JSON.stringify({ candidateRow: rowNumber }),
            }),
          "Removendo intercambista..."
        );
        await refreshHostArea();
      }

      if (action === "logout-admin") {
        state.tokens.admin = "";
        saveTokens();
        openWorkspace("admin-login");
      }
      if (action === "logout-host") {
        state.tokens.host = "";
        saveTokens();
        openWorkspace("host-login");
      }
      if (action === "logout-candidate") {
        state.tokens.candidate = "";
        saveTokens();
        openWorkspace("candidate-login");
      }
    } catch (error) {
      showMessageModal("Erro", error.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  forceHideLottieOverlay();
  forceModalClosed();
  try {
    localStorage.removeItem(STORAGE_KEYS.screen);
  } catch (_) {}
  updateScreenHash("home");
  loadTokens();
  resetHostRegisterForm(qs("#hostRegisterForm"));
  resetCandidateRegisterForm(qs("#candidateRegisterForm"));
  qsa("form").forEach((form) => form.reset());
  setupSmoothScroll();
  setupNavbarToggle();
  setupSystemPanel();
  setupBackToTop();
  setupRevealOnScroll();
  setupNoDraftInputs();
  setupSupportTeamField();
  setupSmartInputs();
  setupCnpjPrefill();
  setupWorkspaceActions();

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = qs("#detailsModal");
    if (!modal || modal.hidden) return;
    if (modal.dataset.closeByEsc === "false") return;
    closeModal();
  });

  const restore = async () => {
    const savedScreen = loadScreen();
    if (!savedScreen || savedScreen === "home") return;

    if (savedScreen === "admin-area") {
      if (!state.tokens.admin) return openWorkspace("admin-login");
      openWorkspace("admin-area");
      try {
        await refreshAdminArea();
      } catch (_) {
        state.tokens.admin = "";
        saveTokens();
        openWorkspace("admin-login");
      }
      return;
    }

    if (savedScreen === "host-area") {
      if (!state.tokens.host) return openWorkspace("host-login");
      openWorkspace("host-area");
      try {
        await refreshHostArea();
      } catch (_) {
        state.tokens.host = "";
        saveTokens();
        openWorkspace("host-login");
      }
      return;
    }

    if (savedScreen === "candidate-area") {
      if (!state.tokens.candidate) return openWorkspace("candidate-login");
      openWorkspace("candidate-area");
      try {
        await refreshCandidateArea();
      } catch (_) {
        state.tokens.candidate = "";
        saveTokens();
        openWorkspace("candidate-login");
      }
      return;
    }

    openWorkspace(savedScreen);
  };

  restore();
});

window.addEventListener("load", () => {
  forceHideLottieOverlay();
  forceModalClosed();
});

window.addEventListener("pagehide", () => {
  persistCurrentScreenFromDOM();
});

window.addEventListener("beforeunload", () => {
  persistCurrentScreenFromDOM();
});


