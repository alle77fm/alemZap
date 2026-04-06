import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import path from 'path'
import fs from 'fs'
import db from '../../db/database.js'
import { processMessage, humanizedResponse } from './ai.js'
import { getConfig } from '../../config/settings.js'
import { dispatchWebhook } from './webhook.js'
import { transcribeAudio } from './transcription.js'

const logger = pino({ level: 'silent' })
const instances = new Map() // instanceId → socket

function getAuthDir(tenantId, instanceId) {
  const dir = path.resolve(`data/auth/${tenantId}/${instanceId}`)
  return dir
}

function hasCredentials(tenantId, instanceId) {
  const credsFile = path.resolve(`data/auth/${tenantId}/${instanceId}/creds.json`)
  return fs.existsSync(credsFile)
}

function updateStatus(instanceId, status, phone = null) {
  db.prepare(`
    UPDATE whatsapp_instances SET status = ?, phone = ? WHERE id = ?
  `).run(status, phone, instanceId)
}

// Encerra um socket completamente, sem chance de reconexão interna
function killSocket(sock) {
  try {
    sock.ev.removeAllListeners()
    sock.end(new Error('force_close'))
  } catch (_) {
    try { sock.ws?.close() } catch (_2) {}
  }
}

export function getInstance(instanceId) {
  return instances.get(instanceId)
}

export async function startInstance(tenantId, instanceId, onEvent = null) {
  // Encerra socket anterior de forma completa
  if (instances.has(instanceId)) {
    console.log(`[${instanceId}] Encerrando socket anterior...`)
    killSocket(instances.get(instanceId))
    instances.delete(instanceId)
  }

  console.log(`[${instanceId}] Iniciando socket...`)

  const authDir = getAuthDir(tenantId, instanceId)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  // Pega versão do protocolo com timeout e fallback
  let version
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
    ])
    version = result.version
    console.log(`[${instanceId}] Versão WA: ${version}`)
  } catch (_) {
    version = [2, 3000, 1035194821] // fallback confirmado funcional em 2026
    console.log(`[${instanceId}] Usando versão fallback: ${version}`)
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome', '130.0.6723.117'],
    printQRInTerminal: false,
    // ── Configurações de estabilidade para VPS ──────────────────────────────
    connectTimeoutMs: 60000,      // aguarda até 60s para conectar
    keepAliveIntervalMs: 10000,   // mantém conexão ativa a cada 10s
    retryRequestDelayMs: 2000,    // espera 2s entre tentativas de requisição
    qrTimeoutMs: 60000,           // QR Code válido por 60 segundos
    maxMsgRetryCount: 5,
  })

  instances.set(instanceId, sock)
  updateStatus(instanceId, 'connecting')

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    // ── QR Code gerado ──────────────────────────────────────────────────────
    if (qr) {
      console.log(`[${instanceId}] QR gerado (onEvent=${!!onEvent})`)
      updateStatus(instanceId, 'qr_pending')
      if (onEvent) {
        onEvent('qr', qr)
      }
    }

    // ── Conexão aberta com sucesso ──────────────────────────────────────────
    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0]
      updateStatus(instanceId, 'connected', phone)
      console.log(`✅ Instância ${instanceId} conectada (${phone})`)
      if (onEvent) onEvent('connected')
    }

    // ── Conexão encerrada ───────────────────────────────────────────────────
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const reason = lastDisconnect?.error?.message || ''
      console.log(`[${instanceId}] Conexão encerrada. Código: ${statusCode}, Motivo: ${reason}`)

      updateStatus(instanceId, 'disconnected')
      instances.delete(instanceId)

      // ── CÓDIGO 515: Stream Error (reinicialização normal do Baileys) ──────
      // NÃO deletar auth. Reconectar após 3 segundos.
      if (statusCode === 515) {
        console.log(`[${instanceId}] Stream error (515) — reconectando em 3s sem deletar auth...`)
        updateStatus(instanceId, 'connecting')
        setTimeout(() => startInstance(tenantId, instanceId, onEvent), 3000)
        return
      }

      // ── CÓDIGO 408: QR expirado — gerar novo QR automaticamente ──────────
      if (statusCode === 408) {
        console.log(`[${instanceId}] QR expirado (408) — gerando novo QR automaticamente...`)
        updateStatus(instanceId, 'qr_pending')
        setTimeout(() => startInstance(tenantId, instanceId, onEvent), 2000)
        return
      }

      // ── LOGOUT REAL: detectado pela mensagem, não pelo código numérico ────
      // DisconnectReason.loggedOut = 401, mas "Connection Failure" com código
      // 401 é diferente. A forma segura é checar o texto da mensagem.
      const isLoggedOut = reason.toLowerCase().includes('logged out')

      if (isLoggedOut) {
        console.log(`[${instanceId}] Desconectado pelo usuário — escaneie o QR novamente`)
        const authDir = getAuthDir(tenantId, instanceId)
        if (fs.existsSync(authDir)) {
          fs.rmSync(authDir, { recursive: true, force: true })
        }
        if (onEvent) onEvent('disconnected')
        return
      }

      // ── Qualquer outro erro: reconecta sem deletar auth ───────────────────
      console.log(`[${instanceId}] Reconectando (código: ${statusCode})...`)
      setTimeout(() => startInstance(tenantId, instanceId, onEvent), 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue
      if (msg.key.remoteJid.endsWith('@g.us')) continue

      const jid = msg.key.remoteJid
      const phone = jid.split('@')[0]

      // Extrai texto ou tenta transcrever áudio
      let text = extractText(msg)

      if (!text?.trim()) {
        const isAudio = msg.message?.audioMessage || msg.message?.pttMessage
        if (isAudio) {
          text = await transcribeAudio(sock, msg, tenantId)
          if (!text) continue
        } else {
          continue
        }
      }

      try {
        const config = getConfig(tenantId)
        if (!config.bot_active) continue

        // Webhook: mensagem recebida
        dispatchWebhook(tenantId, 'message_received', {
          phone,
          message: text,
          instance_id: instanceId,
        })

        const messages = await processMessage(tenantId, instanceId, phone, text)
        if (!messages) continue
        const msgs = Array.isArray(messages) ? messages : [messages]
        const sentMessages = []

        for (const msg of msgs) {
          if (typeof msg !== 'string') continue
          const isLead = msg.includes('[LEAD_QUALIFICADO]')
          const cleanMsg = msg.replace('[LEAD_QUALIFICADO]', '').trim()
          if (isLead) {
            dispatchWebhook(tenantId, 'lead_qualificado', {
              phone,
              instance_id: instanceId,
            })
          }
          if (cleanMsg.length === 0) continue
          await sock.sendPresenceUpdate('composing', jid)
          const typingDelay = Math.min(cleanMsg.length * (Math.floor(Math.random() * 31) + 40), 6000)
          await new Promise(r => setTimeout(r, typingDelay))
          await sock.sendPresenceUpdate('paused', jid)
          await sock.sendMessage(jid, { text: cleanMsg })
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * 701) + 500))
          sentMessages.push(cleanMsg)
        }
