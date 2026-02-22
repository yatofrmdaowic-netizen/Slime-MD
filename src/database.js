const mongoose = require('mongoose')
const { SETTINGS } = require('../settings')

const DEFAULT_GROUP_SETTINGS = {
  antilink: false,
  antibadword: false,
  antispam: false,
  ownerprotect: true,
  onlyadmincmd: false
}

const groupSettingsSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    antilink: { type: Boolean, default: DEFAULT_GROUP_SETTINGS.antilink },
    antibadword: { type: Boolean, default: DEFAULT_GROUP_SETTINGS.antibadword },
    antispam: { type: Boolean, default: DEFAULT_GROUP_SETTINGS.antispam },
    ownerprotect: { type: Boolean, default: DEFAULT_GROUP_SETTINGS.ownerprotect },
    onlyadmincmd: { type: Boolean, default: DEFAULT_GROUP_SETTINGS.onlyadmincmd }
  },
  { versionKey: false, timestamps: true }
)

const userLimitSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    limit: { type: Number, default: SETTINGS.DEFAULT_LIMIT },
    resetAt: { type: Date, required: true },
    premium: { type: Boolean, default: false },
    premiumExpireAt: { type: Date, default: null }
  },
  { versionKey: false, timestamps: true }
)

const GroupSettings = mongoose.models.GroupSettings || mongoose.model('GroupSettings', groupSettingsSchema)
const UserLimit = mongoose.models.UserLimit || mongoose.model('UserLimit', userLimitSchema)

let dbEnabled = false
let connecting = false

const nextResetDate = () => {
  const now = new Date()
  const reset = new Date(now)
  reset.setHours(24, 0, 0, 0)
  return reset
}

const initDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI || ''
  if (!mongoUri) {
    console.log('⚠️ MONGODB_URI is not set, running with in-memory group protection settings.')
    dbEnabled = false
    return false
  }

  if (mongoose.connection.readyState === 1) {
    dbEnabled = true
    return true
  }

  if (connecting) return false

  connecting = true
  try {
    await mongoose.connect(mongoUri, {
      autoIndex: true
    })
    dbEnabled = true
    console.log('✅ MongoDB connected')
    return true
  } catch (error) {
    dbEnabled = false
    console.log(`⚠️ MongoDB connection failed: ${error.message}`)
    return false
  } finally {
    connecting = false
  }
}

const loadGroupSettings = async chatId => {
  if (!dbEnabled) return { ...DEFAULT_GROUP_SETTINGS }

  const data = await GroupSettings.findOne({ chatId }).lean()
  return data ? { ...DEFAULT_GROUP_SETTINGS, ...data } : { ...DEFAULT_GROUP_SETTINGS }
}

const saveGroupSettings = async (chatId, settings) => {
  if (!dbEnabled) return

  const payload = {
    antilink: settings.antilink,
    antibadword: settings.antibadword,
    antispam: settings.antispam,
    ownerprotect: settings.ownerprotect,
    onlyadmincmd: settings.onlyadmincmd
  }

  await GroupSettings.updateOne({ chatId }, { $set: payload }, { upsert: true })
}

const loadUserLimit = async userId => {
  if (!dbEnabled) {
    return {
      userId,
      limit: SETTINGS.DEFAULT_LIMIT,
      resetAt: nextResetDate(),
      premium: false,
      premiumExpireAt: null
    }
  }

  const existing = await UserLimit.findOne({ userId })
  if (!existing) {
    const created = await UserLimit.create({
      userId,
      limit: SETTINGS.DEFAULT_LIMIT,
      resetAt: nextResetDate(),
      premium: false,
      premiumExpireAt: null
    })
    return created.toObject()
  }

  if (existing.premium && existing.premiumExpireAt && new Date(existing.premiumExpireAt).getTime() <= Date.now()) {
    existing.premium = false
    existing.premiumExpireAt = null
  }

  if (new Date(existing.resetAt).getTime() <= Date.now()) {
    existing.limit = SETTINGS.DEFAULT_LIMIT
    existing.resetAt = nextResetDate()
    await existing.save()
  }

  return existing.toObject()
}

const saveUserLimit = async (userId, limit, resetAt, premium = false, premiumExpireAt = null) => {
  if (!dbEnabled) return

  await UserLimit.updateOne(
    { userId },
    { $set: { limit, resetAt, premium, premiumExpireAt } },
    { upsert: true }
  )
}

module.exports = {
  initDatabase,
  loadGroupSettings,
  saveGroupSettings,
  loadUserLimit,
  saveUserLimit,
  DEFAULT_GROUP_SETTINGS,
  nextResetDate
}
