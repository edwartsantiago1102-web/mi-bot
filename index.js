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

// Evita que se caiga en Render
process.on('uncaughtException', e => console.log("Error:", e.message))
process.on('unhandledRejection', e => console.log("Error:", e.message))

const app = express()
let latestQR = null
let isConnected = false

app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif"><h1>✅ Bot Conectado</h1><h2>🐺 Legoshi Bot v2.0</h2><p>#s | #mp3 | #toimg | #play</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🐺 Legoshi Bot v2.0</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><p>Escanea el QR</p><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})

app.listen(process.env.PORT || 10000, () => console.log("Web lista"))

// Funcion para bajar mp3 con 3 APIs gratis
async function getMp3Buffer(videoUrl) {
  try {
    console.log("API 1 - Vreden...")
    const r = await fetch(`https://api.vreden.web.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`)
    const j = await r.json()
    const url = j.result?.download?.url || j.result?.url
    if (url) {
      const b = await fetch(url)
      if (b.ok) return Buffer.from(await b.arrayBuffer())
    }
  } catch {}

  try {
    console.log("API 2 - DavidCyril...")
    const r = await fetch(`https://api.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(videoUrl)}`)
    const j = await r.json()
    if (j.result?.download_url) {
      const b = await fetch(j.result.download_url)
      if (b.ok) return Buffer.from(await b.arrayBuffer())
    }
  } catch {}

  try {
    console.log("API 3 - Ryzen...")
    const r = await fetch(`https://api.ryzendesu.vip/api/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`)
    const j = await r.json()
    const url = j.result?.downloadUrl
    if (url) {
      const b = await fetch(url)
      if (b.ok) return Buffer.from(await b.arrayBuffer())
    }
  } catch {}

  throw new Error("APIs saturadas, intenta en 30s")
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Legoshi v2.0", "Chrome", "1.0"] })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") { isConnected = true; latestQR = null; console.log("✅ CONECTADO") }
    if (connection === "close") {
      isConnected = false
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
      if (shouldReconnect) setTimeout(start, 3000)
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
    const lower = text.toLowerCase().trim()

    // #s - STICKER CON NOMBRE ABAJO (TU CODIGO VIRGEN)
    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToSave = quoted? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const sticker = new Sticker(buffer, {
          pack: "Legoshi Bot v2.0",
          author: `Creado por ${m.pushName || "Usuario"}`,
          type: 'full',
          quality: 100
        })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) {
        await sock.sendMessage(from, { text: "❌ Responde a una imagen/video con #s" }, { quoted: m })
      }
    }

    // #mp3 - TU CODIGO VIRGEN
    if (lower === '#mp3' || lower === '.mp3' || lower === '#a') {
      const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted?.videoMessage) {
        await sock.sendMessage(from, { text: "❌ Responde a un VIDEO con #mp3" }, { quoted: m })
        return
      }
      try {
        await sock.sendMessage(from, { text: "🎵 Convirtiendo a audio..." }, { quoted: m })
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp.mp4", buffer)
        await new Promise((res, rej) => {
          ffmpeg("temp.mp4").toFormat("mp3").on("end", res).on("error", rej).save("temp.mp3")
        })
        await sock.sendMessage(from, { audio: fs.readFileSync("temp.mp3"), mimetype: "audio/mpeg" }, { quoted: m })
        if (fs.existsSync("temp.mp4")) fs.unlinkSync("temp.mp4")
        if (fs.existsSync("temp.mp3")) fs.unlinkSync("temp.mp3")
      } catch (e) {
        await sock.sendMessage(from, { text: "❌ Error convirtiendo a mp3" }, { quoted: m })
      }
    }

    // #toimg - NUEVO ARREGLADO
    if (lower === '#toimg' || lower === '.toimg') {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        if (!quoted?.stickerMessage) {
          await sock.sendMessage(from, { text: "❌ Debes RESPONDER a un sticker con #toimg\nMantén presionado el sticker > Responder > escribe #toimg" }, { quoted: m })
          return
        }
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp_in.webp", buffer)
        await new Promise((res, rej) => {
          ffmpeg("temp_in.webp").outputOptions(["-vframes 1"]).toFormat("png").on("end", res).on("error", rej).save("temp_out.png")
        })
        await sock.sendMessage(from, { image: fs.readFileSync("temp_out.png"), caption: "🐺 Sticker a imagen" }, { quoted: m })
        if (fs.existsSync("temp_in.webp")) fs.unlinkSync("temp_in.webp")
        if (fs.existsSync("temp_out.png")) fs.unlinkSync("temp_out.png")
      } catch (e) {
        await sock.sendMessage(from, { text: "❌ Error en #toimg, asegúrate de responder al sticker" }, { quoted: m })
      }
    }

    // #play - NUEVO CON APIS GRATIS
    if (lower.startsWith('#play ')) {
      const query = text.slice(6).trim()
      if (!query) {
        await sock.sendMessage(from, { text: "❌ Uso: #play bad bunny diles" }, { quoted: m })
        return
      }
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) throw new Error("No encontrado")

        await sock.sendMessage(from, { text: `🎵 Bajando: ${video.title}\n⏱️ ${video.timestamp}` }, { quoted: m })

        const audioBuffer = await getMp3Buffer(video.url)
        fs.writeFileSync("temp_play.mp3", audioBuffer)

        await sock.sendMessage(from, {
          audio: fs.readFileSync("temp_play.mp3"),
          mimetype: "audio/mpeg",
          fileName: `${video.title}.mp3`
        }, { quoted: m })

        if (fs.existsSync("temp_play.mp3")) fs.unlinkSync("temp_play.mp3")

      } catch (e) {
        console.log("Error #play:", e.message)
        await sock.sendMessage(from, { text: `❌ No se pudo bajar ahora, intenta de nuevo en 30s` }, { quoted: m })
      }
    }
  })
}

start()
