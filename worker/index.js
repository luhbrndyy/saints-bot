'use strict';
// SAINTS — Termux single-device bot (pairing-code only)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidDecode,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');
const { smsg } = require('./myfunc');

const BOT_NAME = 'SAINTS';
const BOT_PIC = process.env.BOT_PIC || '';
const SESSION_DIR = path.join(__dirname, 'sessions', 'main');
const SETTINGS_FILE = path.join(__dirname, 'settings', 'main.json');

for (const d of ['sessions', 'settings', 'database', 'Func', 'm']) {
  fs.mkdirSync(path.join(__dirname, d), { recursive: true });
}
if (!fs.existsSync(path.join(__dirname, 'database', 'premium.json'))) {
  fs.writeFileSync(path.join(__dirname, 'database', 'premium.json'), '[]');
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { public: true }; }
}
function saveSettings(patch) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...loadSettings(), ...patch }, null, 2)); } catch {}
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

let retries = 0;

async function promptNumber() {
  for (;;) {
    const raw = (await ask('\nEnter WhatsApp number with country code (digits only, e.g. 50912345678): ')).trim();
    const clean = raw.replace(/\D/g, '');
    if (clean.length >= 8) return clean;
    console.log('  ✗ too short, try again.');
  }
}

async function start(number) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const sock = makeWASocket({
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    generateHighQualityLinkPreview: true,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    logger: pino({ level: 'silent' }),
    auth: state
  });

  const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) });
  store.bind(sock.ev);

  setInterval(() => {
    try { store.messages?.clear?.(); store.chats?.clear?.(); } catch {}
  }, 3600000);

  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const d = jidDecode(jid) || {};
      return (d.user && d.server && `${d.user}@${d.server}`) || jid;
    }
    return jid;
  };

  sock.sendText = (jid, text, quoted = '', options) =>
    sock.sendMessage(jid, { text, ...options }, { quoted });

  sock.public = loadSettings().public !== false;
  sock.saveSetting = (k, v) => saveSettings({ [k]: v });

  let node, attrs;
  sock.ws.on('CB:message', (n) => { node = n.content; attrs = n.attrs; });

  sock.ev.on('messages.upsert', async (u) => {
    try {
      const mek = u.messages[0];
      if (!mek.message) return;
      mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message
        : mek.message;
      if (mek.key?.remoteJid === 'status@broadcast') sock.readMessages([mek.key]);
      if (!sock.public && !mek.key.fromMe && u.type === 'notify') return;
      if (mek.key.id.startsWith('D5PRIMIS') && mek.key.id.length === 16) return;

      let m = smsg(sock, mek, store);
      m = { ...m, attributs: attrs, node };
      require('./squichy.js')(sock, m, u, store);
    } catch {}
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('error', () => {});

  sock.ev.on('connection.update', async (upd) => {
    const { connection, lastDisconnect } = upd;

    if (connection === 'open') {
      retries = 0;
      console.log(`\n✅ ${BOT_NAME} connected as +${sock.user?.id?.split(':')[0] || '?'}`);
      console.log('Send !menu in any chat.\n');
      if (BOT_PIC) {
        try { await sock.updateProfilePicture(sock.user.id, { url: BOT_PIC }); } catch {}
      }
      try { await sock.updateProfileStatus(`${BOT_NAME} | 🐐 Brndyy is a GOAT`); } catch {}
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        console.log('❌ Logged out. Restart to pair again.');
        process.exit(0);
      }
      retries++;
      if (retries >= 3) {
        console.log('❌ Could not reconnect. Restart the bot.');
        process.exit(1);
      }
      console.log(`⚠️ Closed — reconnecting (${retries}/3)...`);
      setTimeout(() => start(), 5000);
    }
  });

  // ---- pairing code ----
  if (!sock.authState.creds.registered) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const code = await sock.requestPairingCode(number);
        const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n────────────────────────────────');
        console.log(`   PAIRING CODE:  ${pretty}`);
        console.log('────────────────────────────────');
        console.log('WhatsApp → Linked Devices → Link with phone number');
        console.log('→ type the code above.\n');
        console.log('Code expired? Press Enter for a new one.');
        await ask('');
      } catch (e) {
        console.log(`\n✗ Code request failed (${e?.message || 'unknown'}).`);
        console.log('Press Enter to retry, or Ctrl+C and restart with a different number.');
        await ask('');
      }
    }
  }
}

process.on('uncaughtException', (e) => console.log('uncaught:', e?.message || e));
process.on('unhandledRejection', () => {});

(async () => {
  console.log(`\n${BOT_NAME} starting...`);
  const { state } = await useMultiFileAuthState(SESSION_DIR);
  const registered = !!state.creds.registered;
  const number = registered
    ? null
    : (process.argv[2]?.replace(/\D/g, '') || (await promptNumber()));
  await start(number).catch((e) => { console.error('Start failed:', e); process.exit(1); });
})();