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

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isStrongPassword(password) {
  const value = String(password || "");
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha na operação.");
  }
  return data;
}

function setFeedback(id, message, ok = false) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.textContent = message || "";
  el.style.color = ok ? "#0a6b43" : "#8d1d1d";
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

  const loadingPath = options.loadingPath || "lottie_save_progress.json";
  const loadingMessage = options.loadingMessage || "Processando...";
  const successPath = options.successPath || "lottie_success_check.json";
  const successMessage = options.successMessage || "Concluído com sucesso.";
  const errorPath = options.errorPath || "lottie_error_generic.json";
  const minLoadingMs = Number(options.minLoadingMs || 450);

  try {
    lottieUi.startedAt = Date.now();
    const started = playOverlayAnimation(loadingPath, loadingMessage, true);
    if (!started) return task();

    const result = await task();
    const elapsed = Date.now() - lottieUi.startedAt;
    if (elapsed < minLoadingMs) await wait(minLoadingMs - elapsed);
    playOverlayAnimation(successPath, successMessage, false);
    await wait(700);
    return result;
  } catch (error) {
    const elapsed = Date.now() - lottieUi.startedAt;
    if (elapsed < minLoadingMs) await wait(minLoadingMs - elapsed);
    playOverlayAnimation(errorPath, error?.message || "Falha na operação.", false);
    await wait(1100);
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
  // O menu superior fica sempre visível no desktop.
  // O hambúrguer controla o painel lateral das áreas do sistema.
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
}

