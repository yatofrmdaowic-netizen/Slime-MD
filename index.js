const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const { runCommand, enforceProtection, isOwner } = require('./src/features')
const { SETTINGS } = require('./settings')
const { initDatabase } = require('./src/database')
const { startPairingWebsite } = require('./src/pairing-web')

const logger = pino({ level: 'silent' })
const pairingNumber = (process.env.PAIRING_NUMBER || '').replace(/[^0-9]/g, '')
const deletedMessageCache = new Map()
const groupMetaCache = new Map()
const REACTION_EMOJIS = ['🔥', '⚡', '✨', '💚', '💫', '✅']
let currentSocket = null

startPairingWebsite({
  getSocket: () => currentSocket
})

const cacheMessage = message => {
  const chat = message?.key?.remoteJid
  const id = message?.key?.id
  if (!chat || !id || !message?.message) return
  deletedMessageCache.set(`${chat}:${id}`, message)
}

const getOwnerJid = () => {
  const number = SETTINGS.OWNER_NUMBERS[0]
  return number ? `${number}@s.whatsapp.net` : null
}

const getGroupMetadataCached = async (sock, chatId) => {
  const cached = groupMetaCache.get(chatId)
  if (cached && Date.now() - cached.ts < 60_000) {
    return cached.data
  }

  const data = await sock.groupMetadata(chatId)
  groupMetaCache.set(chatId, { ts: Date.now(), data })
  return data
}

const normalizeText = message => {
  if (!message) return ''

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim()
}

const formatPairingCode = code => code?.match(/.{1,4}/g)?.join('-') || code

const startBot = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: [SETTINGS.BOT_NAME, 'Chrome', '1.3.0']
  })
  currentSocket = sock

  sock.ev.on('creds.update', saveCreds)

  if (!sock.authState.creds.registered) {
    if (!pairingNumber) {
      console.log('⚠️ Set PAIRING_NUMBER in environment to get pairing code.')
    } else {
      const code = await sock.requestPairingCode(pairingNumber)
      console.log(`\nYour pairing code: ${formatPairingCode(code)}\n`)
      console.log('Open WhatsApp > Linked Devices > Link with phone number, then enter this code.')
    }
  }

  sock.ev.on('call', async calls => {
    if (!SETTINGS.TOGGLES.ANTI_CALL || !SETTINGS.TOGGLES.CALL_BLOCK) return

    for (const call of calls || []) {
      const caller = call.from
      if (!caller || isOwner(caller)) continue

      await sock.sendMessage(caller, {
        text: 'Calls are blocked by bot settings. You have been blocked.'
      })
      await sock.updateBlockStatus(caller, 'block')
    }
  })

  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      console.log(`✅ ${SETTINGS.BOT_NAME} connected to WhatsApp`)
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect)

      if (shouldReconnect) {
        startBot()
      } else {
        console.log('Session logged out. Delete session folder and pair again.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    const message = messages[0]
    if (!message?.message || message.key.fromMe) return

    const chatId = message.key.remoteJid
    const text = normalizeText(message.message)
    const ownerJid = getOwnerJid()

    try {
      const protocol = message.message?.protocolMessage
      if (protocol?.type === 0) {
        const target = protocol.key
        const targetChat = target?.remoteJid || chatId
        const cached = deletedMessageCache.get(`${targetChat}:${target?.id}`)

        if (chatId === 'status@broadcast' && SETTINGS.TOGGLES.ANTI_STATUS_DELETE && ownerJid) {
          await sock.sendMessage(ownerJid, {
            text: `⚠️ Status deletion detected from ${target?.participant || 'unknown'}`
          })
        }

        if (SETTINGS.TOGGLES.ANTI_DELETE && cached && targetChat !== 'status@broadcast') {
          await sock.sendMessage(targetChat, { text: '⚠️ Anti-delete restored one deleted message.' })
          await sock.sendMessage(targetChat, { forward: cached })
        }

        return
      }

      cacheMessage(message)

      if (chatId === 'status@broadcast') {
        if (SETTINGS.TOGGLES.SAVE_STATUS && ownerJid) {
          await sock.sendMessage(ownerJid, { text: `📌 Saved status from ${message.key.participant || 'unknown'}` })
          await sock.sendMessage(ownerJid, { forward: message })
        }
        return
      }

      const groupMetadata = chatId.endsWith('@g.us')
        ? await getGroupMetadataCached(sock, chatId)
        : undefined

      if (
        SETTINGS.TOGGLES.AUTO_REACT_GROUP &&
        chatId.endsWith('@g.us') &&
        !message.key.fromMe &&
        !text.startsWith('.')
      ) {
        const emoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)]
        await sock.sendMessage(chatId, { react: { text: emoji, key: message.key } })
      }

      await enforceProtection({ sock, message, body: text, groupMetadata })

      if (!text.startsWith('.')) return

      const handled = await runCommand({ sock, message, body: text, groupMetadata })
      if (!handled) {
        await sock.sendMessage(
          chatId,
          { text: `Unknown command: ${text}\nType *.menu* for command list.` },
          { quoted: message }
        )
      }
    } catch (error) {
      await sock.sendMessage(chatId, { text: `❌ ${error.message}` }, { quoted: message })
    }
  })
}

initDatabase().finally(() => {
  startBot()
})
