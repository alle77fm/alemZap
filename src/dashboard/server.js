import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import db from '../../db/database.js'
import { getConfig, saveConfig, listTenants, createTenant } from '../../config/settings.js'
import { getConversations, getFullHistory } from '../services/memory.js'
import { startInstance, stopInstance, getInstance } from '../services/whatsapp.js'
import qrcode from 'qrcode'
import multer from 'multer'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdf = require('pdf-parse')
import * as openaiProvider from '../providers/openai.js'
import * as deepseekProvider from '../providers/deepseek.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = parseInt(process.env.DASHBOARD_PORT || '3000', 10)
const JWT_SECRET = process.env.JWT_SECRET || 'secret_dev'

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Auth middleware ──────────────────────────────────────────────────────────

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token
  if (!token) return res.status(401).json({ error: 'Token requerido' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido' })
  }
}

// ── Seed admin user ──────────────────────────────────────────────────────────

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@admin.com'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (!exists) {
    const hash = await bcrypt.hash(password, 10)
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hash, 'superadmin')
    console.log(`👤 Admin criado: ${email}`)
  }
}

// ── Routes: Auth ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' })

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { email: user.email, role: user.role } })
})

app.post('/api/auth/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Campos obrigatórios ausentes' })
  if (newPassword.length < 6) return res.status(400).json({ error: 'Nova senha deve ter ao menos 6 caracteres' })

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' })

  const hash = await bcrypt.hash(newPassword, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  res.json({ ok: true })
})

// ── Routes: Users ─────────────────────────────────────────────────────────────

app.get('/api/users', auth, (req, res) => {
  if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão' })
  const users = db.prepare('SELECT id, email, role, tenant_id, created_at FROM users ORDER BY created_at DESC').all()
  res.json(users)
})

