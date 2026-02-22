const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const { SETTINGS } = require('../settings')
const {
  loadGroupSettings,
  saveGroupSettings,
  loadUserLimit,
  saveUserLimit,
  DEFAULT_GROUP_SETTINGS,
  nextResetDate
} = require('./database')

const activeMathGames = new Map()
const activeQuizGames = new Map()
const groupProtection = new Map()
const antiSpam = new Map()
const userLimitCache = new Map()

const ASSET_IMAGE_PATH = path.join(__dirname, '..', 'assets', 'menu.jpg')
const ASSET_ANIMATION_PATH = path.join(__dirname, '..', 'assets', 'menu.mp4')
const ASSET_SONG_PATH = path.join(__dirname, '..', 'assets', 'menu.wav')
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.lolhuman.xyz'

let publicMode = SETTINGS.TOGGLES.PRIVATE_MODE ? false : SETTINGS.TOGGLES.PUBLIC_MODE

const isGroupJid = jid => jid?.endsWith('@g.us')
const getSenderJid = message => message.key.participant || message.key.remoteJid
const getSenderNumber = jid => (jid || '').replace(/[^0-9]/g, '')
const isOwner = jid => SETTINGS.OWNER_NUMBERS.includes(getSenderNumber(jid))

const parseCommand = body => {
  if (!body.startsWith('.')) return { command: '', args: [] }
  const [command, ...args] = body.trim().slice(1).split(/\s+/)
  return { command: command.toLowerCase(), args }
}

const pickMentionedOrReply = message =>
  message.message?.extendedTextMessage?.contextInfo?.participant ||
  message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]

const getQuoted = message => message.message?.extendedTextMessage?.contextInfo?.quotedMessage

const getGroupProtection = async chatId => {
  if (groupProtection.has(chatId)) return groupProtection.get(chatId)

  const loaded = await loadGroupSettings(chatId)
  const merged = { ...DEFAULT_GROUP_SETTINGS, ...loaded }
  groupProtection.set(chatId, merged)
  return merged
}

const updateGroupProtection = async (chatId, mutator) => {
  const setting = await getGroupProtection(chatId)
  mutator(setting)
  groupProtection.set(chatId, setting)
  await saveGroupSettings(chatId, setting)
  return setting
}

const isAdmin = (groupMetadata, jid) =>
  Boolean(groupMetadata?.participants?.find(participant => participant.id === jid && participant.admin))

const ensureGroupAdminAccess = ({ chatId, senderJid, groupMetadata }) => {
  if (!isGroupJid(chatId)) throw new Error('Group only command.')
  if (!isOwner(senderJid) && !isAdmin(groupMetadata, senderJid)) {
    throw new Error('Admin only command.')
  }
}

const normalizeResult = result => result.result || result.data || result
const yesNo = value => (value ? 'enabled' : 'disabled')
const parseBooleanToggle = value => {
  const v = String(value || '').toLowerCase()
  if (['on', 'true', '1', 'yes'].includes(v)) return true
  if (['off', 'false', '0', 'no'].includes(v)) return false
  return null
}

const toDateString = date => new Date(date).toISOString().slice(0, 10)

const getUserLimitState = async senderJid => {
  const userId = getSenderNumber(senderJid)
  const cached = userLimitCache.get(userId)

  if (cached && new Date(cached.resetAt).getTime() > Date.now()) {
    return cached
  }

  const loaded = await loadUserLimit(userId)
  const state = {
    userId,
    limit: Number(loaded.limit ?? SETTINGS.DEFAULT_LIMIT),
    resetAt: loaded.resetAt ? new Date(loaded.resetAt) : nextResetDate(),
    premium: Boolean(loaded.premium),
    premiumExpireAt: loaded.premiumExpireAt ? new Date(loaded.premiumExpireAt) : null
  }
  userLimitCache.set(userId, state)
  return state
}

const writeUserLimitState = async state => {
  userLimitCache.set(state.userId, state)
  await saveUserLimit(state.userId, state.limit, state.resetAt, state.premium, state.premiumExpireAt)
}

const LIMIT_FREE_COMMANDS = new Set(['menu', 'ping', 'settings', 'system', 'runtime', 'limit', 'creator', 'help'])

const ensureApiKey = () => {
  if (!SETTINGS.API_KEY) throw new Error('API_KEY is missing. Set API_KEY first.')
}

const toQueryString = params =>
  Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')

const httpGetJson = urlString =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, res => {
      let raw = ''
      res.on('data', chunk => {
        raw += chunk
      })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`API request failed (${res.statusCode}): ${url.pathname}`))
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('API request timeout')))
  })

