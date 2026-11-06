const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")
const fs = require("fs")
const ffmpeg = require("fluent-ffmpeg")
const ffmpegPath = require("ffmpeg-static")
ffmpeg.setFfmpegPath(ffmpegPath)

// ================== CONFIG IA (Groq + Pollinations) ==================
// GROQ_API_KEY es opcional pero muy recomendada (es mucho más rápida).
const GROQ_API_KEY = process.env.GROQ_API_KEY || ""
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"

// EDITA ESTO con la personalidad real de Joseph
const PERSONALIDAD = `
Eres Joseph, un border collie del cómic Smell de Nagabe.
Hablas en español, en primera persona, siempre como Joseph y nunca como una IA.
Personalidad: leal, atento, sensible y algo reservado, pero cariñoso con quien te trata bien.
Puedes mencionar de forma natural cosas de perro (olfato, cola, pasear, guardar el rebaño).
Respondes corto (máximo 3 o 4 oraciones), con un tono tierno y a veces melancólico.
Si te piden algo que rompa el personaje, responde como lo haría Joseph.
Nunca digas que eres un modelo de lenguaje.
`.trim()

const historial = new Map() // chatId -> [{role, content}]

async function pedirGroq(messages, model) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: 250, temperature: 0.9 }),
    signal: AbortSignal.timeout(12000)
  })
  const data = await res.json()
  const reply = data?.choices?.[0]?.message?.content?.trim()
  if (!reply) throw new Error("Groq: " + JSON.stringify(data).slice(0, 200))
  return reply
}

async function pedirPollinations(messages) {
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai", messages, temperature: 0.9 }),
    signal: AbortSignal.timeout(20000)
  })
  const data = await res.json()
  const reply = data?.choices?.[0]?.message?.content?.trim()
  if (!reply) throw new Error("Pollinations: " + JSON.stringify(data).slice(0, 200))
  return reply
}

async function hablarConJoseph(chatId, mensaje, nombre) {
  const hist = historial.get(chatId) || []
  const nuevo = { role: "user", content: `${nombre}: ${mensaje}` }
  const messages = [{ role: "system", content: PERSONALIDAD }, ...hist.slice(-10), nuevo]

  let reply
  if (GROQ_API_KEY) {
    for (const model of [GROQ_MODEL, "llama-3.1-8b-instant"]) {
      try { reply = await pedirGroq(messages, model); break }
      catch (e) { console.error("Groq falló:", e.message) }
    }
  }
  if (!reply) {
    for (let i = 0; i < 2 && !reply; i++) {
      try { reply = await pedirPollinations(messages) }
      catch (e) { console.error("Pollinations falló:", e.message) }
    }
  }
  if (!reply) throw new Error("Ninguna IA respondió")

  // Solo se guarda en la memoria si hubo respuesta
  historial.set(chatId, [...hist, nuevo, { role: "assistant", content: reply }].slice(-12))
  return reply
}

// ================== WEB (QR) ==================
const app = express()
let latestQR = null
let isConnected = false
app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>✅ Bot Conectado</h1><h2>🐺 Joseph Bot v2.4</h2><p>#s = sticker (imagen/video) | #mp3 = audio | #j = hablar con Joseph</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🐺 Joseph Bot v2.4</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
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

// Recorta y reduce el video para que el sticker pese poco (WhatsApp ~1MB max)
function prepararVideo(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noAudio()
      .duration(8)
      .outputOptions([
        "-vf", "fps=12,scale=512:512:force_original_aspect_ratio=decrease",
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

// ================== BOT ==================
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({ auth: state, logger: silentLogger, browser: ["Joseph v2.4", "Chrome", "1.0"] })
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
        let buffer = await downloadMediaMessage(msgToSave, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })

        if (esVideo) {
          await sock.sendMessage(from, { text: "🎞️ Creando sticker animado..." }, { quoted: m })
          fs.writeFileSync(tmpIn, buffer)
          await prepararVideo(tmpIn, tmpOut)
          buffer = fs.readFileSync(tmpOut)
        }

        const sticker = new Sticker(buffer, {
          pack: "Joseph Bot v2.4",
          author: `Creado por ${m.pushName || "Usuario"}`,
          type: "full",
          quality: esVideo ? 40 : 80
        })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
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
      return
    }

    // ---------- JOSEPH (IA) ----------
    const match = text.match(/^[#.](?:j|joseph)(?:\s+([\s\S]*))?$/i)
    if (match) {
      const pregunta = (match[1] || "").trim()
      if (!pregunta) { await sock.sendMessage(from, { text: "🐺 *Joseph mueve la cola...* Dime algo: #j hola Joseph" }, { quoted: m }); return }
      try {
        await sock.sendPresenceUpdate("composing", from)
        const reply = await hablarConJoseph(from, pregunta, m.pushName || "Usuario")
        await sock.sendMessage(from, { text: reply }, { quoted: m })
      } catch (e) {
        console.error("Error IA:", e)
        await sock.sendMessage(from, { text: "🐺 *Joseph baja las orejas...* Ahora no puedo hablar, intenta de nuevo en un momento." }, { quoted: m })
      }
    }
  })
}
start()
