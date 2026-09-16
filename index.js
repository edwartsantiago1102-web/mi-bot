const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')

const app = express()
let qrImage = null
let lastQrText = ""

app.get('/', async (req, res) => {
  if (!qrImage) return res.send('<h1>Bot iniciando... recarga en 5 segundos</h1><script>setTimeout(()=>location.reload(),5000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
  <h2>Escanea este QR con WhatsApp</h2>
  <img src="${qrImage}" style="width:350px;height:350px;border:20px solid white;box-shadow:0 0 20px #ccc">
  <p>Se actualiza solo. Si no carga, recarga la pagina</p>
  </div>`)
})

app.listen(process.env.PORT || 3000, () => console.log("Web lista"))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false, browser: ["Ubuntu","Chrome","20.0.04"] })
  
  sock.ev.on('creds.update', saveCreds)
  
  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) {
      lastQrText = qr
      qrImage = await QRCode.toDataURL(qr)
      console.log("Nuevo QR generado, abre la pagina web")
    }
    if (connection === 'open') {
      console.log("¡CONECTADO! Ya puedes borrar la pagina web")
      qrImage = null
    }
  })
}
start()