app.post('/api/users', auth, async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão' })
  const { email, password, tenant_id, role } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' })
  const allowedRoles = ['admin', 'viewer']
  const userRole = allowedRoles.includes(role) ? role : 'admin'
  try {
    const hash = await bcrypt.hash(password, 10)
    db.prepare('INSERT INTO users (email, password_hash, role, tenant_id) VALUES (?, ?, ?, ?)').run(email, hash, userRole, tenant_id || null)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.delete('/api/users/:id', auth, (req, res) => {
  if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão' })
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Não é possível remover seu próprio usuário' })
  db.prepare('DELETE FROM users WHERE id = ?').run(parseInt(req.params.id))
  res.json({ ok: true })
})

// ── Routes: Tenants ───────────────────────────────────────────────────────────

app.get('/api/tenants', auth, (req, res) => {
  res.json(listTenants())
})

app.post('/api/tenants', auth, (req, res) => {
  const { id, name, email } = req.body
  try {
    const tenant = createTenant(id, name, email)
    res.json(tenant)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ── Routes: Playground & Upload ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/playground/:tenantId', auth, async (req, res) => {
  try {
    const { message, history, temperature, top_p, response_format } = req.body
    const config = getConfig(req.params.tenantId)
    const apiKey = config.provider === 'deepseek' ? (config.deepseek_key || process.env.DEEPSEEK_API_KEY) : (config.openai_key || process.env.OPENAI_API_KEY)
    
    if (!apiKey) return res.status(400).json({ error: 'API key não configurada no painel ou env.' })

    const ctx = {
      apiKey,
      model: config.model,
      systemPrompt: config.system_prompt,
      knowledgeBase: config.knowledge_base,
      history,
      message,
      temperature: temperature ?? config.temperature ?? 0.7,
      top_p: top_p ?? config.top_p ?? 1.0,
      response_format: response_format ?? config.response_format ?? 'text'
    }

    const reply = config.provider === 'deepseek' ? await deepseekProvider.call(ctx) : await openaiProvider.call(ctx)
    res.json({ reply })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/config/:tenantId/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido' })
    
    let text = ''
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer)
      text = data.text
    } else if (req.file.mimetype === 'text/plain') {
      text = req.file.buffer.toString('utf-8')
    } else {
      return res.status(400).json({ error: 'Apenas arquivos PDF ou TXT são suportados.' })
    }

    const config = getConfig(req.params.tenantId)
    const newKnowledge = [config.knowledge_base, text].filter(Boolean).join('\n\n')
    
    saveConfig(req.params.tenantId, { knowledge_base: newKnowledge })
    res.json({ ok: true, chars: text.length, knowledge_base: newKnowledge })
  } catch (err) {
    console.error('Erro no upload:', err)
    res.status(500).json({ error: 'Erro processando arquivo: ' + err.message })
  }
})

// ── Routes: Config ────────────────────────────────────────────────────────────

app.get('/api/config/:tenantId', auth, (req, res) => {
  const config = getConfig(req.params.tenantId)
  // Não retorna as keys completas por segurança
  config.openai_key = config.openai_key ? '••••' + config.openai_key.slice(-4) : ''
  config.deepseek_key = config.deepseek_key ? '••••' + config.deepseek_key.slice(-4) : ''
  res.json(config)
})

app.post('/api/config/:tenantId', auth, (req, res) => {
  try {
    saveConfig(req.params.tenantId, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error('[Config] Erro ao salvar:', err.message)
    res.status(500).json({ error: 'Erro ao salvar configurações: ' + err.message })
  }
})

app.post('/api/config/:tenantId/toggle-bot', auth, (req, res) => {
  const config = getConfig(req.params.tenantId)
  const novoValor = config.bot_active ? 0 : 1
  saveConfig(req.params.tenantId, { bot_active: novoValor })
  res.json({ bot_active: novoValor })
})

app.post('/api/config/:tenantId/api-key', auth, (req, res) => {
  const crypto = require('crypto')
  const apiKey = crypto.randomBytes(16).toString('hex')
  saveConfig(req.params.tenantId, { api_key: apiKey })
  res.json({ api_key: apiKey })
})

// ── Routes: Webhook (N8N) ─────────────────────────────────────────────────────

app.post('/api/webhook/send', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const apiKeyHeader = req.headers['x-api-key']
    
    let authenticated = false
    let tenantIdStr = req.body.tenant_id

    if (apiKeyHeader) {
      const config = db.prepare('SELECT tenant_id FROM tenant_config WHERE api_key = ? AND api_key != ""').get(apiKeyHeader)
      if (config) {
        authenticated = true
        tenantIdStr = config.tenant_id
      }
    } else if (authHeader) {
      const token = authHeader.split(' ')[1]
      try {
        const decoded = jwt.verify(token, JWT_SECRET)
        authenticated = true
        if (!tenantIdStr) tenantIdStr = decoded.tenant_id
      } catch (e) {}
    }

    if (!authenticated) return res.status(401).json({ error: 'Não autorizado' })

    const { instance_id, phone, message } = req.body
    if (!instance_id || !phone || !message) {
      return res.status(400).json({ error: 'Campos obrigatórios faltantes: instance_id, phone, message' })
    }

    const sock = getInstance(instance_id)
    if (!sock) return res.status(404).json({ error: 'Instância offline ou não encontrada' })

    const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`
    await sock.sendMessage(jid, { text: message })

    // Opcional: Registrar envio também no webhook!
    // (A chamada de sendMessage aqui dispara dispatchWebhook em messages.update, mas não upsert, então podemos não misturar)

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Routes: WhatsApp Instances ────────────────────────────────────────────────

app.get('/api/instances/:tenantId', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM whatsapp_instances WHERE tenant_id = ?').all(req.params.tenantId)
  res.json(rows)
})

app.post('/api/instances/:tenantId', auth, (req, res) => {
  const { label } = req.body
  const id = `${req.params.tenantId}_${Date.now()}`
  db.prepare('INSERT INTO whatsapp_instances (id, tenant_id, label) VALUES (?, ?, ?)').run(id, req.params.tenantId, label || 'Principal')
  res.json({ id })
})

// QR Code via SSE
const qrSubscribers = new Map()

app.get('/api/instances/:instanceId/connect', auth, async (req, res) => {
  const { instanceId } = req.params
  const row = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!row) return res.status(404).json({ error: 'Instância não encontrada' })

  console.log(`[SSE] Iniciando conexão para ${instanceId}`)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendEvent = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
  }

  // Envia confirmação imediata antes de iniciar
  sendEvent({ type: 'connecting' })

  // Inicia a instância — startInstance resolve rápido, o QR vem via callback assíncrono
  startInstance(row.tenant_id, instanceId, async (event, data) => {
    console.log(`[SSE] Evento recebido: ${event} para ${instanceId}`)
    if (event === 'qr') {
      try {
        const qrDataUrl = await qrcode.toDataURL(data)
        sendEvent({ type: 'qr', qr: qrDataUrl })
      } catch (err) {
        console.error(`[SSE] Erro ao converter QR:`, err.message)
      }
    } else if (event === 'connected') {
      sendEvent({ type: 'connected' })
      res.end()
    }
  }).catch((err) => {
    console.error(`[SSE] Erro ao iniciar instância ${instanceId}:`, err.message)
    sendEvent({ type: 'error', message: err.message })
    // NÃO encerra o stream — o socket pode se recuperar
  })

  // Fecha a conexão SSE quando o cliente desconectar
  req.on('close', () => {
    console.log(`[SSE] Cliente desconectou: ${instanceId}`)
    if (!res.writableEnded) res.end()
  })
})

app.post('/api/instances/:instanceId/disconnect', auth, async (req, res) => {
  await stopInstance(req.params.instanceId)
  res.json({ ok: true })
})

app.delete('/api/instances/:instanceId', auth, async (req, res) => {
  try {
    const { instanceId } = req.params
    const row = db.prepare('SELECT tenant_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
    if (!row) return res.status(404).json({ error: 'Instância não encontrada' })

    await stopInstance(instanceId)
    db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(instanceId)

    // Limpar pasta de auth
    const authPath = path.resolve(`data/auth/${row.tenant_id}/${instanceId}`)
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true })
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/instances/:instanceId/pairing-code', auth, async (req, res) => {
  try {
    const { phone } = req.body
    const { instanceId } = req.params

    if (!phone) return res.status(400).json({ error: 'Número de telefone é obrigatório.' })

    const sock = getInstance(instanceId)
    if (!sock) return res.status(400).json({ error: 'Instância não encontrada. Clique em "Conectar" via QR Code primeiro para iniciar o socket.' })

    const phoneClean = phone.replace(/\D/g, '')
    const code = await sock.requestPairingCode(phoneClean)
    res.json({ code })
  } catch (err) {
    console.error('Pairing code error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Routes: Conversations ─────────────────────────────────────────────────────

app.get('/api/conversations/:tenantId', auth, (req, res) => {
  res.json(getConversations(req.params.tenantId))
})

app.get('/api/conversations/:tenantId/:instanceId/:phone', auth, (req, res) => {
  const { tenantId, instanceId, phone } = req.params
  res.json(getFullHistory(tenantId, instanceId, phone))
})

// ── Start ─────────────────────────────────────────────────────────────────────

await seedAdmin()

// Garante que o tenant 'default' exista para evitar FK violation
const defaultTenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get('default')
if (!defaultTenant) {
  db.prepare('INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)').run('default', 'Default', 'default@alem.zap')
  db.prepare('INSERT OR IGNORE INTO tenant_config (tenant_id) VALUES (?)').run('default')
  console.log('🏢 Tenant "default" criado automaticamente')
}

const server = app.listen(PORT, () => {
  console.log(`🖥️  Dashboard: http://localhost:${PORT}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Erro: A porta ${PORT} já está em uso. O dashboard não pôde ser iniciado.`)
  } else {
    console.error(`❌ Erro no dashboard:`, err.message)
  }
})

export default app
