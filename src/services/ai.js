import * as openaiProvider from '../providers/openai.js'
import * as deepseekProvider from '../providers/deepseek.js'
import { getConfig } from '../../config/settings.js'
import { getHistory, saveMessage } from './memory.js'

export async function processMessage(tenantId, instanceId, phone, message) {
  const config = getConfig(tenantId)

  if (!config.ai_enabled) return null

  const apiKey = config.provider === 'deepseek'
    ? (config.deepseek_key || process.env.DEEPSEEK_API_KEY)
    : (config.openai_key || process.env.OPENAI_API_KEY)

  if (!apiKey) throw new Error(`API key não configurada para provider: ${config.provider}`)

  const history = getHistory(tenantId, instanceId, phone)

  const ctx = {
    apiKey,
    model: config.model,
    systemPrompt: config.system_prompt,
    knowledgeBase: config.knowledge_base,
    history,
    message,
  }

  const reply = config.provider === 'deepseek'
    ? await deepseekProvider.call(ctx)
    : await openaiProvider.call(ctx)

  // Salva interação
  saveMessage(tenantId, instanceId, phone, 'user', message)
  saveMessage(tenantId, instanceId, phone, 'assistant', reply)

  return reply
}

const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export async function humanizedResponse(replyText, sock, jid) {
  // 1. Delay de "pensamento" (antes de começar a digitar)
  const thinkDelay = random(800, 2500)
  await sleep(thinkDelay)

  // 2. Ativa "digitando..."
  await sock.sendPresenceUpdate('composing', jid)

  // 3. Delay proporcional ao tamanho da resposta
  const charsPerMs = random(40, 80)
  const typingDelay = Math.min(replyText.length * charsPerMs, 8000)
  await sleep(typingDelay)

  // 4. Para o "digitando..." e envia
  await sock.sendPresenceUpdate('paused', jid)
}
