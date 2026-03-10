const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const xss = require("xss");
const { google } = require("googleapis");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SHEET_ID) {
  throw new Error("Missing GOOGLE_SHEET_ID");
}
if (!ADMIN_USER || !ADMIN_PASSWORD_HASH) {
  throw new Error("Missing ADMIN_USER or ADMIN_PASSWORD_HASH");
}
if (!SESSION_SECRET || SESSION_SECRET.length < 24) {
  throw new Error("SESSION_SECRET must have at least 24 characters");
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        "img-src": ["'self'", "data:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 250,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const HOST_SHEET = "Anfitrião";
const CANDIDATE_SHEET = "Intercambista";

const hostHeaders = [
  "Entidade ou órgão gestor",
  "Unidade Federativa (UF)",
  "Endereço",
  "Nome do Dirigente ou Responsável Legal",
  "Cargo/Função (Dirigente)",
  "Responsável pela coordenação local",
  "E-mail de contato",
  "Telefone de contato",
  "Nível do Pró-Gestão",
  "Número de vagas oferecidas",
  "Nº de áreas/setores disponíveis",
  "Área: Cadastro e Atendimento (Sim/Não)",
  "Área: Concessão e Revisão de Benefícios (Sim/Não)",
  "Área: Compensação Previdenciária (Sim/Não)",
  "Área: Atuária (Sim/Não)",
  "Área: Investimentos (Sim/Não)",
  "Área: Controle Interno (Sim/Não)",
  "Área: Certificação/Pró-Gestão (Sim/Não)",
  "Área: Governança e Transparência (Sim/Não)",
  "Área: Gestão de Pessoal (Sim/Não)",
  "Área: Tecnologia/Sistemas (Sim/Não)",
  "Área: Contabilidade (Sim/Não)",
  "Outros (Sim/Não)",
  "Outros (especificar)",
  "Equipe de apoio designada (nomes)",
  "Breve descrição da proposta de intercâmbio",
  "Responsável pelo preenchimento",
  "Cargo/Função (Responsável)",
  "Data",
  "Numero de Inscricao",
  "CNPJ",
  "Senha Hash",
  "Status do Anfitriao",
];

const candidateHeaders = [
  "Entidade ou órgão gestor",
  "Unidade Federativa (UF)",
  "Nível do Pró-Gestão",
  "Nome do Dirigente ou Responsável Legal",
  "Cargo/Função (Dirigente)",
  "E-mail institucional",
  "Telefone para contato",
  "Participante - Nome completo",
  "Participante - Cargo/Função",
  "Participante - Tipo de vínculo",
  "Participante - Área de atuação (RPPS/EFPC)",
  "Participante - Certificação",
  "Anfitrião de interesse - Prioridade 1",
  "Objetivo principal (Prioridade 1)",
  "Anfitrião de interesse - Prioridade 2",
  "Objetivo principal (Prioridade 2)",
  "Anfitrião de interesse - Prioridade 3",
  "Objetivo principal (Prioridade 3)",
  "Temas/áreas de interesse (texto)",
  "Atividades propostas (agenda por dia)",
  "Objetivos e compromissos (o que pretende implementar/replicar)",
  "Declaração: vínculo formal (Sim/Não)",
  "Declaração: custeio pelo intercambista (Sim/Não)",
  "Declaração: ciência dos termos (Sim/Não)",
  "Responsável pelo preenchimento",
  "Cargo/Função (Responsável)",
  "Data",
  "CPF",
  "Genero",
  "Anfitriao escolhido - Numero de Inscricao",
  "Anfitriao escolhido - Nome",
  "Status da solicitacao",
  "Data da decisao",
  "Observacao da decisao",
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeInput(value, maxLength = 2500) {
  const sanitized = xss(String(value ?? "").trim());
  return sanitized.slice(0, maxLength);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function toColumnLetter(index) {
  let n = index;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function pickServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  const parsed = JSON.parse(raw);
  parsed.private_key = String(parsed.private_key || "").replace(/\\n/g, "\n");
  return parsed;
}

const auth = new google.auth.GoogleAuth({
  credentials: pickServiceAccount(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function getHeader(sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!1:1`,
  });
  return res.data.values?.[0] || [];
}

async function ensureHeaders(sheetName, requiredHeaders) {
  const headers = await getHeader(sheetName);
  if (headers.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${sheetName}'!A1:${toColumnLetter(requiredHeaders.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [requiredHeaders] },
    });
    return requiredHeaders;
  }

  const normalized = headers.map(normalizeText);
  let changed = false;
  requiredHeaders.forEach((needed) => {
    if (!normalized.includes(normalizeText(needed))) {
      headers.push(needed);
      normalized.push(normalizeText(needed));
      changed = true;
    }
  });

  if (changed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${sheetName}'!A1:${toColumnLetter(headers.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  return headers;
}

async function getRows(sheetName, requiredHeaders) {
  const headers = await ensureHeaders(sheetName, requiredHeaders);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!A:ZZ`,
  });

  const values = res.data.values || [];
  if (values.length <= 1) {
    return { headers, rows: [] };
  }

  const rows = values.slice(1).map((line, index) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = line[i] || "";
    });
    return { rowNumber: index + 2, data: obj };
  });

  return { headers, rows };
}

async function appendRow(sheetName, headers, valueByHeader) {
  const row = headers.map((header) => valueByHeader[header] || "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function updateRow(sheetName, headers, rowNumber, valueByHeader) {
  const row = headers.map((header) => valueByHeader[header] || "");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!A${rowNumber}:${toColumnLetter(headers.length)}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function createToken(role, subject) {
  const nonce = crypto.randomBytes(24).toString("hex");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`${role}:${subject}:${nonce}`)
    .digest("hex");
  const token = `${nonce}.${signature}`;
  sessions.set(token, {
    role,
    subject,
    createdAt: Date.now(),
  });
  return token;
}

function requireAuth(role) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const session = sessions.get(token);
    if (!session) {
      return res.status(401).json({ error: "Sessao invalida." });
    }

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      return res.status(401).json({ error: "Sessao expirada." });
    }

    if (role && session.role !== role) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    req.session = session;
    next();
  };
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getHostAreas(hostData) {
  const areaFields = [
    "Área: Cadastro e Atendimento (Sim/Não)",
    "Área: Concessão e Revisão de Benefícios (Sim/Não)",
    "Área: Compensação Previdenciária (Sim/Não)",
    "Área: Atuária (Sim/Não)",
    "Área: Investimentos (Sim/Não)",
    "Área: Controle Interno (Sim/Não)",
    "Área: Certificação/Pró-Gestão (Sim/Não)",
    "Área: Governança e Transparência (Sim/Não)",
    "Área: Gestão de Pessoal (Sim/Não)",
    "Área: Tecnologia/Sistemas (Sim/Não)",
    "Área: Contabilidade (Sim/Não)",
  ];

  return areaFields
    .filter((key) => normalizeText(hostData[key]) === "sim")
    .map((key) => key.replace("Área: ", "").replace(" (Sim/Não)", ""));
}

function publicHostView(hostData) {
  return {
    numeroInscricao: hostData["Numero de Inscricao"] || "",
    entidade: hostData["Entidade ou órgão gestor"] || "",
    uf: hostData["Unidade Federativa (UF)"] || "",
    email: hostData["E-mail de contato"] || "",
    telefone: hostData["Telefone de contato"] || "",
    nivelProGestao: hostData["Nível do Pró-Gestão"] || "",
    vagas: hostData["Número de vagas oferecidas"] || "",
    descricao: hostData["Breve descrição da proposta de intercâmbio"] || "",
    areas: getHostAreas(hostData),
    status: hostData["Status do Anfitriao"] || "Ativo",
  };
}

function generateHostPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function buildHostValueMap(payload, passwordHash, numeroInscricao) {
  const yesNo = (v) => (v ? "Sim" : "Não");

  return {
    "Entidade ou órgão gestor": sanitizeInput(payload.entidade, 200),
    "Unidade Federativa (UF)": sanitizeInput(payload.uf, 2).toUpperCase(),
    "Endereço": sanitizeInput(payload.endereco, 300),
    "Nome do Dirigente ou Responsável Legal": sanitizeInput(payload.dirigente, 200),
    "Cargo/Função (Dirigente)": sanitizeInput(payload.cargoDirigente, 120),
    "Responsável pela coordenação local": sanitizeInput(payload.coordenadorLocal, 200),
    "E-mail de contato": sanitizeInput(payload.email, 150),
    "Telefone de contato": sanitizeInput(payload.telefone, 40),
    "Nível do Pró-Gestão": sanitizeInput(payload.nivelProGestao, 60),
    "Número de vagas oferecidas": sanitizeInput(payload.vagas, 20),
    "Nº de áreas/setores disponíveis": sanitizeInput(payload.totalAreas, 20),
    "Área: Cadastro e Atendimento (Sim/Não)": yesNo(payload.areaCadastro),
    "Área: Concessão e Revisão de Benefícios (Sim/Não)": yesNo(payload.areaConcessao),
    "Área: Compensação Previdenciária (Sim/Não)": yesNo(payload.areaCompensacao),
    "Área: Atuária (Sim/Não)": yesNo(payload.areaAtuaria),
    "Área: Investimentos (Sim/Não)": yesNo(payload.areaInvestimentos),
    "Área: Controle Interno (Sim/Não)": yesNo(payload.areaControleInterno),
    "Área: Certificação/Pró-Gestão (Sim/Não)": yesNo(payload.areaCertificacao),
    "Área: Governança e Transparência (Sim/Não)": yesNo(payload.areaGovernanca),
    "Área: Gestão de Pessoal (Sim/Não)": yesNo(payload.areaPessoal),
    "Área: Tecnologia/Sistemas (Sim/Não)": yesNo(payload.areaTecnologia),
    "Área: Contabilidade (Sim/Não)": yesNo(payload.areaContabilidade),
    "Outros (Sim/Não)": yesNo(payload.areaOutros),
    "Outros (especificar)": sanitizeInput(payload.areaOutrosTexto, 300),
    "Equipe de apoio designada (nomes)": sanitizeInput(payload.equipeApoio, 400),
    "Breve descrição da proposta de intercâmbio": sanitizeInput(payload.proposta, 1200),
    "Responsável pelo preenchimento": sanitizeInput(payload.responsavel, 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload.cargoResponsavel, 120),
    Data: sanitizeInput(payload.dataPreenchimento || nowIsoDate(), 20),
    "Numero de Inscricao": numeroInscricao,
    CNPJ: onlyDigits(payload.cnpj),
    "Senha Hash": passwordHash,
    "Status do Anfitriao": "Ativo",
  };
}

function flattenParticipant(participants, field) {
  return participants
    .map((item) => sanitizeInput(item[field] || "", 180))
    .filter(Boolean)
    .join(" | ");
}

function buildCandidateValueMap(payload) {
  const yesNo = (v) => (v ? "Sim" : "Não");
  const participants = Array.isArray(payload.participantes) ? payload.participantes.slice(0, 8) : [];

  return {
    "Entidade ou órgão gestor": sanitizeInput(payload.entidade, 200),
    "Unidade Federativa (UF)": sanitizeInput(payload.uf, 2).toUpperCase(),
    "Nível do Pró-Gestão": sanitizeInput(payload.nivelProGestao, 60),
    "Nome do Dirigente ou Responsável Legal": sanitizeInput(payload.dirigente, 200),
    "Cargo/Função (Dirigente)": sanitizeInput(payload.cargoDirigente, 120),
    "E-mail institucional": sanitizeInput(payload.email, 150),
    "Telefone para contato": sanitizeInput(payload.telefone, 40),
    "Participante - Nome completo": flattenParticipant(participants, "nome"),
    "Participante - Cargo/Função": flattenParticipant(participants, "cargo"),
    "Participante - Tipo de vínculo": flattenParticipant(participants, "vinculo"),
    "Participante - Área de atuação (RPPS/EFPC)": flattenParticipant(participants, "area"),
    "Participante - Certificação": flattenParticipant(participants, "certificacao"),
    "Anfitrião de interesse - Prioridade 1": sanitizeInput(payload.prioridade1Host, 200),
    "Objetivo principal (Prioridade 1)": sanitizeInput(payload.prioridade1Objetivo, 600),
    "Anfitrião de interesse - Prioridade 2": sanitizeInput(payload.prioridade2Host, 200),
    "Objetivo principal (Prioridade 2)": sanitizeInput(payload.prioridade2Objetivo, 600),
    "Anfitrião de interesse - Prioridade 3": sanitizeInput(payload.prioridade3Host, 200),
    "Objetivo principal (Prioridade 3)": sanitizeInput(payload.prioridade3Objetivo, 600),
    "Temas/áreas de interesse (texto)": sanitizeInput(payload.temas, 1200),
    "Atividades propostas (agenda por dia)": sanitizeInput(payload.atividades, 2000),
    "Objetivos e compromissos (o que pretende implementar/replicar)": sanitizeInput(payload.objetivosCompromissos, 1500),
    "Declaração: vínculo formal (Sim/Não)": yesNo(payload.declaracaoVinculo),
    "Declaração: custeio pelo intercambista (Sim/Não)": yesNo(payload.declaracaoCusteio),
    "Declaração: ciência dos termos (Sim/Não)": yesNo(payload.declaracaoCiencia),
    "Responsável pelo preenchimento": sanitizeInput(payload.responsavel, 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload.cargoResponsavel, 120),
    Data: sanitizeInput(payload.dataPreenchimento || nowIsoDate(), 20),
    CPF: onlyDigits(payload.cpf),
    Genero: sanitizeInput(payload.genero, 20),
    "Anfitriao escolhido - Numero de Inscricao": "",
    "Anfitriao escolhido - Nome": "",
    "Status da solicitacao": "Sem solicitacao",
    "Data da decisao": "",
    "Observacao da decisao": "",
  };
}

async function getNextHostRegistration(rows) {
  const max = rows.reduce((acc, row) => {
    const value = String(row.data["Numero de Inscricao"] || "");
    const num = Number((value.match(/(\d+)$/) || [])[1]);
    return Number.isFinite(num) && num > acc ? num : acc;
  }, 0);

  const next = String(max + 1).padStart(4, "0");
  return `ANF-${new Date().getFullYear()}-${next}`;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post("/api/host/register", loginLimiter, async (req, res) => {
  try {
    const cnpj = onlyDigits(req.body.cnpj);
    if (cnpj.length !== 14) {
      return res.status(400).json({ error: "CNPJ invalido." });
    }

    const { headers, rows } = await getRows(HOST_SHEET, hostHeaders);
    const existing = rows.find((row) => onlyDigits(row.data.CNPJ) === cnpj);
    if (existing) {
      return res.status(409).json({ error: "CNPJ ja cadastrado." });
    }

    const senha = generateHostPassword();
    const senhaHash = await bcrypt.hash(senha, 12);
    const numeroInscricao = await getNextHostRegistration(rows);

    const valueMap = buildHostValueMap(req.body, senhaHash, numeroInscricao);
    await appendRow(HOST_SHEET, headers, valueMap);

    return res.status(201).json({
      numeroInscricao,
      cnpj,
      senha,
      message: "Cadastro de anfitriao realizado.",
    });
  } catch (error) {
    console.error("host/register", error);
    return res.status(500).json({ error: "Falha ao cadastrar anfitriao." });
  }
});

app.post("/api/host/login", loginLimiter, async (req, res) => {
  try {
    const cnpj = onlyDigits(req.body.cnpj);
    const senha = String(req.body.senha || "");

    const { rows } = await getRows(HOST_SHEET, hostHeaders);
    const found = rows.find((row) => onlyDigits(row.data.CNPJ) === cnpj);

    if (!found) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    const passOk = await bcrypt.compare(senha, found.data["Senha Hash"] || "");
    if (!passOk) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    const token = createToken("host", String(found.rowNumber));
    return res.json({
      token,
      profile: {
        numeroInscricao: found.data["Numero de Inscricao"] || "",
        entidade: found.data["Entidade ou órgão gestor"] || "",
        status: found.data["Status do Anfitriao"] || "Ativo",
      },
    });
  } catch (error) {
    console.error("host/login", error);
    return res.status(500).json({ error: "Falha no login do anfitriao." });
  }
});

app.get("/api/host/requests", requireAuth("host"), async (req, res) => {
  try {
    const hostRow = Number(req.session.subject);

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = hostData.rows.find((item) => item.rowNumber === hostRow);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitriao nao encontrado." });
    }

    const hostNumero = hostRowData.data["Numero de Inscricao"];
    const hostStatus = normalizeText(hostRowData.data["Status do Anfitriao"] || "ativo");
    if (hostStatus !== "ativo") {
      return res.status(403).json({ error: "Anfitriao inativo. Contate o admin." });
    }

    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const pendentes = candidates.rows
      .filter((row) => {
        const selectedHost = String(row.data["Anfitriao escolhido - Numero de Inscricao"] || "");
        const status = normalizeText(row.data["Status da solicitacao"] || "");
        return selectedHost === hostNumero && status === "pendente";
      })
      .map((row) => ({
        rowNumber: row.rowNumber,
        cpf: row.data.CPF,
        entidade: row.data["Entidade ou órgão gestor"],
        participante: row.data["Participante - Nome completo"],
        objetivo: row.data["Objetivo principal (Prioridade 1)"],
      }));

    res.json({
      host: {
        numeroInscricao: hostNumero,
        entidade: hostRowData.data["Entidade ou órgão gestor"],
      },
      pendentes,
    });
  } catch (error) {
    console.error("host/requests", error);
    res.status(500).json({ error: "Falha ao carregar solicitacoes." });
  }
});

app.post("/api/host/decision", requireAuth("host"), async (req, res) => {
  try {
    const candidateRow = Number(req.body.candidateRow);
    const decision = normalizeText(req.body.decision);
    const note = sanitizeInput(req.body.note || "", 600);

    if (!candidateRow || !["aceito", "rejeitado"].includes(decision)) {
      return res.status(400).json({ error: "Dados invalidos para decisao." });
    }

    const hostRow = Number(req.session.subject);
    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = hostData.rows.find((item) => item.rowNumber === hostRow);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitriao nao encontrado." });
    }

    const hostNumero = hostRowData.data["Numero de Inscricao"];
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const target = candidates.rows.find((row) => row.rowNumber === candidateRow);

    if (!target) {
      return res.status(404).json({ error: "Solicitacao nao encontrada." });
    }

    if (String(target.data["Anfitriao escolhido - Numero de Inscricao"] || "") !== hostNumero) {
      return res.status(403).json({ error: "Solicitacao nao pertence ao anfitriao logado." });
    }

    target.data["Status da solicitacao"] = decision === "aceito" ? "Aceito" : "Rejeitado";
    target.data["Data da decisao"] = nowIsoDate();
    target.data["Observacao da decisao"] = note;

    await updateRow(CANDIDATE_SHEET, candidates.headers, target.rowNumber, target.data);

    res.json({ ok: true });
  } catch (error) {
    console.error("host/decision", error);
    res.status(500).json({ error: "Falha ao registrar decisao." });
  }
});

