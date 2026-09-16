const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')

const app = express()
let qrImage = null
app.get('/', async (req, res) => {
  if (!qrImage) return res.send('<h1>Bot iniciando...</h1><script>setTimeout(()=>location.reload(),5000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:white"><h2>Escanea QR de Legoshi</h2><img src="${qrImage}" style="width:350px;background:white;padding:15px;border-radius:15px"></div>`)
})
app.listen(process.env.PORT || 3000)

const patLegoshi = [
  "ha acariciado a Legoshi con mucho cariño 🥺🐺",
  "le ha dado pat pat a la cabecita de Legoshi 💚",
  "está mimando a Legoshi, se ve feliz",
  "le rascó las orejitas a Legoshi",
  "le dio muchos pats a Legoshi hasta que se durmió 😴",
  "Legoshi mueve la colita porque {user} le dio pat pat",
  "¡{user} consintió a Legoshi! *pat pat*"
]

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false, browser: ["Ubuntu","Chrome","20.0.04"] })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ qr, connection }) => {
    if (qr) qrImage = await QRCode.toDataURL(qr)
    if (connection === 'open') { console.log("CONECTADO"); qrImage = null }
    if (connection === 'close') start()
  })

  // BIENVENIDA DEFINITIVA CON TU TEXTO Y TU FOTO
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update
      if (action!== 'add') return
      for (const user of participants) {
        const caption = `hola que tal!! @${user.split('@')[0]}. Soy Legoshi, el bot personal del grupo *☾ Bot Group ☽*. Diviértete creando stikers: manda la foto de tu stiker recortada a tu gusto y pon *.s*, crearé tu stiker al instante con mucho gusto!!!\n\n` +
`hasta ahora estoy en version de prueba.. Así que si ves alguna anomalía o error en mis respuestas contactate con mi owner *☾ Edlegoshi ☽*!!\n\n` +
`Reglas:\n` +
`- _Evita el uso de lenguaje soez a los integrantes del grupo_\n` +
`- _No crear stikers de carácter sexual/explícito_\n` +
`- _Evitar a toda costa el reporte por spam a este bot_\n` +
`- pronto vendrán más actualizaciones y nuevas funciones, puedes dejar tus sugerencias en el chat privado de ☾ Edlegoshi ☽!!\n\n` +
`Disfruta tu estancia y recuerda que este bot es hecho con amor!!! 𖹭`

        if (fs.existsSync('./legoshi.jpg')) {
          await sock.sendMessage(id, { image: fs.readFileSync('./legoshi.jpg'), caption: caption, mentions: [user] })
        } else {
          await sock.sendMessage(id, { text: caption, mentions: [user] })
        }
      }
    } catch(e){ console.log(e) }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const textRaw = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || ""
    const text = textRaw.trim()
    const lower = text.toLowerCase()
    const senderName = m.pushName || "Alguien"

    // STICKER.s / #s
    if (lower === '#s' || lower.startsWith('#s ') || lower === '.s' || lower.startsWith('.s ') || lower === '#sticker' || lower.startsWith('#sticker ')) {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToConvert = quoted? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToConvert, 'buffer', {})
        if (!buffer) return
        let groupName = "☾ Bot Group ☽"
        try { if (from.endsWith('@g.us')) { const meta = await sock.groupMetadata(from); groupName = meta.subject } } catch(e){}
        const sticker = new Sticker(buffer, { pack: groupName, author: `Hecho por ${senderName}`, type: 'full', quality: 80 })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch(e){ console.log("sticker error", e.message) }
    }

    // PLAY
    if (lower.startsWith('#playaudio') || lower.startsWith('#play ')) {
      const query = text.replace(/#playaudio|#play/i, '').trim()
      if (!query) return
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: *${query}*...` })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) return
        const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' })
        const chunks = []; for await (const chunk of stream) chunks.push(chunk)
        await sock.sendMessage(from, { audio: Buffer.concat(chunks), mimetype: 'audio/mpeg' }, { quoted: m })
      } catch(e){ console.log(e) }
    }

    // PAT ARREGLADO - SIN NUMEROS
    if (lower.startsWith('#pat')) {
      const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
      const targetJid = mentioned[0] || null
      let targetText = text.replace(/#pat/i, '').replace(/@\d+/g,'').trim()

      if (targetJid) {
        const isBotMention = sock.user.id.includes(targetJid.split('@')[0]) || targetText.toLowerCase().includes('legoshi') || mentioned.length===1 && lower.includes('legoshi')
        if (targetText.toLowerCase().includes('legoshi') || isBotMention) {
          const random = patLegoshi[Math.floor(Math.random() * patLegoshi.length)].replace(/{user}/g, senderName)
          await sock.sendMessage(from, { text: `✨ ${senderName} ${random}` })
        } else {
          await sock.sendMessage(from, {
            text: `✨ @${m.key.participant?.split('@')[0] || senderName} le dio pat pat a @${targetJid.split('@')[0]} 🥰`,
            mentions: [m.key.participant || from, targetJid].filter(Boolean)
          })
        }
        return
      }

      if (targetText.toLowerCase().includes('legoshi') || targetText === "") {
        const random = patLegoshi[Math.floor(Math.random() * patLegoshi.length)].replace(/{user}/g, senderName)
        await sock.sendMessage(from, { text: `🐺 *${senderName}* ${random}` })
      } else {
        await sock.sendMessage(from, { text: `✨ *${senderName}* le dio pat pat a *${targetText}* 🥰` })
      }
    }
  })
}
start()
