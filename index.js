const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({
        auth: state,
        browser: ["Chrome","",""]
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if(update.qr){
            qrcode.generate(update.qr, {small: true})
        }
        if(connection === 'close'){
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
            if(shouldReconnect) start()
        } else if(connection === 'open'){
            console.log('¡BOT DE STICKERS CONECTADO!')
        }
    })

    sock.ev.on('messages.upsert', async ({messages}) => {
        const m = messages[0]
        if(!m.message) return
        const texto = m.message.conversation || m.message.extendedTextMessage?.text || ""

        // Si te mandan imagen con.s = sticker
        if(m.message.imageMessage && texto.toLowerCase().includes('.s') || m.message.imageMessage){
            // si responde a una imagen también
            if(texto === '.s' || texto === '.sticker' ||!texto){
                const buffer = await sock.downloadMediaMessage(m)
                await sock.sendMessage(m.key.remoteJid, { sticker: buffer }, { quoted: m })
            }
        }
        // Si te mandan video corto con.s
        if(m.message.videoMessage && texto.toLowerCase() === '.s'){
            const buffer = await sock.downloadMediaMessage(m)
            await sock.sendMessage(m.key.remoteJid, { sticker: buffer }, { quoted: m })
        }

        if(texto.toLowerCase() === '.s' && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage){
            const quoted = m.message.extendedTextMessage.contextInfo
            const buffer = await sock.downloadMediaMessage({ key: {...m.key, id: quoted.stanzaId }, message: quoted.quotedMessage })
            await sock.sendMessage(m.key.remoteJid, { sticker: buffer }, { quoted: m })
        }

        if(texto.toLowerCase() === 'hola'){
            await sock.sendMessage(m.key.remoteJid, { text: 'Bot de stickers activo ✅\n\nManda una foto con.s o responde una foto con.s' })
        }
    })
}
start()