const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require("@whiskeysockets/baileys")
const { Sticker } = require("wa-sticker-formatter")
const P = require("pino")
const express = require("express")
const QRCode = require("qrcode")
const crypto = require("crypto")
const fs = require("fs")
const ffmpeg = require("fluent-ffmpeg")
const ffmpegPath = require("ffmpeg-static")
ffmpeg.setFfmpegPath(ffmpegPath)

// ================== CONFIG ==================
const VERSION = "v3.2"
const DURACION_MAX = Number(process.env.DURACION_MAX) || 8        // segundos del sticker de video
const PESO_MAX = 900 * 1024                                        // peso máximo del sticker animado
const SOLO_GRUPOS = process.env.SOLO_GRUPOS === "1"                // 1 = solo responde en grupos
const DEBUG = process.env.DEBUG === "1"                            // 1 = muestra mensajes recibidos en logs
const COINS_INICIALES = Number(process.env.COINS_INICIALES) || 1000
const DAILY_COINS = Number(process.env.DAILY_COINS) || 500
const DATA_DIR = process.env.DATA_DIR || "data"
const DB_FILE = `${DATA_DIR}/banco.json`

// ================== WEB (QR) ==================
const app = express()
let latestQR = null
let isConnected = false
const estilo = "background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif"
app.get("/", async (req, res) => {
  if (isConnected) res.send(`<body style="${estilo}"><h1>✅ Bot Conectado</h1><h2>🐺 Joseph Bot ${VERSION}</h2><p>#menu para ver los comandos</p></body>`)
  else if (latestQR) {
    const qrImage = await QRCode.toDataURL(latestQR)
    res.send(`<body style="${estilo}"><h1>🐺 Joseph Bot ${VERSION}</h1><img src="${qrImage}" style="width:300px;background:white;padding:12px;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
  } else res.send(`<body style="${estilo}"><h1>Cargando...</h1><script>setTimeout(()=>location.reload(),3000)</script></body>`)
})
app.listen(process.env.PORT || 10000, () => console.log("Web lista"))

// ================== BANCO (guardado en archivo JSON) ==================
// OJO: en Render gratis el disco se borra en cada deploy/reinicio, y con él las cuentas.
let db = {}
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) } catch {}
let timerGuardar = null
function guardar() {
  clearTimeout(timerGuardar)
  timerGuardar = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db))
      fs.renameSync(DB_FILE + ".tmp", DB_FILE)
    } catch (e) { console.error("Error guardando banco:", e.message) }
  }, 500)
}
function cuenta(id, nombre) {
  if (!db[id]) db[id] = { nombre: nombre || "", cartera: COINS_INICIALES, banco: 0, ultimoDaily: 0 }
  if (nombre) db[id].nombre = nombre
  return db[id]
}
const fmt = (n) => Number(n).toLocaleString("es-CO")

// ================== RULETA ==================
const ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const EMOJI = { rojo: "🔴", negro: "⚫", verde: "🟢" }
const PAGO = { rojo: 2, negro: 2, verde: 14 } // multiplicador sobre lo apostado
function girar() {
  const n = crypto.randomInt(37) // 0 a 36
  const color = n === 0 ? "verde" : ROJOS.has(n) ? "rojo" : "negro"
  return { n, color }
}
function parseColor(t = "") {
  t = t.toLowerCase()
  if (["red", "rojo", "r"].includes(t)) return "rojo"
  if (["black", "negro", "b", "n"].includes(t)) return "negro"
  if (["green", "verde", "g", "v"].includes(t)) return "verde"
  return null
}
function parseMonto(t = "", disponible) {
  t = t.toLowerCase()
  if (["all", "todo", "todas"].includes(t)) return disponible
  const n = Math.floor(Number(t.replace(/[.,]/g, "")))
  return Number.isFinite(n) ? n : NaN
}
const ultimoRt = new Map() // anti-spam: 3 s entre apuestas por usuario

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

function limpiar(...files) {
  for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {} }
}

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

const MENU = `🐺 *Joseph Bot ${VERSION}*

🎞️ *Stickers y multimedia*
• #s → sticker (imagen, video o GIF)
• #mp3 → video a audio
• #toimage → sticker a imagen

🎰 *Casino*
• #rt 200 black → apuesta (red/black/green, o "all")
• #d 300 / #d all → depositar en el banco
• #retirar 300 → sacar del banco
• #bal → ver tu cartera y tu banco
• #baltop → ranking de usuarios con más furrycoins
• #daily → furrycoins diarios gratis

Rojo/negro paga x2, verde (0) paga x14.
Solo se apuesta con la cartera; el banco está a salvo.
La moneda del bot son los *furrycoins* 🐾`

// ================== BOT ==================
let sockActual = null

async function start() {
  if (sockActual) {
    try { sockActual.ev.removeAllListeners(); sockActual.end(undefined) } catch {}
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const sock = makeWASocket({
    auth: state,
    logger: silentLogger,
    browser: [`Joseph ${VERSION}`, "Chrome", "1.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false
  })
  sockActual = sock

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) latestQR = qr
    if (connection === "open") { isConnected = true; latestQR = null; console.log("✅ CONECTADO") }
    if (connection === "close") {
      if (sock !== sockActual) return
      isConnected = false
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync("auth", { recursive: true, force: true })
        setTimeout(start, 1000)
      } else {
        setTimeout(start, 3000)
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (DEBUG) for (const x of messages) console.log("DIAG llego:", type, x.key?.remoteJid, "fromMe=" + x.key?.fromMe, Object.keys(x.message || {}))
    if (type !== "notify") return

    for (const m of messages) {
      try {
        if (!m?.message || m.key.fromMe) continue
        m.message = unwrap(m.message)
        const from = m.key.remoteJid
        if (!from || from === "status@broadcast") continue
        const esGrupo = from.endsWith("@g.us")
        if (SOLO_GRUPOS && !esGrupo) continue

        const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
        const lower = text.toLowerCase().trim()
        const quoted = unwrap(m.message.extendedTextMessage?.contextInfo?.quotedMessage)

        const mc = lower.match(/^[#.]([a-z0-9]+)(?:\s+([\s\S]*))?$/)
        if (!mc) continue
        const cmd = mc[1]
        const args = (mc[2] || "").trim()

        const responder = (t) => sock.sendMessage(from, { text: t }, { quoted: m })
        const userId = m.key.participant || from
        const nombre = m.pushName || "Usuario"

        // ---------- MENÚ ----------
        if (cmd === "menu" || cmd === "ayuda") { await responder(MENU); continue }

        // ---------- STICKER ----------
        if (cmd === "s") {
          const id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
          const tmpIn = `tmp_${id}_in.mp4`
          const tmpOut = `tmp_${id}_out.mp4`
          try {
            const target = quoted || m.message
            const esVideo = !!target.videoMessage
            const esImagen = !!(target.imageMessage || target.stickerMessage)
            if (!esVideo && !esImagen) { await responder("❌ Responde a una imagen/video/GIF con #s (o envíalo con #s en el texto)"); continue }
            const msgToSave = quoted ? { message: quoted } : m
            const buffer = await downloadMediaMessage(msgToSave, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
            const autor = `Creado por ${nombre}`
            let stickerBuffer
            if (esVideo) {
              if (esGrupo) await responder("🎞️ Creando sticker animado...")
              fs.writeFileSync(tmpIn, buffer)
              stickerBuffer = await crearStickerVideo(tmpIn, tmpOut, autor)
            } else {
              const sticker = new Sticker(buffer, { pack: `Joseph Bot ${VERSION}`, author: autor, type: "full", quality: 80 })
              stickerBuffer = await sticker.toBuffer()
            }
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m })
          } catch (e) {
            console.error("Error sticker:", e)
            await responder("❌ No pude crear el sticker. Prueba con un video más corto o más liviano.").catch(() => {})
          } finally { limpiar(tmpIn, tmpOut) }
          continue
        }

        // ---------- MP3 ----------
        if (cmd === "mp3" || cmd === "a") {
          if (!quoted?.videoMessage) { await responder("❌ Responde a un VIDEO con #mp3"); continue }
          const id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
          const v = `tmp_${id}.mp4`
          const a = `tmp_${id}.mp3`
          try {
            if (esGrupo) await responder("🎵 Convirtiendo...")
            const buffer = await downloadMediaMessage({ message: quoted }, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
            fs.writeFileSync(v, buffer)
            await new Promise((res, rej) => { ffmpeg(v).noVideo().toFormat("mp3").on("end", res).on("error", rej).save(a) })
            const audioBuffer = fs.readFileSync(a)
            await sock.sendMessage(from, { audio: audioBuffer, mimetype: "audio/mpeg" }, { quoted: m })
          } catch (e) {
            console.error("Error mp3:", e)
            await responder("❌ Error convirtiendo").catch(() => {})
          } finally { limpiar(v, a) }
          continue
        }

        // ---------- TOIMAGE (sticker a imagen) ----------
        if (cmd === "toimage" || cmd === "toimg") {
          if (!quoted?.stickerMessage) { await responder("❌ Responde a un STICKER con #toimage"); continue }
          if (quoted.stickerMessage.isAnimated) { await responder("❌ Por ahora solo convierto stickers normales, no animados."); continue }
          const id = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
          const w = `tmp_${id}.webp`
          const p = `tmp_${id}.png`
          try {
            const buffer = await downloadMediaMessage({ message: quoted }, "buffer", {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage })
            fs.writeFileSync(w, buffer)
            await new Promise((res, rej) => { ffmpeg(w).outputOptions(["-vframes", "1"]).on("end", res).on("error", rej).save(p) })
            await sock.sendMessage(from, { image: fs.readFileSync(p) }, { quoted: m })
          } catch (e) {
            console.error("Error toimage:", e)
            await responder("❌ No pude convertir el sticker").catch(() => {})
          } finally { limpiar(w, p) }
          continue
        }

        // ---------- CASINO ----------
        if (cmd === "bal" || cmd === "banco" || cmd === "saldo" || cmd === "cartera") {
          const c = cuenta(userId, nombre); guardar()
          await responder(`💰 *Cuenta de ${nombre}*\n👛 Cartera: ${fmt(c.cartera)} furrycoins\n🏦 Banco: ${fmt(c.banco)} furrycoins\n📊 Total: ${fmt(c.cartera + c.banco)} furrycoins`)
          continue
        }

        if (cmd === "baltop" || cmd === "top") {
          cuenta(userId, nombre); guardar()
          const ranking = Object.values(db)
            .map((u) => ({ nombre: u.nombre || "Usuario", total: u.cartera + u.banco }))
            .sort((x, y) => y.total - x.total)
            .slice(0, 10)
          const medallas = ["🥇", "🥈", "🥉"]
          const lineas = ranking.map((u, i) => `${medallas[i] || `${i + 1}.`} ${u.nombre} — ${fmt(u.total)} furrycoins`)
          await responder(`🏆 *Estos son los usuarios con más furrycoins:*\n\n${lineas.join("\n")}`)
          continue
        }

        if (cmd === "daily" || cmd === "diario") {
          const c = cuenta(userId, nombre)
          const resta = 24 * 3600 * 1000 - (Date.now() - c.ultimoDaily)
          if (resta > 0) {
            const h = Math.floor(resta / 3600000), min = Math.ceil((resta % 3600000) / 60000)
            await responder(`⏳ Ya reclamaste hoy. Vuelve en ${h}h ${min}min.`)
          } else {
            c.cartera += DAILY_COINS; c.ultimoDaily = Date.now(); guardar()
            await responder(`🎁 ¡Has recibido ${fmt(DAILY_COINS)} furrycoins!\n👛 Cartera: ${fmt(c.cartera)} furrycoins`)
          }
          continue
        }

        if (cmd === "d" || cmd === "depositar") {
          const c = cuenta(userId, nombre)
          const monto = parseMonto(args || "all", c.cartera)
          if (!Number.isFinite(monto) || monto <= 0) { await responder("❌ Uso: #d 300 o #d all"); continue }
          if (monto > c.cartera) { await responder(`❌ Solo tienes ${fmt(c.cartera)} furrycoins en la cartera.`); continue }
          c.cartera -= monto; c.banco += monto; guardar()
          await responder(`🏦 ¡Has depositado ${fmt(monto)} furrycoins!\n👛 Cartera: ${fmt(c.cartera)} furrycoins\n🏦 Banco: ${fmt(c.banco)} furrycoins`)
          continue
        }

        if (cmd === "retirar" || cmd === "w") {
          const c = cuenta(userId, nombre)
          const monto = parseMonto(args || "all", c.banco)
          if (!Number.isFinite(monto) || monto <= 0) { await responder("❌ Uso: #retirar 300 o #retirar all"); continue }
          if (monto > c.banco) { await responder(`❌ Solo tienes ${fmt(c.banco)} furrycoins en el banco.`); continue }
          c.banco -= monto; c.cartera += monto; guardar()
          await responder(`👛 ¡Has retirado ${fmt(monto)} furrycoins!\n👛 Cartera: ${fmt(c.cartera)} furrycoins\n🏦 Banco: ${fmt(c.banco)} furrycoins`)
          continue
        }

        if (cmd === "rt" || cmd === "ruleta") {
          const c = cuenta(userId, nombre)
          const [a1, a2] = args.split(/\s+/)
          const color = parseColor(a2)
          const monto = parseMonto(a1, c.cartera)
          if (!a1 || !color || !Number.isFinite(monto) || monto <= 0) {
            await responder("🎰 Uso: #rt 200 black\nColores: red, black, green (o \"all\" para apostar todo)")
            continue
          }
          if (monto > c.cartera) {
            await responder(`❌ Solo tienes ${fmt(c.cartera)} furrycoins en la cartera.${c.banco > 0 ? " Usa #retirar para sacar del banco." : ""}`)
            continue
          }
          const espera = 3000 - (Date.now() - (ultimoRt.get(userId) || 0))
          if (espera > 0) { await responder("⏳ Espera unos segundos entre apuestas."); continue }
          ultimoRt.set(userId, Date.now())

          const { n, color: salio } = girar()
          c.cartera -= monto
          let msg = `🎰 Salió el *${n}* ${EMOJI[salio]} (${salio})\n`
          if (salio === color) {
            const premio = monto * PAGO[color]
            c.cartera += premio
            msg += `🎉 ¡Felicidades, has ganado ${fmt(premio)} furrycoins!`
          } else {
            msg += `💀 Perdiste ${fmt(monto)} furrycoins. ¡Suerte la próxima!`
          }
          msg += `\n👛 Cartera: ${fmt(c.cartera)} furrycoins`
          if (c.cartera > 0 && salio === color) msg += `\nUsa #d all para guardarlo en el banco 🏦`
          if (c.cartera === 0) msg += `\nTe quedaste sin furrycoins. Usa #retirar o #daily.`
          guardar()
          await responder(msg)
          continue
        }
      } catch (e) {
        console.error("Error handler:", e)
      }
    }
  })
}
start()
