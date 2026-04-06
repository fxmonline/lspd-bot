
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 3000);
const EX_MEMBER_ROLE_ID = process.env.EX_MEMBER_ROLE_ID || '';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');
if (!API_KEY) throw new Error('API_KEY fehlt');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const app = express();
app.use(express.json());

function loadMapping() {
  const file = path.join(__dirname, 'rankRoles.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function getGuild() { return client.guilds.fetch(GUILD_ID); }
async function getMember(discordId) { const guild = await getGuild(); return guild.members.fetch(String(discordId)); }

function requireKey(req, res) {
  if (req.headers['x-api-key'] !== API_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function getAllManagedRoleIds() {
  const mapping = loadMapping();
  return [...new Set(Object.values(mapping).flat().map(String))];
}

app.get('/health', (req, res) => {
  res.json({ success: true, botReady: client.isReady(), guildId: GUILD_ID });
});

app.post('/roles', async (req, res) => {
  if (!requireKey(req, res)) return;
  try {
    const guild = await getGuild();
    await guild.roles.fetch();
    const roles = [...guild.roles.cache.values()]
      .filter(role => role.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(role => ({ id: role.id, name: role.name, color: role.hexColor, position: role.position, managed: role.managed }));
    res.json({ success: true, roles });
  } catch (e) {
    console.error('/roles error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/assign', async (req, res) => {
  if (!requireKey(req, res)) return;
  const { discordId, rank } = req.body || {};
  if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });
  if (!rank) return res.status(400).json({ success: false, error: 'rank fehlt' });

  try {
    const mapping = loadMapping();
    const roles = mapping[String(rank).trim()] || [];
    if (!Array.isArray(roles) || !roles.length) {
      return res.status(400).json({ success: false, error: 'Keine Rollen für Rang gefunden: ' + rank });
    }
    const member = await getMember(discordId);
    for (const roleId of roles) {
      if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, 'LSPD Einstellung');
    }
    res.json({ success: true, discordId, rank, assignedRoleIds: roles });
  } catch (e) {
    console.error('/assign error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/assign-custom', async (req, res) => {
  if (!requireKey(req, res)) return;
  const { discordId, roleIds } = req.body || {};
  if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });
  if (!Array.isArray(roleIds) || !roleIds.length) return res.status(400).json({ success: false, error: 'roleIds fehlt' });

  try {
    const member = await getMember(discordId);
    const assigned = [];
    for (const roleId of roleIds.map(String)) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, 'LSPD Einstellung (Custom)');
        assigned.push(roleId);
      }
    }
    res.json({ success: true, discordId, assignedRoleIds: assigned });
  } catch (e) {
    console.error('/assign-custom error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/dismiss', async (req, res) => {
  if (!requireKey(req, res)) return;
  const { discordId, roleIds } = req.body || {};
  if (!discordId) return res.status(400).json({ success: false, error: 'discordId fehlt' });

  try {
    const managedIds = Array.isArray(roleIds) && roleIds.length ? roleIds.map(String) : await getAllManagedRoleIds();
    const member = await getMember(discordId);
    const removed = [];
    for (const roleId of managedIds) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, 'LSPD Kündigung');
        removed.push(roleId);
      }
    }
    if (EX_MEMBER_ROLE_ID && !member.roles.cache.has(EX_MEMBER_ROLE_ID)) {
      await member.roles.add(EX_MEMBER_ROLE_ID, 'LSPD Kündigung');
    }
    res.json({ success: true, discordId, removedRoleIds: removed, exMemberRoleId: EX_MEMBER_ROLE_ID || null });
  } catch (e) {
    console.error('/dismiss error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

client.once('ready', () => {
  console.log('Bot ready as ' + client.user.tag);
  app.listen(PORT, () => console.log('API running on ' + PORT));
});

client.login(BOT_TOKEN);
