const state = {
  tokens: {
    candidate: "",
    host: "",
    admin: "",
  },
  candidateProfile: null,
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
    throw new Error(data.error || "Falha na operacao.");
  }
  return data;
}

function setFeedback(el, message, ok) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("feedback-ok", "feedback-err");
  if (!message) return;
  el.classList.add(ok ? "feedback-ok" : "feedback-err");
}

function showSection(sectionId) {
  qsa(".app-section").forEach((section) => {
    section.classList.remove("active-section");
  });
  const section = qs(`#${sectionId}`);
  if (section) section.classList.add("active-section");
}

function initMenu() {
  const offcanvasEl = qs("#mainAside");
  const offcanvas = offcanvasEl ? bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl) : null;

  qsa("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSection(btn.dataset.target);
      offcanvas?.hide();
    });
  });

  qsa("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSection(btn.dataset.jump);
    });
  });
}

function initLotties() {
  if (!window.lottie) return;
  qsa(".lottie-slot").forEach((slot) => {
    const path = slot.dataset.lottie;
    if (!path) return;
    lottie.loadAnimation({
      container: slot,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path,
    });
  });
}

function participantTemplate(index) {
  return `
    <div class="participant-item" data-index="${index}">
      <div class="participant-grid">
        <input class="form-control" placeholder="Nome completo" data-p="nome" />
        <input class="form-control" placeholder="Cargo/Funcao" data-p="cargo" />
        <input class="form-control" placeholder="Tipo de vinculo" data-p="vinculo" />
        <input class="form-control" placeholder="Area de atuacao" data-p="area" />
        <input class="form-control" placeholder="Certificacao" data-p="certificacao" />
      </div>
    </div>
  `;
}

function initParticipants() {
  const wrap = qs("#participantsWrap");
  const addBtn = qs("#addParticipantBtn");
  if (!wrap || !addBtn) return;

  const add = () => {
    const count = wrap.querySelectorAll(".participant-item").length;
    if (count >= 8) return;
    wrap.insertAdjacentHTML("beforeend", participantTemplate(count + 1));
  };

  add();
  addBtn.addEventListener("click", add);
}

function readParticipants() {
  const items = qsa("#participantsWrap .participant-item");
  return items.map((item) => ({
    nome: item.querySelector('[data-p="nome"]').value.trim(),
    cargo: item.querySelector('[data-p="cargo"]').value.trim(),
    vinculo: item.querySelector('[data-p="vinculo"]').value.trim(),
    area: item.querySelector('[data-p="area"]').value.trim(),
    certificacao: item.querySelector('[data-p="certificacao"]').value.trim(),
  }));
}

function initCandidateGenderPreview() {
  const select = qs("#candidateGenero");
  const img = qs("#candidateFormImage");
  if (!select || !img) return;

  const sync = () => {
    img.src = select.value === "Masculino" ? "img_for_man.svg" : "img_for_woman.svg";
  };

  sync();
  select.addEventListener("change", sync);
}

function collectFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderCandidateHosts(hosts) {
  const wrap = qs("#candidateHostsWrap");
  const badge = qs("#hostsCountBadge");
  if (!wrap || !badge) return;

  badge.textContent = `${hosts.length} disponiveis`;

  if (!hosts.length) {
    wrap.className = "host-list-wrap empty";
    wrap.textContent = "Nenhum anfitriao ativo disponivel.";
    return;
  }

  wrap.className = "host-list-wrap";
  wrap.innerHTML = hosts
    .map((host) => {
      const areas = host.areas?.length ? host.areas.join(", ") : "Nao informado";
      return `
        <div class="host-item">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <strong>${host.entidade}</strong>
              <div class="host-meta">${host.numeroInscricao} | ${host.uf} | Vagas: ${host.vagas || "-"}</div>
            </div>
            <button class="btn btn-sm btn-brand" data-select-host="${host.numeroInscricao}">Escolher</button>
          </div>
          <div class="host-meta mt-2">Areas: ${areas}</div>
          <div class="host-meta">${host.descricao || ""}</div>
        </div>
      `;
    })
    .join("");

  qsa("[data-select-host]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch("/api/candidate/select-host", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.candidate}` },
          body: JSON.stringify({ numeroInscricao: btn.dataset.selectHost }),
        });
        await refreshCandidateStatus();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function setCandidateResult(statusData) {
  const box = qs("#candidateResultBox");
  const image = qs("#candidateLoginImage");
  if (!box || !statusData) return;

  if ((statusData.genero || "").toLowerCase() === "masculino") {
    image.src = "img_for_man.svg";
  } else {
    image.src = "img_for_woman.svg";
  }

  box.classList.remove("success", "error");

  const status = String(statusData.status || "Sem solicitacao");
  if (status.toLowerCase() === "aceito") {
    box.classList.add("success");
    box.textContent = `Aceito. Anfitriao: ${statusData.host || "-"}. Data: ${statusData.dataDecisao || "-"}.`;
    return;
  }
  if (status.toLowerCase() === "rejeitado") {
    box.classList.add("error");
    box.textContent = `Rejeitado. Anfitriao: ${statusData.host || "-"}. Observacao: ${statusData.observacao || "-"}.`;
    return;
  }
  if (status.toLowerCase() === "pendente") {
    box.textContent = `Solicitacao pendente no anfitriao ${statusData.host || "-"}.`;
    return;
  }
  box.textContent = "Sem solicitacao no momento.";
}

