import db from '../db/database.js'

const DEFAULTS = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  system_prompt: 'Você é um atendente comercial simpático e objetivo.',
  knowledge_base: '',
  delay_min: 2000,
  delay_max: 5000,
  ai_enabled: 1,
  bot_active: 1,
  temperature: 0.7,
  top_p: 1.0,
  response_format: 'text',
}

export function getConfig(tenantId) {
  const row = db.prepare('SELECT * FROM tenant_config WHERE tenant_id = ?').get(tenantId)
  return { ...DEFAULTS, ...row }
}

export function saveConfig(tenantId, updates) {
  const current = getConfig(tenantId)
  const merged = { ...current, ...updates, tenant_id: tenantId }

  db.prepare(`
    INSERT INTO tenant_config (tenant_id, provider, openai_key, gemini_key, model,
      system_prompt, knowledge_base, delay_min, delay_max, ai_enabled, bot_active, temperature, top_p, response_format)
    VALUES (@tenant_id, @provider, @openai_key, @gemini_key, @model,
      @system_prompt, @knowledge_base, @delay_min, @delay_max, @ai_enabled, @bot_active, @temperature, @top_p, @response_format)
    ON CONFLICT(tenant_id) DO UPDATE SET
      provider=excluded.provider, openai_key=excluded.openai_key,
      gemini_key=excluded.gemini_key, model=excluded.model,
      system_prompt=excluded.system_prompt, knowledge_base=excluded.knowledge_base,
      delay_min=excluded.delay_min, delay_max=excluded.delay_max,
      ai_enabled=excluded.ai_enabled, bot_active=excluded.bot_active, temperature=excluded.temperature,
      top_p=excluded.top_p, response_format=excluded.response_format
  `).run(merged)
}

export function getTenant(tenantId) {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
}

export function listTenants() {
  return db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()
}

export function createTenant(id, name, email) {
  db.prepare('INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)').run(id, name, email)
  db.prepare('INSERT INTO tenant_config (tenant_id) VALUES (?)').run(id)
  return getTenant(id)
}
