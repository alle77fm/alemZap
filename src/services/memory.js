import db from '../../db/database.js'

const MAX_HISTORY = 20 // mensagens por conversa

export function getHistory(tenantId, instanceId, phone) {
  return db.prepare(`
    SELECT role, content FROM messages
    WHERE tenant_id = ? AND instance_id = ? AND phone = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(tenantId, instanceId, phone, MAX_HISTORY).reverse()
}

export function saveMessage(tenantId, instanceId, phone, role, content) {
  db.prepare(`
    INSERT INTO messages (tenant_id, instance_id, phone, role, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, instanceId, phone, role, content)
}

export function getConversations(tenantId, instanceId = null) {
  const query = instanceId
    ? `SELECT phone, COUNT(*) as total, MAX(created_at) as last_message
       FROM messages WHERE tenant_id = ? AND instance_id = ?
       GROUP BY phone ORDER BY last_message DESC`
    : `SELECT phone, instance_id, COUNT(*) as total, MAX(created_at) as last_message
       FROM messages WHERE tenant_id = ?
       GROUP BY phone, instance_id ORDER BY last_message DESC`

  return instanceId
    ? db.prepare(query).all(tenantId, instanceId)
    : db.prepare(query).all(tenantId)
}

export function getFullHistory(tenantId, instanceId, phone) {
  return db.prepare(`
    SELECT role, content, created_at FROM messages
    WHERE tenant_id = ? AND instance_id = ? AND phone = ?
    ORDER BY created_at ASC
  `).all(tenantId, instanceId, phone)
}

export function clearHistory(tenantId, phone) {
  db.prepare('DELETE FROM messages WHERE tenant_id = ? AND phone = ?').run(tenantId, phone)
}
