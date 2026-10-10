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

// Evita que el bot se caiga por completo si falla un comando
process.on('uncaughtException', (e) => console.log("Error no fatal:", e.message))
process.on('unhandledRejection', (e) => console.log("Promesa no fatal:", e.message))

const app = express()
let latestQR = null
let isConnected = false

app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif"><h1>✅ Bot Conectado</h1><h2>🐺 Legoshi Bot v2.0</h2><p>#s #mp3 #toimg #play #play2</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🐺 Legoshi Bot v2.0</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><p>Escanea - se actualiza cada 15s</p><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})

app.listen(process.env.PORT || 10000, () => console.log("Web lista"))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Legoshi v2.0", "Chrome", "1.0"] })
  sock.ev.on("creds.update", saveCreds)
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") { isConnected = true; latestQR = null; console.log("✅ CONECTADO") }
    if (connection === "close") { isConnected = false; const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut; if (shouldReconnect) setTimeout(start, 3000) }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]; if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
    const lower = text.toLowerCase().trim()
    console.log(`Mensaje: ${text} de ${from}`)

    // #s - sticker (tu codigo original intacto)
    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToSave = quoted? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const sticker = new Sticker(buffer, { pack: "Legoshi Bot v2.0", author: `Creado por ${m.pushName || "Usuario"}`, type: 'full', quality: 100 })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) { await sock.sendMessage(from, { text: "❌ Responde a imagen/video con #s" }, { quoted: m }) }
    }

    // #mp3 - tu codigo original intacto
    if (lower === '#mp3' || lower === '.mp3' || lower === '#a') {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted?.videoMessage) { await sock.sendMessage(from, { text: "❌ Responde a un VIDEO con #mp3" }, { quoted: m }); return }
      try {
        await sock.sendMessage(from, { text: "🎵 Convirtiendo..." }, { quoted: m })
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp.mp4", buffer)
        await new Promise((res, rej) => { ffmpeg("temp.mp4").toFormat("mp3").on("end", res).on("error", rej).save("temp.mp3") })
        await sock.sendMessage(from, { audio: fs.readFileSync("temp.mp3"), mimetype: "audio/mpeg" }, { quoted: m })
        if (fs.existsSync("temp.mp4")) fs.unlinkSync("temp.mp4"); if (fs.existsSync("temp.mp3")) fs.unlinkSync("temp.mp3")
      } catch (e) { await sock.sendMessage(from, { text: "❌ Error convirtiendo" }, { quoted: m }) }
    }

    // #toimg - NUEVO
    if (lower === '#toimg' || lower === '.toimg') {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted?.stickerMessage) { await sock.sendMessage(from, { text: "❌ Responde a un STICKER con #toimg" }, { quoted: m }); return }
      try {
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp.webp", buffer)
        await new Promise((res, rej) => { ffmpeg("temp.webp").toFormat("png").on("end", res).on("error", rej).save("temp.png") })
        await sock.sendMessage(from, { image: fs.readFileSync("temp.png"), caption: "🐺 Sticker a imagen" }, { quoted: m })
        if (fs.existsSync("temp.webp")) fs.unlinkSync("temp.webp"); if (fs.existsSync("temp.png")) fs.unlinkSync("temp.png")
      } catch (e) { await sock.sendMessage(from, { text: "❌ Error en #toimg" }, { quoted: m }) }
    }

    // #play - NUEVO CON ANTI-CRASH
    if (lower.startsWith('#play ') &&!lower.startsWith('#play2')) {
      const query = text.slice(6).trim()
      if (!query) return
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) throw new Error("no video")
        if (video.seconds > 600) { await sock.sendMessage(from, { text: "❌ Muy largo (max 10 min): " + video.timestamp }, { quoted: m }); return }

        await sock.sendMessage(from, { text: `🎵 Bajando: ${video.title}\n⏱️ ${video.timestamp}` }, { quoted: m })

        const filePath = "temp_play.mp3"
        const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 })

        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filePath)
          stream.pipe(file)
          file.on('finish', resolve)
          file.on('error', reject)
          stream.on('error', reject)
          setTimeout(() => reject(new Error("Timeout Render")), 40000)
        })

        await sock.sendMessage(from, { audio: fs.readFileSync(filePath), mimetype: "audio/mpeg", fileName: `${video.title}.mp3` }, { quoted: m })
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

      } catch (e) {
        console.log("Error #play:", e.message)
        if (fs.existsSync("temp_play.mp3")) try { fs.unlinkSync("temp_play.mp3") } catch {}
        await sock.sendMessage(from, { text: `❌ No se pudo bajar "${query}"\nYouTube bloquea a Render a veces.\nIntenta con otro nombre o más corto.\n\n#s #toimg #mp3 si funcionan.` }, { quoted: m })
      }
    }

    // #play2 - NUEVO CON ANTI-CRASH
    if (lower.startsWith('#play2 ')) {
      const query = text.slice(7).trim()
      if (!query) return
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando video: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) throw new Error("no video")
        if (video.seconds > 300) { await sock.sendMessage(from, { text: "❌ Video muy largo para #play2 (max 5 min)" }, { quoted: m }); return }

        await sock.sendMessage(from, { text: `🎬 Bajando video: ${video.title}` }, { quoted: m })
        const filePath = "temp_play2.mp4"
        const stream = ytdl(video.url, { quality: 'lowest', filter: f => f.hasVideo && f.hasAudio })

        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filePath)
          stream.pipe(file)
          file.on('finish', resolve)
          file.on('error', reject)
          stream.on('error', reject)
          setTimeout(() => reject(new Error("Timeout")), 50000)
        })

        await sock.sendMessage(from, { video: fs.readFileSync(filePath), mimetype: "video/mp4", caption: `🐺 ${video.title}` }, { quoted: m })
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

      } catch (e) {
        console.log("Error #play2:", e.message)
        if (fs.existsSync("temp_play2.mp4")) try { fs.unlinkSync("temp_play2.mp4") } catch {}
        await sock.sendMessage(from, { text: `❌ No se pudo bajar video\nIntenta uno más corto.` }, { quoted: m })
      }
    }
  })
}
start()