<<<<<<< HEAD

       // Webhook: resposta enviada
        dispatchWebhook(tenantId, 'message_sent', {
          phone,
          instance_id: instanceId,
        })
=======

        if (sentMessages.length > 0) {
  // Envia mensagens de forma humanizada (uma por vez)
  const delay = (ms) => new Promise(r => setTimeout(r, ms))

  for (const msg of sentMessages) {
    // simula digitando
    await sock.sendPresenceUpdate('composing', jid)
    await delay(800 + Math.random() * 1200)

    // envia mensagem
    await sock.sendMessage(jid, { text: msg })

    // dispara webhook individual (não agrupado)
    dispatchWebhook(tenantId, 'message_sent', {
      phone,
      message: msg,
      instance_id: instanceId,
    })
  }

  console.log(
    `[${tenantId}/${instanceId}] ${phone}: ${text.substring(0, 50)}...`
  )
}

export async function stopInstance(instanceId) {
  const sock = instances.get(instanceId)
  if (sock) {
    killSocket(sock)
    instances.delete(instanceId)
    updateStatus(instanceId, 'disconnected')
  }
}

export async function startAllInstances() {
  const rows = db.prepare(`
    SELECT wi.id, wi.tenant_id FROM whatsapp_instances wi
    JOIN tenants t ON t.id = wi.tenant_id
    WHERE t.active = 1
  `).all()

  for (const row of rows) {
    if (hasCredentials(row.tenant_id, row.id)) {
      console.log(`🚀 Iniciando instância ${row.id} (tenant: ${row.tenant_id})`)
      await startInstance(row.tenant_id, row.id)
    } else {
      console.log(`⏭️  Instância ${row.id} sem credenciais — aguardando conexão manual`)
      updateStatus(row.id, 'disconnected')
    }
  }
}

function extractText(msg) {
  const m = msg.message
  if (!m) return null
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || null
}

