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

process.on('uncaughtException', (e) => console.log("No fatal:", e.message))
process.on('unhandledRejection', (e) => console.log("No fatal promesa:", e.message))

const app = express()
let latestQR = null
let isConnected = false

app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif"><h1>✅ Bot Conectado</h1><h2>🐺 Legoshi Bot v2.0</h2><p>#s #mp3 #toimg #play</p></body>`)
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
    console.log(`Mensaje: ${text}`)

    // #s
    if (lower === '#s' || lower === '.s' || lower.startsWith('#s ') || lower.startsWith('.s ')) {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msgToSave = quoted? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToSave, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const sticker = new Sticker(buffer, { pack: "Legoshi V2.0", author: m.pushName || "Usuario", type: 'full', quality: 90 })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      } catch (e) { await sock.sendMessage(from, { text: "❌ Responde a imagen/video con #s" }, { quoted: m }) }
    }

    // #mp3
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
      } catch (e) { await sock.sendMessage(from, { text: "❌ Error en #mp3" }, { quoted: m }) }
    }

    // #toimg - ARREGLADO
    if (lower === '#toimg' || lower === '.toimg') {
      try {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        if (!quoted?.stickerMessage) { await sock.sendMessage(from, { text: "❌ Responde a un STICKER con #toimg\nTienes que responder al sticker, no mandar #toimg solo" }, { quoted: m }); return }

        console.log("toimg: descargando sticker...")
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync("temp_sticker.webp", buffer)

        console.log("toimg: convirtiendo a png...")
        await new Promise((res, rej) => {
          ffmpeg("temp_sticker.webp")
           .outputOptions(["-vframes 1", "-f image2"])
           .toFormat("png")
           .on("end", res)
           .on("error", (err) => { console.log("ffmpeg error:", err.message); rej(err) })
           .save("temp_out.png")
        })

        await sock.sendMessage(from, { image: fs.readFileSync("temp_out.png"), caption: "🐺 Sticker -> Imagen" }, { quoted: m })
        if (fs.existsSync("temp_sticker.webp")) fs.unlinkSync("temp_sticker.webp")
        if (fs.existsSync("temp_out.png")) fs.unlinkSync("temp_out.png")

      } catch (e) {
        console.log("Error toimg real:", e)
        await sock.sendMessage(from, { text: `❌ Error en toimg: ${e.message}\nAsegúrate de RESPONDER al sticker con #toimg` }, { quoted: m })
      }
    }

    // #play - ARREGLADO CON API QUE SI MANDA
    if (lower.startsWith('#play ') &&!lower.startsWith('#play2')) {
      const query = text.slice(6).trim()
      if (!query) { await sock.sendMessage(from, { text: "❌ Uso: #play bad bunny diles" }, { quoted: m }); return }
      try {
        await sock.sendMessage(from, { text: `🔎 Buscando: ${query}` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if (!video) throw new Error("no resultados")

        await sock.sendMessage(from, { text: `🎵 Bajando: ${video.title}\n⏱️ ${video.timestamp}` }, { quoted: m })

        // Usamos API externa para saltar bloqueo de Render
        const apiUrl = `https://api.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(video.url)}`
        console.log("Llamando API:", apiUrl)
        const response = await fetch(apiUrl)
        const json = await response.json()
        console.log("API respuesta:", JSON.stringify(json).slice(0,200))

        if (!json.success ||!json.result?.download_url) throw new Error("API sin link")

        const mp3BufferRes = await fetch(json.result.download_url)
        const arrayBuffer = await mp3BufferRes.arrayBuffer()
        fs.writeFileSync("temp_song.mp3", Buffer.from(arrayBuffer))

        await sock.sendMessage(from, {
          audio: fs.readFileSync("temp_song.mp3"),
          mimetype: "audio/mpeg",
          ptt: false
        }, { quoted: m })

        if (fs.existsSync("temp_song.mp3")) fs.unlinkSync("temp_song.mp3")

      } catch (e) {
        console.log("Error #play:", e.message)
        if (fs.existsSync("temp_song.mp3")) try{fs.unlinkSync("temp_song.mp3")}catch{}
        await sock.sendMessage(from, { text: `❌ No se pudo bajar "${query}"\nLa API está saturada, intenta de nuevo en 30s\nTip: prueba #play ${query} lyrics` }, { quoted: m })
      }
    }
  })
}
start()
