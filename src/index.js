import 'dotenv/config'
import { startAllInstances } from './services/whatsapp.js'

// Garante que tenant padrão existe
import db from '../db/database.js'
import { createTenant, getTenant } from '../config/settings.js'

function ensureDefaultTenant() {
  if (!getTenant('default')) {
    createTenant('default', 'Tenant Padrão', 'default@whatsappai.com')
    console.log('✅ Tenant "default" criado')
  }
}

async function main() {
  console.log('🚀 WhatsApp AI v2 iniciando...')

  ensureDefaultTenant()

  // Inicia o dashboard em paralelo
  import('./dashboard/server.js').catch(err => {
    console.error('Erro ao iniciar dashboard:', err.message)
  })

  // Inicia todas as instâncias WhatsApp ativas
  await startAllInstances()

  console.log('✅ Sistema pronto!')
}

main().catch(console.error)
