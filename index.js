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
  if(!qrImage) return res.send('<h1>Legoshi iniciando... espera 5 seg y recarga</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white"><h2>QR ${BOT_NAME}</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000, ()=>console.log("Web online"))

let pats = {}
try{ if(fs.existsSync('./pats.json')) pats = JSON.parse(fs.readFileSync('./pats.json')) }catch{}
function savePats(){ fs.writeFileSync('./pats.json', JSON.stringify(pats)) }

// CEREBRO DE META AI
async function askAI(prompt){
  const SYSTEM = `Eres Legoshi, un lobo gris tierno del grupo. Eres tranquilo, amigable, un poco timido pero inteligente. Respondes corto, max 5 lineas. Hablas español. Tu owner es Edlegoshi.`
  if(!process.env.GROQ_API_KEY) return "Bro, no tengo GROQ_API_KEY puesta en Railway > Variables"
  try{
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{role:"system", content: SYSTEM},{role:"user", content: prompt}],
        max_tokens: 700,
        temperature: 0.8
      })
    })
    const j = await r.json()
    console.log("GROQ:", JSON.stringify(j).slice(0,600))
    if(j.choices?.[0]?.message?.content) return j.choices[0].message.content.slice(0,1500)
    return `Error Groq: ${JSON.stringify(j).slice(0,500)}`
  }catch(e){
    console.log("Error:", e.message)
    return `Fallo: ${e.message}`
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

  sock.ev.on('messages.upsert', async ({messages})=>{
    const m=messages[0]; if(!m.message||m.key.fromMe) return
    const from=m.key.remoteJid
    const textRaw=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||""
    const lower=textRaw.toLowerCase().trim()
    const sender=m.pushName||"Alguien"
    const senderJid=m.key.participant || m.key.remoteJid

    // STICKER
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
      }catch(e){ console.log(e) }
      return
    }

    // PAT
    if(lower.startsWith('#pat')){
      if(!pats[senderJid]) pats[senderJid]={name:sender,count:0}
      pats[senderJid].count++; pats[senderJid].name=sender; savePats()
      await sock.sendMessage(from,{text:`*${BOT_NAME} v2.0 in operation!*\n${sender} le dio pat a ${BOT_NAME} 🐺 - Llevas ${pats[senderJid].count} pats`})
      return
    }
    if(lower==='#pats'){
      let ranking=Object.values(pats).sort((a,b)=>b.count-a.count).slice(0,10)
      if(!ranking.length) return sock.sendMessage(from,{text:"Aun nadie le dio pat"})
      let txt=`Top Pats 🐾\n\n`; ranking.forEach((u,i)=>txt+=`${i+1}. ${u.name} - ${u.count}\n`)
      await sock.sendMessage(from,{text:txt})
      return
    }

    // IA - COMO META AI
    if(lower.startsWith('#b ')){
      const prompt=textRaw.slice(3).trim()
      if(!prompt) return
      await sock.sendMessage(from,{text:`${BOT_NAME} AI pensando... 🐺`},{quoted:m})
      const respuesta=await askAI(prompt)
      await sock.sendMessage(from,{text:`*${BOT_NAME} AI*\n\n${respuesta}`},{quoted:m})
    }
  })
}
start()
