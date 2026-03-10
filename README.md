# Intercambio RPPS Conaprev

Portal com 3 areas de acesso (Admin, Anfitriao e Intercambista) integrado ao Google Sheets.

## Como rodar

```bash
npm install
npm start
```

Servidor local: `http://localhost:3000`

## Variaveis de ambiente (Render)

As variaveis abaixo sao obrigatorias:

- `PORT` = `3000` (no Render pode deixar automatico)
- `GOOGLE_SERVICE_ACCOUNT_JSON` = JSON completo da service account (ja existente no Render)
- `GOOGLE_SHEET_ID` = `10pTssa2LbdW_uU7pHandbf6_6S3V6mJ7pAnmoSKPqOg`
- `ADMIN_USER` = usuario admin (exemplo: `admin_conaprev`)
- `ADMIN_PASSWORD_HASH` = hash bcrypt da senha admin
- `SESSION_SECRET` = chave longa aleatoria (minimo 24 chars, recomendado 64)

## Gerar ADMIN_PASSWORD_HASH

Use localmente:

```bash
node -e "const b=require('bcryptjs'); b.hash('SUA_SENHA_FORTE_AQUI',12).then(console.log)"
```

Copie o hash retornado para `ADMIN_PASSWORD_HASH`.

## Seguranca aplicada

- Chave do Google Sheets usada apenas no backend.
- Senha do anfitriao armazenada como hash bcrypt em `Senha Hash`.
- Login com rate limit.
- Sessao por token com expiracao.
- Helmet + CSP para reduzir vetores de ataque.
- Sanitizacao de entrada contra script injection.

## Observacao sobre o arquivo da chave

Apos configurar `GOOGLE_SERVICE_ACCOUNT_JSON` no Render e validar deploy, pode remover o arquivo `gestao-caco-fc23b8ec8e0e.json` do projeto.
