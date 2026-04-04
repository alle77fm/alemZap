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
      const code = lastDisconnect?.error?.output?.statusCode
      const reason = lastDisconnect?.error?.message || 'desconhecido'
      console.log(`[${instanceId}] Conexão encerrada. Código: ${code}, Motivo: ${reason}`)

      // ── CÓDIGO 515: Stream Error (reinicialização normal do Baileys) ──────
      // NÃO deletar auth. Apenas reconectar após 3 segundos.
      if (code === 515) {
        console.log(`[${instanceId}] Stream error (515) — reconectando em 3s sem deletar auth...`)
        instances.delete(instanceId)
        updateStatus(instanceId, 'connecting')
        setTimeout(() => startInstance(tenantId, instanceId, onEvent), 3000)
        return
      }

      // ── CÓDIGO 401 REAL: loggedOut (DisconnectReason.loggedOut = 401) ─────
      // Só deleta auth quando for REALMENTE deslogado (ex: sessão revogada no celular).
      if (code === DisconnectReason.loggedOut) {
        console.log(`[${instanceId}] Sessão encerrada pelo WhatsApp (loggedOut 401) — deletando auth...`)
        instances.delete(instanceId)
        updateStatus(instanceId, 'disconnected')
        const dir = getAuthDir(tenantId, instanceId)
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true })
        }
        if (onEvent) onEvent('disconnected')
        return
      }

      // ── CÓDIGO 408: QR refs expirado — gerar novo QR automaticamente ─────
      // Não exige clique em "Conectar" novamente. Reinicia o socket para novo QR.
      if (code === 408) {
        console.log(`[${instanceId}] QR expirado (408) — gerando novo QR automaticamente...`)
        instances.delete(instanceId)
        updateStatus(instanceId, 'qr_pending')
        setTimeout(() => startInstance(tenantId, instanceId, onEvent), 2000)
        return
      }

      // ── Connection Failure genérico (qualquer outro código) ───────────────
      // Reconecta sem deletar credentials. Pode ser problema de rede, VPS, etc.
      instances.delete(instanceId)
      updateStatus(instanceId, 'disconnected')

      const wasLoggedOut = code === DisconnectReason.loggedOut
      const started_by_dashboard = !!onEvent

      if (!wasLoggedOut && !started_by_dashboard && hasCredentials(tenantId, instanceId)) {
        console.log(`🔄 Reconectando instância ${instanceId} em 5s (código ${code})...`)
        setTimeout(() => startInstance(tenantId, instanceId), 5000)
      } else if (!wasLoggedOut && started_by_dashboard && hasCredentials(tenantId, instanceId)) {
        // Iniciada pelo dashboard mas pode reconectar (falha de rede, ex: 503, 500)
        console.log(`🔄 Reconectando instância dashboard ${instanceId} em 5s (código ${code})...`)
        setTimeout(() => startInstance(tenantId, instanceId, onEvent), 5000)
      } else {
        console.log(`[${instanceId}] Sem reconexão automática. Código: ${code}`)
        if (onEvent) onEvent('disconnected')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue
      if (msg.key.remoteJid.endsWith('@g.us')) continue

      const text = extractText(msg)
      if (!text?.trim()) continue

      const jid = msg.key.remoteJid
      const phone = jid.split('@')[0]

      try {
        const config = getConfig(tenantId)
        if (!config.bot_active) return

        const reply = await processMessage(tenantId, instanceId, phone, text)
        if (!reply) continue

        await humanizedResponse(reply, sock, jid)
        await sock.sendMessage(jid, { text: reply })

        console.log(`[${tenantId}/${instanceId}] ${phone}: ${text.substring(0, 50)}...`)
      } catch (err) {
        console.error(`Erro instância ${instanceId}:`, err.message)
        await sock.sendPresenceUpdate('paused', jid)
      }
    }
  })

  return sock
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
