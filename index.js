const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const P = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const { Sticker } = require('wa-sticker-formatter')
const fs = require('fs')

const app = express()
let qrImage = null

app.get('/', async (req,res)=>{
  if(!qrImage) return res.send('<h1>Legoshi iniciando... recarga en 3 seg</h1><script>setTimeout(()=>location.reload(),3000)</script>')
  res.send(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:white"><h2>QR Legoshi</h2><img src="${qrImage}" style="width:340px;background:white;padding:12px;border-radius:12px"></div>`)
})
app.listen(process.env.PORT || 3000, ()=>console.log("Web online"))

let pats = {}
try{ if(fs.existsSync('./pats.json')) pats = JSON.parse(fs.readFileSync('./pats.json')) }catch{}
function savePats(){ fs.writeFileSync('./pats.json', JSON.stringify(pats)) }

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

    // STICKER GRANDE HD
    if(lower==='#s'||lower.startsWith('#s ')||lower==='.s'||lower.startsWith('.s ')){
      try{
        const quoted=m.message.extendedTextMessage?.contextInfo?.quotedMessage
        const msg=quoted?{message:quoted}:m
        const buf=await downloadMediaMessage(msg,'buffer',{})
        if(!buf) return
        let pack="☾ Bot Group ☽"
        try{ if(from.endsWith('@g.us')) pack=(await sock.groupMetadata(from)).subject }catch{}
        const sticker=new Sticker(buf,{
          pack,
          author:`Hecho por ${sender}`,
          type:'full',
          quality:100,
          categories:["🤩"]
        })
        await sock.sendMessage(from,{sticker:await sticker.toBuffer()},{quoted:m})
      }catch(e){ console.log(e) }
      return
    }

    // PAT ORIGINAL DIVERSO
    if(lower.startsWith('#pat')){
      if(!pats[senderJid]) pats[senderJid]={name:sender,count:0}
      pats[senderJid].count++
      pats[senderJid].name=sender
      savePats()
      const frases = [
        `*Legoshi v2.0 in operation!*\n☾ ${sender} ☽ le dio pat a Legoshi 🐺 - Llevas ${pats[senderJid].count} pats`,
        `*Legoshi v2.0 in operation!*\nAw ${sender} acaricia a Legoshi 🐾 - Llevas ${pats[senderJid].count} pats`,
        `*Legoshi v2.0 in operation!*\n${sender} consiente a Legoshi :3 - Llevas ${pats[senderJid].count} pats`,
        `*Legoshi v2.0 in operation!*\n${sender} le hace pio pio a Legoshi 🐺 - Llevas ${pats[senderJid].count} pats`
      ]
      await sock.sendMessage(from,{text: frases[Math.floor(Math.random()*frases.length)]})
      return
    }

    // PAT LIST
    if(lower.startsWith('#pats')){
      let ranking=Object.values(pats).sort((a,b)=>b.count-a.count)
      if(!ranking.length) return sock.sendMessage(from,{text:"Aun nadie le ha dado pat a Legoshi 🐺"})
      let txt=`*Pat List de Legoshi 🐾*\n\n`
      ranking.slice(0,15).forEach((u,i)=>{ txt+=`${i+1}. ${u.name} - ${u.count} pats\n` })
      await sock.sendMessage(from,{text:txt})
      return
    }
  })
}
start()
