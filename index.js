require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 3000);
const EX_MEMBER_ROLE_ID = process.env.EX_MEMBER_ROLE_ID || '';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');
if (!API_KEY) throw new Error('API_KEY fehlt');

const app = express();
app.use(express.json({ limit: '1mb' }));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

function loadRankRoles() {
  const file = path.join(__dirname, 'rankRoles.json');
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function normalizeRank(rank) {
  return String(rank || '').trim();
}

async function fetchGuild() {
  return client.guilds.fetch(GUILD_ID);
}

async function fetchMember(discordId) {
  const guild = await fetchGuild();
  return guild.members.fetch(discordId);
}

async function getAllMappedRoleIds() {
  const mapping = loadRankRoles();
  const ids = new Set();

  Object.values(mapping).forEach((arr) => {
    if (Array.isArray(arr)) {
      arr.forEach((id) => ids.add(String(id)));
    }
  });

  return [...ids];
}

function checkApiKey(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function assignRankRoles(discordId, rank) {
  const mapping = loadRankRoles();
  const normalizedRank = normalizeRank(rank);
  const roleIds = mapping[normalizedRank];

  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    throw new Error(`Keine Rollen für Rang "${normalizedRank}" gefunden`);
  }

  return assignSpecificRoles(discordId, roleIds);
}

async function assignSpecificRoles(discordId, roleIds) {
  const member = await fetchMember(discordId);
  const assignedRoleIds = [];

  for (const roleId of roleIds) {
    const cleanRoleId = String(roleId).trim();
    if (!cleanRoleId) continue;

    if (!member.roles.cache.has(cleanRoleId)) {
      await member.roles.add(cleanRoleId, 'LSPD Rollenvergabe');
    }
    assignedRoleIds.push(cleanRoleId);
  }

  return {
    success: true,
    discordId,
    assignedRoleIds
  };
}

async function dismissRankRoles(discordId) {
  const member = await fetchMember(discordId);
  const mappedRoleIds = await getAllMappedRoleIds();
  const removed = [];

  for (const roleId of mappedRoleIds) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'LSPD Kündigung');
      removed.push(roleId);
    }
  }

  if (EX_MEMBER_ROLE_ID) {
    if (!member.roles.cache.has(EX_MEMBER_ROLE_ID)) {
      await member.roles.add(EX_MEMBER_ROLE_ID, 'LSPD Kündigung / Ex-Member');
    }
  }

  return {
    success: true,
    action: 'dismiss',
    discordId,
    removedRoleIds: removed,
    exMemberRoleId: EX_MEMBER_ROLE_ID || null
  };
}

app.get('/', async (req, res) => {
  res.json({
    success: true,
    message: 'LSPD Bot API running'
  });
});

app.get('/health', async (req, res) => {
  res.json({
    success: true,
    botReady: client.isReady(),
    guildId: GUILD_ID
  });
});

app.get('/roles', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const guild = await fetchGuild();
    await guild.roles.fetch();

    const roles = guild.roles.cache
      .map(role => ({
        id: role.id,
        name: role.name,
        position: role.position,
        managed: role.managed
      }))
      .sort((a, b) => b.position - a.position);

    return res.json({
      success: true,
      roles
    });
  } catch (error) {
    console.error('/roles error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unbekannter Fehler'
    });
  }
});

app.post('/assign', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const { discordId, rank } = req.body || {};
    if (!discordId) {
      return res.status(400).json({ success: false, error: 'discordId fehlt' });
    }
    if (!rank) {
      return res.status(400).json({ success: false, error: 'rank fehlt' });
    }

    const result = await assignRankRoles(discordId, rank);
    return res.json(result);
  } catch (error) {
    console.error('/assign error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unbekannter Fehler'
    });
  }
});

app.post('/assignRoles', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const { discordId, roleIds } = req.body || {};
    if (!discordId) {
      return res.status(400).json({ success: false, error: 'discordId fehlt' });
    }
    if (!Array.isArray(roleIds) || !roleIds.length) {
      return res.status(400).json({ success: false, error: 'roleIds fehlen' });
    }

    const result = await assignSpecificRoles(discordId, roleIds);
    return res.json(result);
  } catch (error) {
    console.error('/assignRoles error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unbekannter Fehler'
    });
  }
});

app.post('/dismiss', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const { discordId } = req.body || {};
    if (!discordId) {
      return res.status(400).json({ success: false, error: 'discordId fehlt' });
    }

    const result = await dismissRankRoles(discordId);
    return res.json(result);
  } catch (error) {
    console.error('/dismiss error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unbekannter Fehler'
    });
  }
});

client.once('ready', () => {
  console.log(`Bot ready as ${client.user.tag}`);
  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
});

client.login(BOT_TOKEN);