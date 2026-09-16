const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const fs = require('fs')

const BOT_NAME = "Legoshi"
const app = express()
let qrImage = null
app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Bot iniciando...</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white"><h2>QR ${BOT_NAME}</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000)

// --- CONTADOR DE PATS ---
let pats = {}
try{ if(fs.existsSync('./pats.json')) pats = JSON.parse(fs.readFileSync('./pats.json')) }catch{}
function savePats(){ fs.writeFileSync('./pats.json', JSON.stringify(pats)) }

const patBot = [
  "ha acariciado a {bot} 🥺🐺",
  "le ha dado pat pat a {bot} 💚",
  "está mimando a {bot} hasta dormirlo 😴",
  "le rascó las orejitas a {bot} 🐾",
  "le dio muchos mimos a {bot} 💤",
  "está consintiendo a {bot} con pat pat ✨",
  "le dio su dosis diaria de pat a {bot} 💚",
  "abrazó a {bot} con pat pat 🫂"
]
const patOtros = [
  "le dio pat pat a {target} 🥰",
  "acarició a {target} 💚",
  "está mimando a {target} 😳",
  "le rascó las orejitas a {target} 🐾",
  "le dio muchos pats a {target} ✨",
  "consintió a {target} con mucho amor 💖"
]

async function askAI(prompt){
  try{
    // Pollinations es gratis y no necesita API key
    const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`, {
      headers: { "User-Agent":"Mozilla/5.0" },
      signal: AbortSignal.timeout(20000)
    })
    const text = await res.text()
    return text.slice(0, 1500) // limite whatsapp
  }catch(e){
    return "⚠️ La IA está ocupada, intenta de nuevo en 5 seg."
  }
}

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({level:'silent'}), browser:["Ubuntu","Chrome","20.0.04"] })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({qr,connection})=>{
    if(qr) qrImage = await QRCode.toDataURL(qr)
    if(connection==='open'){ console.log("CONECTADO"); qrImage=null }
    if(connection==='close') start()
  })

  // SALUDO NUEVOS
  sock.ev.on('group-participants.update', async (upd)=>{
    try{
      if(upd.action!=='add') return
      for(const user of upd.participants){
        const caption = `hola que tal!! @${user.split('@')[0]}. Soy ${BOT_NAME}, el bot personal del grupo *☾ Bot Group ☽*.\n\n📌 Comandos:\n•.s para stickers\n• #pat para pat pat\n• #b para preguntarme lo que sea\n• #pats para ver tu contador`
        const files = fs.readdirSync('./')
        const found = files.find(f=> f.toLowerCase().includes('legoshi') && f.match(/\.(jpg|jpeg|png|webp)$/))
        if(found) await sock.sendMessage(upd.id, { image: fs.readFileSync('./'+found), caption, mentions:[user] })
        else await sock.sendMessage(upd.id, { text: caption, mentions:[user] })
      }
    }catch{}
  })

  sock.ev.on('messages.upsert', async ({messages})=>{
    const m=messages[0]; if(!m.message||m.key.fromMe) return
    const from=m.key.remoteJid
    const textRaw=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||""
    const lower=textRaw.toLowerCase().trim()
    const sender=m.pushName||"Alguien"
    const senderJid=m.key.participant || from

    //.s / #s
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
      }catch{}
    }

    // #pat
    if(lower.startsWith('#pat')){
      const mentioned=m.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
      const jid=mentioned[0]
      const isBot =!jid || lower.includes(BOT_NAME.toLowerCase()) || (jid && sock.user.id.includes(jid.split('@')[0]))

      if(isBot){
        // CONTADOR
        if(!pats[senderJid]) pats[senderJid] = { name: sender, count: 0 }
        pats[senderJid].count += 1
        pats[senderJid].name = sender
        savePats()

        let frase = patBot[Math.floor(Math.random()*patBot.length)]
        frase = frase.replace(/{bot}/g, BOT_NAME)
        await sock.sendMessage(from,{text:`*${BOT_NAME} v2.0 in operation!*\n🐺 *${sender}* ${frase}\n\n📊 Llevas *${pats[senderJid].count}* pats a ${BOT_NAME}`})
      }else{
        let frase = patOtros[Math.floor(Math.random()*patOtros.length)]
        frase = frase.replace(/{target}/g, `@${jid.split('@')[0]}`)
        await sock.sendMessage(from,{text:`✨ *${sender}* ${frase}`, mentions:[jid]})
      }
    }

    // #pats - ver ranking
    if(lower==='#pats' || lower==='#pats top'){
      let ranking = Object.values(pats).sort((a,b)=>b.count-a.count).slice(0,10)
      if(ranking.length===0) return sock.sendMessage(from,{text:"Aún nadie le ha dado pat a Legoshi 🥺"})
      let txt = `🏆 *Top Pats a ${BOT_NAME}*\n\n`
      ranking.forEach((u,i)=>{ txt += `${i+1}. ${u.name} - ${u.count} pats\n` })
      const mine = pats[senderJid]
      if(mine) txt += `\nTu: ${mine.count} pats`
      await sock.sendMessage(from,{text:txt})
    }

    // #b - IA PARA TODO
    if(lower.startsWith('#b ')){
      const prompt = textRaw.slice(3).trim()
      if(!prompt) return sock.sendMessage(from,{text:"Usa: #b que es 5+5 o #b traduceme hello al ingles"})

      // Si es matematica simple, la resuelvo local rapido
      if(/^[0-9+\-*/().% ]+$/.test(prompt)){
        try{
          const res = Function(`"use strict"; return (${prompt})`)()
          return sock.sendMessage(from,{text:`🧮 *${BOT_NAME} AI*\n\n${prompt} = *${res}*`},{quoted:m})
        }catch{}
      }

      await sock.sendMessage(from,{text:`🤖 *${BOT_NAME} AI* pensando...`},{quoted:m})
      const respuesta = await askAI(prompt)
      await sock.sendMessage(from,{text:`🤖 *${BOT_NAME} AI*\n\n${respuesta}`},{quoted:m})
    }

  })
}
start()
