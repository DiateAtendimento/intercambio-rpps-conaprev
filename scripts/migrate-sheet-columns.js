const { google } = require("googleapis");
require("dotenv").config();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

if (!SHEET_ID) {
  throw new Error("Missing GOOGLE_SHEET_ID");
}

function pickServiceAccount() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      parsed.private_key = String(parsed.private_key || "").replace(/\\n/g, "\n");
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key");
      }
      return parsed;
    } catch {
      if (!raw.includes("BEGIN PRIVATE KEY")) {
        throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON");
      }
    }
  }

  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = raw || String(process.env.GOOGLE_PRIVATE_KEY || "").trim();
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google credentials. Use GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY."
    );
  }

  return {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID || undefined,
    private_key: privateKey,
    client_email: clientEmail,
  };
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

function normalize(value) {
  return String(value || "").trim();
}

async function getSheetValues(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!A:ZZ`,
  });
  return res.data.values || [];
}

async function ensureHeaders(sheets, sheetName, requiredHeaders) {
  const values = await getSheetValues(sheets, sheetName);
  const headers = values[0] || [];
  const existing = new Set(headers.map((h) => normalize(h)));
  let changed = false;

  requiredHeaders.forEach((h) => {
    if (!existing.has(normalize(h))) {
      headers.push(h);
      existing.add(normalize(h));
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

function buildHeaderIndex(headers) {
  const map = new Map();
  headers.forEach((h, idx) => map.set(normalize(h), idx));
  return map;
}

function getCell(row, idx) {
  if (idx == null || idx < 0) return "";
  return row[idx] || "";
}

function setCell(row, idx, value) {
  while (row.length <= idx) row.push("");
  row[idx] = value;
}

function planRowMigrations(rows, headerIndex, mapping) {
  let changedRows = 0;
  let changedCells = 0;
  const output = rows.map((r) => [...r]);

  output.forEach((row) => {
    let rowChanged = false;

    mapping.forEach(({ target, source }) => {
      const tIdx = headerIndex.get(normalize(target));
      const sIdx = headerIndex.get(normalize(source));
      if (tIdx == null || sIdx == null) return;

      const currentTarget = normalize(getCell(row, tIdx));
      const currentSource = normalize(getCell(row, sIdx));
      if (currentTarget || !currentSource) return;

      setCell(row, tIdx, getCell(row, sIdx));
      changedCells += 1;
      rowChanged = true;
    });

    if (rowChanged) changedRows += 1;
  });

  return { output, changedRows, changedCells };
}

async function applyRows(sheets, sheetName, headers, rows) {
  if (!rows.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!A2:${toColumnLetter(headers.length)}${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows.map((r) => headers.map((_, i) => r[i] || "")) },
  });
}

async function migrateSheet(sheets, config, apply) {
  const headers = await ensureHeaders(sheets, config.sheetName, config.requiredHeaders);
  const values = await getSheetValues(sheets, config.sheetName);
  const rows = values.slice(1);
  const headerIndex = buildHeaderIndex(headers);
  const { output, changedRows, changedCells } = planRowMigrations(rows, headerIndex, config.mapping);

  if (apply && changedRows > 0) {
    await applyRows(sheets, config.sheetName, headers, output);
  }

  return { changedRows, changedCells, totalRows: rows.length };
}

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
];

const hostMapping = [
  { target: "Inscrição", source: "Numero de Inscricao" },
  { target: "UF", source: "Unidade Federativa (UF)" },
  { target: "Município", source: "Entidade ou órgão gestor" },
  { target: "Município CNPJ", source: "CNPJ" },
  { target: "Unidade Gestora", source: "Entidade ou órgão gestor" },
  { target: "Senha", source: "Senha Hash" },
  { target: "Primeiro Acesso Concluído", source: "Primeiro Acesso Concluido" },
  { target: "Status do Anfitrião", source: "Status do Anfitriao" },
];

const candidateMapping = [
  { target: "UF", source: "Unidade Federativa (UF)" },
  { target: "Município", source: "Entidade ou órgão gestor" },
  { target: "Unidade Gestora", source: "Entidade ou órgão gestor" },
  { target: "Senha", source: "Senha Hash" },
  { target: "Gênero", source: "Genero" },
  { target: "Primeiro Acesso Concluído", source: "Primeiro Acesso Concluido" },
  { target: "Anfitrião escolhido - Inscrição", source: "Anfitriao escolhido - Numero de Inscricao" },
  { target: "Anfitrião escolhido - Nome", source: "Anfitriao escolhido - Nome" },
  { target: "Status da solicitação", source: "Status da solicitacao" },
  { target: "Data da decisão", source: "Data da decisao" },
  { target: "Observação da decisão", source: "Observacao da decisao" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const auth = new google.auth.GoogleAuth({
    credentials: pickServiceAccount(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const hostResult = await migrateSheet(
    sheets,
    { sheetName: "Anfitrião", requiredHeaders: hostHeaders, mapping: hostMapping },
    apply
  );

  const candidateResult = await migrateSheet(
    sheets,
    { sheetName: "Intercambista", requiredHeaders: candidateHeaders, mapping: candidateMapping },
    apply
  );

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[Anfitrião] rows=${hostResult.totalRows} changedRows=${hostResult.changedRows} changedCells=${hostResult.changedCells}`);
  console.log(`[Intercambista] rows=${candidateResult.totalRows} changedRows=${candidateResult.changedRows} changedCells=${candidateResult.changedCells}`);
}

main().catch((error) => {
  console.error("Migration failed:", error.message || error);
  process.exitCode = 1;
});
