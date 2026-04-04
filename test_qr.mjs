import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'

fs.mkdirSync('data/auth/test_direct', { recursive: true })
const { state } = await useMultiFileAuthState('data/auth/test_direct')

console.log('Buscando versão mais recente...')
let version
try {
  const result = await fetchLatestBaileysVersion()
  version = result.version
  console.log('Versão obtida:', version)
} catch (e) {
  console.log('Falhou ao buscar versão:', e.message)
  version = [2, 3000, 1025135162] // versão mais recente conhecida
}

const sock = makeWASocket({
  version,
  auth: state,
  logger: pino({ level: 'silent' }),
  printQRInTerminal: false,
})

sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
  if (qr) {
    console.log('✅ QR GERADO! Baileys funcionando corretamente')
    process.exit(0)
  }
  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode
    console.log('❌ Fechou. Código:', code, 'Erro:', lastDisconnect?.error?.message)
    process.exit(1)
  }
})

setTimeout(() => {
  console.log('⏱ Timeout 20s')
  process.exit(2)
}, 20000)
