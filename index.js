require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');
if (!API_KEY) throw new Error('API_KEY fehlt');

const app = express();
app.use(express.json({ limit: '1mb' }));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

function requireApiKey(req, res) {
  if (req.headers['x-api-key'] !== API_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function fetchGuild() {
  return client.guilds.fetch(GUILD_ID);
}

async function fetchMember(discordId) {
  const guild = await fetchGuild();
  return guild.members.fetch(String(discordId).trim());
}

function uniq(values) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))];
}

async function applyMemberState(member, payload) {
  const preserveRoleIds = uniq(payload.preserveRoleIds);
  const removeRoleIds = uniq(payload.removeRoleIds);
  const addRoleIds = uniq(payload.addRoleIds).filter(roleId => !removeRoleIds.includes(roleId));
  const result = { removedRoleIds: [], addedRoleIds: [], preservedRoleIds: preserveRoleIds, failedRemovals: [], failedAdditions: [], nicknameUpdated: false };

  if (payload.removeAllRoles) {
    await member.fetch(true);
    const removableRoleIds = member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .filter(role => !preserveRoleIds.includes(role.id))
      .filter(role => !role.managed)
      .map(role => role.id);

    for (const roleId of removableRoleIds) {
      if (member.roles.cache.has(roleId)) {
        try { await member.roles.remove(roleId); result.removedRoleIds.push(roleId); } catch (err) { result.failedRemovals.push({ roleId, error: err.message }); console.log('remove all roles failed', roleId, err.message); }
      }
    }
  }

  await member.fetch(true);

  for (const roleId of removeRoleIds) {
    if (preserveRoleIds.includes(roleId)) continue;
    if (member.roles.cache.has(roleId)) {
      try { await member.roles.remove(roleId); result.removedRoleIds.push(roleId); } catch (err) { result.failedRemovals.push({ roleId, error: err.message }); console.log('remove role failed', roleId, err.message); }
    }
  }

  await member.fetch(true);

  for (const roleId of addRoleIds) {
    if (!member.roles.cache.has(roleId)) {
      try { await member.roles.add(roleId); result.addedRoleIds.push(roleId); } catch (err) { result.failedAdditions.push({ roleId, error: err.message }); console.log('add role failed', roleId, err.message); }
    }
  }

  if (payload.nickname) {
    try { await member.setNickname(String(payload.nickname).slice(0, 32)); result.nicknameUpdated = true; } catch (err) { result.nicknameError = err.message; console.log('nickname failed', err.message); }
  }

  return result;
}

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Bot läuft', ready: client.isReady() });
});

app.get('/roles', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot startet noch. Bitte erneut versuchen.' });

    const guild = await fetchGuild();
    await guild.roles.fetch();

    const roles = guild.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => ({ id: role.id, name: role.name, position: role.position, managed: role.managed }))
      .sort((a, b) => b.position - a.position);

    res.json({ success: true, roles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/set-member-state', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot startet noch. Bitte erneut versuchen.' });

    const { discordId } = req.body || {};
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });

    const member = await fetchMember(discordId);
    const result = await applyMemberState(member, req.body || {});

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/dismiss', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot startet noch. Bitte erneut versuchen.' });

    const { discordId } = req.body || {};
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });

    const member = await fetchMember(discordId);
    const result = await applyMemberState(member, req.body || {});

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('API läuft auf Port ' + PORT);
});

client.once('ready', () => {
  console.log('Bot ready als ' + client.user.tag);
});

client.login(BOT_TOKEN);
