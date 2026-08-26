const express = require('express');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT || 3000);

// User, der automatisch gebannt werden soll.
const AUTO_BAN_USER_ID = '499109716195278849';

// Server, auf denen dieser User automatisch gebannt werden soll.
const AUTO_BAN_GUILD_IDS = [
  GUILD_ID,
  '1137403259380842606',
  '1374766558395629680',
].filter(Boolean);

const ROLE_ID = '1445502657799258293';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');

const app = express();
let running = false;
let stopRequested = false;
let cycleCount = 0;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

app.get('/', (req, res) => {
  res.status(200).send('Discord Bot läuft.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    discordReady: client.isReady(),
    running,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Startet das Rollen-Wechseln für 100 verschiedene Mitglieder.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('sop')
    .setDescription('Stoppt das Rollen-Wechseln.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(null)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const result = await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
  console.log(`Slash-Commands erfolgreich registriert: ${result.length}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRandomMembers(guild, amount = 100) {
  await guild.members.fetch();

  const members = [...guild.members.cache.values()]
    .filter(member => !member.user.bot)
    .filter(member => member.id !== AUTO_BAN_USER_ID)
    .filter(member => member.manageable);

  if (members.length < amount) {
    throw new Error(
      `Nur ${members.length} verwaltbare Mitglieder gefunden; ${amount} benötigt.`
    );
  }

  for (let i = members.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [members[i], members[j]] = [members[j], members[i]];
  }

  return members.slice(0, amount);
}

async function runToggleLoop(guild) {
  if (running) return;

  const role = await guild.roles.fetch(ROLE_ID);
  if (!role) throw new Error(`Rolle ${ROLE_ID} nicht gefunden.`);
  if (!role.editable) {
    throw new Error('Die Rolle kann vom Bot nicht verwaltet werden. Prüfe die Rollen-Hierarchie.');
  }

  running = true;
  stopRequested = false;
  cycleCount = 0;

  console.log('Gestartet: Rollen-Wechsel für 100 verschiedene Mitglieder.');

  try {
    while (!stopRequested) {
      const members = await getRandomMembers(guild, 100);
      console.log(`100 Mitglieder ausgewählt. Starte Durchlauf #${cycleCount + 1}.`);

      for (const member of members) {
        if (stopRequested) break;
        try {
          await member.roles.add(role);
          console.log(`Rolle gegeben: ${member.user.tag}`);
          await sleep(250);
        } catch (err) {
          console.error(`Rolle konnte ${member.user.tag} nicht gegeben werden:`, err.message);
          if (err.status === 429) await sleep(2000);
        }
      }

      if (stopRequested) break;

      for (const member of members) {
        if (stopRequested) break;
        try {
          await member.roles.remove(role);
          console.log(`Rolle entfernt: ${member.user.tag}`);
          await sleep(250);
        } catch (err) {
          console.error(`Rolle konnte ${member.user.tag} nicht entfernt werden:`, err.message);
          if (err.status === 429) await sleep(2000);
        }
      }

      cycleCount++;
      console.log(`Durchlauf ${cycleCount} abgeschlossen.`);

      if (!stopRequested) await sleep(5000);
    }
  } finally {
    running = false;
    stopRequested = false;
    console.log(`Gestoppt. Insgesamt ${cycleCount} Durchläufe.`);
  }
}

// Automatischer Bann beim Beitritt auf den festgelegten Servern.
client.on('guildMemberAdd', async member => {
  if (!AUTO_BAN_GUILD_IDS.includes(member.guild.id)) return;
  if (member.id !== AUTO_BAN_USER_ID) return;

  console.log(`Auto-Ban erkannt: ${member.user.tag} (${member.id}) auf ${member.guild.id}`);

  try {
    await member.ban({ reason: 'Automatischer Bann durch LSPD Bot' });
    console.log(`User ${member.id} wurde auf ${member.guild.id} gebannt.`);
  } catch (err) {
    console.error(`Auto-Ban fehlgeschlagen auf ${member.guild.id}:`, err.message);
  }
});

// Beim Bot-Start ebenfalls prüfen, ob der User bereits auf einem der Server ist.
async function checkExistingAutoBanUser() {
  for (const guildId of AUTO_BAN_GUILD_IDS) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(AUTO_BAN_USER_ID);

      if (member) {
        console.log(`Auto-Ban-User bereits auf ${guildId} gefunden. Banne ihn...`);
        await member.ban({ reason: 'Automatischer Bann durch LSPD Bot' });
        console.log(`User ${AUTO_BAN_USER_ID} wurde auf ${guildId} gebannt.`);
      }
    } catch (err) {
      if (err.code === 10007 || err.code === 10004) {
        console.log(`User ${AUTO_BAN_USER_ID} ist auf ${guildId} nicht vorhanden oder Server nicht erreichbar.`);
      } else if (err.code === 50013) {
        console.error(`Keine Berechtigung zum Bannen auf ${guildId}.`);
      } else {
        console.error(`Fehler beim Prüfen von ${guildId}:`, err.message);
      }
    }
  }
}

client.once('clientReady', async () => {
  console.log(`Bot online als ${client.user.tag}`);

  try {
    await registerCommands();
    console.log('/start und /sop registriert.');
  } catch (err) {
    console.error('Slash-Commands konnten nicht registriert werden:', err);
  }

  await checkExistingAutoBanUser();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      content: '❌ Du brauchst Administrator-Rechte.',
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'sop') {
    if (!running) {
      return interaction.reply({ content: 'ℹ️ Es läuft gerade nichts.', ephemeral: true });
    }

    stopRequested = true;
    return interaction.reply({ content: '🛑 Wird gestoppt.', ephemeral: true });
  }

  if (interaction.commandName === 'start') {
    if (running) {
      return interaction.reply({ content: 'ℹ️ Läuft bereits.', ephemeral: true });
    }

    await interaction.reply({
      content: '▶️ Rollen-Wechsel für 100 verschiedene Mitglieder gestartet.',
      ephemeral: true,
    });

    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      runToggleLoop(guild).catch(err => {
        running = false;
        console.error('Rollen-Wechsel beendet:', err);
      });
    } catch (err) {
      console.error('Guild konnte nicht geladen werden:', err);
    }
  }
});

client.login(BOT_TOKEN).catch(err => {
  console.error('Discord Login fehlgeschlagen:', err);
  process.exit(1);
});
