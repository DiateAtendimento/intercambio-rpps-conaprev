const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const xss = require("xss");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_PASSWORD_PLAIN = process.env.ADMIN_PASSWORD_PLAIN;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

if (!SHEET_ID) {
  throw new Error("Missing GOOGLE_SHEET_ID");
}
if (!ADMIN_USER || (!ADMIN_PASSWORD_HASH && !ADMIN_PASSWORD_PLAIN)) {
  throw new Error("Missing ADMIN_USER and one of ADMIN_PASSWORD_HASH or ADMIN_PASSWORD_PLAIN");
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
  "Inscrição",
  "UF",
  "Município",
  "Município CNPJ",
  "Unidade Gestora",
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
  "Senha",
  "Primeiro Acesso Concluído",
  "Status do Anfitrião",
  "Permissão admin",
];

const candidateHeaders = [
  "Inscrição",
  "UF",
  "Município",
  "Município CNPJ",
  "Unidade Gestora",
  "Unidade Gestora CNPJ",
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
  "Senha",
  "CPF",
  "Gênero",
  "Primeiro Acesso Concluído",
  "Anfitrião escolhido - Inscrição",
  "Anfitrião escolhido - Nome",
  "Status da solicitação",
  "Data da decisão",
  "Observação da decisão",
  "Permissão anfitrião",
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
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();

  if (raw) {
    // Primary path: full service account JSON in one env var.
    try {
      const parsed = JSON.parse(raw);
      parsed.private_key = String(parsed.private_key || "").replace(/\\n/g, "\n");
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key");
      }
      return parsed;
    } catch (error) {
      // Fallback path: some platforms store only the PEM key in this var.
      const maybePem = raw.includes("BEGIN PRIVATE KEY");
      if (!maybePem) {
        throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON");
      }
    }
  }

  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = raw || String(process.env.GOOGLE_PRIVATE_KEY || "").trim();
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google credentials. Use GOOGLE_SERVICE_ACCOUNT_JSON (full JSON) or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY."
    );
  }

  return {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID || undefined,
    private_key: privateKey,
    client_email: clientEmail,
  };
}

const auth = new google.auth.GoogleAuth({
  credentials: pickServiceAccount(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const mailer =
  SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

async function sendEmail(to, subject, text) {
  if (!to) return;
  if (!mailer) {
    console.warn(`[mail-disabled] ${subject} -> ${to}`);
    return;
  }
  await mailer.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
  });
}

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
      return res.status(401).json({ error: "Sessão inválida." });
    }

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      return res.status(401).json({ error: "Sessão expirada." });
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
    numeroInscricao: hostData["Inscrição"] || "",
    entidade: hostData["Unidade Gestora"] || "",
    uf: hostData.UF || "",
    email: hostData["E-mail de contato"] || "",
    telefone: hostData["Telefone de contato"] || "",
    nivelProGestao: hostData["Nível do Pró-Gestão"] || "",
    vagas: hostData["Número de vagas oferecidas"] || "",
    descricao: hostData["Breve descrição da proposta de intercâmbio"] || "",
    areas: getHostAreas(hostData),
    status: hostData["Status do Anfitrião"] || "Ativo",
  };
}

function generateHostPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "!@#$%&*";
  const pick = (pool) => pool.charAt(Math.floor(Math.random() * pool.length));

  // 2 maiusculas + 1 minuscula + 4 numeros + 1 especial
  return `${pick(upper)}${pick(upper)}${pick(lower)}${pick(digits)}${pick(digits)}${pick(digits)}${pick(digits)}${pick(special)}`;
}

