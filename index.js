const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')

// AQUI CAMBIAS EL NOMBRE Y TODO CAMBIA SOLO
const BOT_NAME = "Legoshi"

const app = express()
let qrImage = null
app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Bot iniciando...</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white;font-family:sans-serif"><h2>QR ${BOT_NAME}</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000)

// PATS PARA EL BOT (RANDOM)
const patBot = [
  `ha acariciado a ${BOT_NAME} con mucho cariño 🥺🐺`,
  `le ha dado pat pat a la cabecita de ${BOT_NAME} 💚`,
  `está mimando a ${BOT_NAME}, se ve feliz`,
  `le rascó las orejitas a ${BOT_NAME} 🐾`,
  `le dio muchos pats a ${BOT_NAME} hasta que se durmió 😴`,
  `${BOT_NAME} mueve la colita porque {user} le dio pat pat`,
  `¡{user} consintió a ${BOT_NAME}! *pat pat*`
]

// PATS PARA OTRAS PERSONAS (RANDOM Y CON NOMBRE)
const patOtros = [
  "le dio pat pat a {target} 🥰",
  "acarició a {target} con mucho cariño 💚",
  "está mimando a {target}, que tierno",
  "le rascó las orejitas a {target} 🐾",
  "le dio muchos pats a {target} hasta dormirlo 😴",
  "consintió a {target} con pat pat"
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

  // BIENVENIDA CON IMAGEN
  sock.ev.on('group-participants.update', async (upd)=>{
    try{
      if(upd.action!=='add') return
      for(const user of upd.participants){
        const caption = `hola que tal!! @${user.split('@')[0]}. Soy ${BOT_NAME}, el bot personal del grupo *☾ Bot Group ☽*. Diviértete creando stikers: manda la foto de tu stiker recortada a tu gusto y pon *.s*, crearé tu stiker al instante con mucho gusto!!!\n\nhasta ahora estoy en version de prueba.. Así que si ves alguna anomalía o error en mis respuestas contactate con mi owner *☾ Edlegoshi ☽*!!\n\nReglas:\n- _Evita el uso de lenguaje soez_\n- _No crear stikers sexual/explícito_\n- _Evitar reporte por spam_\n\nDisfruta tu estancia y recuerda que este bot es hecho con amor!!! 𖹭`
        const files = fs.readdirSync('./')
        const found = files.find(f=> f.toLowerCase().includes('legoshi') && f.match(/\.(jpg|jpeg|png|webp)$/))
        if(found) await sock.sendMessage(upd.id, { image: fs.readFileSync('./'+found), caption, mentions:[user] })
        else await sock.sendMessage(upd.id, { text: caption, mentions:[user] })
      }
    }catch(e){console.log(e)}
  })

  sock.ev.on('messages.upsert', async ({messages})=>{
    const m=messages[0]; if(!m.message||m.key.fromMe) return
    const from=m.key.remoteJid
    const textRaw=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||""
    const lower=textRaw.toLowerCase().trim()
    const sender=m.pushName||"Alguien"

    if(lower==='#s'||lower.startsWith('#s ')||lower==='.s'||lower.startsWith('.s ')){
      try{
        const quoted=m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msg=quoted?{message:quoted}:m
        const buf=await downloadMediaMessage(msg,'buffer',{})
        if(!buf) return
        let pack="☾ Bot Group ☽"
        try{ if(from.endsWith('@g.us')) pack=(await sock.groupMetadata(from)).subject }catch{}
        const sticker=new Sticker(buf,{pack, author:`Hecho por ${sender}`, type:'full', quality:80})
        await sock.sendMessage(from,{sticker:await sticker.toBuffer()},{quoted:m})
      }catch(e){console.log(e.message)}
    }

    // PAT DEFINITIVO
    if(lower.startsWith('#pat')){
      const mentioned=m.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
      const jid=mentioned[0]
      const isBot =!jid || textRaw.toLowerCase().includes(BOT_NAME.toLowerCase()) || (jid && sock.user.id.includes(jid.split('@')[0]))

      if(isBot){
        const frase = patBot[Math.floor(Math.random()*patBot.length)].replace(/{user}/g, sender)
        await sock.sendMessage(from,{text:`*${BOT_NAME} v2.0 in operation!*\n🐺 *${sender}* ${frase}`})
      } else {
        const targetName = `@${jid.split('@')[0]}`
        const frase = patOtros[Math.floor(Math.random()*patOtros.length)].replace(/{target}/g, targetName)
        await sock.sendMessage(from,{text:`✨ *${sender}* ${frase}`, mentions:[m.key.participant||from, jid].filter(Boolean)})
      }
    }

    // PLAY
    if(lower.startsWith('#play ')){
      const query=textRaw.replace(/#play/i,'').trim()
      if(!query) return
      try{
        await sock.sendMessage(from,{text:`🔎 Buscando: *${query}*`},{quoted:m})
        const search=await yts(query)
        const video=search.videos[0]
        await sock.sendMessage(from,{ image:{url:video.thumbnail}, caption:`🎵 *${video.title}*\n⏱️ ${video.timestamp}\n*Descargando...*`},{quoted:m})
        const stream=ytdl(video.url,{ filter:'audioonly', quality:'highestaudio', playerClients:["IOS","ANDROID","WEB"] })
        const chunks=[]; for await(const c of stream) chunks.push(c)
        const buffer=Buffer.concat(chunks)
        await sock.sendMessage(from,{ audio:buffer, mimetype:'audio/mpeg' },{quoted:m})
      }catch(e){ console.log(e.message) }
    }
  })
}
start()
