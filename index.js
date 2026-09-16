const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')

const BOT_NAME = "Legoshi"
const app = express()
let qrImage = null
app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Bot iniciando...</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white"><h2>QR ${BOT_NAME}</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000)

async function downloadAnySong(videoUrl, videoId){
  let buffer = null

  // 1. ytdl-core con TODOS los clientes (este agarra el 90%)
  try{
    const stream = ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      playerClients: ["IOS","ANDROID","WEB","TV","WEB_EMBEDDED","MWEB","WEB_CREATOR"]
    })
    const chunks=[]; for await(const c of stream) chunks.push(c)
    buffer = Buffer.concat(chunks)
    if(buffer.length > 5000) return buffer
  }catch(e){ console.log("ytdl fail:", e.message) }

  // 2. FabDL - agarra Shorts como el "quiero queque" de tu captura
  try{
    const res = await fetch(`https://api.fabdl.com/youtube/get?url=https://www.youtube.com/watch?v=${videoId}`, { signal: AbortSignal.timeout(15000) })
    const json = await res.json()
    let dl = json?.result?.downloadUrl || json?.result?.url || json?.result?.downloads?.mp3?.[0]?.url
    if(dl){
      const r = await fetch(dl)
      const b = Buffer.from(await r.arrayBuffer())
      if(b.length > 5000) return b
    }
  }catch(e){ console.log("fabdl fail:", e.message) }

  // 3. Piped - 3 servidores
  const pipedApis = [
    `https://pipedapi.kavin.rocks/streams/${videoId}`,
    `https://pipedapi.moomoo.me/streams/${videoId}`,
    `https://api.piped.projectsegfau.lt/streams/${videoId}`
  ]
  for(const api of pipedApis){
    try{
      const r = await fetch(api, { signal: AbortSignal.timeout(8000) })
      const j = await r.json()
      if(j?.audioStreams?.length){
        const best = j.audioStreams.sort((a,b)=>b.bitrate-a.bitrate)[0]
        const ar = await fetch(best.url)
        const b = Buffer.from(await ar.arrayBuffer())
        if(b.length > 5000) return b
      }
    }catch{}
  }

  // 4. Cobalt - ultimo respaldo
  try{
    const res = await fetch("https://co.wuk.sh/api/json", {
      method:"POST", headers:{"Accept":"application/json","Content-Type":"application/json"},
      body: JSON.stringify({url:videoUrl,isAudioOnly:true,aFormat:"mp3"})
    })
    const data = await res.json()
    if(data?.url){
      const r = await fetch(data.url)
      return Buffer.from(await r.arrayBuffer())
    }
  }catch{}

  return null
}

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({level:'silent'}), browser:["Ubuntu","Chrome","20.0.04"] })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({qr,connection})=>{ if(qr) qrImage = await QRCode.toDataURL(qr); if(connection==='open'){console.log("CONECTADO");qrImage=null} if(connection==='close') start() })

  sock.ev.on('group-participants.update', async (upd)=>{
    try{
      if(upd.action!=='add') return
      for(const u of upd.participants){
        const caption = `hola que tal!! @${u.split('@')[0]}. Soy ${BOT_NAME}, el bot personal del grupo *☾ Bot Group ☽*. Diviértete creando stikers: manda la foto y pon *.s*`
        const files = fs.readdirSync('./')
        const found = files.find(f=> f.toLowerCase().includes('legoshi') && f.match(/\.(jpg|jpeg|png|webp)$/))
        if(found) await sock.sendMessage(upd.id, { image: fs.readFileSync('./'+found), caption, mentions:[u] })
        else await sock.sendMessage(upd.id, { text: caption, mentions:[u] })
      }
    }catch{}
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
        const sticker=new Sticker(buf,{pack:"☾ Bot Group ☽", author:sender, type:'full', quality:80})
        await sock.sendMessage(from,{sticker:await sticker.toBuffer()},{quoted:m})
      }catch{}
    }

    if(lower.startsWith('#pat')){
      const mentioned=m.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
      const jid=mentioned[0]
      const isBot=!jid||lower.includes(BOT_NAME.toLowerCase())
      const text=isBot?`*${BOT_NAME} v2.0 in operation!*\n🐺 *${sender}* ha acariciado a ${BOT_NAME} 🥺🐺`:`✨ *${sender}* le dio pat pat a @${jid.split('@')[0]} 🥰`
      await sock.sendMessage(from,{text, mentions:isBot?[]:[jid]})
    }

    if(lower.startsWith('#play ')){
      const query=textRaw.replace(/#play/i,'').trim()
      if(!query) return
      try{
        await sock.sendMessage(from,{text:`🔎 Buscando: *${query}*`},{quoted:m})
        const search=await yts(query)
        const video=search.videos[0]
        await sock.sendMessage(from,{ image:{url:video.thumbnail}, caption:`🎵 *${video.title}*\n⏱️ ${video.timestamp}\n🎧 Bajando...`},{quoted:m})

        const buffer = await downloadAnySong(video.url, video.videoId)
        if(!buffer) throw new Error("no buffer")

        await sock.sendMessage(from,{ audio: buffer, mimetype:'audio/mpeg' },{quoted:m})
      }catch(e){
        console.log(e.message)
        await sock.sendMessage(from,{text:`⚠️ Intenta de nuevo:\n#play ${query}`},{quoted:m})
      }
    }
  })
}
start()
