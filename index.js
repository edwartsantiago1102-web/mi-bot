const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")
const fs = require("fs")

const app = express()
let latestQR = null
let isConnected = false

// Página web con QR
app.get("/", async (req, res) => {
  if (isConnected) {
    res.send(`
      <body style="background:#0a0a0a;color:#fff;font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;text-align:center">
        <h1 style="font-size:40px">✅ Bot Conectado</h1>
        <h2>🐺 Legoshi Bot v2.0</h2>
        <p>Creado por <b>Edlegoshi</b></p>
      </body>
    `)
  } else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`
      <body style="background:#0a0a0a;color:#fff;font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column">
        <h1>🐺 Legoshi Bot v2.0</h1>
        <p>Creado por <b>Edlegoshi</b></p>
        <img src="${qrImage}" style="width:320px;border-radius:20px;background:white;padding:12px">
        <p>Escanea en WhatsApp > Dispositivos vinculados</p>
        <script>setTimeout(()=>location.reload(),15000)</script>
      </body>
    `)
  } else {
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
  }
})

app.listen(process.env.PORT || 3000, () => console.log("Web lista"))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ["Legoshi v2.0", "Chrome", "1.0"]
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) latestQR = qr
    if (connection === "open") {
      isConnected = true
      latestQR = null
      console.log("✅ CONECTADO")
    }
    if (connection === "close") {
      isConnected = false
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync("auth", { recursive: true, force: true })
      }
      if (code !== DisconnectReason.loggedOut) setTimeout(start, 3000)
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
    const lower = text.toLowerCase().trim()

    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      const msgToSave = quoted ? { message: quoted } : m

      try {
        const senderName = m.pushName || from.split("@")[0] || "Usuario"
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, {
          logger: P({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage
        })

        const sticker = new Sticker(buffer, {
          pack: "Legoshi Bot v2.0",
          author: `Creado por ${senderName}`,
          type: 'full',
          quality: 100
        })

        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })

      } catch (e) {
        console.log("Error sticker:", e.message)
        await sock.sendMessage(from, { text: "❌ Responde a una imagen/video con #s" }, { quoted: m })
      }
    }
  })
}

start()