async function refreshCandidateStatus() {
  if (!state.tokens.candidate) return;
  const status = await apiFetch("/api/candidate/status", {
    headers: { Authorization: `Bearer ${state.tokens.candidate}` },
  });
  setCandidateResult(status);
}

async function refreshCandidateHosts() {
  if (!state.tokens.candidate) return;
  const data = await apiFetch("/api/candidate/hosts", {
    headers: { Authorization: `Bearer ${state.tokens.candidate}` },
  });
  renderCandidateHosts(data.hosts || []);
}

async function refreshHostRequests() {
  if (!state.tokens.host) return;

  const data = await apiFetch("/api/host/requests", {
    headers: { Authorization: `Bearer ${state.tokens.host}` },
  });

  const wrap = qs("#hostRequestsWrap");
  const badge = qs("#hostPendingBadge");
  if (!wrap || !badge) return;

  const pendentes = data.pendentes || [];
  badge.textContent = `${pendentes.length} pendentes`;

  if (!pendentes.length) {
    wrap.className = "empty-state";
    wrap.textContent = "Nenhuma solicitacao pendente.";
    return;
  }

  wrap.className = "";
  wrap.innerHTML = pendentes
    .map(
      (item) => `
      <div class="request-item">
        <div><strong>${item.entidade}</strong></div>
        <div class="host-meta">CPF: ${item.cpf || "-"}</div>
        <div class="host-meta">Participante(s): ${item.participante || "-"}</div>
        <div class="host-meta mb-2">Objetivo: ${item.objetivo || "-"}</div>
        <div class="request-actions">
          <button class="btn btn-sm btn-success" data-decision="aceito" data-row="${item.rowNumber}">Aceitar</button>
          <button class="btn btn-sm btn-danger" data-decision="rejeitado" data-row="${item.rowNumber}">Rejeitar</button>
        </div>
      </div>
    `
    )
    .join("");

  qsa("[data-decision]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = window.prompt("Observacao opcional da decisao:", "") || "";
      try {
        await apiFetch("/api/host/decision", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.tokens.host}` },
          body: JSON.stringify({
            candidateRow: Number(btn.dataset.row),
            decision: btn.dataset.decision,
            note,
          }),
        });
        await refreshHostRequests();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderAdminOverview(data) {
  const metrics = qs("#adminMetrics");
  const decisionsWrap = qs("#adminDecisionsWrap");
  const hostsWrap = qs("#adminHostsWrap");

  metrics.innerHTML = `
    <div class="metrics-grid">
      <div class="mini"><strong>${data.metrics.totalHosts}</strong><br />Anfitrioes</div>
      <div class="mini"><strong>${data.metrics.totalCandidates}</strong><br />Intercambistas</div>
      <div class="mini"><strong>${data.metrics.totalAceitos}</strong><br />Aceitos</div>
      <div class="mini"><strong>${data.metrics.totalRejeitados}</strong><br />Rejeitados</div>
    </div>
  `;

  const decisions = data.decisions || [];
  if (!decisions.length) {
    decisionsWrap.className = "empty-state";
    decisionsWrap.textContent = "Nenhuma decisao registrada.";
  } else {
    decisionsWrap.className = "";
    decisionsWrap.innerHTML = decisions
      .map(
        (d) => `
        <div class="admin-decision-item">
          <strong>${d.status}</strong> | ${d.entidadeIntercambista} -> ${d.host}
          <div class="host-meta">CPF: ${d.cpf || "-"} | Data: ${d.dataDecisao || "-"}</div>
        </div>
      `
      )
      .join("");
  }

  const hosts = data.hosts || [];
  if (!hosts.length) {
    hostsWrap.className = "empty-state";
    hostsWrap.textContent = "Sem anfitrioes cadastrados.";
  } else {
    hostsWrap.className = "";
    hostsWrap.innerHTML = hosts
      .map(
        (host) => `
        <div class="admin-host-item">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <strong>${host.entidade}</strong>
              <div class="host-meta">${host.numeroInscricao} | ${host.uf} | Vagas: ${host.vagas || "-"}</div>
              <div class="host-meta">Status atual: ${host.status}</div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-success" data-admin-status="Ativo" data-admin-row="${host.rowNumber}">Ativar</button>
              <button class="btn btn-sm btn-outline-danger" data-admin-status="Inativo" data-admin-row="${host.rowNumber}">Inativar</button>
            </div>
          </div>
        </div>
      `
      )
      .join("");

    qsa("[data-admin-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiFetch("/api/admin/host-status", {
            method: "POST",
            headers: { Authorization: `Bearer ${state.tokens.admin}` },
            body: JSON.stringify({ rowNumber: Number(btn.dataset.adminRow), status: btn.dataset.adminStatus }),
          });
          await refreshAdminOverview();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  }
}

async function refreshAdminOverview() {
  if (!state.tokens.admin) return;
  const data = await apiFetch("/api/admin/overview", {
    headers: { Authorization: `Bearer ${state.tokens.admin}` },
  });
  renderAdminOverview(data);
}

function initForms() {
  const hostForm = qs("#hostForm");
  const hostFeedback = qs("#hostFormFeedback");

  hostForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(hostFeedback, "Enviando cadastro...", true);

    const payload = collectFormData(hostForm);
    payload.cnpj = normalizeDigits(payload.cnpj);

    ["areaCadastro", "areaConcessao", "areaCompensacao", "areaAtuaria", "areaInvestimentos", "areaControleInterno", "areaCertificacao", "areaGovernanca", "areaPessoal", "areaTecnologia", "areaContabilidade", "areaOutros"].forEach((key) => {
      payload[key] = hostForm.querySelector(`[name="${key}"]`)?.checked || false;
    });

    try {
      const data = await apiFetch("/api/host/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setFeedback(hostFeedback, `Cadastro concluido. Inscricao: ${data.numeroInscricao}. Senha inicial: ${data.senha}`, true);
      hostForm.reset();
    } catch (error) {
      setFeedback(hostFeedback, error.message, false);
    }
  });

  const candidateForm = qs("#candidateForm");
  const candidateFeedback = qs("#candidateFormFeedback");
  candidateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(candidateFeedback, "Enviando cadastro...", true);

    const payload = collectFormData(candidateForm);
    payload.cpf = normalizeDigits(payload.cpf);
    payload.participantes = readParticipants();
    payload.declaracaoVinculo = candidateForm.querySelector('[name="declaracaoVinculo"]').checked;
    payload.declaracaoCusteio = candidateForm.querySelector('[name="declaracaoCusteio"]').checked;
    payload.declaracaoCiencia = candidateForm.querySelector('[name="declaracaoCiencia"]').checked;

    try {
      await apiFetch("/api/candidate/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setFeedback(candidateFeedback, "Cadastro concluido. Agora use a Area do Intercambista para login com CPF.", true);
      candidateForm.reset();
      qs("#participantsWrap").innerHTML = "";
      initParticipants();
      initCandidateGenderPreview();
    } catch (error) {
      setFeedback(candidateFeedback, error.message, false);
    }
  });

  const candidateLoginForm = qs("#candidateLoginForm");
  const candidateLoginFeedback = qs("#candidateLoginFeedback");
  candidateLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(candidateLoginFeedback, "Autenticando...", true);
    const payload = collectFormData(candidateLoginForm);
    payload.cpf = normalizeDigits(payload.cpf);

    try {
      const data = await apiFetch("/api/candidate/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.tokens.candidate = data.token;
      state.candidateProfile = data.profile;
      setFeedback(candidateLoginFeedback, `Login concluido: ${data.profile.entidade || "Intercambista"}.`, true);
      await refreshCandidateHosts();
      await refreshCandidateStatus();
    } catch (error) {
      state.tokens.candidate = "";
      setFeedback(candidateLoginFeedback, error.message, false);
    }
  });

  const hostLoginForm = qs("#hostLoginForm");
  const hostLoginFeedback = qs("#hostLoginFeedback");
  hostLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(hostLoginFeedback, "Autenticando...", true);
    const payload = collectFormData(hostLoginForm);
    payload.cnpj = normalizeDigits(payload.cnpj);

    try {
      const data = await apiFetch("/api/host/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.tokens.host = data.token;
      setFeedback(hostLoginFeedback, `Login concluido: ${data.profile.entidade}.`, true);
      await refreshHostRequests();
    } catch (error) {
      state.tokens.host = "";
      setFeedback(hostLoginFeedback, error.message, false);
    }
  });

  const adminLoginForm = qs("#adminLoginForm");
  const adminLoginFeedback = qs("#adminLoginFeedback");
  adminLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFeedback(adminLoginFeedback, "Autenticando...", true);
    const payload = collectFormData(adminLoginForm);

    try {
      const data = await apiFetch("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.tokens.admin = data.token;
      setFeedback(adminLoginFeedback, "Login admin concluido.", true);
      await refreshAdminOverview();
    } catch (error) {
      state.tokens.admin = "";
      setFeedback(adminLoginFeedback, error.message, false);
    }
  });

  qs("#adminRefreshBtn")?.addEventListener("click", async () => {
    try {
      await refreshAdminOverview();
    } catch (error) {
      alert(error.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMenu();
  initLotties();
  initParticipants();
  initCandidateGenderPreview();
  initForms();
});
