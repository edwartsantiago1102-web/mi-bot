const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const fs = require('fs')

const BOT_NAME = "Legoshi"
const OWNER = "Edlegoshi"

const app = express()
let qrImage = null
app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Bot iniciando...</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white"><h2>QR ${BOT_NAME}</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000)

// Contador persistente
let pats = {}
try{ if(fs.existsSync('./pats.json')) pats = JSON.parse(fs.readFileSync('./pats.json')) }catch{}
function savePats(){ fs.writeFileSync('./pats.json', JSON.stringify(pats)) }

const patBot = [
  "ha acariciado a {bot}",
  "le ha dado pat pat a {bot}",
  "esta mimando a {bot} hasta dormirlo",
  "le rasco las orejitas a {bot}",
  "le dio muchos mimos a {bot}",
  "esta consintiendo a {bot} con pat pat",
  "le dio su dosis diaria de pat a {bot}",
  "abrazo a {bot} con pat pat"
]
const patOtros = [
  "le dio pat pat a {target}",
  "acaricio a {target}",
  "esta mimando a {target}",
  "le rasco las orejitas a {target}",
  "le dio muchos pats a {target}",
  "consintio a {target} con mucho amor"
]

async function askAI(prompt){
  try{
    const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, { signal: AbortSignal.timeout(15000) })
    const t = await res.text()
    if(t && t.length > 15) return t.slice(0, 1500)
  }catch(e){ console.log("AI fallo 1", e.message) }
  try{
    const res2 = await fetch(`https://text.pollinations.ai/openai/${encodeURIComponent(prompt)}`, { signal: AbortSignal.timeout(15000) })
    const t2 = await res2.text()
    if(t2 && t2.length > 15) return t2.slice(0, 1500)
  }catch{}
  return "La IA esta ocupada, intenta con #b de nuevo en 5 seg."
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

  sock.ev.on('group-participants.update', async (upd)=>{
    try{
      if(upd.action!=='add') return
      for(const user of upd.participants){
        const caption = `hola que tal!!. Soy Legoshi, el bot personal del grupo *☾ Bot Group ☽*. Diviértete creando stikers: manda la foto de tu stiker recortada a tu gusto y pon *#s /.s*, crearé tu stiker al instante con mucho gusto!!!

_puedes acariciarme con *#pat* he oído que mi owner ha puesto una recompensa al usuario con mayor número de *#pats*, participa si deseas podrás ganar un bot personalizado a tu gusto!! (el top uno en *#pats* deberá comunicarse con ☾Edlegoshi☽ para la personalización del premio!!_

hasta ahora estoy en version de prueba.. Así que si ves alguna anomalía o error en mis respuestas contactate con mi owner *☾ Edlegoshi ☽*!!

Reglas:
- _Evita el uso de lenguaje soez_
- _No crear stikers sexual/explícito_
- _Evitar reporte por spam_

Disfruta tu estancia y recuerda que este bot es hecho con amor!!!

Bienvenid@ @${user.split('@')[0]}`
        const files = fs.readdirSync('./')
        const img = files.find(f=> f.toLowerCase().includes('legoshi') && f.match(/\.(jpg|jpeg|png|webp)$/))
        if(img) await sock.sendMessage(upd.id, { image: fs.readFileSync('./'+img), caption, mentions:[user] })
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
    const senderJid=m.key.participant || m.key.remoteJid

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

    if(lower.startsWith('#pat')){
      const mentioned=m.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
      const jid=mentioned[0]
      const isBot =!jid || lower.includes('legoshi') || (jid && sock.user.id.includes(jid.split('@')[0]))
      if(isBot){
        if(!pats[senderJid]) pats[senderJid] = { name: sender, count: 0 }
        pats[senderJid].count += 1
        pats[senderJid].name = sender
        savePats()
        const frase = patBot[Math.floor(Math.random()*patBot.length)].replace(/{bot}/g, BOT_NAME)
        await sock.sendMessage(from,{text:`*${BOT_NAME} v2.0 in operation!*\n${sender} ${frase}\n\nLlevas ${pats[senderJid].count} pats a ${BOT_NAME}`})
      }else{
        const frase = patOtros[Math.floor(Math.random()*patOtros.length)].replace(/{target}/g, `@${jid.split('@')[0]}`)
        await sock.sendMessage(from,{text:`${sender} ${frase}`, mentions:[jid]})
      }
    }

    if(lower==='#pats'){
      let ranking = Object.values(pats).sort((a,b)=>b.count-a.count).slice(0,10)
      if(ranking.length===0) return sock.sendMessage(from,{text:"Aun nadie le ha dado pat a Legoshi. Usa #pat"})
      let txt = `Top Pats a ${BOT_NAME}\n\n`
      ranking.forEach((u,i)=>{ txt += `${i+1}. ${u.name} - ${u.count} pats\n` })
      const mine = pats[senderJid]
      if(mine) txt += `\nTu: ${mine.count} pats`
      txt += `\n\nPremio al top 1: bot personalizado por Edlegoshi`
      await sock.sendMessage(from,{text:txt})
    }

    if(lower.startsWith('#b ')){
      const prompt = textRaw.slice(3).trim()
      if(!prompt) return
      if(/^[0-9+\-*/().% ]+$/.test(prompt)){
        try{
          const r = Function(`"use strict"; return (${prompt})`)()
          return sock.sendMessage(from,{text:`${BOT_NAME} AI - Math\n\n${prompt} = ${r}`},{quoted:m})
        }catch{}
      }
      await sock.sendMessage(from,{text:`${BOT_NAME} AI pensando...`},{quoted:m})
      const respuesta = await askAI(prompt)
      await sock.sendMessage(from,{text:`${BOT_NAME} AI\n\n${respuesta}`},{quoted:m})
    }
  })
}
start()
