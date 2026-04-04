import { downloadMediaMessage } from '@whiskeysockets/baileys'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { getConfig } from '../../config/settings.js'

const TMP_DIR = path.resolve('data/tmp')

/**
 * Transcreve uma mensagem de áudio do WhatsApp usando a API Whisper da OpenAI.
 * Retorna o texto transcrito ou null em caso de falha.
 */
export async function transcribeAudio(sock, msg, tenantId) {
  let tmpPath = null
  try {
    const config = getConfig(tenantId)
    const apiKey = config.openai_key || process.env.OPENAI_API_KEY

    if (!apiKey) {
      console.warn(`[Transcription] Nenhuma OpenAI API key configurada para ${tenantId}`)
      return null
    }

    // Garante que a pasta tmp existe
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

    // Baixa o buffer de áudio do WhatsApp
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: { level: 'silent', info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      reuploadRequest: sock.updateMediaMessage,
    })

    if (!buffer || buffer.length === 0) {
      console.warn(`[Transcription] Buffer de áudio vazio para ${tenantId}`)
      return null
    }

    // Salva temporariamente como .ogg (formato do WhatsApp)
    tmpPath = path.join(TMP_DIR, `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.ogg`)
    fs.writeFileSync(tmpPath, buffer)

    // Envia para o Whisper
    const client = new OpenAI({ apiKey })
    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpPath),
      language: 'pt',
    })

    const text = transcription.text?.trim()
    if (text) {
      console.log(`[Transcription] Áudio transcrito (${tenantId}): "${text.substring(0, 60)}..."`)
    }
    return text || null

  } catch (err) {
    console.error(`[Transcription] Erro ao transcrever áudio:`, err.message)
    return null
  } finally {
    // Remove arquivo temporário sempre, mesmo em caso de erro
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath) } catch (_) {}
    }
  }
}