app.post("/api/candidate/register", loginLimiter, async (req, res) => {
  try {
    const cpf = onlyDigits(req.body.cpf);
    if (cpf.length !== 11) {
      return res.status(400).json({ error: "CPF invalido." });
    }

    const dataset = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const existing = dataset.rows.find((row) => onlyDigits(row.data.CPF) === cpf);
    if (existing) {
      return res.status(409).json({ error: "CPF ja cadastrado. Use o login." });
    }

    const row = buildCandidateValueMap(req.body);
    await appendRow(CANDIDATE_SHEET, dataset.headers, row);

    res.status(201).json({ ok: true, message: "Cadastro do intercambista realizado." });
  } catch (error) {
    console.error("candidate/register", error);
    res.status(500).json({ error: "Falha ao cadastrar intercambista." });
  }
});

app.post("/api/candidate/login", loginLimiter, async (req, res) => {
  try {
    const cpf = onlyDigits(req.body.cpf);
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const found = candidates.rows.find((row) => onlyDigits(row.data.CPF) === cpf);

    if (!found) {
      return res.status(404).json({ error: "CPF nao encontrado." });
    }

    const token = createToken("candidate", String(found.rowNumber));
    res.json({
      token,
      profile: {
        entidade: found.data["Entidade ou órgão gestor"] || "",
        cpf,
        genero: found.data.Genero || "",
        status: found.data["Status da solicitacao"] || "Sem solicitacao",
        hostSelecionado: found.data["Anfitriao escolhido - Nome"] || "",
      },
    });
  } catch (error) {
    console.error("candidate/login", error);
    res.status(500).json({ error: "Falha no login do intercambista." });
  }
});

