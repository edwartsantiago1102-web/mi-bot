// Silencia el ruido de libsignal en los logs
const _info = console.info
console.info = (...a) => {
  if (typeof a[0] === "string" && /^(Closing|Opening|Removing|Migrating) .*session/i.test(a[0])) return
  _info(...a)
}
const _log = console.log
console.log = (...a) => {
  if (typeof a[0] === "string" && /^(Closing|Opening|Removing|Migrating) .*session/i.test(a[0])) return
  _log(...a)
}

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
const VERSION = "v3.0"
const DURACION_MAX = Number(process.env.DURACION_MAX) || 10 // segundos (máx. recomendado: 10)
const PESO_MAX = 900 * 1024 // peso máximo del sticker animado
const silentLogger = P({ level: "silent" })

// ================== WEB (QR + estado) ==================
const app = express()
let latestQR = null
let isConnected = false
const estilo = "background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif"
app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="${estilo}"><h1>✅ Bot Conectado</h1><h2>🐺 Joseph Bot ${VERSION}</h2><p>#s = sticker (imagen/video) | #mp3 = audio</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="${estilo}"><h1>🐺 Joseph Bot ${VERSION}</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="${estilo}"><h1>Cargando...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})
app.listen(process.env.PORT || 10000, () => console.log("Web lista"))

// Auto-ping para que Render gratis no duerma el servicio
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => { fetch(process.env.RENDER_EXTERNAL_URL).catch(() => {}) }, 10 * 60 * 1000)
}

// ================== UTILIDADES ==================
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

function limpiar(...files) {
  for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {} }
}

// Cola: un trabajo pesado a la vez (cuida la RAM de Render gratis)
let cola = Promise.resolve()
const encolar = (fn) => { cola = cola.then(fn).catch((e) => console.error("Error en cola:", e)) }

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

// Si el sticker pesa demasiado, reintenta con menos calidad
async function crearStickerVideo(tmpIn, tmpOut, autor) {
  const intentos = [
    { fps: 12, quality: 40 },
    { fps: 10, quality: 25 },
    { fps: 8, quality: 15 }
  ]
  let resultado
  for (const { fps, quality } of intentos) {
    await prepararVideo(tmpIn, tmpOut, fps)
    const sticker = new Sticker(fs.readFileSync(tmpOut), { pack: `Joseph Bot ${VERSION}`, author: autor, type: "full", quality })
    resultado = await sticker.toBuffer()
    if (resultado.length <= PESO_MAX) break
  }
  return resultado
}

// ================== BOT ==================
let reconectando = false

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({
    auth: state,
    logger: silentLogger,
    browser: [`Joseph ${VERSION}`, "Chrome", "1.0"],
    markOnlineOnConnect: false, // no interfiere con notificaciones del teléfono ni con Meta IA
    syncFullHistory: false
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") {
      isConnected = true
      latestQR = null
      reconectando = false
      console.log("✅ CONECTADO")
    }
    if (connection === "close") {
      isConnected = false
      if (reconectando) return
      reconectando = true
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log("Sesión cerrada, generando QR nuevo...")
        fs.rmSync("auth", { recursive: true, force: true })
        setTimeout(start, 1000)
      } else {
        setTimeout(start, 3000)
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      try {
        if (!m?.message || m.key.fromMe) continue
        const from = m.key.remoteJid
        if (!from || from === "status@broadcast") continue

        // Ignora mensajes viejos (más de 2 minutos)
        const ts = Number(m.messageTimestamp || 0)
        if (ts && Date.now() / 1000 - ts > 120) continue

        m.message = unwrap(m.message)
        const text =
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          m.message.imageMessage?.caption ||
          m.message.videoMessage?.caption || ""
        const lower = text.toLowerCase().trim()
        const quoted = unwrap(m.message.extendedTextMessage?.contextInfo?.quotedMessage)

        const esSticker = /^[#.]s(\s|$)/.test(lower)
        const esMp3 = /^[#.](mp3|a)(\s|$)/.test(lower)
        if (!esSticker && !esMp3) continue // cualquier otro mensaje se ignora (queda para Meta IA)

        // ---------- STICKER (imagen, video o GIF) ----------
        if (esSticker) {
          encolar(async () => {
            const id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
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
                const sticker = new Sticker(buffer, { pack: `Joseph Bot ${VERSION}`, author: autor, type: "full", quality: 80 })
                stickerBuffer = await sticker.toBuffer()
              }
              await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m })
            } catch (e) {
              console.error("Error sticker:", e)
              await sock.sendMessage(from, { text: "❌ No pude crear el sticker. Prueba con un video más corto o más liviano." }, { quoted: m }).catch(() => {})
            } finally {
              limpiar(tmpIn, tmpOut)
            }
          })
          continue
        }

        // ---------- MP3 ----------
        if (esMp3) {
          if (!quoted?.videoMessage) {
            await sock.sendMessage(from, { text: "❌ Responde a un VIDEO con #mp3" }, { quoted: m })
            continue
          }
          encolar(async () => {
            const id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
            const v = `tmp_${id}.mp4`
            const a = `tmp_${id}.mp3`
            try {
              await sock.sendMessage(from, { text: "🎵 Convirtiendo..." }, { quoted: m })
              const buffer = await downloadMediaMessage({ message: quoted }, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
              fs.writeFileSync(v, buffer)
              await new Promise((res, rej) => { ffmpeg(v).noVideo().toFormat("mp3").on("end", res).on("error", rej).save(a) })
              await sock.sendMessage(from, { audio: fs.readFileSync(a), mimetype: "audio/mpeg" }, { quoted: m })
            } catch (e) {
              console.error("Error mp3:", e)
              await sock.sendMessage(from, { text: "❌ Error convirtiendo" }, { quoted: m }).catch(() => {})
            } finally {
              limpiar(v, a)
            }
          })
        }
      } catch (e) {
        console.error("Error handler:", e)
      }
    }
  })
}
start()