function isStrongPassword(password) {
  const value = String(password || "");
  if (value.length < 8) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (!/\d/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

function buildHostValueMap(payload, passwordHash, numeroInscricao) {
  const yesNo = (v) => (v ? "Sim" : "Não");

  return {
    "Inscrição": numeroInscricao,
    "UF": sanitizeInput(payload["UF"], 2).toUpperCase(),
    "Município": sanitizeInput(payload["Município"], 200),
    "Município CNPJ": onlyDigits(payload["Município CNPJ"]),
    "Unidade Gestora": sanitizeInput(payload["Unidade Gestora"], 250),
    "Endereço": sanitizeInput(payload["Endereço"], 300),
    "Nome do Dirigente ou Responsável Legal": sanitizeInput(payload["Nome do Dirigente ou Responsável Legal"], 200),
    "Cargo/Função (Dirigente)": sanitizeInput(payload["Cargo/Função (Dirigente)"], 120),
    "Responsável pela coordenação local": sanitizeInput(payload["Responsável pela coordenação local"], 200),
    "E-mail de contato": sanitizeInput(payload["E-mail de contato"], 150),
    "Telefone de contato": sanitizeInput(payload["Telefone de contato"], 40),
    "Nível do Pró-Gestão": sanitizeInput(payload["Nível do Pró-Gestão"], 60),
    "Número de vagas oferecidas": sanitizeInput(payload["Número de vagas oferecidas"], 20),
    "Nº de áreas/setores disponíveis": sanitizeInput(payload["Nº de áreas/setores disponíveis"], 20),
    "Área: Cadastro e Atendimento (Sim/Não)": yesNo(payload["Área: Cadastro e Atendimento (Sim/Não)"]),
    "Área: Concessão e Revisão de Benefícios (Sim/Não)": yesNo(payload["Área: Concessão e Revisão de Benefícios (Sim/Não)"]),
    "Área: Compensação Previdenciária (Sim/Não)": yesNo(payload["Área: Compensação Previdenciária (Sim/Não)"]),
    "Área: Atuária (Sim/Não)": yesNo(payload["Área: Atuária (Sim/Não)"]),
    "Área: Investimentos (Sim/Não)": yesNo(payload["Área: Investimentos (Sim/Não)"]),
    "Área: Controle Interno (Sim/Não)": yesNo(payload["Área: Controle Interno (Sim/Não)"]),
    "Área: Certificação/Pró-Gestão (Sim/Não)": yesNo(payload["Área: Certificação/Pró-Gestão (Sim/Não)"]),
    "Área: Governança e Transparência (Sim/Não)": yesNo(payload["Área: Governança e Transparência (Sim/Não)"]),
    "Área: Gestão de Pessoal (Sim/Não)": yesNo(payload["Área: Gestão de Pessoal (Sim/Não)"]),
    "Área: Tecnologia/Sistemas (Sim/Não)": yesNo(payload["Área: Tecnologia/Sistemas (Sim/Não)"]),
    "Área: Contabilidade (Sim/Não)": yesNo(payload["Área: Contabilidade (Sim/Não)"]),
    "Outros (Sim/Não)": yesNo(payload["Outros (Sim/Não)"]),
    "Outros (especificar)": sanitizeInput(payload["Outros (especificar)"], 300),
    "Equipe de apoio designada (nomes)": sanitizeInput(payload["Equipe de apoio designada (nomes)"], 400),
    "Breve descrição da proposta de intercâmbio": sanitizeInput(payload["Breve descrição da proposta de intercâmbio"], 1200),
    "Responsável pelo preenchimento": sanitizeInput(payload["Responsável pelo preenchimento"], 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload["Cargo/Função (Responsável)"], 120),
    Data: sanitizeInput(payload.Data || nowIsoDate(), 20),
    "Senha": passwordHash || "",
    "Primeiro Acesso Concluído": "Não",
    "Status do Anfitrião": "Ativo",
    "Permissão admin": "Pendente",
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
    "Inscrição": "",
    "UF": sanitizeInput(payload["UF"], 2).toUpperCase(),
    "Município": sanitizeInput(payload["Município"], 200),
    "Município CNPJ": onlyDigits(payload["Município CNPJ"]),
    "Unidade Gestora": sanitizeInput(payload["Unidade Gestora"], 250),
    "Unidade Gestora CNPJ": onlyDigits(payload["Unidade Gestora CNPJ"]),
    "Nível do Pró-Gestão": sanitizeInput(payload["Nível do Pró-Gestão"], 60),
    "Nome do Dirigente ou Responsável Legal": sanitizeInput(payload["Nome do Dirigente ou Responsável Legal"], 200),
    "Cargo/Função (Dirigente)": sanitizeInput(payload["Cargo/Função (Dirigente)"], 120),
    "E-mail institucional": sanitizeInput(payload["E-mail institucional"], 150),
    "Telefone para contato": sanitizeInput(payload["Telefone para contato"], 40),
    "Participante - Nome completo": flattenParticipant(participants, "nome"),
    "Participante - Cargo/Função": flattenParticipant(participants, "cargo"),
    "Participante - Tipo de vínculo": flattenParticipant(participants, "vinculo"),
    "Participante - Área de atuação (RPPS/EFPC)": flattenParticipant(participants, "area"),
    "Participante - Certificação": flattenParticipant(participants, "certificacao"),
    "Anfitrião de interesse - Prioridade 1": sanitizeInput(payload["Anfitrião de interesse - Prioridade 1"], 200),
    "Objetivo principal (Prioridade 1)": sanitizeInput(payload["Objetivo principal (Prioridade 1)"], 600),
    "Anfitrião de interesse - Prioridade 2": sanitizeInput(payload["Anfitrião de interesse - Prioridade 2"], 200),
    "Objetivo principal (Prioridade 2)": sanitizeInput(payload["Objetivo principal (Prioridade 2)"], 600),
    "Anfitrião de interesse - Prioridade 3": sanitizeInput(payload["Anfitrião de interesse - Prioridade 3"], 200),
    "Objetivo principal (Prioridade 3)": sanitizeInput(payload["Objetivo principal (Prioridade 3)"], 600),
    "Temas/áreas de interesse (texto)": sanitizeInput(payload["Temas/áreas de interesse (texto)"], 1200),
    "Atividades propostas (agenda por dia)": sanitizeInput(payload["Atividades propostas (agenda por dia)"], 2000),
    "Objetivos e compromissos (o que pretende implementar/replicar)": sanitizeInput(payload["Objetivos e compromissos (o que pretende implementar/replicar)"], 1500),
    "Declaração: vínculo formal (Sim/Não)": yesNo(payload["Declaração: vínculo formal (Sim/Não)"]),
    "Declaração: custeio pelo intercambista (Sim/Não)": yesNo(payload["Declaração: custeio pelo intercambista (Sim/Não)"]),
    "Declaração: ciência dos termos (Sim/Não)": yesNo(payload["Declaração: ciência dos termos (Sim/Não)"]),
    "Responsável pelo preenchimento": sanitizeInput(payload["Responsável pelo preenchimento"], 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload["Cargo/Função (Responsável)"], 120),
    Data: sanitizeInput(payload.Data || nowIsoDate(), 20),
    "Senha": "",
    CPF: onlyDigits(payload.cpf),
    "Gênero": sanitizeInput(payload.genero, 20),
    "Primeiro Acesso Concluído": "Não",
    "Anfitrião escolhido - Inscrição": "",
    "Anfitrião escolhido - Nome": "",
    "Status da solicitação": "Sem solicitação",
    "Data da decisão": "",
    "Observação da decisão": "",
    "Permissão anfitrião": "Pendente",
  };
}

async function getNextHostRegistration(rows) {
  const max = rows.reduce((acc, row) => {
    const value = String(row.data["Inscrição"] || "");
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
      return res.status(400).json({ error: "CNPJ inválido." });
    }

    const { headers, rows } = await getRows(HOST_SHEET, hostHeaders);
    const existing = rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    if (existing) {
      return res.status(409).json({ error: "CNPJ já cadastrado." });
    }

    const numeroInscricao = await getNextHostRegistration(rows);

    const valueMap = buildHostValueMap(req.body, "", numeroInscricao);
    await appendRow(HOST_SHEET, headers, valueMap);

    return res.status(201).json({
      numeroInscricao,
      cnpj,
      message: "Cadastro de anfitrião realizado. Aguardando autorização do admin.",
    });
  } catch (error) {
    console.error("host/register", error);
    return res.status(500).json({ error: "Falha ao cadastrar anfitrião." });
  }
});

app.post("/api/host/login", loginLimiter, async (req, res) => {
  try {
    const cnpj = onlyDigits(req.body.cnpj);
    const senha = String(req.body.senha || "");

    const { rows } = await getRows(HOST_SHEET, hostHeaders);
    const found = rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);

    if (!found) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const permissaoAdmin = normalizeText(found.data["Permissão admin"] || "pendente");
    if (permissaoAdmin !== "concedido") {
      return res.status(403).json({ error: "Cadastro ainda não autorizado pelo admin." });
    }

    if (!found.data["Senha"]) {
      return res.status(403).json({ error: "Senha inicial ainda não disponibilizada. Aguarde o e-mail de autorização." });
    }

    const passOk = await bcrypt.compare(senha, found.data["Senha"] || "");
    if (!passOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    if (normalizeText(found.data["Primeiro Acesso Concluído"] || "nao") !== "sim") {
      return res.status(403).json({ error: "Primeiro acesso obrigatório. Defina sua senha." });
    }

    const token = createToken("host", String(found.rowNumber));
    return res.json({
      token,
      profile: {
        numeroInscricao: found.data["Inscrição"] || "",
        entidade: found.data["Unidade Gestora"] || "",
        status: found.data["Status do Anfitrião"] || "Ativo",
      },
    });
  } catch (error) {
    console.error("host/login", error);
    return res.status(500).json({ error: "Falha no login do anfitrião." });
  }
});

app.post("/api/host/first-access", loginLimiter, async (req, res) => {
  try {
    const cnpj = onlyDigits(req.body.cnpj);
    const numeroInscricao = sanitizeInput(req.body.numeroInscricao, 60);
    const senhaInicial = String(req.body.senhaInicial || "");
    const novaSenha = String(req.body.novaSenha || "");

    if (cnpj.length !== 14 || !numeroInscricao || !senhaInicial) {
      return res.status(400).json({ error: "Dados de primeiro acesso inválidos." });
    }
    if (!isStrongPassword(novaSenha)) {
      return res
        .status(400)
        .json({ error: "Senha fraca. Use letras, numeros e caractere especial (minimo 8)." });
    }

    const dataset = await getRows(HOST_SHEET, hostHeaders);
    const found = dataset.rows.find(
      (row) =>
        onlyDigits(row.data["Município CNPJ"]) === cnpj &&
        String(row.data["Inscrição"] || "") === numeroInscricao
    );

    if (!found) {
      return res.status(404).json({ error: "Anfitrião não encontrado para primeiro acesso." });
    }

    const initialOk = await bcrypt.compare(senhaInicial, found.data["Senha"] || "");
    if (!initialOk) {
      return res.status(401).json({ error: "Senha inicial inválida." });
    }

    found.data["Senha"] = await bcrypt.hash(novaSenha, 12);
    found.data["Primeiro Acesso Concluído"] = "Sim";
    await updateRow(HOST_SHEET, dataset.headers, found.rowNumber, found.data);

    return res.json({ ok: true, message: "Primeiro acesso concluído." });
  } catch (error) {
    console.error("host/first-access", error);
    return res.status(500).json({ error: "Falha no primeiro acesso do anfitrião." });
  }
});

app.get("/api/host/requests", requireAuth("host"), async (req, res) => {
  try {
    const hostRow = Number(req.session.subject);

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = hostData.rows.find((item) => item.rowNumber === hostRow);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = hostRowData.data["Inscrição"];
    const hostStatus = normalizeText(hostRowData.data["Status do Anfitrião"] || "ativo");
    if (hostStatus !== "ativo") {
      return res.status(403).json({ error: "Anfitrião inativo. Contate o admin." });
    }

    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const pendentes = candidates.rows
      .filter((row) => {
        const selectedHost = String(row.data["Anfitrião escolhido - Inscrição"] || "");
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return selectedHost === hostNumero && status === "pendente";
      })
      .map((row) => ({
        rowNumber: row.rowNumber,
        cpf: row.data.CPF,
        entidade: row.data["Unidade Gestora"],
        participante: row.data["Participante - Nome completo"],
        objetivo: row.data["Objetivo principal (Prioridade 1)"],
      }));

    res.json({
      host: {
        numeroInscricao: hostNumero,
        entidade: hostRowData.data["Unidade Gestora"],
      },
      pendentes,
    });
  } catch (error) {
    console.error("host/requests", error);
    res.status(500).json({ error: "Falha ao carregar solicitações." });
  }
});

app.post("/api/host/decision", requireAuth("host"), async (req, res) => {
  try {
    const candidateRow = Number(req.body.candidateRow);
    const decision = normalizeText(req.body.decision);
    const note = sanitizeInput(req.body.note || "", 600);

    if (!candidateRow || !["aceito", "rejeitado"].includes(decision)) {
      return res.status(400).json({ error: "Dados inválidos para decisão." });
    }

    const hostRow = Number(req.session.subject);
    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = hostData.rows.find((item) => item.rowNumber === hostRow);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = hostRowData.data["Inscrição"];
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const target = candidates.rows.find((row) => row.rowNumber === candidateRow);

    if (!target) {
      return res.status(404).json({ error: "Solicitação não encontrada." });
    }

    if (String(target.data["Anfitrião escolhido - Inscrição"] || "") !== hostNumero) {
      return res.status(403).json({ error: "Solicitação não pertence ao anfitrião logado." });
    }

    target.data["Status da solicitação"] = decision === "aceito" ? "Aceito" : "Rejeitado";
    target.data["Permissão anfitrião"] = decision === "aceito" ? "Concedido" : "Negado";
    target.data["Data da decisão"] = nowIsoDate();
    target.data["Observação da decisão"] = note;

    await updateRow(CANDIDATE_SHEET, candidates.headers, target.rowNumber, target.data);

    if (decision === "aceito") {
      await sendEmail(
        target.data["E-mail institucional"] || "",
        "Intercâmbio RPPS - Solicitação aceita pelo Anfitrião",
        [
          "Olá,",
          "",
          `Sua solicitação foi aceita pelo anfitrião ${hostRowData.data["Unidade Gestora"] || "-"}.`,
          "Acesse a área do intercambista para acompanhar os próximos passos.",
          "",
          "Conaprev - Programa de Intercâmbio Técnico",
        ].join("\n")
      );
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("host/decision", error);
    res.status(500).json({ error: "Falha ao registrar decisão." });
  }
});

app.post("/api/candidate/register", loginLimiter, async (req, res) => {
  try {
    const cpf = onlyDigits(req.body.cpf);
    if (cpf.length !== 11) {
      return res.status(400).json({ error: "CPF inválido." });
    }

    const dataset = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const existing = dataset.rows.find((row) => onlyDigits(row.data.CPF) === cpf);
    if (existing) {
      return res.status(409).json({ error: "CPF já cadastrado. Use o login." });
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
    const senha = String(req.body.senha || "");
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const found = candidates.rows.find((row) => onlyDigits(row.data.CPF) === cpf);

    if (!found) {
      return res.status(404).json({ error: "CPF não encontrado." });
    }

    if (normalizeText(found.data["Primeiro Acesso Concluído"] || "nao") !== "sim") {
      return res.status(403).json({ error: "Primeiro acesso obrigatório. Defina sua senha." });
    }

    const passOk = await bcrypt.compare(senha, found.data["Senha"] || "");
    if (!passOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const token = createToken("candidate", String(found.rowNumber));
    res.json({
      token,
      profile: {
        entidade: found.data["Unidade Gestora"] || "",
        cpf,
        genero: found.data["Gênero"] || "",
        status: found.data["Status da solicitação"] || "Sem solicitação",
        hostSelecionado: found.data["Anfitrião escolhido - Nome"] || "",
      },
    });
  } catch (error) {
    console.error("candidate/login", error);
    res.status(500).json({ error: "Falha no login do intercambista." });
  }
});

app.post("/api/candidate/first-access", loginLimiter, async (req, res) => {
  try {
    const cpf = onlyDigits(req.body.cpf);
    const email = sanitizeInput(req.body.email, 150).toLowerCase();
    const novaSenha = String(req.body.novaSenha || "");

    if (cpf.length !== 11 || !email) {
      return res.status(400).json({ error: "Dados de primeiro acesso inválidos." });
    }
    if (!isStrongPassword(novaSenha)) {
      return res
        .status(400)
        .json({ error: "Senha fraca. Use letras, numeros e caractere especial (minimo 8)." });
    }

    const dataset = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const found = dataset.rows.find((row) => onlyDigits(row.data.CPF) === cpf);
    if (!found) {
      return res.status(404).json({ error: "CPF não encontrado." });
    }

    const rowEmail = String(found.data["E-mail institucional"] || "").trim().toLowerCase();
    if (!rowEmail || rowEmail !== email) {
      return res.status(401).json({ error: "Email institucional não confere." });
    }

    found.data["Senha"] = await bcrypt.hash(novaSenha, 12);
    found.data["Primeiro Acesso Concluído"] = "Sim";
    await updateRow(CANDIDATE_SHEET, dataset.headers, found.rowNumber, found.data);

    return res.json({ ok: true, message: "Primeiro acesso concluído." });
  } catch (error) {
    console.error("candidate/first-access", error);
    return res.status(500).json({ error: "Falha no primeiro acesso do intercambista." });
  }
});

app.get("/api/candidate/hosts", requireAuth("candidate"), async (req, res) => {
  try {
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const ativos = hosts.rows
      .filter((row) => normalizeText(row.data["Status do Anfitrião"] || "ativo") === "ativo")
      .filter((row) => normalizeText(row.data["Permissão admin"] || "") === "concedido")
      .map((row) => publicHostView(row.data));

    res.json({ hosts: ativos });
  } catch (error) {
    console.error("candidate/hosts", error);
    res.status(500).json({ error: "Falha ao listar anfitriões." });
  }
});

app.post("/api/candidate/select-host", requireAuth("candidate"), async (req, res) => {
  try {
    const hostNumero = sanitizeInput(req.body.numeroInscricao, 40);
    if (!hostNumero) {
      return res.status(400).json({ error: "Informe um anfitrião." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => row.data["Inscrição"] === hostNumero);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    if (normalizeText(host.data["Status do Anfitrião"] || "") !== "ativo") {
      return res.status(400).json({ error: "Anfitrião inativo para novas solicitações." });
    }
    if (normalizeText(host.data["Permissão admin"] || "") !== "concedido") {
      return res.status(400).json({ error: "Anfitrião ainda não autorizado pelo admin." });
    }

    const candidateRow = Number(req.session.subject);
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => row.rowNumber === candidateRow);

    if (!candidate) {
      return res.status(404).json({ error: "Intercambista nao encontrado." });
    }

    candidate.data["Anfitrião escolhido - Inscrição"] = hostNumero;
    candidate.data["Anfitrião escolhido - Nome"] = host.data["Unidade Gestora"] || "";
    candidate.data["Status da solicitação"] = "Pendente";
    candidate.data["Data da decisão"] = "";
    candidate.data["Observação da decisão"] = "";
    candidate.data["Permissão anfitrião"] = "Pendente";

    await updateRow(CANDIDATE_SHEET, candidates.headers, candidate.rowNumber, candidate.data);
    res.json({ ok: true, message: "Solicitacao enviada para o anfitriao." });
  } catch (error) {
    console.error("candidate/select-host", error);
    res.status(500).json({ error: "Falha ao registrar solicitação." });
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
      status: candidate.data["Status da solicitação"] || "Sem solicitação",
      host: candidate.data["Anfitrião escolhido - Nome"] || "",
      hostNumero: candidate.data["Anfitrião escolhido - Inscrição"] || "",
      observacao: candidate.data["Observação da decisão"] || "",
      dataDecisao: candidate.data["Data da decisão"] || "",
      genero: candidate.data["Gênero"] || "",
      permissaoAnfitriao: candidate.data["Permissão anfitrião"] || "Pendente",
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
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    let ok = false;
    if (ADMIN_PASSWORD_PLAIN) {
      ok = password === ADMIN_PASSWORD_PLAIN;
    } else {
      ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    }
    if (!ok) {
      return res.status(401).json({ error: "Credenciais inválidas." });
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
    const acceptedByHost = new Map();

    candidatesData.rows.forEach((row) => {
      const status = normalizeText(row.data["Status da solicitação"] || "");
      if (status !== "aceito") return;
      const hostKey = String(row.data["Anfitrião escolhido - Inscrição"] || "");
      if (!hostKey) return;
      acceptedByHost.set(hostKey, (acceptedByHost.get(hostKey) || 0) + 1);
    });

    const hosts = hostsData.rows.map((row) => ({
      rowNumber: row.rowNumber,
      numeroInscricao: row.data["Inscrição"] || "",
      entidade: row.data["Unidade Gestora"] || "",
      cnpj: row.data["Município CNPJ"] || "",
      status: row.data["Status do Anfitrião"] || "Ativo",
      permissaoAdmin: row.data["Permissão admin"] || "Pendente",
      intercambistasAceitos: acceptedByHost.get(String(row.data["Inscrição"] || "")) || 0,
      vagas: row.data["Número de vagas oferecidas"] || "",
      uf: row.data["UF"] || "",
    }));

    const decisions = candidatesData.rows
      .filter((row) => {
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return status === "aceito" || status === "rejeitado";
      })
      .map((row) => ({
        rowNumber: row.rowNumber,
        entidadeIntercambista: row.data["Unidade Gestora"] || "",
        cpf: row.data.CPF || "",
        host: row.data["Anfitrião escolhido - Nome"] || "",
        status: row.data["Status da solicitação"] || "",
        dataDecisao: row.data["Data da decisão"] || "",
        permissaoAnfitriao: row.data["Permissão anfitrião"] || "",
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
    const permissao = normalizeText(req.body.status) === "negado" ? "Negado" : "Concedido";

    const data = await getRows(HOST_SHEET, hostHeaders);
    const host = data.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    host.data["Permissão admin"] = permissao;
    if (permissao === "Concedido") {
      const senhaInicial = generateHostPassword();
      host.data["Senha"] = await bcrypt.hash(senhaInicial, 12);
      host.data["Primeiro Acesso Concluído"] = "Não";
      await sendEmail(
        host.data["E-mail de contato"] || "",
        "Intercâmbio RPPS - Cadastro de Anfitrião aprovado",
        [
          "Olá,",
          "",
          `Seu cadastro de anfitrião foi aprovado pelo admin.`,
          `Inscrição: ${host.data["Inscrição"] || "-"}`,
          `CNPJ: ${host.data["Município CNPJ"] || "-"}`,
          `Senha inicial: ${senhaInicial}`,
          "",
          "Acesse a área do anfitrião e realize o primeiro acesso para definir sua senha definitiva.",
          "",
          "Conaprev - Programa de Intercâmbio Técnico",
        ].join("\n")
      );
    }

    await updateRow(HOST_SHEET, data.headers, host.rowNumber, host.data);

    res.json({ ok: true, status: permissao });
  } catch (error) {
    console.error("admin/host-status", error);
    res.status(500).json({ error: "Falha ao alterar permissão do anfitrião." });
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
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor ativo em http://localhost:${PORT}`);
});