const requestJson = async (pathValue, params = {}) => {
  ensureApiKey()
  const query = toQueryString({ ...params, apikey: SETTINGS.API_KEY })
  const url = `${API_BASE_URL}${pathValue}${query ? `?${query}` : ''}`
  const data = await httpGetJson(url)
  if (data && data.status === false) {
    throw new Error(data.message || `API responded with error: ${pathValue}`)
  }
  return data
}

const requestAny = async (paths, params = {}) => {
  const errors = []
  for (const p of paths) {
    try {
      return await requestJson(p, params)
    } catch (error) {
      errors.push(error.message)
    }
  }
  throw new Error(errors[errors.length - 1] || 'All API endpoints failed')
}

const api = {
  download: {
    ytmp3: url => requestAny(['/api/ytaudio2', '/api/ytaudio'], { url }),
    ytmp4: url => requestAny(['/api/ytvideo2', '/api/ytvideo'], { url }),
    tiktok: url => requestAny(['/api/tiktok', '/api/tiktok2'], { url }),
    instagram: url => requestAny(['/api/instagram2', '/api/instagram'], { url }),
    facebook: url => requestAny(['/api/facebook2', '/api/facebook'], { url }),
    mediafire: url => requestAny(['/api/mediafire2', '/api/mediafire'], { url }),
    play: query => requestAny(['/api/ytsearch', '/api/youtube'], { query })
  },
  stalker: {
    instagram: username => requestAny(['/api/stalk/instagram'], { username }),
    tiktok: username => requestAny(['/api/stalk/tiktok'], { username }),
    github: username => requestAny(['/api/stalk/github'], { username }),
    npm: packageName => requestAny(['/api/stalk/npm'], { package: packageName }),
    ml: userId => requestAny(['/api/stalk/mobilelegend', '/api/mobilelegend'], { id: userId }),
    ff: userId => requestAny(['/api/stalk/freefire', '/api/freefire'], { id: userId })
  },
  fun: {
    joke: () => requestAny(['/api/joke', '/api/random/joke']),
    meme: () => requestAny(['/api/meme', '/api/random/meme']),
    truth: () => requestAny(['/api/truth', '/api/random/truth']),
    dare: () => requestAny(['/api/dare', '/api/random/dare'])
  }
}

const toBuffer = async (message, sock) =>
  downloadMediaMessage(
    message,
    'buffer',
    {},
    {
      logger: sock.logger,
      reuploadRequest: sock.updateMediaMessage
    }
  )

const createQuiz = () => {
  const a = Math.floor(Math.random() * 50) + 1
  const b = Math.floor(Math.random() * 50) + 1
  const operator = ['+', '-', '*'][Math.floor(Math.random() * 3)]
  const answer = operator === '+' ? a + b : operator === '-' ? a - b : a * b
  return { question: `${a} ${operator} ${b}`, answer: String(answer) }
}

