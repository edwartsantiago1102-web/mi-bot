const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")

const app = express()
app.get("/", (req, res) => res.send("Bot ON"))
app.listen(process.env.PORT || 3000)

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true, // ESTO ES LO QUE FALTABA
    browser: ["Bot Sticker", "Chrome", "1.0"]
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) console.log("QR GENERADO, REVISA LOS LOGS")
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
      if (shouldReconnect) start()
    }
    if (connection === "open") console.log("✅ Conectado")
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
          pack: "Stickers",
          author: "Hecho por: TU NOMBRE AQUI",
          type: 'full',
          quality: 100
        })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) { console.log(e.message) }
    }
  })
}
start()
