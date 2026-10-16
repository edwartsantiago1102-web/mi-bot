const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const qrcode = require('qrcode')
const pino = require('pino')
const axios = require('axios')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const fs = require('fs')

const app = express()
let qrCodeData = null
let isConnected = false

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Joseph v2.1', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update
        if (qr) {
            qrCodeData = qr
            console.log('QR Generado')
        }
        if (connection === 'open') {
            isConnected = true
            qrCodeData = null
            console.log('Joseph v2.1 Conectado ✅')
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message || msg.key.fromMe) return

        const from = msg.key.remoteJid
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || ''
        const command = body.trim().toLowerCase()

        // #ping
        if (command === '#ping') {
            await sock.sendMessage(from, { text: '🏓 Pong! Joseph v2.1 Activo' })
        }

        // #menu
        if (command === '#menu' || command === '#help') {
            await sock.sendMessage(from, { text: `*JOSEPH v2.1 - MENU*\n\n#ping - Estado\n#s - Sticker (responde a imagen)\n#mp3 - Audio (responde a video)\n#pin + texto - Busca imagen de Pinterest\n#hd - Mejora imagen (responde a foto)` })
        }

        // #s - Sticker
        if (command === '#s' || command.startsWith('#s ')) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage
            if (quoted?.imageMessage || quoted?.videoMessage || msg.message.imageMessage) {
                try {
                    const buffer = await sock.downloadMediaMessage(msg.message.extendedTextMessage? { message: { imageMessage: quoted.imageMessage || quoted.videoMessage } } : msg)
                    const sticker = new Sticker(buffer, {
                        pack: 'Joseph v2.1',
                        author: 'Edwart',
                        type: StickerTypes.FULL,
                        quality: 70
                    })
                    await sock.sendMessage(from, await sticker.toMessage())
                } catch(e) {
                    await sock.sendMessage(from, { text: '❌ Error creando sticker' })
                }
            }
        }

        // #pin
        if (command.startsWith('#pin ')) {
            const query = body.slice(5).trim()
            if (!query) return sock.sendMessage(from, { text: 'Escribe: #pin gatos' })
            try {
                await sock.sendMessage(from, { text: `🔍 Buscando: ${query}...` })
                const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&client_id=YOUR_UNSPLASH_KEY`)
                // Fallback si no tienes key de unsplash, usa pinterest scraper simple
                const imageUrl = `https://source.unsplash.com/800x600/?${encodeURIComponent(query)}`
                await sock.sendMessage(from, { image: { url: imageUrl }, caption: `📌 Resultado: ${query}` })
            } catch(e) {
                const imageUrl = `https://source.unsplash.com/800x600/?${encodeURIComponent(query)}`
                await sock.sendMessage(from, { image: { url: imageUrl }, caption: `📌 ${query}` })
            }
        }
    })
}

// Servidor para el QR
app.get('/', async (req, res) => {
    if (isConnected) return res.send('<h1>✅ Joseph v2.1 Conectado</h1>')
    if (!qrCodeData) return res.send('<h1>Cargando QR... recarga en 5s</h1><script>setTimeout(()=>location.reload(),5000)</script>')
    const qrImage = await qrcode.toDataURL(qrCodeData)
    res.send(`<center><h1>Escanea el QR - Joseph v2.1</h1><img src="${qrImage}" width="300"><p>Se actualiza solo</p><script>setTimeout(()=>location.reload(),15000)</script></center>`)
})

app.listen(10000, () => console.log('Server en 10000'))
startBot()