app.get("/api/candidate/hosts", requireAuth("candidate"), async (req, res) => {
  try {
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const ativos = hosts.rows
      .map((row) => publicHostView(row.data))
      .filter((host) => normalizeText(host.status) === "ativo");

    res.json({ hosts: ativos });
  } catch (error) {
    console.error("candidate/hosts", error);
    res.status(500).json({ error: "Falha ao listar anfitrioes." });
  }
});

app.post("/api/candidate/select-host", requireAuth("candidate"), async (req, res) => {
  try {
    const hostNumero = sanitizeInput(req.body.numeroInscricao, 40);
    if (!hostNumero) {
      return res.status(400).json({ error: "Informe um anfitriao." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => row.data["Numero de Inscricao"] === hostNumero);
    if (!host) {
      return res.status(404).json({ error: "Anfitriao nao encontrado." });
    }

    if (normalizeText(host.data["Status do Anfitriao"] || "") !== "ativo") {
      return res.status(400).json({ error: "Anfitriao inativo para novas solicitacoes." });
    }

    const candidateRow = Number(req.session.subject);
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => row.rowNumber === candidateRow);

    if (!candidate) {
      return res.status(404).json({ error: "Intercambista nao encontrado." });
    }

    candidate.data["Anfitriao escolhido - Numero de Inscricao"] = hostNumero;
    candidate.data["Anfitriao escolhido - Nome"] = host.data["Entidade ou órgão gestor"] || "";
    candidate.data["Status da solicitacao"] = "Pendente";
    candidate.data["Data da decisao"] = "";
    candidate.data["Observacao da decisao"] = "";

    await updateRow(CANDIDATE_SHEET, candidates.headers, candidate.rowNumber, candidate.data);
    res.json({ ok: true, message: "Solicitacao enviada para o anfitriao." });
  } catch (error) {
    console.error("candidate/select-host", error);
    res.status(500).json({ error: "Falha ao registrar solicitacao." });
  }
});

app.get("/api/candidate/status", requireAuth("candidate"), async (req, res) => {
  try {
    const candidateRow = Number(req.session.subject);
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => row.rowNumber === candidateRow);

    if (!candidate) {
      return res.status(404).json({ error: "Intercambista nao encontrado." });
    }

    res.json({
      status: candidate.data["Status da solicitacao"] || "Sem solicitacao",
      host: candidate.data["Anfitriao escolhido - Nome"] || "",
      hostNumero: candidate.data["Anfitriao escolhido - Numero de Inscricao"] || "",
      observacao: candidate.data["Observacao da decisao"] || "",
      dataDecisao: candidate.data["Data da decisao"] || "",
      genero: candidate.data.Genero || "",
    });
  } catch (error) {
    console.error("candidate/status", error);
    res.status(500).json({ error: "Falha ao consultar status." });
  }
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  try {
    const user = sanitizeInput(req.body.user, 120);
    const password = String(req.body.password || "");

    if (user !== ADMIN_USER) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!ok) {
      return res.status(401).json({ error: "Credenciais invalidas." });
    }

    const token = createToken("admin", user);
    res.json({ token });
  } catch (error) {
    console.error("admin/login", error);
    res.status(500).json({ error: "Falha no login de admin." });
  }
});

