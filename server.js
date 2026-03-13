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
const ADMIN_USER = String(process.env.ADMIN_USER || "").trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
const ADMIN_PASSWORD_PLAIN = String(process.env.ADMIN_PASSWORD_PLAIN || "");
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

// Render and similar platforms run behind a reverse proxy.
// This is required so express-rate-limit can resolve client IP correctly.
if (process.env.RENDER || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

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
const PRO_GESTAO_SHEET = "Pro-gestao";

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

const proGestaoHeaders = [
  "ENTE FEDERATIVO",
  "UF",
  "NÍVEL ATUAL",
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

function buildProGestaoKey(enteFederativo, uf) {
  return `${normalizeText(enteFederativo)}|${String(uf || "").trim().toUpperCase()}`;
}

async function getProGestaoLookup() {
  const map = new Map();
  try {
    const dataset = await getRows(PRO_GESTAO_SHEET, proGestaoHeaders);
    dataset.rows.forEach((row) => {
      const ente = row.data["ENTE FEDERATIVO"] || "";
      const uf = row.data.UF || "";
      const key = buildProGestaoKey(ente, uf);
      if (!key || key.startsWith("|")) return;
      map.set(key, String(row.data["NÍVEL ATUAL"] || "").trim().toUpperCase());
    });
  } catch (error) {
    // Fallback silencioso: se a aba não estiver disponível, usa dados já existentes.
  }
  return map;
}

function resolveProGestaoLevel(proLookup, municipio, uf, fallback) {
  if (proLookup instanceof Map && municipio && uf) {
    const key = buildProGestaoKey(municipio, uf);
    if (proLookup.has(key)) {
      return String(proLookup.get(key) || "").trim().toUpperCase();
    }
  }
  return String(fallback || "").trim().toUpperCase();
}

function normalizeProGestaoForSheet(value) {
  const clean = String(value || "").trim();
  return clean || "Sem Pró-gestão";
}

function isSemProGestaoValue(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "sem pro-gestao" || normalized === "sem pro gestao";
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
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

async function sendEmail(to, subject, text) {
  if (!to) return false;
  if (!mailer) {
    console.warn(`[mail-disabled] ${subject} -> ${to}`);
    return false;
  }
  try {
    await mailer.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error("sendEmail", { to, subject, error: error?.message || error });
    return false;
  }
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

function publicHostView(hostData, proLookup = null) {
  const uf = String(hostData.UF || "").toUpperCase();
  const nivelProGestao = resolveProGestaoLevel(
    proLookup,
    hostData["Município"] || "",
    uf,
    hostData["Nível do Pró-Gestão"] || ""
  );
  return {
    numeroInscricao: hostData["Inscrição"] || "",
    entidade: hostData["Unidade Gestora"] || "",
    uf,
    bandeira: uf ? `img-ufs/${uf}.png` : "",
    email: hostData["E-mail de contato"] || "",
    telefone: hostData["Telefone de contato"] || "",
    nivelProGestao,
    semProGestao: isSemProGestaoValue(nivelProGestao),
    vagas: hostData["Número de vagas oferecidas"] || "",
    descricao: hostData["Breve descrição da proposta de intercâmbio"] || "",
    areas: getHostAreas(hostData),
    status: hostData["Status do Anfitrião"] || "Ativo",
  };
}

function hostSummaryView(row) {
  return {
    rowNumber: row.rowNumber,
    numeroInscricao: row.data["Inscrição"] || "",
    municipio: row.data["Município"] || "",
    uf: row.data.UF || "",
    unidadeGestora: row.data["Unidade Gestora"] || "",
    dirigente: row.data["Nome do Dirigente ou Responsável Legal"] || "",
    cargoDirigente: row.data["Cargo/Função (Dirigente)"] || "",
    dataSolicitacao: row.data.Data || "",
    status: row.data["Status do Anfitrião"] || "Ativo",
    permissaoAdmin: row.data["Permissão admin"] || "",
  };
}

function candidateSummaryView(row) {
  return {
    rowNumber: row.rowNumber,
    inscricao: row.data["Inscrição"] || "",
    municipio: row.data["Município"] || "",
    uf: row.data.UF || "",
    unidadeGestora: row.data["Unidade Gestora"] || "",
    dirigente: row.data["Nome do Dirigente ou Responsável Legal"] || "",
    cargoDirigente: row.data["Cargo/Função (Dirigente)"] || "",
    dataSolicitacao: row.data.Data || "",
    dataDecisao: row.data["Data da decisão"] || "",
    statusSolicitacao: row.data["Status da solicitação"] || "",
    permissaoAnfitriao: row.data["Permissão anfitrião"] || "Pendente",
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

function hostRegistrationEmailText(hostData, userValue, passwordValue) {
  return [
    "Intercâmbio Técnico entre Regimes Previdenciários",
    "Troca estruturada de experiências, fortalecimento institucional e melhoria contínua da gestão previdenciária nos RPPS e EFPC.",
    "",
    "Prezado(a),",
    "",
    "Informamos que a inscrição do regime na condição de Anfitrião foi registrada com sucesso no âmbito do Programa de Intercâmbio Técnico entre Regimes Previdenciários.",
    "",
    "A partir das informações prestadas no formulário, seguem abaixo os dados de acesso cadastrados para acompanhamento das etapas do intercâmbio:",
    "",
    `Município/Ente: ${hostData["Município"] || "-"}`,
    `UF: ${hostData.UF || "-"}`,
    `Usuário: ${userValue || "-"}`,
    `Senha: ${passwordValue || "-"}`,
    "",
    "Esses dados poderão ser utilizados para acesso ao ambiente do programa e para acompanhamento das tratativas relacionadas ao intercâmbio técnico.",
    "",
    "Solicitamos que este e-mail não seja respondido, por se tratar de mensagem automática encaminhada pelo sistema.",
    "",
    "Atenciosamente,",
    "",
    "Departamento dos Regimes Próprios de Previdência Social – DRPPS",
    "Coordenação de Atendimento Colaborativo – CACO",
  ].join("\n");
}

function candidateRegistrationEmailText(candidateData, userValue, passwordValue) {
  return [
    "Intercâmbio Técnico entre Regimes Previdenciários",
    "Troca estruturada de experiências, fortalecimento institucional e melhoria contínua da gestão previdenciária nos RPPS e EFPC.",
    "",
    "Prezado(a),",
    "",
    "Informamos que sua inscrição na condição de Intercambista foi registrada com sucesso no âmbito do Programa de Intercâmbio Técnico entre Regimes Previdenciários.",
    "",
    "Havendo aceite por parte do regime anfitrião selecionado, o intercâmbio será organizado conforme a programação e o plano de trabalho definidos entre as partes, nos termos do programa.",
    "",
    "Seguem abaixo os dados de acesso cadastrados:",
    "",
    `Município/Ente: ${candidateData["Município"] || "-"}`,
    `UF: ${candidateData.UF || "-"}`,
    `Usuário: ${userValue || "-"}`,
    `Senha: ${passwordValue || "-"}`,
    "",
    "Esses dados poderão ser utilizados para acesso ao ambiente do programa e para acompanhamento das etapas relacionadas ao intercâmbio técnico.",
    "",
    "Solicitamos que este e-mail não seja respondido, por se tratar de mensagem automática encaminhada pelo sistema.",
    "",
    "Atenciosamente,",
    "",
    "Departamento dos Regimes Próprios de Previdência Social – DRPPS",
    "Coordenação de Atendimento Colaborativo – CACO",
  ].join("\n");
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
    "Nível do Pró-Gestão": sanitizeInput(normalizeProGestaoForSheet(payload["Nível do Pró-Gestão"]), 60),
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
    "Nível do Pró-Gestão": sanitizeInput(normalizeProGestaoForSheet(payload["Nível do Pró-Gestão"]), 60),
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

app.get("/api/prefill/municipio/:cnpj", async (req, res) => {
  try {
    const cnpj = onlyDigits(req.params.cnpj);
    if (cnpj.length !== 14) {
      return res.status(400).json({ error: "CNPJ do município inválido." });
    }

    const proLookup = await getProGestaoLookup();
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    if (host) {
      const uf = host.data.UF || "";
      const municipio = host.data["Município"] || "";
      const nivelProGestao = resolveProGestaoLevel(
        proLookup,
        municipio,
        uf,
        host.data["Nível do Pró-Gestão"] || ""
      );
      return res.json({
        source: "host",
        prefill: {
          municipio,
          uf,
          municipioCnpj: host.data["Município CNPJ"] || "",
          unidadeGestora: host.data["Unidade Gestora"] || "",
          dirigente: host.data["Nome do Dirigente ou Responsável Legal"] || "",
          cargoDirigente: host.data["Cargo/Função (Dirigente)"] || "",
          email: host.data["E-mail de contato"] || "",
          telefone: host.data["Telefone de contato"] || "",
          nivelProGestao,
          responsavel: host.data["Responsável pelo preenchimento"] || "",
          cargoResponsavel: host.data["Cargo/Função (Responsável)"] || "",
          dataPreenchimento: host.data.Data || "",
        },
      });
    }

    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    if (candidate) {
      const uf = candidate.data.UF || "";
      const municipio = candidate.data["Município"] || "";
      const nivelProGestao = resolveProGestaoLevel(
        proLookup,
        municipio,
        uf,
        candidate.data["Nível do Pró-Gestão"] || ""
      );
      return res.json({
        source: "candidate",
        prefill: {
          municipio,
          uf,
          municipioCnpj: candidate.data["Município CNPJ"] || "",
          unidadeGestora: candidate.data["Unidade Gestora"] || "",
          dirigente: candidate.data["Nome do Dirigente ou Responsável Legal"] || "",
          cargoDirigente: candidate.data["Cargo/Função (Dirigente)"] || "",
          email: candidate.data["E-mail institucional"] || "",
          telefone: candidate.data["Telefone para contato"] || "",
          nivelProGestao,
          responsavel: candidate.data["Responsável pelo preenchimento"] || "",
          cargoResponsavel: candidate.data["Cargo/Função (Responsável)"] || "",
          dataPreenchimento: candidate.data.Data || "",
        },
      });
    }

    return res.status(404).json({ error: "Nenhum registro encontrado para este CNPJ." });
  } catch (error) {
    console.error("prefill/municipio", error);
    return res.status(500).json({ error: "Falha ao consultar dados para pré-preenchimento." });
  }
});

app.post("/api/host/register", loginLimiter, async (req, res) => {
  try {
    const cnpj = onlyDigits(req.body.cnpj);
    if (cnpj.length !== 14) {
      return res.status(400).json({ error: "CNPJ inválido." });
    }

    const { headers, rows } = await getRows(HOST_SHEET, hostHeaders);
    const existing = rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    const accessPassword = generateHostPassword();
    const accessPasswordHash = await bcrypt.hash(accessPassword, 12);

    if (existing) {
      const numeroInscricao = String(existing.data["Inscrição"] || "").trim() || (await getNextHostRegistration(rows));
      const valueMap = buildHostValueMap(req.body, accessPasswordHash, numeroInscricao);

      valueMap["Primeiro Acesso Concluído"] = "Sim";
      valueMap["Status do Anfitrião"] = existing.data["Status do Anfitrião"] || "Ativo";
      valueMap["Permissão admin"] = existing.data["Permissão admin"] || "Pendente";

      await updateRow(HOST_SHEET, headers, existing.rowNumber, valueMap);
      const emailSent = await sendEmail(
        valueMap["E-mail de contato"] || "",
        "Confirmação de inscrição – Intercâmbio Técnico entre Regimes Previdenciários",
        hostRegistrationEmailText(
          valueMap,
          onlyDigits(valueMap["Município CNPJ"]),
          accessPassword
        )
      );

      return res.json({
        updated: true,
        numeroInscricao,
        cnpj,
        emailSent,
        message: "Cadastro atualizado com sucesso.",
      });
    }

    const numeroInscricao = await getNextHostRegistration(rows);

    const valueMap = buildHostValueMap(req.body, accessPasswordHash, numeroInscricao);
    valueMap["Primeiro Acesso Concluído"] = "Sim";
    await appendRow(HOST_SHEET, headers, valueMap);
    const emailSent = await sendEmail(
      valueMap["E-mail de contato"] || "",
      "Confirmação de inscrição – Intercâmbio Técnico entre Regimes Previdenciários",
      hostRegistrationEmailText(
        valueMap,
        onlyDigits(valueMap["Município CNPJ"]),
        accessPassword
      )
    );

    return res.status(201).json({
      created: true,
      numeroInscricao,
      cnpj,
      emailSent,
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
      .map(candidateSummaryView);

    const cadastrados = candidates.rows
      .filter((row) => {
        const selectedHost = String(row.data["Anfitrião escolhido - Inscrição"] || "");
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return selectedHost === hostNumero && status === "aceito";
      })
      .map(candidateSummaryView);

    res.json({
      host: {
        rowNumber: hostRowData.rowNumber,
        numeroInscricao: hostNumero,
        entidade: hostRowData.data["Unidade Gestora"],
        municipio: hostRowData.data["Município"] || "",
        uf: hostRowData.data.UF || "",
      },
      pendentes,
      cadastrados,
    });
  } catch (error) {
    console.error("host/requests", error);
    res.status(500).json({ error: "Falha ao carregar solicitações." });
  }
});

app.get("/api/host/candidate-form/:rowNumber", requireAuth("host"), async (req, res) => {
  try {
    const candidateRow = Number(req.params.rowNumber);
    if (!candidateRow) {
      return res.status(400).json({ error: "Linha do intercambista inválida." });
    }

    const hostRow = Number(req.session.subject);
    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = hostData.rows.find((item) => item.rowNumber === hostRow);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = String(hostRowData.data["Inscrição"] || "");
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => row.rowNumber === candidateRow);
    if (!candidate) {
      return res.status(404).json({ error: "Intercambista não encontrado." });
    }

    const selectedHost = String(candidate.data["Anfitrião escolhido - Inscrição"] || "");
    if (selectedHost !== hostNumero) {
      return res.status(403).json({ error: "Plano não pertence ao anfitrião logado." });
    }

    res.json({
      rowNumber: candidate.rowNumber,
      data: candidate.data,
    });
  } catch (error) {
    console.error("host/candidate-form", error);
    res.status(500).json({ error: "Falha ao abrir plano de trabalho." });
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
    const accessPassword = generateHostPassword();
    row["Senha"] = await bcrypt.hash(accessPassword, 12);
    row["Primeiro Acesso Concluído"] = "Sim";
    await appendRow(CANDIDATE_SHEET, dataset.headers, row);
    const emailSent = await sendEmail(
      row["E-mail institucional"] || "",
      "Confirmação de inscrição – Intercâmbio Técnico entre Regimes Previdenciários",
      candidateRegistrationEmailText(
        row,
        onlyDigits(row.CPF),
        accessPassword
      )
    );

    res.status(201).json({ ok: true, emailSent, message: "Cadastro do intercambista realizado." });
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

app.post("/api/host/remove-candidate", requireAuth("host"), async (req, res) => {
  try {
    const candidateRow = Number(req.body.candidateRow);
    if (!candidateRow) {
      return res.status(400).json({ error: "Linha do intercambista inválida." });
    }

    const hostRow = Number(req.session.subject);
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => row.rowNumber === hostRow);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = String(host.data["Inscrição"] || "");
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => row.rowNumber === candidateRow);
    if (!candidate) {
      return res.status(404).json({ error: "Intercambista não encontrado." });
    }

    if (String(candidate.data["Anfitrião escolhido - Inscrição"] || "") !== hostNumero) {
      return res.status(403).json({ error: "Intercambista não vinculado ao anfitrião logado." });
    }

    candidate.data["Anfitrião escolhido - Inscrição"] = "";
    candidate.data["Anfitrião escolhido - Nome"] = "";
    candidate.data["Status da solicitação"] = "Sem solicitação";
    candidate.data["Permissão anfitrião"] = "Pendente";
    candidate.data["Data da decisão"] = "";
    candidate.data["Observação da decisão"] = "Inscrição removida pelo anfitrião.";
    await updateRow(CANDIDATE_SHEET, candidates.headers, candidate.rowNumber, candidate.data);

    res.json({ ok: true });
  } catch (error) {
    console.error("host/remove-candidate", error);
    res.status(500).json({ error: "Falha ao remover inscrição do intercambista." });
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
    const proLookup = await getProGestaoLookup();
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const ativos = hosts.rows
      .filter((row) => normalizeText(row.data["Status do Anfitrião"] || "ativo") === "ativo")
      .filter((row) => normalizeText(row.data["Permissão admin"] || "") === "concedido")
      .map((row) => publicHostView(row.data, proLookup));

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
      inscricao: candidate.data["Inscrição"] || "",
      municipio: candidate.data["Município"] || "",
      uf: candidate.data.UF || "",
      unidadeGestora: candidate.data["Unidade Gestora"] || "",
      dirigente: candidate.data["Nome do Dirigente ou Responsável Legal"] || "",
      dataSolicitacao: candidate.data.Data || "",
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
    const password = String(req.body.password || "").trim();

    if (user !== ADMIN_USER) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    let ok = false;
    if (ADMIN_PASSWORD_PLAIN) {
      ok = password === ADMIN_PASSWORD_PLAIN.trim();
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
      permissaoAdmin: row.data["Permissão admin"] || "",
      intercambistasAceitos: acceptedByHost.get(String(row.data["Inscrição"] || "")) || 0,
      vagas: row.data["Número de vagas oferecidas"] || "",
      uf: row.data["UF"] || "",
      municipio: row.data["Município"] || "",
      dirigente: row.data["Nome do Dirigente ou Responsável Legal"] || "",
      cargoDirigente: row.data["Cargo/Função (Dirigente)"] || "",
      dataSolicitacao: row.data.Data || "",
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
      solicitacoes: hosts.filter((h) => normalizeText(h.permissaoAdmin) === "pendente"),
      cadastrados: hosts.filter((h) => normalizeText(h.permissaoAdmin) === "concedido"),
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
      if (!host.data["Senha"]) {
        const senhaInicial = generateHostPassword();
        host.data["Senha"] = await bcrypt.hash(senhaInicial, 12);
        host.data["Primeiro Acesso Concluído"] = "Sim";
        await sendEmail(
          host.data["E-mail de contato"] || "",
          "Intercâmbio RPPS - Cadastro de Anfitrião aprovado",
          [
            "Olá,",
            "",
            "Seu cadastro de anfitrião foi aprovado pelo admin.",
            `Inscrição: ${host.data["Inscrição"] || "-"}`,
            `CNPJ (Usuário): ${host.data["Município CNPJ"] || "-"}`,
            `Senha de acesso: ${senhaInicial}`,
            "",
            "Conaprev - Programa de Intercâmbio Técnico",
          ].join("\n")
        );
      }
    }

    await updateRow(HOST_SHEET, data.headers, host.rowNumber, host.data);

    res.json({ ok: true, status: permissao });
  } catch (error) {
    console.error("admin/host-status", error);
    res.status(500).json({ error: "Falha ao alterar permissão do anfitrião." });
  }
});

app.post("/api/admin/remove-host", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.body.rowNumber);
    if (!rowNumber) {
      return res.status(400).json({ error: "Linha do anfitrião inválida." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    host.data["Status do Anfitrião"] = "Inativo";
    host.data["Permissão admin"] = "Negado";
    await updateRow(HOST_SHEET, hosts.headers, host.rowNumber, host.data);

    res.json({ ok: true });
  } catch (error) {
    console.error("admin/remove-host", error);
    res.status(500).json({ error: "Falha ao remover inscrição do anfitrião." });
  }
});

app.get("/api/admin/host-form/:rowNumber", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.params.rowNumber);
    if (!rowNumber) {
      return res.status(400).json({ error: "Linha do anfitrião inválida." });
    }

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const host = hostData.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    res.json({
      rowNumber: host.rowNumber,
      resumo: hostSummaryView(host),
      data: host.data,
    });
  } catch (error) {
    console.error("admin/host-form", error);
    res.status(500).json({ error: "Falha ao abrir credenciamento." });
  }
});

app.get("/api/admin/host-linked/:rowNumber", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.params.rowNumber);
    if (!rowNumber) {
      return res.status(400).json({ error: "Linha do anfitrião inválida." });
    }

    const hostsData = await getRows(HOST_SHEET, hostHeaders);
    const host = hostsData.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = String(host.data["Inscrição"] || "");
    const candidatesData = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const vinculados = candidatesData.rows
      .filter((row) => {
        const selectedHost = String(row.data["Anfitrião escolhido - Inscrição"] || "");
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return selectedHost === hostNumero && status === "aceito";
      })
      .map(candidateSummaryView);

    res.json({
      host: hostSummaryView(host),
      vinculados,
    });
  } catch (error) {
    console.error("admin/host-linked", error);
    res.status(500).json({ error: "Falha ao listar intercambistas vinculados." });
  }
});

app.get("/api/admin/candidate-form/:rowNumber", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.params.rowNumber);
    if (!rowNumber) {
      return res.status(400).json({ error: "Linha do intercambista inválida." });
    }

    const candidatesData = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidatesData.rows.find((row) => row.rowNumber === rowNumber);
    if (!candidate) {
      return res.status(404).json({ error: "Intercambista não encontrado." });
    }

    res.json({
      rowNumber: candidate.rowNumber,
      resumo: candidateSummaryView(candidate),
      data: candidate.data,
    });
  } catch (error) {
    console.error("admin/candidate-form", error);
    res.status(500).json({ error: "Falha ao abrir plano do intercambista." });
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

