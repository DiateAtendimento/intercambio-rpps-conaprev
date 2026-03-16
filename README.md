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
- `GOOGLE_SHEET_ID` = `10pTssa2......`
- `ADMIN_USER` = usuario admin (exemplo: `admin_conaprev`)
- `ADMIN_PASSWORD_HASH` = hash bcrypt da senha admin
- `SESSION_SECRET` = chave longa aleatoria (minimo 24 chars, recomendado 64)

## Variaveis SMTP

Para envio dos e-mails de cadastro e aprovacao, configure:

- `SMTP_HOST` = host do provedor SMTP
- `SMTP_PORT` = `587` (STARTTLS) ou `465` (SSL)
- `SMTP_USER` = usuario SMTP
- `SMTP_PASS` = senha SMTP
- `SMTP_FROM` = remetente exibido

Opcionalmente, para reduzir timeout em ambientes com proxy/CDN:

- `SMTP_CONNECTION_TIMEOUT_MS` = timeout de conexao SMTP (padrao `4000`)
- `SMTP_GREETING_TIMEOUT_MS` = timeout de handshake SMTP (padrao `4000`)
- `SMTP_SOCKET_TIMEOUT_MS` = timeout total do socket SMTP (padrao `6000`)

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

## Diagnostico rapido de e-mail pendente

Se o cadastro salvar, mas a interface mostrar `e-mail pendente` ou `Connection timeout`:

- confira se `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` estao definidos no Render
- confirme com o provedor qual porta deve ser usada: `587` ou `465`
- valide se o usuario SMTP tem permissao para enviar com o remetente informado em `SMTP_FROM`
- se o servidor estiver no Render, teste um provedor SMTP externo compativel e evite configuracoes bloqueadas pela hospedagem
