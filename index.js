const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")
const fs = require("fs")
const ffmpeg = require("fluent-ffmpeg")
const ffmpegPath = require("ffmpeg-static")
ffmpeg.setFfmpegPath(ffmpegPath)
const yts = require("yt-search")
const ytdl = require("@distube/ytdl-core")

const app = express()
let latestQR = null
let isConnected = false

app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>✅ Bot Conectado</h1><h2>🐺 Legoshi Bot v2.0</h2><p>#s = sticker | #mp3 = audio | #play = musica | #toimg = sticker a foto</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🐺 Legoshi Bot v2.0</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})

app.listen(process.env.PORT || 7860, () => console.log("Web lista"))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Legoshi v2.0", "Chrome", "1.0"] })
  sock.ev.on("creds.update", saveCreds)
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") { isConnected = true; latestQR = null; console.log("✅ CONECTADO") }
    if (connection === "close") { isConnected = false; if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(start, 3000) }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]; if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
    const lower = text.toLowerCase().trim()

    // === FUNCIONES QUE YA TENIAS (INTACTAS) ===
    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToSave = quoted ? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const sticker = new Sticker(buffer, { pack: "Legoshi Bot v2.0", author: `Creado por ${m.pushName || "Usuario"}`, type: 'full', quality: 100 })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) { await sock.sendMessage(from, { text: "❌ Responde a imagen/video con #s" }, { quoted: m }) }
    }

    if (lower === '#mp3' || lower === '.mp3' || lower === '#a') {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted?.videoMessage) { await sock.sendMessage(from, { text: "❌ Responde a un VIDEO con #mp3" }, { quoted: m }); return }
      try {
        await sock.sendMessage(from, { text: "🎵 Convirtiendo..." }, { quoted: m })
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp.mp4", buffer)
        await new Promise((res, rej) => { ffmpeg("temp.mp4").toFormat("mp3").on("end", res).on("error", rej).save("temp.mp3") })
        await sock.sendMessage(from, { audio: fs.readFileSync("temp.mp3"), mimetype: "audio/mpeg" }, { quoted: m })
        fs.unlinkSync("temp.mp4"); fs.unlinkSync("temp.mp3")
      } catch (e) { await sock.sendMessage(from, { text: "❌ Error convirtiendo" }, { quoted: m }) }
    }

    // === NUEVAS FUNCIONES AGREGADAS ===

    // #toimg - sticker a imagen
    if (lower === '#toimg' || lower === '.toimg') {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted?.stickerMessage) { await sock.sendMessage(from, { text: "❌ Responde a un STICKER con #toimg" }, { quoted: m }); return }
      try {
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp.webp", buffer)
        await new Promise((res, rej) => { ffmpeg("temp.webp").toFormat("png").on("end", res).on("error", rej).save("temp.png") })
        await sock.sendMessage(from, { image: fs.readFileSync("temp.png"), caption: "🐺 Legoshi Bot - Sticker a imagen" }, { quoted: m })
        fs.unlinkSync("temp.webp"); fs.unlinkSync("temp.png")
      } catch (e) { await sock.sendMessage(from, { text: "❌ Error convirtiendo sticker" }, { quoted: m }) }
    }

    // #play nombre - busca y baja audio
    if (lower.startsWith('#play ')) {
      const query = text.slice(6).trim()
      if (!query) { await sock.sendMessage(from, { text: "❌ Uso: #play nombre de cancion" }, { quoted: m }); return }
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) { await sock.sendMessage(from, { text: "❌ No encontré nada" }, { quoted: m }); return }
        
        await sock.sendMessage(from, { text: `🎵 Bajando: ${video.title}\n⏱️ ${video.timestamp}` }, { quoted: m })
        
        const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' })
        const file = fs.createWriteStream("temp_play.mp3")
        stream.pipe(file)
        await new Promise((res, rej) => { file.on('finish', res); file.on('error', rej) })
        
        await sock.sendMessage(from, { audio: fs.readFileSync("temp_play.mp3"), mimetype: "audio/mpeg", fileName: `${video.title}.mp3` }, { quoted: m })
        fs.unlinkSync("temp_play.mp3")
      } catch (e) { console.log(e); await sock.sendMessage(from, { text: "❌ Error bajando audio, intenta con otro nombre" }, { quoted: m }) }
    }

    // #play2 nombre - busca y baja video
    if (lower.startsWith('#play2 ')) {
      const query = text.slice(7).trim()
      if (!query) { await sock.sendMessage(from, { text: "❌ Uso: #play2 nombre de video" }, { quoted: m }); return }
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) { await sock.sendMessage(from, { text: "❌ No encontré nada" }, { quoted: m }); return }

        await sock.sendMessage(from, { text: `🎬 Bajando video: ${video.title}\n⏱️ ${video.timestamp}` }, { quoted: m })

        const stream = ytdl(video.url, { filter: (f) => f.hasVideo && f.hasAudio, quality: 'highest' })
        const file = fs.createWriteStream("temp_play2.mp4")
        stream.pipe(file)
        await new Promise((res, rej) => { file.on('finish', res); file.on('error', rej) })

        await sock.sendMessage(from, { video: fs.readFileSync("temp_play2.mp4"), mimetype: "video/mp4", caption: `🐺 ${video.title}` }, { quoted: m })
        fs.unlinkSync("temp_play2.mp4")
      } catch (e) { console.log(e); await sock.sendMessage(from, { text: "❌ Error bajando video, intenta que sea menos de 5 min" }, { quoted: m }) }
    }

  })
}
start()