app.get("/api/admin/overview", requireAuth("admin"), async (req, res) => {
  try {
    const hostsData = await getRows(HOST_SHEET, hostHeaders);
    const candidatesData = await getRows(CANDIDATE_SHEET, candidateHeaders);

    const hosts = hostsData.rows.map((row) => ({
      rowNumber: row.rowNumber,
      numeroInscricao: row.data["Numero de Inscricao"] || "",
      entidade: row.data["Entidade ou órgão gestor"] || "",
      cnpj: row.data.CNPJ || "",
      status: row.data["Status do Anfitriao"] || "Ativo",
      vagas: row.data["Número de vagas oferecidas"] || "",
      uf: row.data["Unidade Federativa (UF)"] || "",
    }));

    const decisions = candidatesData.rows
      .filter((row) => {
        const status = normalizeText(row.data["Status da solicitacao"] || "");
        return status === "aceito" || status === "rejeitado";
      })
      .map((row) => ({
        rowNumber: row.rowNumber,
        entidadeIntercambista: row.data["Entidade ou órgão gestor"] || "",
        cpf: row.data.CPF || "",
        host: row.data["Anfitriao escolhido - Nome"] || "",
        status: row.data["Status da solicitacao"] || "",
        dataDecisao: row.data["Data da decisao"] || "",
      }));

    res.json({
      metrics: {
        totalHosts: hosts.length,
        totalCandidates: candidatesData.rows.length,
        totalAceitos: decisions.filter((d) => normalizeText(d.status) === "aceito").length,
        totalRejeitados: decisions.filter((d) => normalizeText(d.status) === "rejeitado").length,
      },
      hosts,
      decisions,
    });
  } catch (error) {
    console.error("admin/overview", error);
    res.status(500).json({ error: "Falha ao carregar gerenciador." });
  }
});

app.post("/api/admin/host-status", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.body.rowNumber);
    const status = normalizeText(req.body.status) === "inativo" ? "Inativo" : "Ativo";

    const data = await getRows(HOST_SHEET, hostHeaders);
    const host = data.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitriao nao encontrado." });
    }

    host.data["Status do Anfitriao"] = status;
    await updateRow(HOST_SHEET, data.headers, host.rowNumber, host.data);

    res.json({ ok: true, status });
  } catch (error) {
    console.error("admin/host-status", error);
    res.status(500).json({ error: "Falha ao alterar status do anfitriao." });
  }
});

app.post("/api/logout", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  sessions.delete(token);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname)));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor ativo em http://localhost:${PORT}`);
});
