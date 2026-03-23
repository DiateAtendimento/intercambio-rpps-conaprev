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
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 4000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 4000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 6000);
const LOOKUP_DEBUG = String(process.env.LOOKUP_DEBUG || "true").trim().toLowerCase() !== "false";

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

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  const allowedOrigin =
    !origin ||
    /^https:\/\/.*\.netlify\.app$/i.test(origin) ||
    /^https:\/\/.*\.onrender\.com$/i.test(origin) ||
    /^http:\/\/localhost(?::\d+)?$/i.test(origin);

  if (allowedOrigin && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

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

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    console.error("[api-hit]", {
      method: req.method,
      path: req.path,
      origin: req.headers.origin || "",
      hasAuthorization: Boolean(req.headers.authorization),
      body: {
        rowNumber: req.body?.rowNumber,
        fingerprint: req.body?.fingerprint || "",
        numeroInscricao: req.body?.numeroInscricao || "",
        cnpj: maskValue(req.body?.cnpj || ""),
        municipio: req.body?.municipio || "",
        uf: req.body?.uf || "",
        entidade: req.body?.entidade || "",
        email: maskValue(req.body?.email || "", 6),
        dirigente: req.body?.dirigente || "",
        dataSolicitacao: req.body?.dataSolicitacao || "",
        candidateRow: req.body?.candidateRow,
        decision: req.body?.decision || "",
      },
    });
  }
  next();
});

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
const HOST_AREAS_SHEET = "Anfitriao Areas";
const EXCHANGE_REQUESTS_SHEET = "Inscricoes Intercambio";
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
  "Vagas restantes",
  "Equipe de apoio designada (nomes)",
  "Breve descrição da proposta de intercâmbio",
  "Responsável pelo preenchimento",
  "Cargo/Função (Responsável)",
  "Data",
  "Data aceite MPS",
  "Senha",
  "Primeiro Acesso Concluído",
  "Status do Anfitrião",
  "Permissão admin",
  "Observação do admin",
  "Mensagem do admin vista",
  "Data visualização mensagem admin",
  "Nº rejeições",
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
  "Responsável pelo preenchimento",
  "Cargo/Função (Responsável)",
  "Data",
  "Senha",
  "CPF",
  "Primeiro Acesso Concluído",
  "Status do Intercambista",
  "Nº rejeições",
];

const hostAreaHeaders = [
  "Inscrição do anfitrião",
  "UF",
  "Município",
  "Unidade Gestora",
  "Área/Setor",
  "Tipo",
  "Vagas da área",
  "Vagas ocupadas",
  "Vagas restantes",
  "Ativa",
  "Ordem",
];

const exchangeRequestHeaders = [
  "Inscrição da solicitação",
  "Inscrição do intercambista",
  "CPF do intercambista",
  "UF",
  "Município",
  "Unidade Gestora",
  "Anfitrião - Inscrição",
  "Anfitrião - Nome",
  "Participante - Nome completo",
  "Participante - Cargo/Função",
  "Participante - Tipo de vínculo",
  "Participante - Área de atuação (RPPS/EFPC)",
  "Participante - Certificação",
  "Temas/áreas de interesse (texto)",
  "Atividades propostas (agenda por dia)",
  "Objetivos e compromissos (o que pretende implementar/replicar)",
  "Declaração: vínculo formal (Sim/Não)",
  "Declaração: custeio pelo intercambista (Sim/Não)",
  "Declaração: ciência dos termos (Sim/Não)",
  "Responsável pelo preenchimento",
  "Cargo/Função (Responsável)",
  "Data da inscrição",
  "Status da solicitação",
  "Data da decisão",
  "Observação da decisão",
  "Status final",
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

function resolveHostStatus(rowData = {}) {
  const permission = normalizeText(rowData["Permissão admin"] || "");
  if (permission === "concedido") return "Ativo";
  if (permission === "removido") return "Inativo";
  if (permission === "negado") return "Rejeitado";
  const explicit = String(rowData["Status do Anfitrião"] || "").trim();
  if (explicit) return explicit;
  return "Pendente";
}

function resolveHostApprovalLabel(rowData = {}) {
  const permission = normalizeText(rowData["Permissão admin"] || "");
  if (permission === "concedido") return "Aceito";
  if (permission === "negado") return "Rejeitado";
  if (permission === "removido") return "Removido";
  return "Pendente";
}

function appendRejectionHistory(previousValue = "", note = "") {
  const cleanNote = String(note || "").trim();
  if (!cleanNote) return String(previousValue || "").trim();
  const previous = String(previousValue || "").trim();
  const entries = previous
    ? previous
        .split(/\r?\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const nextNumber = entries.length + 1;
  entries.push(`${nextNumber} - ${cleanNote}`);
  return entries.join("\n");
}

function extractLatestRejectionNote(historyValue = "") {
  const entries = String(historyValue || "")
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!entries.length) return "";
  const lastEntry = entries[entries.length - 1];
  return lastEntry.replace(/^\d+\s*-\s*/, "").trim();
}

function resolveCandidateStatus(rowData = {}) {
  const explicit = String(rowData["Status do Intercambista"] || "").trim();
  if (explicit) return explicit;
  return "Ativo";
}

function resolveHostFirstAccess(rowData = {}) {
  const approved = normalizeText(rowData["Permissão admin"] || "") === "concedido";
  const active = normalizeText(resolveHostStatus(rowData)) === "ativo";
  return approved && active ? "Sim" : "Não";
}

function resolveCandidateFirstAccess(rowData = {}) {
  const explicit = String(rowData["Primeiro Acesso Concluído"] || "").trim();
  if (explicit) return explicit;
  return "Não";
}

function getHostRemainingVacancies(rowData = {}) {
  const remainingRaw = String(rowData["Vagas restantes"] || "").trim();
  if (remainingRaw !== "") {
    const remaining = Number(remainingRaw);
    if (Number.isFinite(remaining)) return remaining;
  }
  const offered = Number(String(rowData["Número de vagas oferecidas"] || "").trim());
  return Number.isFinite(offered) ? offered : 0;
}

function getAvailableHostAreas(areaRows = []) {
  const areas = getHostAreas(areaRows);
  const withRemaining = areas.filter((item) => Number(item.restantes || 0) > 0);
  return withRemaining.length ? withRemaining : areas.filter((item) => Number(item.vagas || 0) > 0);
}

function parseRequestedAreas(rawValue = "") {
  return String(rawValue || "")
    .split(/[\|\n;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function recalculateHostAreas(areaRows = [], requestRows = [], hostNumero = "") {
  const areas = getHostAreas(areaRows);
  if (!areas.length) return [];
  const occupiedByArea = new Map();
  requestRows
    .filter((row) => String(row.data["Anfitrião - Inscrição"] || "") === String(hostNumero || ""))
    .filter((row) => ["pendente", "aceito"].includes(normalizeText(row.data["Status da solicitação"] || "")))
    .forEach((row) => {
      parseRequestedAreas(row.data["Temas/áreas de interesse (texto)"] || "").forEach((area) => {
        occupiedByArea.set(area, (occupiedByArea.get(area) || 0) + 1);
      });
    });

  return areas.map((item) => {
    const vagas = Number(item.vagas || 0);
    const ocupadas = Number(occupiedByArea.get(item.area) || 0);
    return {
      ...item,
      ocupadas,
      restantes: Math.max(0, vagas - ocupadas),
    };
  });
}

function getReservedParticipantsForHost(requestRows = [], hostNumero = "") {
  return requestRows
    .filter((row) => String(row.data["Anfitrião - Inscrição"] || "") === String(hostNumero || ""))
    .filter((row) => ["pendente", "aceito"].includes(normalizeText(row.data["Status da solicitação"] || "")))
    .reduce((acc, row) => acc + countRequestParticipants(row.data), 0);
}

function recalculateHostRemainingVacancies(hostRowData, requestRows = []) {
  const hostNumero = String(hostRowData?.data?.["Inscrição"] || "");
  const offered = Number(String(hostRowData?.data?.["Número de vagas oferecidas"] || "").trim()) || 0;
  const reserved = getReservedParticipantsForHost(requestRows, hostNumero);
  return Math.max(0, offered - reserved);
}

function candidateHasActiveRequest(requestRows = [], candidateRegistration = "") {
  return requestRows.some((row) => {
    const sameCandidate = String(row.data["Inscrição do intercambista"] || "") === String(candidateRegistration || "");
    const status = normalizeText(row.data["Status da solicitação"] || "");
    return sameCandidate && ["pendente", "aceito"].includes(status);
  });
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
        connectionTimeout: SMTP_CONNECTION_TIMEOUT,
        greetingTimeout: SMTP_GREETING_TIMEOUT,
        socketTimeout: SMTP_SOCKET_TIMEOUT,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

async function sendEmail(to, subject, text) {
  if (!to) return { ok: false, error: "destinatario ausente" };
  if (!mailer) {
    console.warn(`[mail-disabled] ${subject} -> ${to}`);
    return { ok: false, error: "smtp nao configurado" };
  }
  try {
    await mailer.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
    });
    return { ok: true, error: "" };
  } catch (error) {
    const errorMessage = String(error?.message || error || "erro desconhecido");
    console.error("sendEmail", { to, subject, error: errorMessage });
    return { ok: false, error: errorMessage };
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

async function syncHostAreas(hostData, areas) {
  const dataset = await getRows(HOST_AREAS_SHEET, hostAreaHeaders);
  const hostNumero = String(hostData["Inscrição"] || "").trim();
  const currentRows = dataset.rows.filter((row) => String(row.data["Inscrição do anfitrião"] || "").trim() === hostNumero);

  for (const row of currentRows) {
    row.data.Ativa = "Não";
    row.data["Vagas restantes"] = "0";
    await updateRow(HOST_AREAS_SHEET, dataset.headers, row.rowNumber, row.data);
  }

  for (let index = 0; index < areas.length; index += 1) {
    await appendRow(HOST_AREAS_SHEET, dataset.headers, buildHostAreaValueMap(hostData, areas[index], index));
  }
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const actionTokens = new Map();
const ACTION_TOKEN_TTL_MS = 30 * 60 * 1000;

function createToken(role, subject) {
  const payload = {
    role,
    subject: String(subject),
    createdAt: Date.now(),
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readTokenSession(token) {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  if (providedSignature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload?.role || !payload?.subject || !payload?.createdAt) return null;
    return {
      role: String(payload.role),
      subject: String(payload.subject),
      createdAt: Number(payload.createdAt),
    };
  } catch (_) {
    return null;
  }
}

function createActionToken(kind, rowNumber) {
  const token = crypto.randomBytes(18).toString("hex");
  actionTokens.set(token, {
    kind,
    rowNumber: Number(rowNumber),
    createdAt: Date.now(),
  });
  return token;
}

function consumeActionToken(token, kind) {
  const entry = actionTokens.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > ACTION_TOKEN_TTL_MS) {
    actionTokens.delete(token);
    return null;
  }
  if (kind && entry.kind !== kind) return null;
  return entry;
}

function requireAuth(role) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const session = readTokenSession(token);
    if (!session) {
      return res.status(401).json({ error: "Sessão inválida." });
    }

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      return res.status(401).json({ error: "Sessão expirada." });
    }

    if (role && session.role !== role) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    req.session = session;
    next();
  };
}

function normalizeDateBr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{5,6}$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial)) {
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + serial);
      const day = String(base.getUTCDate()).padStart(2, "0");
      const month = String(base.getUTCMonth() + 1).padStart(2, "0");
      const year = base.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return raw;
  return raw;
}

function nowBrDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

function maskValue(value, visible = 4) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= visible) return raw;
  return `${"*".repeat(Math.max(0, raw.length - visible))}${raw.slice(-visible)}`;
}

function logLookup(scope, stage, payload = {}) {
  if (!LOOKUP_DEBUG) return;
  console.error(`[lookup:${scope}] ${stage}`, payload);
}

function buildHostFingerprint(rowData = {}) {
  return crypto
    .createHash("sha1")
    .update(
      [
        String(rowData["Inscrição"] || "").trim(),
        onlyDigits(rowData["Município CNPJ"] || ""),
        String(rowData["Município"] || "").trim(),
        String(rowData.UF || "").trim().toUpperCase(),
        String(rowData["Unidade Gestora"] || "").trim(),
        String(rowData["E-mail de contato"] || "").trim().toLowerCase(),
        String(rowData["Nome do Dirigente ou Responsável Legal"] || "").trim(),
        normalizeDateBr(rowData.Data || ""),
      ].join("|")
    )
    .digest("hex");
}

function normalizeKey(value) {
  return normalizeText(String(value || "").trim());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function findHostForAdminStatus(rows, criteria = {}) {
  const requestedRowNumber = Number(criteria.rowNumber);
  const requestedFingerprint = String(criteria.fingerprint || "").trim();
  const requestedInscricao = String(criteria.numeroInscricao || "").trim();
  const requestedCnpj = onlyDigits(criteria.cnpj);
  const requestedMunicipio = normalizeKey(criteria.municipio);
  const requestedUf = String(criteria.uf || "").trim().toUpperCase();
  const requestedEntidade = normalizeKey(criteria.entidade);
  const requestedEmail = normalizeEmail(criteria.email);
  const requestedDirigente = normalizeKey(criteria.dirigente);
  const requestedData = normalizeDateBr(criteria.dataSolicitacao);
  const pendingHosts = rows.filter((row) => normalizeKey(row.data["Permissão admin"]) === "pendente");

  let host = null;
  let matchedBy = "";

  if (requestedRowNumber) {
    host = rows.find((row) => row.rowNumber === requestedRowNumber) || null;
    if (host) return { host, matchedBy: "rowNumber" };
  }

  if (requestedFingerprint) {
    host = rows.find((row) => buildHostFingerprint(row.data) === requestedFingerprint) || null;
    if (host) return { host, matchedBy: "fingerprint" };
  }

  if (requestedInscricao) {
    host = rows.find((row) => String(row.data["Inscrição"] || "").trim() === requestedInscricao) || null;
    if (host) return { host, matchedBy: "numeroInscricao" };
  }

  if (requestedCnpj) {
    host = rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === requestedCnpj) || null;
    if (host) return { host, matchedBy: "cnpj" };
  }

  if (requestedEmail) {
    host = rows.find((row) => normalizeEmail(row.data["E-mail de contato"]) === requestedEmail) || null;
    if (host) return { host, matchedBy: "email" };
  }

  if (requestedMunicipio || requestedUf || requestedEntidade || requestedDirigente || requestedData) {
    const scored = rows
      .map((row) => {
        const rowInscricao = String(row.data["Inscrição"] || "").trim();
        const rowCnpj = onlyDigits(row.data["Município CNPJ"]);
        const rowMunicipio = normalizeKey(row.data["Município"]);
        const rowUf = String(row.data.UF || "").trim().toUpperCase();
        const rowEntidade = normalizeKey(row.data["Unidade Gestora"]);
        const rowEmail = normalizeEmail(row.data["E-mail de contato"]);
        const rowDirigente = normalizeKey(row.data["Nome do Dirigente ou Responsável Legal"]);
        const rowData = normalizeDateBr(row.data.Data || "");

        let score = 0;
        if (requestedInscricao && rowInscricao === requestedInscricao) score += 10;
        if (requestedCnpj && rowCnpj === requestedCnpj) score += 10;
        if (requestedEmail && rowEmail === requestedEmail) score += 8;
        if (requestedMunicipio && rowMunicipio === requestedMunicipio) score += 4;
        if (requestedUf && rowUf === requestedUf) score += 2;
        if (requestedEntidade && rowEntidade === requestedEntidade) score += 4;
        if (requestedDirigente && rowDirigente === requestedDirigente) score += 3;
        if (requestedData && rowData === requestedData) score += 2;

        return { row, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1 && scored[0].score >= 6) {
      host = scored[0].row;
      matchedBy = `score:${scored[0].score}`;
    } else if (scored.length > 1 && scored[0].score >= 8 && scored[0].score >= scored[1].score + 3) {
      host = scored[0].row;
      matchedBy = `score:${scored[0].score}`;
    }
  }

  if (!host && pendingHosts.length === 1) {
    const onlyPending = pendingHosts[0];
    const rowMunicipio = normalizeKey(onlyPending.data["Município"]);
    const rowUf = String(onlyPending.data.UF || "").trim().toUpperCase();
    const rowEntidade = normalizeKey(onlyPending.data["Unidade Gestora"]);
    const rowEmail = normalizeEmail(onlyPending.data["E-mail de contato"]);
    const rowDirigente = normalizeKey(onlyPending.data["Nome do Dirigente ou Responsável Legal"]);
    const sameVisibleIdentity =
      (!requestedMunicipio || rowMunicipio === requestedMunicipio) &&
      (!requestedUf || rowUf === requestedUf) &&
      (!requestedEntidade || rowEntidade === requestedEntidade) &&
      (!requestedEmail || rowEmail === requestedEmail) &&
      (!requestedDirigente || rowDirigente === requestedDirigente);

    if (sameVisibleIdentity) {
      host = onlyPending;
      matchedBy = "singlePendingFallback";
    }
  }

  return { host, matchedBy };
}

function findHostBySessionSubject(rows, subject) {
  const cnpj = onlyDigits(subject);
  if (cnpj.length === 14) {
    return rows.find((item) => onlyDigits(item.data["Município CNPJ"]) === cnpj) || null;
  }
  const rowNumber = Number(subject);
  if (!rowNumber) return null;
  return rows.find((item) => item.rowNumber === rowNumber) || null;
}

function findCandidateBySessionSubject(rows, subject) {
  const cpf = onlyDigits(subject);
  if (cpf.length === 11) {
    return rows.find((item) => onlyDigits(item.data.CPF || "") === cpf) || null;
  }
  const rowNumber = Number(subject);
  if (!rowNumber) return null;
  return rows.find((item) => item.rowNumber === rowNumber) || null;
}

function findHostForCandidateSelection(rows, criteria = {}) {
  const hostNumero = String(criteria.numeroInscricao || "").trim();
  const cnpj = onlyDigits(criteria.cnpj);
  const entidade = normalizeKey(criteria.entidade);
  const uf = String(criteria.uf || "").trim().toUpperCase();
  const municipio = normalizeKey(criteria.municipio);

  let host = null;
  let matchedBy = "";

  if (hostNumero) {
    host = rows.find((row) => String(row.data["Inscrição"] || "").trim() === hostNumero) || null;
    if (host) return { host, matchedBy: "numeroInscricao" };
  }

  if (cnpj) {
    host = rows.find((row) => onlyDigits(row.data["Município CNPJ"] || "") === cnpj) || null;
    if (host) return { host, matchedBy: "cnpj" };
  }

  if (entidade || uf || municipio) {
    host = rows.find((row) => {
      const sameEntidade = !entidade || normalizeKey(row.data["Unidade Gestora"] || "") === entidade;
      const sameUf = !uf || String(row.data.UF || "").trim().toUpperCase() === uf;
      const sameMunicipio = !municipio || normalizeKey(row.data["Município"] || "") === municipio;
      return sameEntidade && sameUf && sameMunicipio;
    }) || null;
    if (host) return { host, matchedBy: "entidade+uf+municipio" };
  }

  return { host, matchedBy };
}

function getHostAreas(areaRows) {
  return areaRows
    .filter((row) => {
      if (row?.data) {
        return normalizeText(row.data.Ativa || "sim") !== "nao";
      }
      return Boolean(row?.area);
    })
    .sort((a, b) => {
      const leftOrder = Number(a?.data?.Ordem ?? a?.ordem ?? 0);
      const rightOrder = Number(b?.data?.Ordem ?? b?.ordem ?? 0);
      return leftOrder - rightOrder;
    })
    .map((row) => {
      if (!row?.data) {
        return {
          area: row.area || "",
          tipo: row.tipo || "",
          vagas: Number(row.vagas || 0),
          ocupadas: Number(row.ocupadas || 0),
          restantes: Number(row.restantes || 0),
        };
      }
      return {
        area: row.data["Área/Setor"] || "",
        tipo: row.data.Tipo || "",
        vagas: Number(row.data["Vagas da área"] || 0),
        ocupadas: Number(row.data["Vagas ocupadas"] || 0),
        restantes: Number(row.data["Vagas restantes"] || 0),
      };
    });
}

function publicHostView(hostData, areaRows = [], proLookup = null, remainingOverride = null) {
  const uf = String(hostData.UF || "").trim().toUpperCase();
  const areas = getAvailableHostAreas(areaRows);
  const nivelProGestao = resolveProGestaoLevel(
    proLookup,
    hostData["Município"] || "",
    uf,
    hostData["Nível do Pró-Gestão"] || ""
  );
  const vagasRestantes = remainingOverride == null ? getHostRemainingVacancies(hostData) : Math.max(0, Number(remainingOverride) || 0);
  return {
    numeroInscricao: String(hostData["Inscrição"] || "").trim(),
    entidade: hostData["Unidade Gestora"] || "",
    municipio: hostData["Município"] || "",
    uf,
    bandeira: uf ? `img-ufs/${uf}.png` : "",
    cnpj: onlyDigits(hostData["Município CNPJ"] || ""),
    email: hostData["E-mail de contato"] || "",
    telefone: hostData["Telefone de contato"] || "",
    nivelProGestao,
    semProGestao: isSemProGestaoValue(nivelProGestao),
    vagas: hostData["Número de vagas oferecidas"] || "",
    vagasRestantes: String(vagasRestantes),
    descricao: hostData["Breve descrição da proposta de intercâmbio"] || "",
    areas,
    status: resolveHostStatus(hostData),
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
    dataSolicitacao: normalizeDateBr(row.data.Data || ""),
    status: resolveHostStatus(row.data),
    permissaoAdmin: row.data["Permissão admin"] || "",
    vagasRestantes: String(getHostRemainingVacancies(row.data)),
  };
}

function exchangeRequestSummaryView(row) {
  return {
    rowNumber: row.rowNumber,
    inscricao: row.data["Inscrição da solicitação"] || "",
    inscricaoIntercambista: row.data["Inscrição do intercambista"] || "",
    municipio: row.data["Município"] || "",
    uf: row.data.UF || "",
    unidadeGestora: row.data["Unidade Gestora"] || "",
    hostNumero: row.data["Anfitrião - Inscrição"] || "",
    hostNome: row.data["Anfitrião - Nome"] || "",
    dataSolicitacao: normalizeDateBr(row.data["Data da inscrição"] || ""),
    dataDecisao: normalizeDateBr(row.data["Data da decisão"] || ""),
    observacaoDecisao: row.data["Observação da decisão"] || "",
    statusSolicitacao: row.data["Status da solicitação"] || "",
    statusIntercambista: row.data["Status final"] || "Pendente",
  };
}

function countRequestParticipants(rowData = {}) {
  return String(rowData["Participante - Nome completo"] || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean).length || 1;
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

function buildHostAccessPayload(valueMap, numeroInscricao, accessPassword) {
  return {
    tipo: "anfitriao",
    titulo: "Cadastro concluido",
    orientacao:
      "Guarde estas informacoes. Elas serao usadas no primeiro acesso e no acompanhamento do cadastro.",
    inscricao: numeroInscricao,
    municipio: valueMap["Município"] || "-",
    uf: valueMap.UF || "-",
    usuario: onlyDigits(valueMap["Município CNPJ"]) || "-",
    senha: accessPassword || "-",
  };
}

function buildCandidateAccessPayload(row, accessPassword) {
  return {
    tipo: "intercambista",
    titulo: "Cadastro concluido",
    orientacao:
      "Guarde estas informacoes. Elas serao usadas no primeiro acesso e no acompanhamento da inscricao.",
    inscricao: row["Inscrição"] || "-",
    municipio: row["Município"] || "-",
    uf: row.UF || "-",
    usuario: onlyDigits(row.CPF) || "-",
    senha: accessPassword || "-",
  };
}

function buildHostValueMap(payload, passwordHash, numeroInscricao) {
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
    "Vagas restantes": sanitizeInput(payload["Vagas restantes"] || payload["Número de vagas oferecidas"], 20),
    "Equipe de apoio designada (nomes)": sanitizeInput(payload["Equipe de apoio designada (nomes)"], 400),
    "Breve descrição da proposta de intercâmbio": sanitizeInput(payload["Breve descrição da proposta de intercâmbio"], 1200),
    "Responsável pelo preenchimento": sanitizeInput(payload["Responsável pelo preenchimento"], 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload["Cargo/Função (Responsável)"], 120),
    Data: sanitizeInput(normalizeDateBr(payload.Data || nowBrDate()), 20),
    "Senha": passwordHash || "",
    "Primeiro Acesso Concluído": "Não",
    "Status do Anfitrião": "Pendente",
    "Permissão admin": "Pendente",
    "Observação do admin": "",
    "Mensagem do admin vista": "Sim",
    "Data visualização mensagem admin": "",
    "Nº rejeições": "",
  };
}

function flattenParticipant(participants, field) {
  return participants
    .map((item) => sanitizeInput(item[field] || "", 180))
    .filter(Boolean)
    .join(" | ");
}

function buildCandidateValueMap(payload) {
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
    "Responsável pelo preenchimento": sanitizeInput(payload["Responsável pelo preenchimento"], 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload["Cargo/Função (Responsável)"], 120),
    Data: sanitizeInput(normalizeDateBr(payload.Data || nowBrDate()), 20),
    "Senha": "",
    CPF: onlyDigits(payload.cpf),
    "Primeiro Acesso Concluído": "Não",
    "Status do Intercambista": "Ativo",
    "Nº rejeições": "",
  };
}

function buildExchangeRequestValueMap(payload, candidateRow, hostRow) {
  const yesNo = (v) => (v ? "Sim" : "Não");
  const participants = Array.isArray(payload.participantes) ? payload.participantes.slice(0, 20) : [];
  return {
    "Inscrição da solicitação": payload.inscricaoSolicitacao || "",
    "Inscrição do intercambista": candidateRow.data["Inscrição"] || "",
    "CPF do intercambista": onlyDigits(candidateRow.data.CPF || ""),
    "UF": candidateRow.data.UF || "",
    "Município": candidateRow.data["Município"] || "",
    "Unidade Gestora": candidateRow.data["Unidade Gestora"] || "",
    "Anfitrião - Inscrição": hostRow.data["Inscrição"] || "",
    "Anfitrião - Nome": hostRow.data["Unidade Gestora"] || "",
    "Participante - Nome completo": flattenParticipant(participants, "nome"),
    "Participante - Cargo/Função": flattenParticipant(participants, "cargo"),
    "Participante - Tipo de vínculo": flattenParticipant(participants, "vinculo"),
    "Participante - Área de atuação (RPPS/EFPC)": flattenParticipant(participants, "area"),
    "Participante - Certificação": flattenParticipant(participants, "certificacao"),
    "Temas/áreas de interesse (texto)": sanitizeInput(payload["Temas/áreas de interesse (texto)"], 1200),
    "Atividades propostas (agenda por dia)": sanitizeInput(payload["Atividades propostas (agenda por dia)"], 2000),
    "Objetivos e compromissos (o que pretende implementar/replicar)": sanitizeInput(payload["Objetivos e compromissos (o que pretende implementar/replicar)"], 1500),
    "Declaração: vínculo formal (Sim/Não)": yesNo(payload["Declaração: vínculo formal (Sim/Não)"]),
    "Declaração: custeio pelo intercambista (Sim/Não)": yesNo(payload["Declaração: custeio pelo intercambista (Sim/Não)"]),
    "Declaração: ciência dos termos (Sim/Não)": yesNo(payload["Declaração: ciência dos termos (Sim/Não)"]),
    "Responsável pelo preenchimento": sanitizeInput(payload["Responsável pelo preenchimento"], 200),
    "Cargo/Função (Responsável)": sanitizeInput(payload["Cargo/Função (Responsável)"], 120),
    "Data da inscrição": sanitizeInput(normalizeDateBr(payload["Data da inscrição"] || nowBrDate()), 20),
    "Status da solicitação": "Pendente",
    "Data da decisão": "",
    "Observação da decisão": "",
    "Status final": "Pendente",
  };
}

function buildHostAreaValueMap(hostData, area, index) {
  const vagas = Number(area.vagas || 0);
  return {
    "Inscrição do anfitrião": hostData["Inscrição"] || "",
    UF: hostData.UF || "",
    "Município": hostData["Município"] || "",
    "Unidade Gestora": hostData["Unidade Gestora"] || "",
    "Área/Setor": sanitizeInput(area.nome, 180),
    Tipo: "",
    "Vagas da área": String(vagas),
    "Vagas ocupadas": String(Number(area.ocupadas || 0)),
    "Vagas restantes": String(Number(area.restantes ?? vagas)),
    Ativa: normalizeText(area.ativa || "sim") === "nao" ? "Não" : "Sim",
    Ordem: String(index + 1),
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

async function getNextCandidateRegistration(rows) {
  const max = rows.reduce((acc, row) => {
    const value = String(row.data["Inscrição"] || "");
    const num = Number((value.match(/(\d+)$/) || [])[1]);
    return Number.isFinite(num) && num > acc ? num : acc;
  }, 0);

  const next = String(max + 1).padStart(4, "0");
  return `INT-${new Date().getFullYear()}-${next}`;
}

async function getNextExchangeRequestRegistration(rows) {
  const max = rows.reduce((acc, row) => {
    const value = String(row.data["Inscrição da solicitação"] || "");
    const num = Number((value.match(/(\d+)$/) || [])[1]);
    return Number.isFinite(num) && num > acc ? num : acc;
  }, 0);

  const next = String(max + 1).padStart(4, "0");
  return `SOL-${new Date().getFullYear()}-${next}`;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/prefill/municipio/:cnpj", async (req, res) => {
  try {
    const cnpj = onlyDigits(req.params.cnpj);
    const target = normalizeText(req.query.target || "");
    if (cnpj.length !== 14) {
      return res.status(400).json({ error: "CNPJ do município inválido." });
    }

    const proLookup = await getProGestaoLookup();
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = candidates.rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => onlyDigits(row.data["Município CNPJ"]) === cnpj);
    const hostAreas = await getRows(HOST_AREAS_SHEET, hostAreaHeaders);
    const resolvePrefillAreas = (hostRow) =>
      getHostAreas(
        hostAreas.rows.filter((row) => String(row.data["Inscrição do anfitrião"] || "").trim() === String(hostRow?.data?.["Inscrição"] || "").trim())
      );

    if (target === "candidate" && candidate) {
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
          rowNumber: candidate.rowNumber,
          source: "candidate",
          municipio,
          uf,
          municipioCnpj: candidate.data["Município CNPJ"] || "",
          unidadeGestora: candidate.data["Unidade Gestora"] || "",
          unidadeGestoraCnpj: candidate.data["Unidade Gestora CNPJ"] || "",
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

    if (target === "host" && host) {
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
          rowNumber: host.rowNumber,
          source: "host",
          municipio,
          uf,
          municipioCnpj: host.data["Município CNPJ"] || "",
          unidadeGestora: host.data["Unidade Gestora"] || "",
          endereco: host.data["Endereço"] || "",
          coordenadorLocal: host.data["Responsável pela coordenação local"] || "",
          dirigente: host.data["Nome do Dirigente ou Responsável Legal"] || "",
          cargoDirigente: host.data["Cargo/Função (Dirigente)"] || "",
          email: host.data["E-mail de contato"] || "",
          telefone: host.data["Telefone de contato"] || "",
          nivelProGestao,
          vagas: host.data["Número de vagas oferecidas"] || "",
          vagasRestantes: host.data["Vagas restantes"] || "",
          proposta: host.data["Breve descrição da proposta de intercâmbio"] || "",
          equipeApoio: String(host.data["Equipe de apoio designada (nomes)"] || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          areas: resolvePrefillAreas(host),
          responsavel: host.data["Responsável pelo preenchimento"] || "",
          cargoResponsavel: host.data["Cargo/Função (Responsável)"] || "",
          dataPreenchimento: host.data.Data || "",
        },
      });
    }

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
          rowNumber: candidate.rowNumber,
          source: "candidate",
          municipio,
          uf,
          municipioCnpj: candidate.data["Município CNPJ"] || "",
          unidadeGestora: candidate.data["Unidade Gestora"] || "",
          unidadeGestoraCnpj: candidate.data["Unidade Gestora CNPJ"] || "",
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
          rowNumber: host.rowNumber,
          source: "host",
          municipio,
          uf,
          municipioCnpj: host.data["Município CNPJ"] || "",
          unidadeGestora: host.data["Unidade Gestora"] || "",
          endereco: host.data["Endereço"] || "",
          coordenadorLocal: host.data["Responsável pela coordenação local"] || "",
          dirigente: host.data["Nome do Dirigente ou Responsável Legal"] || "",
          cargoDirigente: host.data["Cargo/Função (Dirigente)"] || "",
          email: host.data["E-mail de contato"] || "",
          telefone: host.data["Telefone de contato"] || "",
          nivelProGestao,
          vagas: host.data["Número de vagas oferecidas"] || "",
          vagasRestantes: host.data["Vagas restantes"] || "",
          proposta: host.data["Breve descrição da proposta de intercâmbio"] || "",
          equipeApoio: String(host.data["Equipe de apoio designada (nomes)"] || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          areas: resolvePrefillAreas(host),
          responsavel: host.data["Responsável pelo preenchimento"] || "",
          cargoResponsavel: host.data["Cargo/Função (Responsável)"] || "",
          dataPreenchimento: host.data.Data || "",
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
    const areas = Array.isArray(req.body.areas) ? req.body.areas : [];
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

      valueMap["Senha"] = existing.data["Senha"] || valueMap["Senha"] || "";
      const wasRejected = normalizeText(existing.data["Permissão admin"] || "") === "negado";
      valueMap["Status do Anfitrião"] = wasRejected ? "Pendente" : existing.data["Status do Anfitrião"] || "Pendente";
      valueMap["Permissão admin"] = wasRejected ? "Pendente" : existing.data["Permissão admin"] || "Pendente";
      valueMap["Data aceite MPS"] = existing.data["Data aceite MPS"] || "";
      valueMap["Observação do admin"] = wasRejected ? "" : existing.data["Observação do admin"] || "";
      valueMap["Mensagem do admin vista"] = existing.data["Mensagem do admin vista"] || "Sim";
      valueMap["Data visualização mensagem admin"] = wasRejected ? "" : existing.data["Data visualização mensagem admin"] || "";
      valueMap["Nº rejeições"] = existing.data["Nº rejeições"] || "";
      valueMap["Primeiro Acesso Concluído"] = resolveHostFirstAccess(valueMap);

      await updateRow(HOST_SHEET, headers, existing.rowNumber, valueMap);
      await syncHostAreas(valueMap, areas);
      const alreadyHasAccess = Boolean(existing.data["Senha"]);
      return res.json({
        updated: true,
        numeroInscricao,
        cnpj,
        delivery: alreadyHasAccess ? "toast" : "modal",
        accessInfo: alreadyHasAccess ? null : buildHostAccessPayload(valueMap, numeroInscricao, accessPassword),
        message: alreadyHasAccess
          ? "Cadastro reenviado para aprovação do admin."
          : "Cadastro atualizado com sucesso.",
      });
    }

    const numeroInscricao = await getNextHostRegistration(rows);

    const valueMap = buildHostValueMap(req.body, accessPasswordHash, numeroInscricao);
    valueMap["Primeiro Acesso Concluído"] = resolveHostFirstAccess(valueMap);
    await appendRow(HOST_SHEET, headers, valueMap);
    await syncHostAreas(valueMap, areas);
    return res.status(201).json({
      created: true,
      numeroInscricao,
      cnpj,
      delivery: "modal",
      accessInfo: buildHostAccessPayload(valueMap, numeroInscricao, accessPassword),
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
    if (permissaoAdmin === "removido") {
      return res.status(403).json({ error: "Cadastro do anfitrião removido pelo admin." });
    }

    if (!found.data["Senha"]) {
      return res.status(403).json({ error: "Senha inicial ainda não disponibilizada. Aguarde o e-mail de autorização." });
    }

    const passOk = await bcrypt.compare(senha, found.data["Senha"] || "");
    if (!passOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const token = createToken("host", cnpj);
    return res.json({
      token,
      profile: {
        numeroInscricao: found.data["Inscrição"] || "",
        entidade: found.data["Unidade Gestora"] || "",
        status: resolveHostApprovalLabel(found.data),
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
    logLookup("host-first-access", "start", {
      cnpj: maskValue(cnpj),
      numeroInscricao,
      totalHosts: dataset.rows.length,
    });
    const found = dataset.rows.find(
      (row) =>
        onlyDigits(row.data["Município CNPJ"]) === cnpj &&
        String(row.data["Inscrição"] || "") === numeroInscricao
    );

    if (!found) {
      logLookup("host-first-access", "not_found", {
        cnpj: maskValue(cnpj),
        numeroInscricao,
      });
      return res.status(404).json({ error: "Anfitrião não encontrado para primeiro acesso." });
    }
    logLookup("host-first-access", "matched", {
      by: "cnpj+numeroInscricao",
      rowNumber: found.rowNumber,
      cnpj: maskValue(cnpj),
      numeroInscricao,
    });

    const initialOk = await bcrypt.compare(senhaInicial, found.data["Senha"] || "");
    if (!initialOk) {
      return res.status(401).json({ error: "Senha inicial inválida." });
    }

    found.data["Senha"] = await bcrypt.hash(novaSenha, 12);
    found.data["Primeiro Acesso Concluído"] = resolveHostFirstAccess(found.data);
    await updateRow(HOST_SHEET, dataset.headers, found.rowNumber, found.data);

    return res.json({ ok: true, message: "Primeiro acesso concluído." });
  } catch (error) {
    console.error("host/first-access", error);
    return res.status(500).json({ error: "Falha no primeiro acesso do anfitrião." });
  }
});

app.get("/api/host/requests", requireAuth("host"), async (req, res) => {
  try {
    const hostData = await getRows(HOST_SHEET, hostHeaders);
    logLookup("host-requests", "start", {
      sessionSubject: req.session.subject,
      totalHosts: hostData.rows.length,
    });
    const hostRowData = findHostBySessionSubject(hostData.rows, req.session.subject);
    if (!hostRowData) {
      logLookup("host-requests", "host_not_found", {
        sessionSubject: req.session.subject,
      });
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }
    logLookup("host-requests", "host_matched", {
      rowNumber: hostRowData.rowNumber,
      inscricao: hostRowData.data["Inscrição"] || "",
      cnpj: maskValue(onlyDigits(hostRowData.data["Município CNPJ"] || "")),
    });

    const hostNumero = hostRowData.data["Inscrição"];

    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidateByRegistration = new Map(
      candidates.rows.map((row) => [String(row.data["Inscrição"] || ""), row.data])
    );
    const enrichRequest = (row) => {
      const summary = exchangeRequestSummaryView(row);
      const candidateData = candidateByRegistration.get(String(summary.inscricaoIntercambista || ""));
      return {
        ...summary,
        dirigente: candidateData?.["Nome do Dirigente ou Responsável Legal"] || "",
      };
    };
    const pendentes = requests.rows
      .filter((row) => String(row.data["Anfitrião - Inscrição"] || "") === hostNumero)
      .filter((row) => normalizeText(row.data["Status da solicitação"] || "") === "pendente")
      .map(enrichRequest);

    const cadastrados = requests.rows
      .filter((row) => String(row.data["Anfitrião - Inscrição"] || "") === hostNumero)
      .filter((row) => normalizeText(row.data["Status da solicitação"] || "") === "aceito")
      .map(enrichRequest);

    const approvalStatus = resolveHostApprovalLabel(hostRowData.data);
    const hostAdminNote =
      String(hostRowData.data["Observação do admin"] || "").trim() ||
      extractLatestRejectionNote(hostRowData.data["Nº rejeições"] || "");
    const adminSolicitacao =
      approvalStatus === "Aceito"
        ? null
        : {
            rowNumber: hostRowData.rowNumber,
            inscricao: hostNumero || "",
            municipio: hostRowData.data["Município"] || "",
            uf: hostRowData.data.UF || "",
            unidadeGestora: hostRowData.data["Unidade Gestora"] || "",
            dataSolicitacao: normalizeDateBr(hostRowData.data.Data || ""),
            statusSolicitacao: approvalStatus,
            adminNote: hostAdminNote,
            adminNoteRead: normalizeText(hostRowData.data["Mensagem do admin vista"] || "sim") === "sim",
            selfRequest: true,
          };

    res.json({
      host: {
        rowNumber: hostRowData.rowNumber,
        numeroInscricao: hostNumero,
        entidade: hostRowData.data["Unidade Gestora"],
        municipio: hostRowData.data["Município"] || "",
        uf: hostRowData.data.UF || "",
        approvalStatus,
        visibleToCandidates: normalizeText(hostRowData.data["Permissão admin"] || "") === "concedido",
        adminNote: hostAdminNote,
        adminNoteRead: normalizeText(hostRowData.data["Mensagem do admin vista"] || "sim") === "sim",
        adminNoteReadAt: normalizeDateBr(hostRowData.data["Data visualização mensagem admin"] || ""),
      },
      adminSolicitacao,
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
    const requestRow = Number(req.params.rowNumber);
    if (!requestRow) {
      return res.status(400).json({ error: "Linha da inscrição inválida." });
    }

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = findHostBySessionSubject(hostData.rows, req.session.subject);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = String(hostRowData.data["Inscrição"] || "");
    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const request = requests.rows.find((row) => row.rowNumber === requestRow);
    if (!request) {
      return res.status(404).json({ error: "Inscrição não encontrada." });
    }

    const selectedHost = String(request.data["Anfitrião - Inscrição"] || "");
    if (selectedHost !== hostNumero) {
      return res.status(403).json({ error: "Plano não pertence ao anfitrião logado." });
    }

    res.json({
      rowNumber: request.rowNumber,
      data: request.data,
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
    if (decision === "rejeitado" && !note) {
      return res.status(400).json({ error: "Informe o motivo da rejeição." });
    }

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    logLookup("host-decision", "start", {
      sessionSubject: req.session.subject,
      candidateRow,
      decision,
      totalHosts: hostData.rows.length,
    });
    const hostRowData = findHostBySessionSubject(hostData.rows, req.session.subject);
    if (!hostRowData) {
      logLookup("host-decision", "host_not_found", {
        sessionSubject: req.session.subject,
        candidateRow,
      });
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }
    logLookup("host-decision", "host_matched", {
      rowNumber: hostRowData.rowNumber,
      inscricao: hostRowData.data["Inscrição"] || "",
      candidateRow,
      decision,
    });

    const hostNumero = hostRowData.data["Inscrição"];
    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const target = requests.rows.find((row) => row.rowNumber === candidateRow);

    if (!target) {
      logLookup("host-decision", "candidate_not_found", {
        candidateRow,
        hostNumero,
      });
      return res.status(404).json({ error: "Solicitação não encontrada." });
    }
    logLookup("host-decision", "candidate_matched", {
      candidateRow: target.rowNumber,
      hostNumero,
      selectedHost: String(target.data["Anfitrião - Inscrição"] || ""),
      candidateCpf: maskValue(onlyDigits(target.data["CPF do intercambista"] || "")),
    });

    if (String(target.data["Anfitrião - Inscrição"] || "") !== hostNumero) {
      return res.status(403).json({ error: "Solicitação não pertence ao anfitrião logado." });
    }

    target.data["Status da solicitação"] = decision === "aceito" ? "Aceito" : "Rejeitado";
    target.data["Status final"] = decision === "aceito" ? "Ativo" : "Inativo";
    target.data["Data da decisão"] = nowBrDate();
    target.data["Observação da decisão"] = note;

    const participantCount = countRequestParticipants(target.data);
    if (decision === "aceito") {
      const hostNumeroKey = String(hostRowData.data["Inscrição"] || "");
      const offered = Number(String(hostRowData.data["Número de vagas oferecidas"] || "").trim()) || 0;
      const reservedByOthers = requests.rows
        .filter((row) => row.rowNumber !== target.rowNumber)
        .filter((row) => String(row.data["Anfitrião - Inscrição"] || "") === hostNumeroKey)
        .filter((row) => ["pendente", "aceito"].includes(normalizeText(row.data["Status da solicitação"] || "")))
        .reduce((acc, row) => acc + countRequestParticipants(row.data), 0);
      const remainingForAcceptance = Math.max(0, offered - reservedByOthers);
      if (remainingForAcceptance < participantCount) {
        console.warn("[host/decision:no-vacancy]", {
          hostNumero: hostNumeroKey,
          requestRow: target.rowNumber,
          participantCount,
          offered,
          reservedByOthers,
          remainingForAcceptance,
        });
        return res.status(400).json({ error: "Vagas insuficientes para aceitar esta inscrição." });
      }
      hostRowData.data["Vagas restantes"] = String(recalculateHostRemainingVacancies(hostRowData, requests.rows));
      await updateRow(HOST_SHEET, hostData.headers, hostRowData.rowNumber, hostRowData.data);
    }

    await updateRow(EXCHANGE_REQUESTS_SHEET, requests.headers, target.rowNumber, target.data);

    if (decision !== "aceito" && note) {
      const candidatesBase = await getRows(CANDIDATE_SHEET, candidateHeaders);
      const candidateBase = candidatesBase.rows.find((row) => String(row.data["Inscrição"] || "") === String(target.data["Inscrição do intercambista"] || ""));
      if (candidateBase) {
        candidateBase.data["Nº rejeições"] = appendRejectionHistory(candidateBase.data["Nº rejeições"] || "", note);
        await updateRow(CANDIDATE_SHEET, candidatesBase.headers, candidateBase.rowNumber, candidateBase.data);
      }
    }

    if (decision === "aceito") {
      const candidatesBase = await getRows(CANDIDATE_SHEET, candidateHeaders);
      const candidateBase = candidatesBase.rows.find((row) => String(row.data["Inscrição"] || "") === String(target.data["Inscrição do intercambista"] || ""));
      await sendEmail(
        candidateBase?.data["E-mail institucional"] || "",
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

    res.json({ ok: true, message: decision === "aceito" ? "Solicitação aceita com sucesso." : "Solicitação rejeitada com sucesso." });
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
      const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
      if (candidateHasActiveRequest(requests.rows, existing.data["Inscrição"] || "")) {
        return res.status(409).json({ error: "Olá, você já possui uma inscrição ativa" });
      }
      const row = buildCandidateValueMap(req.body);
      row["Inscrição"] = existing.data["Inscrição"] || "";
      row["Senha"] = existing.data["Senha"] || "";
      row["Primeiro Acesso Concluído"] = existing.data["Primeiro Acesso Concluído"] || resolveCandidateFirstAccess(row);
      row["Status do Intercambista"] = existing.data["Status do Intercambista"] || "Ativo";
      row["Nº rejeições"] = existing.data["Nº rejeições"] || "";
      await updateRow(CANDIDATE_SHEET, dataset.headers, existing.rowNumber, row);
      return res.json({
        ok: true,
        updated: true,
        delivery: "toast",
        message: "Cadastro do intercambista atualizado com sucesso.",
      });
    }

    const row = buildCandidateValueMap(req.body);
    row["Inscrição"] = await getNextCandidateRegistration(dataset.rows);
    const accessPassword = generateHostPassword();
    row["Senha"] = await bcrypt.hash(accessPassword, 12);
    row["Primeiro Acesso Concluído"] = resolveCandidateFirstAccess(row);

    await appendRow(CANDIDATE_SHEET, dataset.headers, row);
    res.status(201).json({
      ok: true,
      delivery: "modal",
      accessInfo: buildCandidateAccessPayload(row, accessPassword),
      message: "Cadastro do intercambista realizado.",
    });
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
    logLookup("candidate-login", "start", {
      cpf: maskValue(cpf),
      totalCandidates: candidates.rows.length,
    });
    const found = candidates.rows.find((row) => onlyDigits(row.data.CPF) === cpf);

    if (!found) {
      logLookup("candidate-login", "not_found", { cpf: maskValue(cpf) });
      return res.status(404).json({ error: "CPF não encontrado." });
    }
    logLookup("candidate-login", "matched", {
      by: "cpf",
      rowNumber: found.rowNumber,
      cpf: maskValue(cpf),
      inscricao: found.data["Inscrição"] || "",
    });

    const passOk = await bcrypt.compare(senha, found.data["Senha"] || "");
    if (!passOk) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const token = createToken("candidate", cpf);
    res.json({
      token,
      profile: {
        entidade: found.data["Unidade Gestora"] || "",
        cpf,
        status: found.data["Status do Intercambista"] || "Pendente",
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
    const note = sanitizeInput(req.body.note || "", 600);
    if (!candidateRow) {
      return res.status(400).json({ error: "Linha da inscrição inválida." });
    }
    if (!note) {
      return res.status(400).json({ error: "Informe o motivo do cancelamento." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = findHostBySessionSubject(hosts.rows, req.session.subject);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    const hostNumero = String(host.data["Inscrição"] || "");
    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const candidate = requests.rows.find((row) => row.rowNumber === candidateRow);
    if (!candidate) {
      return res.status(404).json({ error: "Inscrição não encontrada." });
    }

    if (String(candidate.data["Anfitrião - Inscrição"] || "") !== hostNumero) {
      return res.status(403).json({ error: "Intercambista não vinculado ao anfitrião logado." });
    }

    candidate.data["Status da solicitação"] = "Pendente";
    candidate.data["Status final"] = "Pendente";
    candidate.data["Data da decisão"] = "";
    candidate.data["Observação da decisão"] = note;
    await updateRow(EXCHANGE_REQUESTS_SHEET, requests.headers, candidate.rowNumber, candidate.data);

    const candidatesBase = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidateBase = candidatesBase.rows.find((row) => String(row.data["Inscrição"] || "") === String(candidate.data["Inscrição do intercambista"] || ""));
    if (candidateBase) {
      candidateBase.data["Nº rejeições"] = appendRejectionHistory(candidateBase.data["Nº rejeições"] || "", note);
      await updateRow(CANDIDATE_SHEET, candidatesBase.headers, candidateBase.rowNumber, candidateBase.data);
    }

    host.data["Vagas restantes"] = String(recalculateHostRemainingVacancies(host, requests.rows));
    await updateRow(HOST_SHEET, hosts.headers, host.rowNumber, host.data);

    res.json({ ok: true, message: "Inscrição do intercambista cancelada com sucesso." });
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
    logLookup("candidate-first-access", "start", {
      cpf: maskValue(cpf),
      email: maskValue(email, 6),
      totalCandidates: dataset.rows.length,
    });
    const found = dataset.rows.find((row) => onlyDigits(row.data.CPF) === cpf);
    if (!found) {
      logLookup("candidate-first-access", "not_found", { cpf: maskValue(cpf) });
      return res.status(404).json({ error: "CPF não encontrado." });
    }
    logLookup("candidate-first-access", "matched", {
      by: "cpf",
      rowNumber: found.rowNumber,
      cpf: maskValue(cpf),
      emailSheet: maskValue(found.data["E-mail institucional"] || "", 6),
    });

    const rowEmail = String(found.data["E-mail institucional"] || "").trim().toLowerCase();
    if (!rowEmail || rowEmail !== email) {
      logLookup("candidate-first-access", "email_mismatch", {
        cpf: maskValue(cpf),
        emailRequest: maskValue(email, 6),
        emailSheet: maskValue(rowEmail, 6),
      });
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
    const hostAreas = await getRows(HOST_AREAS_SHEET, hostAreaHeaders);
    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const areasByHost = new Map();
    hostAreas.rows.forEach((row) => {
      const key = String(row.data["Inscrição do anfitrião"] || "");
      if (!areasByHost.has(key)) areasByHost.set(key, []);
      areasByHost.get(key).push(row);
    });
    const ativos = hosts.rows
      .filter((row) => normalizeText(resolveHostStatus(row.data)) === "ativo")
      .filter((row) => normalizeText(row.data["Permissão admin"] || "") === "concedido")
      .map((row) => {
        const hostKey = String(row.data["Inscrição"] || "");
        const reserved = getReservedParticipantsForHost(requests.rows, hostKey);
        const offered = Number(String(row.data["Número de vagas oferecidas"] || "").trim()) || 0;
        const remaining = Math.max(0, offered - reserved);
        return {
          row,
          hostAreasRows: recalculateHostAreas(areasByHost.get(hostKey) || [], requests.rows, hostKey),
          remaining,
        };
      })
      .map((item) => publicHostView(item.row.data, item.hostAreasRows, proLookup, item.remaining));

    res.json({ hosts: ativos });
  } catch (error) {
    console.error("candidate/hosts", error);
    res.status(500).json({ error: "Falha ao listar anfitriões." });
  }
});

app.post("/api/candidate/select-host", requireAuth("candidate"), async (req, res) => {
  try {
    const hostNumero = sanitizeInput(req.body.numeroInscricao || req.body.hostNumeroInscricao, 40);
    const cnpj = onlyDigits(req.body.cnpj || req.body.hostCnpj);
    const entidade = sanitizeInput(req.body.entidade || req.body.hostEntidade, 250);
    const uf = sanitizeInput(req.body.uf || req.body.hostUf, 2).toUpperCase();
    const municipio = sanitizeInput(req.body.municipio || req.body.hostMunicipio, 200);
    console.log("[candidate/select-host:request]", {
      sessionSubject: req.session.subject,
      hostNumero,
      cnpj: maskValue(cnpj),
      entidade,
      uf,
      municipio,
      payloadKeys: Object.keys(req.body || {}),
      participantes: Array.isArray(req.body.participantes) ? req.body.participantes.length : 0,
    });
    if (!hostNumero && !cnpj && !entidade) {
      console.warn("[candidate/select-host:missing-host]", {
        sessionSubject: req.session.subject,
        payloadKeys: Object.keys(req.body || {}),
        rawHostNumero: req.body.numeroInscricao || req.body.hostNumeroInscricao || "",
        rawCnpj: maskValue(onlyDigits(req.body.cnpj || req.body.hostCnpj || "")),
        rawEntidade: req.body.entidade || req.body.hostEntidade || "",
      });
      return res.status(400).json({ error: "Informe um anfitrião." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    logLookup("candidate-select-host", "host_lookup_start", {
      hostNumero,
      cnpj: maskValue(cnpj),
      entidade,
      uf,
      municipio,
      totalHosts: hosts.rows.length,
      candidateSubject: req.session.subject,
    });
    const resolved = findHostForCandidateSelection(hosts.rows, { numeroInscricao: hostNumero, cnpj, entidade, uf, municipio });
    const host = resolved.host;
    if (!host) {
      logLookup("candidate-select-host", "host_not_found", { hostNumero, cnpj: maskValue(cnpj), entidade, uf, municipio });
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }
    logLookup("candidate-select-host", "host_matched", {
      by: resolved.matchedBy || "fallback",
      rowNumber: host.rowNumber,
      hostNumero: String(host.data["Inscrição"] || "").trim(),
      cnpj: maskValue(onlyDigits(host.data["Município CNPJ"] || "")),
    });

    if (normalizeText(resolveHostStatus(host.data)) !== "ativo") {
      console.warn("[candidate/select-host:host-inactive]", {
        hostNumero: String(host.data["Inscrição"] || "").trim(),
        status: resolveHostStatus(host.data),
      });
      return res.status(400).json({ error: "Anfitrião inativo para novas solicitações." });
    }
    if (normalizeText(host.data["Permissão admin"] || "") !== "concedido") {
      console.warn("[candidate/select-host:host-not-authorized]", {
        hostNumero: String(host.data["Inscrição"] || "").trim(),
        permissaoAdmin: host.data["Permissão admin"] || "",
      });
      return res.status(400).json({ error: "Anfitrião ainda não autorizado pelo admin." });
    }

    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    logLookup("candidate-select-host", "candidate_lookup_start", {
      candidateSubject: req.session.subject,
      totalCandidates: candidates.rows.length,
    });
    const candidate = findCandidateBySessionSubject(candidates.rows, req.session.subject);

    if (!candidate) {
      logLookup("candidate-select-host", "candidate_not_found", { candidateSubject: req.session.subject });
      return res.status(404).json({ error: "Intercambista nao encontrado." });
    }
    logLookup("candidate-select-host", "candidate_matched", {
      by: "session.rowNumber",
      rowNumber: candidate.rowNumber,
      cpf: maskValue(onlyDigits(candidate.data.CPF || "")),
      inscricao: candidate.data["Inscrição"] || "",
    });

    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const participants = Array.isArray(req.body.participantes) ? req.body.participantes.filter((item) => item && item.nome) : [];
    if (!participants.length) {
      console.warn("[candidate/select-host:missing-participants]", {
        sessionSubject: req.session.subject,
        participantesRecebidos: Array.isArray(req.body.participantes) ? req.body.participantes.length : 0,
      });
      return res.status(400).json({ error: "Informe ao menos um participante." });
    }
    const duplicate = requests.rows.find((row) => {
      const sameCandidate = String(row.data["Inscrição do intercambista"] || "") === String(candidate.data["Inscrição"] || "");
      const sameHost = String(row.data["Anfitrião - Inscrição"] || "") === String(host.data["Inscrição"] || "");
      const status = normalizeText(row.data["Status da solicitação"] || "");
      return sameCandidate && sameHost && ["pendente", "aceito"].includes(status);
    });
    if (duplicate) {
      console.warn("[candidate/select-host:duplicate]", {
        candidateRegistration: candidate.data["Inscrição"] || "",
        hostNumero: String(host.data["Inscrição"] || ""),
        duplicateRow: duplicate.rowNumber,
      });
      return res.status(409).json({ error: "Já existe uma inscrição ativa desse intercambista para este anfitrião." });
    }
    const requestedParticipants = participants.length;
    const offered = Number(String(host.data["Número de vagas oferecidas"] || "").trim()) || 0;
    const reserved = getReservedParticipantsForHost(requests.rows, String(host.data["Inscrição"] || ""));
    const remaining = Math.max(0, offered - reserved);
    if (requestedParticipants > remaining) {
      console.warn("[candidate/select-host:no-vacancy]", {
        hostNumero: String(host.data["Inscrição"] || ""),
        requestedParticipants,
        offered,
        reserved,
        remaining,
      });
      return res.status(400).json({ error: `Este anfitrião possui apenas ${remaining} vaga(s) restante(s) para novas inscrições.` });
    }

    const requestPayload = buildExchangeRequestValueMap(
      {
        ...req.body,
        participantes: participants,
        inscricaoSolicitacao: await getNextExchangeRequestRegistration(requests.rows),
      },
      candidate,
      host
    );
    await appendRow(EXCHANGE_REQUESTS_SHEET, requests.headers, requestPayload);
    console.log("[candidate/select-host:success]", {
      requestRegistration: requestPayload["Inscrição da solicitação"] || "",
      candidateRegistration: candidate.data["Inscrição"] || "",
      hostNumero: String(host.data["Inscrição"] || ""),
      participantes: participants.length,
    });
    res.json({ ok: true, message: "Inscrição enviada. Agora aguarde o feedback do anfitrião." });
  } catch (error) {
    console.error("candidate/select-host", error);
    res.status(500).json({ error: "Falha ao registrar solicitação." });
  }
});

app.get("/api/host/self-form/:rowNumber", requireAuth("host"), async (req, res) => {
  try {
    const hostRowNumber = Number(req.params.rowNumber);
    if (!hostRowNumber) {
      return res.status(400).json({ error: "Linha da solicitação inválida." });
    }

    const hostData = await getRows(HOST_SHEET, hostHeaders);
    const hostRowData = findHostBySessionSubject(hostData.rows, req.session.subject);
    if (!hostRowData) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }
    if (hostRowData.rowNumber !== hostRowNumber) {
      return res.status(403).json({ error: "Formulário não pertence ao anfitrião logado." });
    }

    const areaData = await getRows(HOST_AREAS_SHEET, hostAreaHeaders);
    const hostAreas = getHostAreas(
      areaData.rows.filter((row) => String(row.data["Inscrição do anfitrião"] || "").trim() === String(hostRowData.data["Inscrição"] || "").trim())
    );
    const data = {
      ...hostRowData.data,
      "Áreas/Setores disponíveis para intercâmbio": hostAreas.length
        ? hostAreas.map((item) => `${item.area}: ${item.vagas}`).join("\n")
        : "",
    };

    res.json({
      rowNumber: hostRowData.rowNumber,
      data,
    });
  } catch (error) {
    console.error("host/self-form", error);
    res.status(500).json({ error: "Falha ao abrir formulário do anfitrião." });
  }
});

app.get("/api/candidate/status", requireAuth("candidate"), async (req, res) => {
  try {
    const candidates = await getRows(CANDIDATE_SHEET, candidateHeaders);
    const candidate = findCandidateBySessionSubject(candidates.rows, req.session.subject);

    if (!candidate) {
      return res.status(404).json({ error: "Intercambista nao encontrado." });
    }

    const requests = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const inscricoes = requests.rows
      .filter((row) => String(row.data["Inscrição do intercambista"] || "") === String(candidate.data["Inscrição"] || ""))
      .sort((a, b) => b.rowNumber - a.rowNumber)
      .map(exchangeRequestSummaryView);

    res.json({
      profile: {
        inscricao: candidate.data["Inscrição"] || "",
        municipio: candidate.data["Município"] || "",
        uf: candidate.data.UF || "",
        unidadeGestora: candidate.data["Unidade Gestora"] || "",
        dirigente: candidate.data["Nome do Dirigente ou Responsável Legal"] || "",
        dataSolicitacao: normalizeDateBr(candidate.data.Data || ""),
        statusIntercambista: resolveCandidateStatus(candidate.data),
        responsavel: candidate.data["Responsável pelo preenchimento"] || "",
        cargoResponsavel: candidate.data["Cargo/Função (Responsável)"] || "",
        dataPreenchimento: normalizeDateBr(candidate.data.Data || ""),
      },
      inscricoes,
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
    const requestData = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const acceptedByHost = new Map();

    requestData.rows.forEach((row) => {
      const status = normalizeText(row.data["Status da solicitação"] || "");
      if (status !== "aceito") return;
      const hostKey = String(row.data["Anfitrião - Inscrição"] || "");
      if (!hostKey) return;
      acceptedByHost.set(hostKey, (acceptedByHost.get(hostKey) || 0) + 1);
    });

    const hosts = hostsData.rows.map((row) => ({
      rowNumber: row.rowNumber,
      actionToken: createActionToken("host-admin-status", row.rowNumber),
      fingerprint: buildHostFingerprint(row.data),
      numeroInscricao: row.data["Inscrição"] || "",
      entidade: row.data["Unidade Gestora"] || "",
      cnpj: row.data["Município CNPJ"] || "",
      status: resolveHostStatus(row.data),
      permissaoAdmin: row.data["Permissão admin"] || "",
      intercambistasAceitos: acceptedByHost.get(String(row.data["Inscrição"] || "")) || 0,
      vagas: row.data["Número de vagas oferecidas"] || "",
      uf: row.data["UF"] || "",
      municipio: row.data["Município"] || "",
      dirigente: row.data["Nome do Dirigente ou Responsável Legal"] || "",
      cargoDirigente: row.data["Cargo/Função (Dirigente)"] || "",
      email: row.data["E-mail de contato"] || "",
      dataSolicitacao: normalizeDateBr(row.data.Data || ""),
      dataAceiteMps: normalizeDateBr(row.data["Data aceite MPS"] || ""),
    }));

    const decisions = requestData.rows
      .filter((row) => {
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return status === "aceito" || status === "rejeitado";
      })
      .map((row) => ({
        rowNumber: row.rowNumber,
        entidadeIntercambista: row.data["Unidade Gestora"] || "",
        cpf: row.data["CPF do intercambista"] || "",
        host: row.data["Anfitrião - Nome"] || "",
        status: row.data["Status da solicitação"] || "",
        dataDecisao: normalizeDateBr(row.data["Data da decisão"] || ""),
        statusIntercambista: row.data["Status final"] || "",
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
    const actionToken = sanitizeInput(req.body.actionToken, 80);
    const fingerprint = sanitizeInput(req.body.fingerprint, 80);
    const numeroInscricao = sanitizeInput(req.body.numeroInscricao, 60);
    const cnpj = onlyDigits(req.body.cnpj);
    const municipio = sanitizeInput(req.body.municipio, 200);
    const uf = sanitizeInput(req.body.uf, 2).toUpperCase();
    const entidade = sanitizeInput(req.body.entidade, 250);
    const email = sanitizeInput(req.body.email, 150);
    const dirigente = sanitizeInput(req.body.dirigente, 200);
    const dataSolicitacao = normalizeDateBr(req.body.dataSolicitacao);
    const permissao = normalizeText(req.body.status) === "negado" ? "Negado" : "Concedido";
    const note = sanitizeInput(req.body.note || "", 600);

    if (permissao === "Negado" && !note) {
      return res.status(400).json({ error: "Informe o motivo da rejeição." });
    }

    const data = await getRows(HOST_SHEET, hostHeaders);
    logLookup("admin-host-status", "start", {
      rowNumber,
      actionToken,
      fingerprint,
      numeroInscricao,
      cnpj: maskValue(cnpj),
      municipio,
      uf,
      entidade,
      email: maskValue(email, 6),
      dirigente,
      dataSolicitacao,
      permissao,
      totalHosts: data.rows.length,
    });

    let host = null;
    if (actionToken) {
      const actionEntry = consumeActionToken(actionToken, "host-admin-status");
      if (actionEntry?.rowNumber) {
        host = data.rows.find((row) => row.rowNumber === actionEntry.rowNumber) || null;
        if (host) logLookup("admin-host-status", "matched", { by: "actionToken", rowNumber: host.rowNumber, inscricao: host.data["Inscrição"] || "" });
      }
    }
    if (!host) {
      const resolved = findHostForAdminStatus(data.rows, {
        rowNumber,
        fingerprint,
        numeroInscricao,
        cnpj,
        municipio,
        uf,
        entidade,
        email,
        dirigente,
        dataSolicitacao,
      });
      host = resolved.host;
      if (host) {
        logLookup("admin-host-status", "matched", {
          by: resolved.matchedBy || "fallback",
          rowNumber: host.rowNumber,
          inscricao: host.data["Inscrição"] || "",
          cnpj: maskValue(onlyDigits(host.data["Município CNPJ"] || "")),
        });
      }
    }
    if (!host) {
      logLookup("admin-host-status", "not_found", {
        rowNumber,
        numeroInscricao,
        cnpj: maskValue(cnpj),
        municipio,
        uf,
        entidade,
        email: maskValue(email, 6),
        dirigente,
        dataSolicitacao,
      });
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    host.data["Permissão admin"] = permissao;
    host.data["Status do Anfitrião"] = permissao === "Concedido" ? "Ativo" : "Rejeitado";
    host.data["Data aceite MPS"] = permissao === "Concedido" ? nowBrDate() : "";
    host.data["Observação do admin"] = note;
    if (permissao === "Negado" && note) {
      host.data["Nº rejeições"] = appendRejectionHistory(host.data["Nº rejeições"] || "", note);
    }
    host.data["Mensagem do admin vista"] = permissao === "Negado" && note ? "Não" : host.data["Mensagem do admin vista"] || "Sim";
    host.data["Data visualização mensagem admin"] = permissao === "Negado" && note ? "" : host.data["Data visualização mensagem admin"] || "";
    if (permissao === "Concedido") {
      if (!host.data["Senha"]) {
        const senhaInicial = generateHostPassword();
        host.data["Senha"] = await bcrypt.hash(senhaInicial, 12);
        host.data["Primeiro Acesso Concluído"] = resolveHostFirstAccess(host.data);
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

    host.data["Primeiro Acesso Concluído"] = resolveHostFirstAccess(host.data);
    await updateRow(HOST_SHEET, data.headers, host.rowNumber, host.data);

    res.json({ ok: true, status: permissao, message: permissao === "Concedido" ? "Cadastro aprovado com sucesso." : "Cadastro rejeitado com sucesso." });
  } catch (error) {
    console.error("admin/host-status", error);
    res.status(500).json({ error: "Falha ao alterar permissão do anfitrião." });
  }
});

app.post("/api/host/admin-note/read", requireAuth("host"), async (req, res) => {
  try {
    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = findHostBySessionSubject(hosts.rows, req.session.subject);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }
    const currentNote =
      String(host.data["Observação do admin"] || "").trim() ||
      extractLatestRejectionNote(host.data["Nº rejeições"] || "");
    if (!currentNote) {
      return res.json({ ok: true, message: "Sem mensagem pendente." });
    }
    host.data["Mensagem do admin vista"] = "Sim";
    host.data["Data visualização mensagem admin"] = nowBrDate();
    await updateRow(HOST_SHEET, hosts.headers, host.rowNumber, host.data);
    res.json({ ok: true, message: "Mensagem marcada como vista." });
  } catch (error) {
    console.error("host/admin-note/read", error);
    res.status(500).json({ error: "Falha ao marcar mensagem como vista." });
  }
});

app.post("/api/admin/remove-host", requireAuth("admin"), async (req, res) => {
  try {
    const rowNumber = Number(req.body.rowNumber);
    const note = sanitizeInput(req.body.note || "", 600);
    if (!rowNumber) {
      return res.status(400).json({ error: "Linha do anfitrião inválida." });
    }
    if (!note) {
      return res.status(400).json({ error: "Informe o motivo do cancelamento." });
    }

    const hosts = await getRows(HOST_SHEET, hostHeaders);
    const host = hosts.rows.find((row) => row.rowNumber === rowNumber);
    if (!host) {
      return res.status(404).json({ error: "Anfitrião não encontrado." });
    }

    host.data["Status do Anfitrião"] = "Inativo";
    host.data["Permissão admin"] = "Removido";
    host.data["Data aceite MPS"] = "";
    host.data["Senha"] = "";
    host.data["Observação do admin"] = note;
    host.data["Primeiro Acesso Concluído"] = resolveHostFirstAccess(host.data);
    await updateRow(HOST_SHEET, hosts.headers, host.rowNumber, host.data);

    res.json({ ok: true, message: "Inscrição do anfitrião cancelada com sucesso." });
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
    const candidatesData = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const vinculados = candidatesData.rows
      .filter((row) => {
        const selectedHost = String(row.data["Anfitrião - Inscrição"] || "");
        const status = normalizeText(row.data["Status da solicitação"] || "");
        return selectedHost === hostNumero && status === "aceito";
      })
      .map(exchangeRequestSummaryView);

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
      return res.status(400).json({ error: "Linha da inscrição inválida." });
    }

    const candidatesData = await getRows(EXCHANGE_REQUESTS_SHEET, exchangeRequestHeaders);
    const candidate = candidatesData.rows.find((row) => row.rowNumber === rowNumber);
    if (!candidate) {
      return res.status(404).json({ error: "Inscrição não encontrada." });
    }

    res.json({
      rowNumber: candidate.rowNumber,
      resumo: exchangeRequestSummaryView(candidate),
      data: candidate.data,
    });
  } catch (error) {
    console.error("admin/candidate-form", error);
    res.status(500).json({ error: "Falha ao abrir plano do intercambista." });
  }
});

app.post("/api/logout", (req, res) => {
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

