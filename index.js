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

const ROLE_ID = '1445502657799258293';
const CHECK_INTERVAL_MS = 30000; // alle 30 Sekunden prüfen

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Discord Bot läuft.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    discordReady: client.isReady(),
    running
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
});

let running = false;
let stopRequested = false;

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Gibt allen normalen Mitgliedern die LSPD-Rolle.')
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('sop')
    .setDescription('Stoppt die automatische Rollenvergabe.')
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('weg')
    .setDescription('Entfernt die LSPD-Rolle von allen normalen Mitgliedern.')
    .setDMPermission(false)
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

async function giveRoleToEveryone(guild) {
  const role = await guild.roles.fetch(ROLE_ID);

  if (!role) {
    throw new Error(`Rolle ${ROLE_ID} nicht gefunden.`);
  }

  if (!role.editable) {
    throw new Error(
      'Die Rolle kann vom Bot nicht verwaltet werden. ' +
      'Ziehe die Bot-Rolle in Discord über die Rolle 1445502657799258293.'
    );
  }

  await guild.members.fetch();

  const members = [...guild.members.cache.values()]
    .filter(member => !member.user.bot);

  let added = 0;
  let alreadyHad = 0;
  let failed = 0;

  console.log(`Prüfe ${members.length} normale Mitglieder...`);

  for (const member of members) {
    if (stopRequested) break;

    if (member.roles.cache.has(ROLE_ID)) {
      alreadyHad++;
      continue;
    }

    try {
      await member.roles.add(role);
      added++;

      console.log(`Rolle gegeben: ${member.user.tag} (${member.id})`);

      // Kleine Pause zwischen Änderungen
      await sleep(500);
    } catch (err) {
      failed++;
      console.error(
        `Rolle konnte ${member.user.tag} (${member.id}) nicht gegeben werden:`,
        err.message
      );

      if (err.status === 429) {
        await sleep(3000);
      }
    }
  }

  console.log(
    `Prüfung fertig: ${added} hinzugefügt, ` +
    `${alreadyHad} hatten die Rolle bereits, ${failed} fehlgeschlagen.`
  );
}

async function runRoleLoop(guild) {
  if (running) return;

  running = true;
  stopRequested = false;

  console.log(`Automatische Rollenvergabe gestartet. Rolle: ${ROLE_ID}`);

  try {
    while (!stopRequested) {
      await giveRoleToEveryone(guild);

      if (!stopRequested) {
        await sleep(CHECK_INTERVAL_MS);
      }
    }
  } catch (err) {
    console.error('Rollenvergabe beendet:', err);
  } finally {
    running = false;
    stopRequested = false;
    console.log('Automatische Rollenvergabe gestoppt.');
  }
}

client.once('ready', async () => {
  console.log(`Bot online als ${client.user.tag}`);

  try {
    await registerCommands();
    console.log('/start und /sop registriert.');
  } catch (err) {
    console.error('Slash-Commands konnten nicht registriert werden:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      content: '❌ Du brauchst Administrator-Rechte.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'weg') {
    if (running) { stopRequested = true; await sleep(500); }
    await interaction.reply({ content: `🧹 Entferne die Rolle <@&${ROLE_ID}> von allen normalen Mitgliedern...`, ephemeral: true });
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const role = await guild.roles.fetch(ROLE_ID);
      if (!role) throw new Error(`Rolle ${ROLE_ID} nicht gefunden.`);
      if (!role.editable) throw new Error('Die Rolle kann vom Bot nicht verwaltet werden. Die Bot-Rolle muss über der Zielrolle stehen.');
      await guild.members.fetch();
      const members = [...guild.members.cache.values()].filter(m => !m.user.bot && m.roles.cache.has(ROLE_ID));
      let removed = 0, failed = 0;
      for (const member of members) {
        try { await member.roles.remove(role); removed++; await sleep(500); }
        catch (err) { failed++; console.error(`Rolle konnte ${member.user.tag} (${member.id}) nicht entfernt werden:`, err.message); if (err.status === 429) await sleep(3000); }
      }
      await interaction.editReply({ content: `✅ Fertig. Rolle <@&${ROLE_ID}> wurde von ${removed} Mitgliedern entfernt.${failed ? ` ${failed} konnten nicht geändert werden.` : ''}` });
    } catch (err) {
      console.error('/weg Fehler:', err);
      await interaction.editReply({ content: `❌ Fehler: ${err.message}` });
    }
    return;
  }

  if (interaction.commandName === 'sop') {
    if (!running) {
      return interaction.reply({
        content: 'ℹ️ Die automatische Rollenvergabe läuft gerade nicht.',
        ephemeral: true
      });
    }

    stopRequested = true;

    return interaction.reply({
      content: '🛑 Die automatische Rollenvergabe wird gestoppt.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'start') {
    if (running) {
      return interaction.reply({
        content: 'ℹ️ Die automatische Rollenvergabe läuft bereits.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content:
        `▶️ Gestartet. Der Bot gibt allen normalen Mitgliedern ` +
        `die Rolle <@&${ROLE_ID}> und prüft alle 30 Sekunden erneut.`,
      ephemeral: true
    });

    try {
      const guild = await client.guilds.fetch(GUILD_ID);

      runRoleLoop(guild).catch(err => {
        running = false;
        console.error('Rollen-Loop beendet:', err);
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