function validateRequiredFields(form) {
  if (!form) return true;
  const requiredFields = [...form.querySelectorAll("[required]")];
  for (const field of requiredFields) {
    if (field.type === "checkbox" && !field.checked) return false;
    if (field.type !== "checkbox") {
      const value = String(field.value || "").trim();
      if (!value) return false;
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
    "Nível do Pró-Gestão": String(formData.nivelProGestao || "").trim(),
    "Número de vagas oferecidas": String(formData.vagas || "").trim(),
    "Nº de áreas/setores disponíveis": String(formData.totalAreas || "").trim(),
    "Outros (especificar)": String(formData.areaOutrosTexto || "").trim(),
    "Equipe de apoio designada (nomes)": equipeApoio,
    "Breve descrição da proposta de intercâmbio": String(formData.proposta || "").trim(),
    "Responsável pelo preenchimento": String(formData.responsavel || "").trim(),
    "Cargo/Função (Responsável)": String(formData.cargoResponsavel || "").trim(),
    "Data": String(formData.dataPreenchimento || "").trim(),
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

function payloadCandidateRegister(form) {
  const formData = collectFormData(form);
  const payload = {
    "UF": String(formData.uf || "").trim().toUpperCase(),
    "Município": String(formData.municipio || "").trim(),
    "Município CNPJ": normalizeDigits(formData.municipioCnpj),
    "Unidade Gestora": String(formData.unidadeGestora || "").trim(),
    "Unidade Gestora CNPJ": normalizeDigits(formData.unidadeGestoraCnpj),
    "Nível do Pró-Gestão": String(formData.nivelProGestao || "").trim(),
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
    "Data": String(formData.dataPreenchimento || "").trim(),
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
  set("nivelProGestao", data.nivelProGestao);
  set("responsavel", data.responsavel);
  set("cargoResponsavel", data.cargoResponsavel);
  set("dataPreenchimento", data.dataPreenchimento);
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
  set("nivelProGestao", data.nivelProGestao);
  set("responsavel", data.responsavel);
  set("cargoResponsavel", data.cargoResponsavel);
  set("dataPreenchimento", data.dataPreenchimento);
}

function setupCnpjPrefill() {
  const hostForm = qs("#hostRegisterForm");
  const candidateForm = qs("#candidateRegisterForm");
  const hostBtn = qs("#hostPrefillByCnpj");
  const candidateBtn = qs("#candidatePrefillByCnpj");

  hostBtn?.addEventListener("click", async () => {
    const raw = hostForm?.querySelector('[name="municipioCnpj"]')?.value || "";
    const cnpj = normalizeDigits(raw);
    if (cnpj.length !== 14) {
      setFeedback("hostRegisterFeedback", "Informe um CNPJ do município válido para buscar.", false);
      return;
    }
    setFeedback("hostRegisterFeedback", "Buscando dados na planilha...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch(`/api/prefill/municipio/${cnpj}`),
        {
          loadingPath: "lottie_search_loading.json",
          loadingMessage: "Buscando dados do município...",
          successMessage: "Dados encontrados.",
        }
      );
      applyPrefillToHostForm(hostForm, data.prefill);
      setFeedback("hostRegisterFeedback", "Dados carregados. Revise e ajuste se necessário.", true);
    } catch (error) {
      setFeedback("hostRegisterFeedback", error.message, false);
    }
  });

  candidateBtn?.addEventListener("click", async () => {
    const raw = candidateForm?.querySelector('[name="municipioCnpj"]')?.value || "";
    const cnpj = normalizeDigits(raw);
    if (cnpj.length !== 14) {
      setFeedback("candidateRegisterFeedback", "Informe um CNPJ do município válido para buscar.", false);
      return;
    }
    setFeedback("candidateRegisterFeedback", "Buscando dados na planilha...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch(`/api/prefill/municipio/${cnpj}`),
        {
          loadingPath: "lottie_search_loading.json",
          loadingMessage: "Buscando dados do município...",
          successMessage: "Dados encontrados.",
        }
      );
      applyPrefillToCandidateForm(candidateForm, data.prefill);
      setFeedback("candidateRegisterFeedback", "Dados carregados. Revise e ajuste se necessário.", true);
    } catch (error) {
      setFeedback("candidateRegisterFeedback", error.message, false);
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

function openModal(title, html) {
  const modal = qs("#detailsModal");
  const modalTitle = qs("#detailsModalTitle");
  const modalBody = qs("#detailsModalBody");
  if (!modal || !modalTitle || !modalBody) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.hidden = false;
}

function closeModal() {
  const modal = qs("#detailsModal");
  if (modal) modal.hidden = true;
}

function renderFieldList(data, fields) {
  return `
    <div class="read-grid">
      ${fields
        .map(
          (field) => `
        <div class="read-item">
          <span>${escapeHtml(field.label)}</span>
          <strong>${escapeHtml(data[field.key] || "-")}</strong>
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
            ${escapeHtml(host.nivelProGestao || "Sem Pró-gestão")}
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
                   <button class="btn btn-primary btn-sm" type="button" data-action="host-decision" data-row="${item.rowNumber}" data-decision="aceito">Aceitar</button>
                   <button class="btn btn-outline btn-sm" type="button" data-action="host-decision" data-row="${item.rowNumber}" data-decision="rejeitado">Rejeitar</button>
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
                  <button class="btn btn-primary btn-sm" type="button" data-action="admin-status" data-row="${item.rowNumber}" data-status="Concedido">Aceitar</button>
                  <button class="btn btn-outline btn-sm" type="button" data-action="admin-status" data-row="${item.rowNumber}" data-status="Negado">Rejeitar</button>
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
      return setFeedback("hostRegisterFeedback", "Preencha todos os campos obrigatórios.", false);
    }
    setFeedback("hostRegisterFeedback", "Enviando cadastro...", true);
    try {
      const data = await runWithLottie(
        () => apiFetch("/api/host/register", { method: "POST", body: JSON.stringify(payloadHostRegister(hostRegisterForm)) }),
        {
          loadingPath: "lottie_save_progress.json",
          loadingMessage: "Enviando cadastro do anfitrião...",
          successMessage: "Cadastro processado com sucesso.",
        }
      );
      setFeedback("hostRegisterFeedback", data.updated ? "Cadastro atualizado com sucesso." : "Cadastro concluído.", true);
      const cred = qs("#hostRegisterCredentials");
      if (cred) {
        cred.textContent = data.updated
          ? `Número de inscrição: ${data.numeroInscricao} | CNPJ: ${data.cnpj}. Informações atualizadas na planilha.`
          : `Número de inscrição: ${data.numeroInscricao} | CNPJ: ${data.cnpj}. Cadastro enviado para aprovação do admin.`;
      }
      if (!data.updated) hostRegisterForm.reset();
    } catch (error) {
      setFeedback("hostRegisterFeedback", error.message, false);
    }
  });

  const candidateRegisterForm = qs("#candidateRegisterForm");
  candidateRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateRequiredFields(candidateRegisterForm)) {
      return setFeedback("candidateRegisterFeedback", "Preencha todos os campos obrigatórios.", false);
    }
    setFeedback("candidateRegisterFeedback", "Enviando cadastro...", true);
    try {
      await runWithLottie(
        () => apiFetch("/api/candidate/register", { method: "POST", body: JSON.stringify(payloadCandidateRegister(candidateRegisterForm)) }),
        {
          loadingPath: "lottie_save_progress.json",
          loadingMessage: "Enviando cadastro do intercambista...",
          successMessage: "Cadastro enviado com sucesso.",
        }
      );
      setFeedback("candidateRegisterFeedback", "Cadastro concluído. Realize o primeiro acesso para criar sua senha.", true);
      candidateRegisterForm.reset();
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
          loadingPath: "lottie_lock_unauthorized.json",
          loadingMessage: "Validando e criando senha...",
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
          loadingPath: "lottie_lock_unauthorized.json",
          loadingMessage: "Validando e criando senha...",
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
          loadingPath: "lottie_lock_unauthorized.json",
          loadingMessage: "Autenticando intercambista...",
          successMessage: "Login realizado.",
        }
      );
      state.tokens.candidate = data.token;
      setFeedback("candidateLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("candidate-area");
      await refreshCandidateArea();
    } catch (error) {
      setFeedback("candidateLoginFeedback", error.message, false);
      state.tokens.candidate = "";
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
          loadingPath: "lottie_lock_unauthorized.json",
          loadingMessage: "Autenticando anfitrião...",
          successMessage: "Login realizado.",
        }
      );
      state.tokens.host = data.token;
      setFeedback("hostLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("host-area");
      await refreshHostArea();
    } catch (error) {
      setFeedback("hostLoginFeedback", error.message, false);
      state.tokens.host = "";
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
          loadingPath: "lottie_lock_unauthorized.json",
          loadingMessage: "Autenticando administrador...",
          successMessage: "Login realizado.",
        }
      );
      state.tokens.admin = data.token;
      setFeedback("adminLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("admin-area");
      await refreshAdminArea();
    } catch (error) {
      setFeedback("adminLoginFeedback", error.message, false);
      state.tokens.admin = "";
    }
  });

  qs("#adminSearchInput")?.addEventListener("input", applyAdminSearch);
  qs("#hostSearchInput")?.addEventListener("input", applyHostSearch);

  qsa("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  document.addEventListener("click", async (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const rowNumber = Number(actionEl.dataset.row || 0);

    try {
      if (action === "select-host") {
        await apiFetch("/api/candidate/select-host", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.candidate}` },
          body: JSON.stringify({ numeroInscricao: actionEl.dataset.host || "" }),
        });
        await refreshCandidateArea();
      }

      if (action === "host-decision") {
        const note = window.prompt("Observação opcional da decisão:", "") || "";
        await apiFetch("/api/host/decision", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.host}` },
          body: JSON.stringify({ candidateRow: rowNumber, decision: actionEl.dataset.decision, note }),
        });
        await refreshHostArea();
      }

      if (action === "admin-status") {
        await apiFetch("/api/admin/host-status", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.admin}` },
          body: JSON.stringify({ rowNumber, status: actionEl.dataset.status }),
        });
        await refreshAdminArea();
      }

      if (action === "admin-open-cred") {
        const data = await apiFetch(`/api/admin/host-form/${rowNumber}`, {
          headers: { Authorization: `Bearer ${state.tokens.admin}` },
        });
        openModal("Formulário do Anfitrião", renderFieldList(data.data || {}, HOST_FIELDS));
      }

      if (action === "admin-open-linked") {
        const data = await apiFetch(`/api/admin/host-linked/${rowNumber}`, {
          headers: { Authorization: `Bearer ${state.tokens.admin}` },
        });
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
        const data = await apiFetch(`/api/admin/candidate-form/${rowNumber}`, {
          headers: { Authorization: `Bearer ${state.tokens.admin}` },
        });
        openModal("Plano de Trabalho do Intercambista", renderFieldList(data.data || {}, CANDIDATE_FIELDS));
      }

      if (action === "host-open-plan") {
        const data = await apiFetch(`/api/host/candidate-form/${rowNumber}`, {
          headers: { Authorization: `Bearer ${state.tokens.host}` },
        });
        openModal("Plano de Trabalho do Intercambista", renderFieldList(data.data || {}, CANDIDATE_FIELDS));
      }

      if (action === "admin-remove-host") {
        if (!window.confirm("Deseja remover a inscrição deste anfitrião?")) return;
        await apiFetch("/api/admin/remove-host", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.admin}` },
          body: JSON.stringify({ rowNumber }),
        });
        await refreshAdminArea();
      }

      if (action === "host-remove-candidate") {
        if (!window.confirm("Deseja remover a inscrição deste intercambista?")) return;
        await apiFetch("/api/host/remove-candidate", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.host}` },
          body: JSON.stringify({ candidateRow: rowNumber }),
        });
        await refreshHostArea();
      }

      if (action === "logout-admin") {
        state.tokens.admin = "";
        openWorkspace("admin-login");
      }
      if (action === "logout-host") {
        state.tokens.host = "";
        openWorkspace("host-login");
      }
      if (action === "logout-candidate") {
        state.tokens.candidate = "";
        openWorkspace("candidate-login");
      }
    } catch (error) {
      window.alert(error.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  forceHideLottieOverlay();
  setupSmoothScroll();
  setupNavbarToggle();
  setupSystemPanel();
  setupBackToTop();
  setupRevealOnScroll();
  setupSupportTeamField();
  setupSmartInputs();
  setupCnpjPrefill();
  setupWorkspaceActions();
});

window.addEventListener("load", () => {
  forceHideLottieOverlay();
});


