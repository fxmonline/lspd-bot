require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const app = express();
app.use(express.json());

const mapping = JSON.parse(fs.readFileSync('./rankRoles.json'));

app.post('/assign', async (req, res) => {
  const { discordId, rank } = req.body;
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);

    const roles = mapping[rank] || [];
    for (const role of roles) {
      await member.roles.add(role);
    }

    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/dismiss', async (req, res) => {
  const { discordId } = req.body;
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);

    for (const rank in mapping) {
      for (const role of mapping[rank]) {
        if (member.roles.cache.has(role)) {
          await member.roles.remove(role);
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

client.once('ready', () => {
  console.log('Bot ready');
  app.listen(process.env.PORT, () => {
    console.log('API running');
  });
});

client.login(process.env.BOT_TOKEN);
