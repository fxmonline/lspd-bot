require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 3000);
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '';
const ERROR_CHANNEL_ID = process.env.ERROR_CHANNEL_ID || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);

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

async function sendChannelMessage(channelId, content) {
  if (!channelId || !client.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && typeof channel.send === 'function') await channel.send(content);
  } catch (err) {
    console.log('channel log failed', err.message);
  }
}

async function fetchMember(discordId) {
  const guild = await fetchGuild();
  return guild.members.fetch(String(discordId).trim());
}

function uniq(values) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))];
}

function roleIsManageable(guild, roleId) {
  const role = guild.roles.cache.get(String(roleId || '').trim());
  if (!role || role.managed) return false;
  const me = guild.members.me;
  return !!(me && me.roles.highest && me.roles.highest.position > role.position);
}

async function applyMemberState(member, payload) {
  await member.guild.roles.fetch();
  const preserveRoleIds = uniq(payload.preserveRoleIds);
  const removeRoleIds = uniq(payload.removeRoleIds);
  const addRoleIds = uniq(payload.addRoleIds).filter(roleId => !removeRoleIds.includes(roleId));
  const skippedRoles = [];

  if (payload.removeAllRoles) {
    await member.fetch(true);
    const removableRoleIds = member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .filter(role => !preserveRoleIds.includes(role.id))
      .filter(role => !role.managed)
      .filter(role => roleIsManageable(member.guild, role.id))
      .map(role => role.id);

    for (const roleId of removableRoleIds) {
      if (member.roles.cache.has(roleId)) {
        try { await member.roles.remove(roleId); } catch (err) { console.log('remove all roles failed', roleId, err.message); }
      }
    }
  }

  await member.fetch(true);

  for (const roleId of removeRoleIds) {
    if (preserveRoleIds.includes(roleId)) continue;
    if (member.roles.cache.has(roleId)) {
      try { await member.roles.remove(roleId); } catch (err) { console.log('remove role failed', roleId, err.message); }
    }
  }

  await member.fetch(true);

  for (const roleId of addRoleIds) {
    if (!member.roles.cache.has(roleId)) {
      if (!roleIsManageable(member.guild, roleId)) { skippedRoles.push({ roleId, action: 'add', reason: 'role not manageable / hierarchy' }); continue; }
      try { await member.roles.add(roleId); } catch (err) { skippedRoles.push({ roleId, action: 'add', reason: err.message }); console.log('add role failed', roleId, err.message); }
    }
  }

  await member.fetch(true);

  if (payload.nickname) {
    try { await member.setNickname(String(payload.nickname).slice(0, 32)); } catch (err) { skippedRoles.push({ action: 'nickname', reason: err.message }); console.log('nickname failed', err.message); }
  }

  await member.fetch(true);
  return { roleIds: member.roles.cache.filter(role => role.id !== member.guild.id && !role.managed).map(role => role.id), skippedRoles };
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
    await sendChannelMessage(ERROR_CHANNEL_ID, `❌ Botfehler /set-member-state: ${err.message}`);
    await sendChannelMessage(ERROR_CHANNEL_ID, `❌ Botfehler /dismiss: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post('/member-roles', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot startet noch. Bitte erneut versuchen.' });

    const { discordId } = req.body || {};
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });

    const member = await fetchMember(discordId);
    await member.fetch(true);
    const roleIds = member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .filter(role => !role.managed)
      .filter(role => roleIsManageable(member.guild, role.id))
      .map(role => role.id);

    res.json({ success: true, roleIds });
  } catch (err) {
    await sendChannelMessage(ERROR_CHANNEL_ID, `❌ Botfehler /member-roles: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});



app.post('/member-profile', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    if (!client.isReady()) return res.status(503).json({ success: false, error: 'Bot startet noch. Bitte erneut versuchen.' });

    const { discordId } = req.body || {};
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });

    const member = await fetchMember(discordId);
    await member.fetch(true);
    const user = member.user;
    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: false });
    const bannerUrl = typeof user.bannerURL === 'function' ? user.bannerURL({ extension: 'png', size: 1024 }) : null;
    const roleIds = member.roles.cache
      .filter(role => role.id !== member.guild.id)
      .map(role => role.id);

    res.json({ success: true, profile: {
      discordId: String(discordId),
      username: user.username || '',
      globalName: user.globalName || '',
      displayName: member.displayName || user.globalName || user.username || '',
      tag: user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username,
      avatarUrl,
      bannerUrl: bannerUrl || '',
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : '',
      roleIds
    }});
  } catch (err) {
    await sendChannelMessage(ERROR_CHANNEL_ID, `❌ Botfehler /member-profile: ${err.message}`);
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

    await sendChannelMessage(LOG_CHANNEL_ID, `✅ Rollenstatus aktualisiert für <@${discordId}>`);
    res.json({ success: true, roleIds: result.roleIds, skippedRoles: result.skippedRoles });
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

    res.json({ success: true, roleIds: result.roleIds, skippedRoles: result.skippedRoles });
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