const commandHandlers = {
  menu: async ({ sock, chatId, message }) => {
    const text = [
      `*🤖 ${SETTINGS.BOT_NAME} Menu*`,
      '',
      '*Main*',
      '.menu .ping .system .limit .creator',
      '',
      '*Owner*',
      '.public .self .block .unblock .callblock on|off .fullpp',
      '.private true|false .autoreact true|false .savestatus true|false',
      '.antidelete true|false .antistatusdel true|false .getpp <number>',
      '.addprem <number> <days> .delprem <number> .listprem .premset <number> <days>',
      '',
      '*Group*',
      '.tagall .group open|close .kick .add .promote .demote',
      '.hidetag .linkgroup .revoke .setsubject .setdesc',
      '',
      '*Protection*',
      '.antilink true|false .antibadword true|false .antispam true|false',
      '.ownerprotect true|false .onlyadmincmd true|false .groupprotect true|false .protect',
      '',
      '*Media*',
      '.sticker .onceview .toimg .tourl .emoji <emoji> .emojimix <a>+<b>',
      '',
      '*Limit/Premium*',
      '.limit .premium .addlimit .setlimit .resetlimit'
    ].join('\n')

    const hasMenuImage = fs.existsSync(ASSET_IMAGE_PATH)
    const hasMenuAnimation = fs.existsSync(ASSET_ANIMATION_PATH)
    const hasMenuSong = fs.existsSync(ASSET_SONG_PATH)

    await sock.sendMessage(
      chatId,
      {
        ...(hasMenuImage ? { image: { url: ASSET_IMAGE_PATH } } : {}),
        caption: text,
        footer: `${SETTINGS.BOT_NAME} • by ${SETTINGS.OWNER_NAME}`,
        buttons: [
          { buttonId: '.system', buttonText: { displayText: '📊 System' }, type: 1 },
          { buttonId: '.limit', buttonText: { displayText: '🎟️ Limit' }, type: 1 },
          { buttonId: '.creator', buttonText: { displayText: '👤 Creator' }, type: 1 }
        ],
        headerType: 4
      },
      { quoted: message }
    )

    const followUps = []
    if (hasMenuAnimation) {
      followUps.push(
        sock.sendMessage(chatId, {
          video: { url: ASSET_ANIMATION_PATH },
          gifPlayback: true,
          caption: '✨ Menu animation'
        })
      )
    }

    if (hasMenuSong) {
      followUps.push(
        sock.sendMessage(chatId, {
          audio: { url: ASSET_SONG_PATH },
          mimetype: 'audio/wav',
          ptt: false
        })
      )
    }

    if (followUps.length) {
      Promise.allSettled(followUps).catch(() => {})
    }
  },

  settings: async ({ sock, chatId, message }) => {
    const text = [
      '*Bot Settings*',
      `Bot: ${SETTINGS.BOT_NAME}`,
      `Owner: ${SETTINGS.OWNER_NAME}`,
      `Owner numbers: ${SETTINGS.OWNER_NUMBERS.join(', ') || '-'}`,
      `Public mode: ${publicMode}`,
      `Anti-call: ${SETTINGS.TOGGLES.ANTI_CALL}`,
      `Call block: ${SETTINGS.TOGGLES.CALL_BLOCK}`,
      `Auto react group: ${SETTINGS.TOGGLES.AUTO_REACT_GROUP}`,
      `Private mode: ${SETTINGS.TOGGLES.PRIVATE_MODE}`,
      `Save status: ${SETTINGS.TOGGLES.SAVE_STATUS}`,
      `Anti status delete: ${SETTINGS.TOGGLES.ANTI_STATUS_DELETE}`,
      `Anti delete: ${SETTINGS.TOGGLES.ANTI_DELETE}`,
      `Sticker pack: ${SETTINGS.STICKER_PACKNAME}`,
      `Sticker author: ${SETTINGS.STICKER_AUTHOR}`
    ].join('\n')

    await sock.sendMessage(chatId, { text }, { quoted: message })
  },

  creator: async ({ sock, chatId, message }) => {
    const number = SETTINGS.CREATOR_NUMBER
    await sock.sendMessage(
      chatId,
      {
        contacts: {
          displayName: SETTINGS.OWNER_NAME,
          contacts: [
            {
              displayName: SETTINGS.OWNER_NAME,
              vcard: [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${SETTINGS.OWNER_NAME}`,
                `TEL;type=CELL;type=VOICE;waid=${number}:${number}`,
                'END:VCARD'
              ].join('\n')
            }
          ]
        }
      },
      { quoted: message }
    )
    await sock.sendMessage(chatId, { text: `Creator: https://wa.me/${number}` }, { quoted: message })
  },

  system: async ({ sock, chatId, message }) => {
    const up = process.uptime()
    const mem = process.memoryUsage()
    const text = [
      '*System*',
      `Platform: ${process.platform}`,
      `Node: ${process.version}`,
      `Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${Math.floor(up % 60)}s`,
      `RAM used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `RAM total: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`
    ].join('\n')
    await sock.sendMessage(chatId, { text }, { quoted: message })
  },

  runtime: async ({ sock, chatId, message }) => {
    const up = process.uptime()
    const text = [
      '*Runtime*',
      `Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${Math.floor(up % 60)}s`,
      `Date: ${new Date().toISOString()}`,
      `Node: ${process.version}`
    ].join('\n')
    await sock.sendMessage(chatId, { text }, { quoted: message })
  },

  private: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .private true|false')

    SETTINGS.TOGGLES.PRIVATE_MODE = value
    publicMode = !value
    await sock.sendMessage(chatId, { text: `Private mode ${yesNo(value)}.` }, { quoted: message })
  },

  autoreact: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .autoreact true|false')

    SETTINGS.TOGGLES.AUTO_REACT_GROUP = value
    await sock.sendMessage(chatId, { text: `Auto react group ${yesNo(value)}.` }, { quoted: message })
  },

  savestatus: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .savestatus true|false')

    SETTINGS.TOGGLES.SAVE_STATUS = value
    await sock.sendMessage(chatId, { text: `Save status ${yesNo(value)}.` }, { quoted: message })
  },

  antidelete: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .antidelete true|false')

    SETTINGS.TOGGLES.ANTI_DELETE = value
    await sock.sendMessage(chatId, { text: `Anti delete ${yesNo(value)}.` }, { quoted: message })
  },

  antistatusdel: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .antistatusdel true|false')

    SETTINGS.TOGGLES.ANTI_STATUS_DELETE = value
    await sock.sendMessage(chatId, { text: `Anti status delete ${yesNo(value)}.` }, { quoted: message })
  },

  getpp: async ({ sock, chatId, message, args }) => {
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .getpp <number>')

    const jid = `${number}@s.whatsapp.net`
    const imageUrl = await sock.profilePictureUrl(jid, 'image')
    await sock.sendMessage(chatId, { image: { url: imageUrl }, caption: `Profile picture: ${number}` }, { quoted: message })
  },

  limit: async ({ sock, chatId, message, senderJid }) => {
    if (isOwner(senderJid)) {
      await sock.sendMessage(chatId, { text: 'Owner has unlimited limit.' }, { quoted: message })
      return
    }

    const state = await getUserLimitState(senderJid)
    await sock.sendMessage(
      chatId,
      { text: `Limit: ${state.limit}\nReset: ${toDateString(state.resetAt)}` },
      { quoted: message }
    )
  },

  addlimit: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    const amount = Number(args[1])
    if (!number || Number.isNaN(amount)) throw new Error('Usage: .addlimit <number> <amount>')

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    state.limit += amount
    await writeUserLimitState(state)
    await sock.sendMessage(chatId, { text: `Limit ${number}: ${state.limit}` }, { quoted: message })
  },

  setlimit: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    const amount = Number(args[1])
    if (!number || Number.isNaN(amount)) throw new Error('Usage: .setlimit <number> <amount>')

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    state.limit = amount
    await writeUserLimitState(state)
    await sock.sendMessage(chatId, { text: `Limit ${number} set to ${state.limit}` }, { quoted: message })
  },

  resetlimit: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .resetlimit <number>')

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    state.limit = SETTINGS.DEFAULT_LIMIT
    state.resetAt = nextResetDate()
    await writeUserLimitState(state)
    await sock.sendMessage(chatId, { text: `Limit ${number} reset to ${state.limit}` }, { quoted: message })
  },

  premium: async ({ sock, chatId, message, senderJid }) => {
    if (isOwner(senderJid)) {
      await sock.sendMessage(chatId, { text: 'Owner is premium by default.' }, { quoted: message })
      return
    }

    const state = await getUserLimitState(senderJid)
    const premiumText = state.premium
      ? `Premium: true\nExpire: ${state.premiumExpireAt ? toDateString(state.premiumExpireAt) : 'never'}`
      : 'Premium: false'
    await sock.sendMessage(chatId, { text: premiumText }, { quoted: message })
  },

  addprem: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')

    const number = (args[0] || '').replace(/[^0-9]/g, '')
    const days = Number(args[1])
    if (!number || Number.isNaN(days) || days <= 0) {
      throw new Error('Usage: .addprem <number> <days>')
    }

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    const expire = new Date()
    expire.setDate(expire.getDate() + days)
    state.premium = true
    state.premiumExpireAt = expire
    await writeUserLimitState(state)

    await sock.sendMessage(chatId, { text: `Premium added for ${number} until ${toDateString(expire)}.` }, { quoted: message })
  },

  delprem: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')

    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .delprem <number>')

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    state.premium = false
    state.premiumExpireAt = null
    await writeUserLimitState(state)

    await sock.sendMessage(chatId, { text: `Premium removed from ${number}.` }, { quoted: message })
  },

  premset: async ({ sock, chatId, message, senderJid, args }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    const days = Number(args[1])
    if (!number || Number.isNaN(days)) throw new Error('Usage: .premset <number> <days>')

    const state = await getUserLimitState(`${number}@s.whatsapp.net`)
    if (days <= 0) {
      state.premium = false
      state.premiumExpireAt = null
      await writeUserLimitState(state)
      await sock.sendMessage(chatId, { text: `Premium disabled for ${number}.` }, { quoted: message })
      return
    }

    const expire = new Date()
    expire.setDate(expire.getDate() + days)
    state.premium = true
    state.premiumExpireAt = expire
    await writeUserLimitState(state)
    await sock.sendMessage(chatId, { text: `Premium set for ${number} until ${toDateString(expire)}.` }, { quoted: message })
  },

  listprem: async ({ sock, chatId, message, senderJid }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')

    const users = []
    userLimitCache.forEach(value => {
      if (value.premium) users.push(`${value.userId} (until ${value.premiumExpireAt ? toDateString(value.premiumExpireAt) : 'never'})`)
    })

    await sock.sendMessage(
      chatId,
      { text: users.length ? `Premium users:\n${users.join('\n')}` : 'No premium users in cache yet.' },
      { quoted: message }
    )
  },

  ping: ({ sock, chatId, message }) => sock.sendMessage(chatId, { text: 'pong 🟢' }, { quoted: message }),

  callblock: async ({ sock, senderJid, chatId, args, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const mode = args[0]
    if (!['on', 'off'].includes(mode)) throw new Error('Usage: .callblock on|off')
    SETTINGS.TOGGLES.ANTI_CALL = mode === 'on'
    SETTINGS.TOGGLES.CALL_BLOCK = mode === 'on'
    await sock.sendMessage(chatId, { text: `Call block ${mode}.` }, { quoted: message })
  },

  fullpp: async ({ sock, senderJid, chatId, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const quoted = getQuoted(message)
    const qCtx = message.message?.extendedTextMessage?.contextInfo
    if (!quoted?.imageMessage || !qCtx) {
      throw new Error('Reply to an image with .fullpp')
    }

    const wrappedMessage = {
      key: {
        remoteJid: chatId,
        fromMe: false,
        id: qCtx.stanzaId,
        participant: qCtx.participant
      },
      message: quoted
    }

    const buffer = await toBuffer(wrappedMessage, sock)
    await sock.updateProfilePicture(sock.user.id, buffer)
    await sock.sendMessage(chatId, { text: 'Bot profile picture updated.' }, { quoted: message })
  },

  onceview: async ({ sock, chatId, message }) => {
    const quoted = getQuoted(message)
    if (!quoted) throw new Error('Reply to a view-once message with .onceview')

    const vo = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessageV2Extension?.message
    if (!vo) throw new Error('Quoted message is not a view-once message.')

    if (vo.imageMessage) {
      await sock.sendMessage(chatId, { image: { url: vo.imageMessage.url }, caption: vo.imageMessage.caption || '' }, { quoted: message })
      return
    }

    if (vo.videoMessage) {
      await sock.sendMessage(chatId, { video: { url: vo.videoMessage.url }, caption: vo.videoMessage.caption || '' }, { quoted: message })
      return
    }

    throw new Error('Unsupported view-once message type.')
  },

  block: async ({ sock, senderJid, args, chatId, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .block <number>')
    await sock.updateBlockStatus(`${number}@s.whatsapp.net`, 'block')
    await sock.sendMessage(chatId, { text: `Blocked ${number}` }, { quoted: message })
  },

  unblock: async ({ sock, senderJid, args, chatId, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .unblock <number>')
    await sock.updateBlockStatus(`${number}@s.whatsapp.net`, 'unblock')
    await sock.sendMessage(chatId, { text: `Unblocked ${number}` }, { quoted: message })
  },

  public: async ({ sock, senderJid, chatId, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    publicMode = true
    await sock.sendMessage(chatId, { text: 'Bot mode: public' }, { quoted: message })
  },

  self: async ({ sock, senderJid, chatId, message }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    publicMode = false
    await sock.sendMessage(chatId, { text: 'Bot mode: self' }, { quoted: message })
  },

  tagall: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const mentions = groupMetadata.participants.map(item => item.id)
    const body = mentions.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n')
    await sock.sendMessage(chatId, { text: `*Tag All*\n\n${body}`, mentions }, { quoted: message })
  },

  hidetag: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const text = args.join(' ') || 'Hidetag message.'
    const mentions = groupMetadata.participants.map(item => item.id)
    await sock.sendMessage(chatId, { text, mentions }, { quoted: message })
  },

  group: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const mode = args[0]
    if (!['open', 'close'].includes(mode)) throw new Error('Use `.group open` or `.group close`')
    await sock.groupSettingUpdate(chatId, mode === 'open' ? 'not_announcement' : 'announcement')
    await sock.sendMessage(chatId, { text: `Group is now ${mode}.` }, { quoted: message })
  },

  linkgroup: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const code = await sock.groupInviteCode(chatId)
    await sock.sendMessage(chatId, { text: `https://chat.whatsapp.com/${code}` }, { quoted: message })
  },

  revoke: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const code = await sock.groupRevokeInvite(chatId)
    await sock.sendMessage(chatId, { text: `New link: https://chat.whatsapp.com/${code}` }, { quoted: message })
  },

  setsubject: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const text = args.join(' ')
    if (!text) throw new Error('Usage: .setsubject <text>')
    await sock.groupUpdateSubject(chatId, text)
    await sock.sendMessage(chatId, { text: 'Group subject updated.' }, { quoted: message })
  },

  setdesc: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const text = args.join(' ')
    if (!text) throw new Error('Usage: .setdesc <text>')
    await sock.groupUpdateDescription(chatId, text)
    await sock.sendMessage(chatId, { text: 'Group description updated.' }, { quoted: message })
  },

  promote: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const target = pickMentionedOrReply(message)
    if (!target) throw new Error('Reply/mention target user.')
    await sock.groupParticipantsUpdate(chatId, [target], 'promote')
  },

  demote: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const target = pickMentionedOrReply(message)
    const setting = await getGroupProtection(chatId)
    if (!target) throw new Error('Reply/mention target user.')
    if (setting.ownerprotect && isOwner(target)) throw new Error('Owner protection active.')
    await sock.groupParticipantsUpdate(chatId, [target], 'demote')
  },

  kick: async ({ sock, chatId, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const target = pickMentionedOrReply(message)
    const setting = await getGroupProtection(chatId)
    if (!target) throw new Error('Reply/mention target user.')
    if (setting.ownerprotect && isOwner(target)) throw new Error('Owner protection active.')
    await sock.groupParticipantsUpdate(chatId, [target], 'remove')
  },

  add: async ({ sock, chatId, args, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    if (!number) throw new Error('Usage: .add <number>')
    await sock.groupParticipantsUpdate(chatId, [`${number}@s.whatsapp.net`], 'add')
  },

  antilink: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .antilink true|false')
    const setting = await updateGroupProtection(chatId, draft => {
      draft.antilink = value
    })
    await sock.sendMessage(chatId, { text: `Antilink ${yesNo(setting.antilink)}.` }, { quoted: message })
  },

  antibadword: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .antibadword true|false')
    const setting = await updateGroupProtection(chatId, draft => {
      draft.antibadword = value
    })
    await sock.sendMessage(chatId, { text: `Antibadword ${yesNo(setting.antibadword)}.` }, { quoted: message })
  },

  antispam: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    ensureGroupAdminAccess({ chatId, senderJid, groupMetadata })
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .antispam true|false')
    const setting = await updateGroupProtection(chatId, draft => {
      draft.antispam = value
    })
    await sock.sendMessage(chatId, { text: `Antispam ${yesNo(setting.antispam)}.` }, { quoted: message })
  },

  ownerprotect: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    if (!isGroupJid(chatId)) throw new Error('Group only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .ownerprotect true|false')
    const setting = await updateGroupProtection(chatId, draft => {
      draft.ownerprotect = value
    })
    await sock.sendMessage(chatId, { text: `Owner protect ${yesNo(setting.ownerprotect)}.` }, { quoted: message })
  },

  onlyadmincmd: async ({ sock, chatId, args, message, groupMetadata, senderJid }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    if (!isGroupJid(chatId)) throw new Error('Group only command.')
    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .onlyadmincmd true|false')
    const setting = await updateGroupProtection(chatId, draft => {
      draft.onlyadmincmd = value
    })
    await sock.sendMessage(chatId, { text: `Only admin cmd ${yesNo(setting.onlyadmincmd)}.` }, { quoted: message })
  },

  groupprotect: async ({ sock, chatId, args, message, senderJid }) => {
    if (!isOwner(senderJid)) throw new Error('Owner only command.')
    if (!isGroupJid(chatId)) throw new Error('Group only command.')

    const value = parseBooleanToggle(args[0])
    if (value === null) throw new Error('Usage: .groupprotect true|false')

    await updateGroupProtection(chatId, setting => {
      setting.antilink = value
      setting.antibadword = value
      setting.antispam = value
      setting.ownerprotect = value
      setting.onlyadmincmd = value
    })

    await sock.sendMessage(
      chatId,
      { text: `Group protect ${yesNo(value)} (all protection toggles updated).` },
      { quoted: message }
    )
  },

  protect: async ({ sock, chatId, message }) => {
    const s = await getGroupProtection(chatId)
    await sock.sendMessage(
      chatId,
      { text: `antilink:${s.antilink}\nantibadword:${s.antibadword}\nantispam:${s.antispam}\nownerprotect:${s.ownerprotect}\nonlyadmincmd:${s.onlyadmincmd}` },
      { quoted: message }
    )
  },

  sticker: async ({ sock, message, chatId }) => {
    const context = message.message?.extendedTextMessage?.contextInfo
    const quoted = context?.quotedMessage
    if (!quoted) throw new Error('Reply to image/video with `.sticker`.')

    const wrappedMessage = {
      key: { remoteJid: chatId, fromMe: false, id: context.stanzaId, participant: context.participant },
      message: quoted
    }

    const mediaBuffer = await toBuffer(wrappedMessage, sock)
    await sock.sendMessage(
      chatId,
      { sticker: mediaBuffer, packname: SETTINGS.STICKER_PACKNAME, author: SETTINGS.STICKER_AUTHOR },
      { quoted: message }
    )
  },

  toimg: async ({ sock, message, chatId }) => {
    const context = message.message?.extendedTextMessage?.contextInfo
    const quoted = context?.quotedMessage
    if (!quoted?.stickerMessage) throw new Error('Reply to sticker with `.toimg`.')

    const wrappedMessage = {
      key: { remoteJid: chatId, fromMe: false, id: context.stanzaId, participant: context.participant },
      message: quoted
    }

    const buffer = await toBuffer(wrappedMessage, sock)
    await sock.sendMessage(chatId, { image: buffer, caption: 'Converted sticker to image.' }, { quoted: message })
  },

  tourl: async ({ sock, message, chatId }) => {
    const quoted = getQuoted(message)
    if (!quoted) throw new Error('Reply to media with `.tourl`.')

    const media =
      quoted.imageMessage ||
      quoted.videoMessage ||
      quoted.audioMessage ||
      quoted.documentMessage ||
      quoted.stickerMessage

    const mediaUrl = media?.url
    if (!mediaUrl) throw new Error('No media URL found in quoted message.')

    await sock.sendMessage(chatId, { text: `Media URL:\n${mediaUrl}` }, { quoted: message })
  },

  emoji: async ({ sock, chatId, message, args }) => {
    const symbol = args[0]
    if (!symbol) throw new Error('Usage: .emoji <emoji>')
    const codepoint = [...symbol].map(ch => ch.codePointAt(0).toString(16)).join('-')
    const imageUrl = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${codepoint}.png`
    await sock.sendMessage(chatId, { image: { url: imageUrl }, caption: `Emoji: ${symbol}` }, { quoted: message })
  },

  emojimix: async ({ sock, chatId, message, args }) => {
    const raw = args.join(' ')
    const [a, b] = raw.split('+').map(v => (v || '').trim())
    if (!a || !b) throw new Error('Usage: .emojimix <emoji1>+<emoji2>')

    const q = `q=${encodeURIComponent(a)}_${encodeURIComponent(b)}`
    const imageUrl = `https://emojik.vercel.app/s/${q}`
    await sock.sendMessage(chatId, { image: { url: imageUrl }, caption: `${a} + ${b}` }, { quoted: message })
  },

  joke: async ({ sock, chatId, message }) => {
    const data = normalizeResult(await api.fun.joke())
    await sock.sendMessage(chatId, { text: data.joke || data.result || JSON.stringify(data) }, { quoted: message })
  },

  meme: async ({ sock, chatId, message }) => {
    const data = normalizeResult(await api.fun.meme())
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },

  truth: async ({ sock, chatId, message }) => {
    const data = normalizeResult(await api.fun.truth())
    await sock.sendMessage(chatId, { text: data.result || data.truth || JSON.stringify(data) }, { quoted: message })
  },

  dare: async ({ sock, chatId, message }) => {
    const data = normalizeResult(await api.fun.dare())
    await sock.sendMessage(chatId, { text: data.result || data.dare || JSON.stringify(data) }, { quoted: message })
  },

  rate: async ({ sock, args, chatId, message }) => {
    const text = args.join(' ')
    await sock.sendMessage(chatId, { text: `⭐ ${text || 'random'}: ${Math.floor(Math.random() * 101)}/100` }, { quoted: message })
  },

  math: ({ sock, chatId, message, senderJid }) => {
    const quiz = createQuiz()
    activeMathGames.set(senderJid, quiz.answer)
    return sock.sendMessage(chatId, { text: `Solve: ${quiz.question}\nUse .guess` }, { quoted: message })
  },

  guess: ({ sock, args, chatId, message, senderJid }) => {
    const answer = activeMathGames.get(senderJid)
    if (answer === undefined) throw new Error('Use .math first.')
    if (String(args[0] || '') === String(answer)) {
      activeMathGames.delete(senderJid)
      return sock.sendMessage(chatId, { text: 'Correct ✅' }, { quoted: message })
    }

    return sock.sendMessage(chatId, { text: 'Wrong ❌' }, { quoted: message })
  },

  quiz: async ({ sock, chatId, message, senderJid }) => {
    const q = createQuiz()
    activeQuizGames.set(senderJid, q.answer)
    await sock.sendMessage(chatId, { text: `Quiz: ${q.question}\nUse .answer` }, { quoted: message })
  },

  answer: async ({ sock, chatId, args, message, senderJid }) => {
    const answer = activeQuizGames.get(senderJid)
    if (!answer) throw new Error('Use .quiz first.')
    if (String(args[0] || '') === String(answer)) {
      activeQuizGames.delete(senderJid)
      await sock.sendMessage(chatId, { text: 'Quiz correct 🏆' }, { quoted: message })
      return
    }

    await sock.sendMessage(chatId, { text: 'Quiz wrong ❌' }, { quoted: message })
  },

  coinflip: ({ sock, chatId, message }) =>
    sock.sendMessage(chatId, { text: `Coin: ${Math.random() > 0.5 ? 'Heads' : 'Tails'}` }, { quoted: message }),

  slot: ({ sock, chatId, message }) => {
    const icons = ['🍒', '🍋', '🍇', '7️⃣', '⭐']
    const row = [0, 1, 2].map(() => icons[Math.floor(Math.random() * icons.length)])
    return sock.sendMessage(chatId, { text: `🎰 ${row.join(' | ')}` }, { quoted: message })
  },

  wastalk: async ({ sock, args, chatId, message }) => {
    const number = (args[0] || '').replace(/[^0-9]/g, '')
    const jid = `${number}@s.whatsapp.net`
    const exists = await sock.onWhatsApp(jid)
    const found = Array.isArray(exists) ? exists[0] : exists
    await sock.sendMessage(chatId, { text: `Number: ${number}\nExists: ${Boolean(found?.exists)}` }, { quoted: message })
  },

  igstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.instagram(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },
  ttstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.tiktok(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },
  ghstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.github(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },
  npmstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.npm(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },
  mlstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.ml(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  },
  ffstalk: async ({ sock, args, chatId, message }) => {
    const data = normalizeResult(await api.stalker.ff(args[0]))
    await sock.sendMessage(chatId, { text: JSON.stringify(data) }, { quoted: message })
  }
}

