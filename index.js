const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")
const fs = require("fs")
const ffmpeg = require("fluent-ffmpeg")
const ffmpegPath = require("ffmpeg-static")
ffmpeg.setFfmpegPath(ffmpegPath)

// ================== CONFIG ==================
// Segundos máximos del sticker de video (recomendado: 10 como máximo)
const DURACION_MAX = Number(process.env.DURACION_MAX) || 10
// Peso máximo aceptable del sticker animado (en bytes)
const PESO_MAX = 900 * 1024

// ================== WEB (QR) ==================
const app = express()
let latestQR = null
let isConnected = false
app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>✅ Bot Conectado</h1><h2>🐺 Joseph Bot v2.5</h2><p>#s = sticker (imagen/video) | #mp3 = audio</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🐺 Joseph Bot v2.5</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh"><h1>Cargando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})
app.listen(process.env.PORT || 10000, () => console.log("Web lista"))

// ================== UTILIDADES ==================
const silentLogger = P({ level: "silent" })

function unwrap(message) {
  if (!message) return message
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  )
}

// Recorta y reduce el video para que el sticker pese poco
function prepararVideo(input, output, fps) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noAudio()
      .duration(DURACION_MAX)
      .outputOptions([
        "-vf", `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "30"
      ])
      .format("mp4")
      .on("end", resolve)
      .on("error", reject)
      .save(output)
  })
}

function limpiar(...files) {
  for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {} }
}

// Crea el sticker de video; si pesa demasiado, reintenta con menos calidad
async function crearStickerVideo(tmpIn, tmpOut, autor) {
  const intentos = [
    { fps: 12, quality: 40 },
    { fps: 10, quality: 25 },
    { fps: 8, quality: 15 }
  ]
  let resultado
  for (const { fps, quality } of intentos) {
    await prepararVideo(tmpIn, tmpOut, fps)
    const sticker = new Sticker(fs.readFileSync(tmpOut), {
      pack: "Joseph Bot v2.5",
      author: autor,
      type: "full",
      quality
    })
    resultado = await sticker.toBuffer()
    if (resultado.length <= PESO_MAX) break
  }
  return resultado
}

// ================== BOT ==================
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({ auth: state, logger: silentLogger, browser: ["Joseph v2.5", "Chrome", "1.0"] })
  sock.ev.on("creds.update", saveCreds)
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") { isConnected = true; latestQR = null; console.log("✅ CONECTADO") }
    if (connection === "close") {
      isConnected = false
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(start, 3000)
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    const m = messages[0]
    if (!m?.message || m.key.fromMe) return
    m.message = unwrap(m.message)
    const from = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
    const lower = text.toLowerCase().trim()
    const quoted = unwrap(m.message.extendedTextMessage?.contextInfo?.quotedMessage)

    // ---------- STICKER (imagen, video o GIF) ----------
    if (lower === "#s" || lower === ".s" || lower.startsWith("#s ") || lower.startsWith(".s ")) {
      const id = Date.now()
      const tmpIn = `tmp_${id}_in.mp4`
      const tmpOut = `tmp_${id}_out.mp4`
      try {
        const target = quoted || m.message
        const esVideo = !!target.videoMessage
        const esImagen = !!(target.imageMessage || target.stickerMessage)
        if (!esVideo && !esImagen) {
          await sock.sendMessage(from, { text: "❌ Responde a una imagen/video/GIF con #s (o envíalo con #s en el texto)" }, { quoted: m })
          return
        }
        const msgToSave = quoted ? { message: quoted } : m
        const buffer = await downloadMediaMessage(msgToSave, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
        const autor = `Creado por ${m.pushName || "Usuario"}`

        let stickerBuffer
        if (esVideo) {
          await sock.sendMessage(from, { text: "🎞️ Creando sticker animado..." }, { quoted: m })
          fs.writeFileSync(tmpIn, buffer)
          stickerBuffer = await crearStickerVideo(tmpIn, tmpOut, autor)
        } else {
          const sticker = new Sticker(buffer, { pack: "Joseph Bot v2.5", author: autor, type: "full", quality: 80 })
          stickerBuffer = await sticker.toBuffer()
        }
        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m })
      } catch (e) {
        console.error("Error sticker:", e)
        await sock.sendMessage(from, { text: "❌ No pude crear el sticker. Prueba con un video más corto o más liviano." }, { quoted: m })
      } finally {
        limpiar(tmpIn, tmpOut)
      }
      return
    }

    // ---------- MP3 ----------
    if (lower === "#mp3" || lower === ".mp3" || lower === "#a") {
      if (!quoted?.videoMessage) { await sock.sendMessage(from, { text: "❌ Responde a un VIDEO con #mp3" }, { quoted: m }); return }
      const id = Date.now()
      const v = `tmp_${id}.mp4`
      const a = `tmp_${id}.mp3`
      try {
        await sock.sendMessage(from, { text: "🎵 Convirtiendo..." }, { quoted: m })
        const buffer = await downloadMediaMessage({ message: quoted }, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
        fs.writeFileSync(v, buffer)
        await new Promise((res, rej) => { ffmpeg(v).toFormat("mp3").on("end", res).on("error", rej).save(a) })
        await sock.sendMessage(from, { audio: fs.readFileSync(a), mimetype: "audio/mpeg" }, { quoted: m })
      } catch (e) {
        console.error("Error mp3:", e)
        await sock.sendMessage(from, { text: "❌ Error convirtiendo" }, { quoted: m })
      } finally {
        limpiar(v, a)
      }
    }
  })
}
start()
