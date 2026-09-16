const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const play = require('play-dl')
const fs = require('fs')

const app = express()
let qrImage = null
app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Bot Legoshi Iniciando...</h1><script>setTimeout(()=>location.reload(),4000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white;font-family:sans-serif"><h2>Escanea QR Legoshi</h2><img src="${qrImage}" style="width:350px;background:white;padding:15px;border-radius:15px"></div>`)
})
app.listen(process.env.PORT || 3000)

const patFrases = [
  "ha acariciado a Legoshi con mucho cariño 🥺🐺",
  "le ha dado pat pat a la cabecita de Legoshi 💚",
  "está mimando a Legoshi, se ve feliz",
  "le rascó las orejitas a Legoshi 🐾",
  "le dio muchos pats a Legoshi hasta que se durmió 😴",
  "Legoshi mueve la colita porque {user} le dio pat pat",
  "¡{user} consintió a Legoshi! *pat pat*",
  "Legoshi se sonrojó por el pat de {user} ///"
]

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({level:'silent'}), printQRInTerminal:false, browser:["Ubuntu","Chrome","20.0.04"] })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({qr,connection})=>{
    if(qr) qrImage = await QRCode.toDataURL(qr)
    if(connection==='open'){ console.log("CONECTADO"); qrImage=null }
    if(connection==='close') start()
  })

  // BIENVENIDA CON IMAGEN - BUSCA CUALQUIER NOMBRE
  sock.ev.on('group-participants.update', async (upd)=>{
    try{
      if(upd.action!=='add') return
      for(const user of upd.participants){
        const caption = `hola que tal!! @${user.split('@')[0]}. Soy Legoshi, el bot personal del grupo *☾ Bot Group ☽*. Diviértete creando stikers: manda la foto de tu stiker recortada a tu gusto y pon *.s*, crearé tu stiker al instante con mucho gusto!!!\n\nhasta ahora estoy en version de prueba.. Así que si ves alguna anomalía o error en mis respuestas contactate con mi owner *☾ Edlegoshi ☽*!!\n\nReglas:\n- _Evita el uso de lenguaje soez a los integrantes del grupo_\n- _No crear stikers de carácter sexual/explícito_\n- _Evitar a toda costa el reporte por spam a este bot_\n- pronto vendrán más actualizaciones y nuevas funciones, puedes dejar tus sugerencias en el chat privado de ☾ Edlegoshi ☽!!\n\nDisfruta tu estancia y recuerda que este bot es hecho con amor!!! 𖹭`
        let img = null
        const all = fs.readdirSync('./')
        const found = all.find(f=> f.toLowerCase().includes('legoshi') && (f.endsWith('.jpg')||f.endsWith('.jpeg')||f.endsWith('.png')||f.endsWith('.webp')))
        if(found) img = './'+found
        if(img) await sock.sendMessage(upd.id, { image: fs.readFileSync(img), caption, mentions:[user] })
        else await sock.sendMessage(upd.id, { text: caption, mentions:[user] })
      }
    }catch(e){console.log(e)}
  })

  sock.ev.on('messages.upsert', async ({messages})=>{
    const m = messages[0]; if(!m.message||m.key.fromMe) return
    const from = m.key.remoteJid
    const textRaw = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || ""
    const lower = textRaw.toLowerCase().trim()
    const sender = m.pushName || "Alguien"

    // #s STICKER
    if(lower==='#s'||lower.startsWith('#s ')||lower==='.s'||lower.startsWith('.s ')){
      try{
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msg = quoted? { message: quoted } : m
        const buf = await downloadMediaMessage(msg,'buffer',{})
        if(!buf) return
        let pack = "☾ Bot Group ☽"
        try{ if(from.endsWith('@g.us')){ pack = (await sock.groupMetadata(from)).subject } }catch{}
        const sticker = new Sticker(buf, { pack, author: `Hecho por ${sender}`, type: 'full', quality: 80 })
        await sock.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: m })
      }catch(e){console.log("sticker:",e.message)}
    }

    // #pat - YA NO SALEN NUMEROS
    if(lower.startsWith('#pat')){
      const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
      const jid = mentioned[0]
      const isLegoshi = textRaw.toLowerCase().includes('legoshi') ||!jid || (jid && sock.user.id.includes(jid.split('@')[0]))
      if(isLegoshi){
        const frase = patFrases[Math.floor(Math.random()*patFrases.length)].replace(/{user}/g, sender)
        await sock.sendMessage(from, { text: `🐺 *${sender}* ${frase}` })
      } else {
        await sock.sendMessage(from, { text: `✨ @${m.key.participant?.split('@')[0]||'Alguien'} le dio pat pat a @${jid.split('@')[0]} 🥰`, mentions:[m.key.participant||from, jid].filter(Boolean) })
      }
    }

    // #play - AUDIO YT PERRON CON 2 MOTORES
    if(lower.startsWith('#play ')){
      const query = textRaw.replace(/#play/i,'').trim()
      if(!query) return sock.sendMessage(from, { text: "Usa: #play death by glamour" }, { quoted: m })
      try{
        await sock.sendMessage(from, { text: `🔎 Buscando: *${query}*` }, { quoted: m })
        const search = await yts(query)
        const video = search.videos[0]
        if(!video) return sock.sendMessage(from, { text: "No encontré nada" })

        await sock.sendMessage(from, {
          image: { url: video.thumbnail },
          caption: `🎵 *${video.title}*\n⏱️ ${video.timestamp} | 👁️ ${video.views.toLocaleString()}\n🔗 ${video.url}\n\n*Enviando audio...*`
        }, { quoted: m })

        // MOTOR 1: play-dl (el que más funciona en Railway)
        try{
          let stream = await play.stream(video.url)
          await sock.sendMessage(from, { audio: stream.stream, mimetype: 'audio/mpeg', fileName: `${video.title}.mp3` }, { quoted: m })
          return
        }catch(e){ console.log("play-dl falló:", e.message) }

        // MOTOR 2: ytdl-core con clientes IOS
        try{
          const ytStream = ytdl(video.url, { filter:'audioonly', quality:'highestaudio', playerClients:["IOS","ANDROID","WEB"] })
          const chunks=[]; for await(const c of ytStream) chunks.push(c)
          const buffer = Buffer.concat(chunks)
          if(buffer.length>1000){
            await sock.sendMessage(from, { audio: buffer, mimetype:'audio/mpeg' }, { quoted: m })
            return
          }
        }catch(e){ console.log("ytdl falló:", e.message) }

        await sock.sendMessage(from, { text: `⚠️ YouTube me bloqueó la descarga directa, pero aquí tienes el link: ${video.url}\n\nSi quieres que nunca falle, luego le metemos API de respaldo.` })

      }catch(e){ console.log(e); sock.sendMessage(from, { text: "Error en #play: "+e.message }) }
    }
  })
}
start()
