require('dotenv').config();

const express = require('express');
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

function checkApiKey(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
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
  return guild.members.fetch(discordId);
}

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Bot läuft' });
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

    res.json({ success: true, roles });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/assignRoles', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const { discordId, roleIds } = req.body;

    const member = await fetchMember(discordId);

    for (const roleId of roleIds) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/dismiss', async (req, res) => {
  try {
    if (!checkApiKey(req, res)) return;

    const { discordId } = req.body;
    const member = await fetchMember(discordId);

    const roles = member.roles.cache.map(r => r.id);

    for (const roleId of roles) {
      try {
        await member.roles.remove(roleId);
      } catch {}
    }

    if (EX_MEMBER_ROLE_ID) {
      await member.roles.add(EX_MEMBER_ROLE_ID);
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

client.once('ready', () => {
  console.log('Bot ready');

  app.listen(PORT, () => {
    console.log('API läuft auf Port ' + PORT);
  });
});

client.login(BOT_TOKEN);