const enforceProtection = async ({ sock, message, body, groupMetadata }) => {
  const chatId = message.key.remoteJid
  if (!isGroupJid(chatId) || !body) return

  const senderJid = getSenderJid(message)
  if (isOwner(senderJid) || isAdmin(groupMetadata, senderJid)) return

  const setting = await getGroupProtection(chatId)
  const lowered = body.toLowerCase()

  if (setting.antilink && /(https?:\/\/|chat\.whatsapp\.com)/i.test(body)) {
    await sock.sendMessage(chatId, { text: `@${getSenderNumber(senderJid)} link is not allowed.`, mentions: [senderJid] }, { quoted: message })
    await sock.groupParticipantsUpdate(chatId, [senderJid], 'remove')
    return
  }

  if (setting.antibadword) {
    const badWords = ['anjing', 'babi', 'kontol', 'tolol', 'fuck']
    if (badWords.some(word => lowered.includes(word))) {
      await sock.sendMessage(chatId, { text: `@${getSenderNumber(senderJid)} bad word detected.`, mentions: [senderJid] }, { quoted: message })
      await sock.groupParticipantsUpdate(chatId, [senderJid], 'remove')
      return
    }
  }

  if (setting.antispam) {
    const now = Date.now()
    const key = `${chatId}:${senderJid}`
    const recent = (antiSpam.get(key) || []).filter(time => now - time < 8000)
    recent.push(now)
    antiSpam.set(key, recent)

    if (recent.length >= 6) {
      await sock.sendMessage(chatId, { text: `@${getSenderNumber(senderJid)} spam detected.`, mentions: [senderJid] }, { quoted: message })
      await sock.groupParticipantsUpdate(chatId, [senderJid], 'remove')
    }
  }
}

