const state = {
  tokens: {
    candidate: "",
    host: "",
    admin: "",
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

async function refreshCandidateArea() {
  const status = await apiFetch("/api/candidate/status", { headers: { Authorization: `Bearer ${state.tokens.candidate}` } });
  const hosts = await apiFetch("/api/candidate/hosts", { headers: { Authorization: `Bearer ${state.tokens.candidate}` } });

  const statusBox = qs("#candidateStatusBox");
  if (statusBox) statusBox.textContent = `Status: ${status.status || "Sem solicitação"}. Anfitrião: ${status.host || "-"}.`;

  const list = qs("#candidateHostsList");
  if (!list) return;

  const items = hosts.hosts || [];
  if (!items.length) {
    list.textContent = "Nenhum anfitrião ativo disponível.";
    return;
  }

  list.innerHTML = items.map((host) => `
    <div class="item-row">
      <strong>${host.entidade}</strong><br />
      <small>${host.numeroInscricao} | ${host.uf} | Vagas: ${host.vagas || "-"}</small><br />
      <small>Áreas: ${(host.areas || []).join(", ") || "Não informado"}</small>
      <div style="margin-top:0.5rem;"><button class="btn btn-primary" type="button" data-select-host="${host.numeroInscricao}">Escolher</button></div>
    </div>`).join("");

  qsa("[data-select-host]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch("/api/candidate/select-host", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.candidate}` },
          body: JSON.stringify({ numeroInscricao: btn.dataset.selectHost }),
        });
        await refreshCandidateArea();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function refreshHostArea() {
  const data = await apiFetch("/api/host/requests", { headers: { Authorization: `Bearer ${state.tokens.host}` } });
  const list = qs("#hostRequestsList");
  if (!list) return;

  const pendentes = data.pendentes || [];
  if (!pendentes.length) {
    list.textContent = "Nenhuma solicitação pendente.";
    return;
  }

  list.innerHTML = pendentes.map((item) => `
    <div class="item-row">
      <strong>${item.entidade}</strong><br />
      <small>CPF: ${item.cpf || "-"}</small><br />
      <small>Participante: ${item.participante || "-"}</small><br />
      <small>Objetivo: ${item.objetivo || "-"}</small>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
        <button class="btn btn-primary" type="button" data-host-decision="aceito" data-host-row="${item.rowNumber}">Aceitar</button>
        <button class="btn btn-outline" type="button" data-host-decision="rejeitado" data-host-row="${item.rowNumber}">Rejeitar</button>
      </div>
    </div>`).join("");

  qsa("[data-host-decision]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = window.prompt("Observação opcional da decisão:", "") || "";
      try {
        await apiFetch("/api/host/decision", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.host}` },
          body: JSON.stringify({ candidateRow: Number(btn.dataset.hostRow), decision: btn.dataset.hostDecision, note }),
        });
        await refreshHostArea();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function refreshAdminArea() {
  const data = await apiFetch("/api/admin/overview", { headers: { Authorization: `Bearer ${state.tokens.admin}` } });

  const metrics = qs("#adminMetrics");
  if (metrics) metrics.innerHTML = `Anfitriões cadastrados: ${data.metrics.totalHosts} | Intercambistas: ${data.metrics.totalCandidates} | Aceitos: ${data.metrics.totalAceitos} | Rejeitados: ${data.metrics.totalRejeitados}`;

  const decisionsList = qs("#adminDecisionsList");
  if (decisionsList) {
    const decisions = data.decisions || [];
    decisionsList.innerHTML = decisions.length
      ? decisions.map((d) => `<div class="item-row"><strong>${d.status}</strong> - ${d.entidadeIntercambista} -> ${d.host}<br /><small>CPF: ${d.cpf || "-"} | Data: ${d.dataDecisao || "-"} | Permissão anfitrião: ${d.permissaoAnfitriao || "-"}</small></div>`).join("")
      : "Sem decisões.";
  }

  const hostsList = qs("#adminHostsList");
  if (hostsList) {
    const hosts = data.hosts || [];
    hostsList.innerHTML = hosts.length
      ? hosts.map((host) => `<div class="item-row"><strong>${host.entidade}</strong><br /><small>${host.numeroInscricao} | ${host.uf} | Status: ${host.status} | Permissão admin: ${host.permissaoAdmin || "Pendente"} | Intercambistas aceitos: ${host.intercambistasAceitos || 0}</small><div style="margin-top:0.5rem; display:flex; gap:0.5rem;"><button class="btn btn-primary" type="button" data-admin-status="Concedido" data-admin-row="${host.rowNumber}">Conceder</button><button class="btn btn-outline" type="button" data-admin-status="Negado" data-admin-row="${host.rowNumber}">Negar</button></div></div>`).join("")
      : "Sem anfitriões cadastrados.";

    qsa("[data-admin-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiFetch("/api/admin/host-status", {
            method: "POST",
            headers: { Authorization: `Bearer ${state.tokens.admin}` },
            body: JSON.stringify({ rowNumber: Number(btn.dataset.adminRow), status: btn.dataset.adminStatus }),
          });
          await refreshAdminArea();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  }
}

function setupWorkspaceActions() {
  qsa("[data-screen]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkspace(btn.dataset.screen));
  });

  const hostRegisterForm = qs("#hostRegisterForm");
  hostRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback("hostRegisterFeedback", "Enviando cadastro...", true);
    try {
      const data = await apiFetch("/api/host/register", { method: "POST", body: JSON.stringify(payloadHostRegister(hostRegisterForm)) });
      setFeedback("hostRegisterFeedback", "Cadastro concluído.", true);
      const cred = qs("#hostRegisterCredentials");
      if (cred) cred.textContent = `Número de inscrição: ${data.numeroInscricao} | CNPJ: ${data.cnpj}. Cadastro enviado para aprovação do admin.`;
      hostRegisterForm.reset();
    } catch (error) {
      setFeedback("hostRegisterFeedback", error.message, false);
    }
  });

  const candidateRegisterForm = qs("#candidateRegisterForm");
  candidateRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback("candidateRegisterFeedback", "Enviando cadastro...", true);
    try {
      await apiFetch("/api/candidate/register", { method: "POST", body: JSON.stringify(payloadCandidateRegister(candidateRegisterForm)) });
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
      await apiFetch("/api/candidate/first-access", { method: "POST", body: JSON.stringify({ cpf: normalizeDigits(data.cpf), email: data.email, novaSenha: data.novaSenha }) });
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
      await apiFetch("/api/host/first-access", { method: "POST", body: JSON.stringify({ cnpj: normalizeDigits(data.cnpj), numeroInscricao: data.numeroInscricao, senhaInicial: data.senhaInicial, novaSenha: data.novaSenha }) });
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
      const data = await apiFetch("/api/candidate/login", { method: "POST", body: JSON.stringify({ cpf: normalizeDigits(payload.cpf), senha: payload.senha }) });
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
      const data = await apiFetch("/api/host/login", { method: "POST", body: JSON.stringify({ cnpj: normalizeDigits(payload.cnpj), senha: payload.senha }) });
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
      const data = await apiFetch("/api/admin/login", { method: "POST", body: JSON.stringify({ user: adminUser, password: adminPassword }) });
      state.tokens.admin = data.token;
      setFeedback("adminLoginFeedback", "Login realizado com sucesso.", true);
      openWorkspace("admin-area");
      await refreshAdminArea();
    } catch (error) {
      setFeedback("adminLoginFeedback", error.message, false);
      state.tokens.admin = "";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupSmoothScroll();
  setupNavbarToggle();
  setupSystemPanel();
  setupBackToTop();
  setupRevealOnScroll();
  setupSupportTeamField();
  setupWorkspaceActions();
});


