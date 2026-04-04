# WhatsApp AI v2

Atendimento automático via WhatsApp com Responses API, multi-tenant, multi-instância e dashboard.

---

## Stack

- **Baileys** — WhatsApp via QR Code
- **OpenAI Responses API** — gpt-4.1-mini (padrão)
- **Google Gemini** — alternativa de provider
- **SQLite** — memória, histórico, config por tenant
- **Express** — dashboard web
- **PM2** — produção na VPS

---

## Setup local

```bash
npm install
cp .env.example .env
# edite o .env com suas chaves
npm start
```

Acesse o dashboard em: `http://localhost:3000`

Login padrão: email e senha definidos no `.env`

---

## Estrutura

```
/src
  /providers
    openai.js          → Responses API
    gemini.js          → Google Gemini
  /services
    ai.js              → orquestrador de providers
    memory.js          → histórico por tenant/número
    actions.js         → stubs de ações (pedido, pagamento, etc)
    whatsapp.js        → gerenciador de instâncias Baileys
  /dashboard
    server.js          → Express + JWT + rotas API
    /public
      index.html       → frontend completo (single file)
/config
  settings.js          → config por tenant (SQLite)
/db
  database.js          → schema e conexão SQLite
/data
  db.sqlite            → gerado automaticamente
  /auth                → sessões WhatsApp por tenant/instância
```

---

## Multi-tenant

Cada cliente (tenant) tem:
- Configurações isoladas (provider, API key, prompt, RAG)
- Histórico separado por número
- Instâncias WhatsApp próprias

Tenant padrão `default` é criado automaticamente.

---

## Adicionar nova instância WhatsApp

1. Dashboard → Instâncias → digitar nome → "+ Adicionar"
2. Clicar em "Conectar"
3. Escanear QR Code com o WhatsApp

---

## Configurar o prompt

Dashboard → **Prompt & RAG**

- **System Prompt**: comportamento do assistente
- **Base de Conhecimento**: informações do negócio, preços, FAQ

---

## Actions (stubs)

Edite `src/services/actions.js` para implementar lógica real:

```js
criarPedido({ cliente, itens, endereco })
gerarLinkPagamento({ pedidoId, valor })
consultarStatusPedido({ pedidoId })
```

A IA decide quando chamar cada action. O backend executa.

---

## Produção (VPS)

```bash
npm install -g pm2
pm2 start src/index.js --name whatsapp-ai
pm2 save
pm2 startup
```

---

## Custos estimados

| Provider | Modelo | Custo por 1k mensagens |
|---|---|---|
| OpenAI | gpt-4.1-mini | ~$0.10 |
| OpenAI | gpt-4o | ~$1.50 |
| Gemini | gemini-2.0-flash | ~$0.05 |

---

## Evoluções futuras

- [ ] Webhook para CRM quando lead qualificado
- [ ] Horário de atendimento (fora do horário → mensagem automática)
- [ ] Blacklist de números
- [ ] Upload de arquivo no dashboard para RAG
- [ ] Métricas (total de conversas, tempo médio de resposta)
- [ ] Multi-usuário por tenant com permissões