const runCommand = async ({ sock, message, body, groupMetadata }) => {
  const senderJid = getSenderJid(message)
  const chatId = message.key.remoteJid

  if (!publicMode && !isOwner(senderJid)) return false

  const { command, args } = parseCommand(body)
  if (!command) return false

  const setting = isGroupJid(chatId) ? await getGroupProtection(chatId) : undefined
  if (setting?.onlyadmincmd && !isOwner(senderJid) && !isAdmin(groupMetadata, senderJid)) {
    throw new Error('Only admin can use command in this group.')
  }

  const handler = commandHandlers[command]
  if (!handler) return false

  if (!isOwner(senderJid) && !LIMIT_FREE_COMMANDS.has(command)) {
    const state = await getUserLimitState(senderJid)

    if (state.premium && state.premiumExpireAt && new Date(state.premiumExpireAt).getTime() <= Date.now()) {
      state.premium = false
      state.premiumExpireAt = null
      await writeUserLimitState(state)
    }

    if (state.premium) {
      await handler({ sock, message, chatId, senderJid, args, groupMetadata })
      return true
    }

    if (new Date(state.resetAt).getTime() <= Date.now()) {
      state.limit = SETTINGS.DEFAULT_LIMIT
      state.resetAt = nextResetDate()
    }

    if (state.limit <= 0) {
      throw new Error(`Your command limit is exhausted. Reset on ${toDateString(state.resetAt)}.`)
    }

    state.limit -= 1
    await writeUserLimitState(state)
  }

  await handler({ sock, message, chatId, senderJid, args, groupMetadata })
  return true
}

module.exports = { runCommand, enforceProtection, isOwner }
