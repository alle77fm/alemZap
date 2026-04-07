import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.resolve('data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// Garantir pasta tmp
const TMP_DIR = path.resolve('data/tmp')
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'db.sqlite'))

db.exec(`
  -- Tenants (clientes do SaaS)
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Configurações por tenant
  CREATE TABLE IF NOT EXISTS tenant_config (
    tenant_id TEXT PRIMARY KEY,
    provider TEXT DEFAULT 'openai',
    openai_key TEXT,
    gemini_key TEXT,
    model TEXT DEFAULT 'gpt-4.1-mini',
    system_prompt TEXT DEFAULT '',
    knowledge_base TEXT DEFAULT '',
    delay_min INTEGER DEFAULT 2000,
    delay_max INTEGER DEFAULT 5000,
    ai_enabled INTEGER DEFAULT 1,
    bot_active INTEGER DEFAULT 1,
    temperature REAL DEFAULT 0.7,
    top_p REAL DEFAULT 1.0,
    response_format TEXT DEFAULT 'text',
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Instâncias WhatsApp por tenant
  CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    label TEXT DEFAULT 'Principal',
    status TEXT DEFAULT 'disconnected',
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Histórico de conversas por tenant + número
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Usuários do dashboard
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Gestão de leads
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    last_message TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Anti-duplicação de webhooks/mensagens do Baileys
  CREATE TABLE IF NOT EXISTS processed_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    created_at TEXT
  );
`)

// Migrations seguras — adiciona colunas novas sem quebrar banco existente
const migrations = [
  `ALTER TABLE tenant_config ADD COLUMN webhook_url TEXT DEFAULT ''`,
  `ALTER TABLE tenant_config ADD COLUMN webhook_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE tenant_config ADD COLUMN api_key TEXT DEFAULT ''`,
  `ALTER TABLE tenant_config ADD COLUMN deepseek_key TEXT DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN reset_token TEXT`,
  `ALTER TABLE users ADD COLUMN reset_token_expires TEXT`,
  `ALTER TABLE users ADD COLUMN name TEXT DEFAULT ''`
]
for (const sql of migrations) {
  try { db.prepare(sql).run() } catch (_) { /* coluna já existe */ }
}

export default db
