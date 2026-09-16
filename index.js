const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const sharp = require('sharp')
const fs = require('fs')

const app = express()
let qrImage = null

app.get('/', async (req, res) => {
  if (!qrImage) return res.send('<h1>Bot iniciando... recarga en 5s</h1><script>setTimeout(()=>location.reload(),5000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:white">
  <h2>Escanea este QR con WhatsApp</h2>
  <img src="${qrImage}" style="width:350px;height:350px;background:white;padding:15px;border-radius:15px">
  <p>WhatsApp > Dispositivos vinculados > Vincular dispositivo</p>
  </div>`)
})
app.listen(process.env.PORT || 3000)

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false, browser: ["Ubuntu","Chrome","20.0.04"] })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) { qrImage = await QRCode.toDataURL(qr); console.log("QR NUEVO") }
    if (connection === 'open') { console.log("¡CONECTADO!"); qrImage = null }
    if (connection === 'close') start()
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const m = messages[0]
      if (!m.message) return
      const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || ""
      if (!text) return

      if (text.toLowerCase().trim() === '.s' || text.toLowerCase().trim() === '.sticker' || text.toLowerCase().trim() === 'sticker') {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToConvert = quoted? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToConvert, 'buffer', {})
        if (!buffer) { await sock.sendMessage(m.key.remoteJid, { text: "Manda una imagen con.s" }, { quoted: m }); return }
        const webp = await sharp(buffer).resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp().toBuffer()
        await sock.sendMessage(m.key.remoteJid, { sticker: webp }, { quoted: m })
      }
    } catch(e){ console.log("Error sticker", e.message) }
  })
}
start()
