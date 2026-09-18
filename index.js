const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")

const app = express()
let latestQR = null
let isConnected = false

app.get("/", async (req, res) => {
  if (isConnected) {
    res.send(`
      <body style="background:#111;color:#fff;font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column">
        <h1>✅ Bot Conectado</h1>
        <h2>🐺 Legoshi - Creado por Edlegoshi</h2>
        <p>Solo stickers #s</p>
      </body>
    `)
  } else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`
      <body style="background:#111;color:#fff;font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column">
        <h1>🐺 Legoshi Bot</h1>
        <p>Creado por Edlegoshi</p>
        <img src="${qrImage}" style="width:300px;border-radius:20px;background:white;padding:10px">
        <p>Escanea con WhatsApp > Dispositivos vinculados</p>
        <p style="opacity:.5">Se actualiza solo, recarga la página</p>
        <script>setTimeout(()=>location.reload(),15000)</script>
      </body>
    `)
  } else {
    res.send(`<body style="background:#111;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
  }
})

app.listen(process.env.PORT || 3000, () => console.log("Web lista"))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ["Legoshi", "Chrome", "1.0"]
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) latestQR = qr
    if (connection === "open") {
      isConnected = true
      latestQR = null
      console.log("✅ Bot conectado - Creado por Edlegoshi")
    }
    if (connection === "close") {
      isConnected = false
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
      if (shouldReconnect) start()
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""
    const lower = text.toLowerCase().trim()

    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      const msgToSave = quoted? { message: quoted } : m
      try {
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, {
          logger: P({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage
        })
        const sticker = new Sticker(buffer, {
          pack: "Legoshi Bot",
          author: "Creado por Edlegoshi",
          type: 'full',
          quality: 100
        })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) { console.log(e.message) }
    }
  })
}
start()
