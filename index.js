const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const P = require('pino')

// !!! PON TU NUMERO AQUI CON CODIGO PAIS, SIN + NI ESPACIOS !!!
// Ejemplo Colombia: 573001234567
const NUMERO = "57XXXXXXXXXX" 

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  })

  if (!sock.authState.creds.registered) {
    console.log("Pidiendo codigo de emparejamiento...")
    await new Promise(r => setTimeout(r, 3000))
    const code = await sock.requestPairingCode(NUMERO)
    console.log(`\n\n=== TU CODIGO ES: ${code} ===\n\n`)
    console.log(`Ve a WhatsApp > Dispositivos vinculados > Vincular con numero de telefono y escribe ese codigo\n\n`)
  }

  sock.ev.on('creds.update', saveCreds)
  
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') console.log("¡CONECTADO!")
  })
}
start()
