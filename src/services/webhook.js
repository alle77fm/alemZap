import { getConfig } from '../../config/settings.js'

/**
 * Dispara um webhook para o n8n (ou qualquer URL configurada pelo tenant).
 * Não lança exceção — falhas são logadas silenciosamente.
 *
 * @param {string} tenantId
 * @param {string} event  - 'message_received' | 'message_sent' | 'lead_qualified'
 * @param {object} data   - dados adicionais do evento
 */
export async function dispatchWebhook(tenantId, event, data) {
  const config = getConfig(tenantId)
  if (!config.webhook_enabled || !config.webhook_url) return

  const payload = {
    event,
    tenant_id: tenantId,
    timestamp: new Date().toISOString(),
    ...data,
  }

  try {
    await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error(`[Webhook] Erro ao disparar evento "${event}" para ${tenantId}:`, err.message)
  }
}
