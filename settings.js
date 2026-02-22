const SETTINGS = {
  BOT_NAME: process.env.BOT_NAME || 'Slime-MD',
  OWNER_NAME: process.env.OWNER_NAME || 'Owner',
  OWNER_NUMBERS: (process.env.OWNER_NUMBERS || '6281234567890')
    .split(',')
    .map(value => value.replace(/[^0-9]/g, ''))
    .filter(Boolean),
  CREATOR_NUMBER: (process.env.CREATOR_NUMBER || process.env.OWNER_NUMBERS || '6281234567890')
    .split(',')[0]
    .replace(/[^0-9]/g, ''),
  API_KEY: process.env.API_KEY || '',
  STICKER_PACKNAME: process.env.STICKER_PACKNAME || 'Slime-MD',
  STICKER_AUTHOR: process.env.STICKER_AUTHOR || 'Bot',
  DEFAULT_LIMIT: Number(process.env.DEFAULT_LIMIT || 25),
  TOGGLES: {
    PUBLIC_MODE: process.env.PUBLIC_MODE !== 'false',
    ANTI_CALL: process.env.ANTI_CALL === 'true',
    CALL_BLOCK: process.env.CALL_BLOCK !== 'false',
    AUTO_REACT_GROUP: process.env.AUTO_REACT_GROUP === 'true',
    PRIVATE_MODE: process.env.PRIVATE_MODE === 'true',
    SAVE_STATUS: process.env.SAVE_STATUS === 'true',
    ANTI_STATUS_DELETE: process.env.ANTI_STATUS_DELETE === 'true',
    ANTI_DELETE: process.env.ANTI_DELETE === 'true'
  }
}

module.exports = { SETTINGS }
