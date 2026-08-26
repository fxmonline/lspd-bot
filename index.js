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
const TARGET_COUNT = 20;
const CHANGE_INTERVAL_MS = 10000;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');

const app = express();

// Render Web Service: Port auf 0.0.0.0 öffnen
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let running = false;
let stopRequested = false;
let cycleCount = 0;

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Startet das Rollen-Wechseln.')
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

async function runToggleLoop(guild) {
  if (running) return;

  const role = await guild.roles.fetch(ROLE_ID);
  if (!role) throw new Error(`Rolle ${ROLE_ID} nicht gefunden.`);
  if (!role.editable) {
    throw new Error('Die Rolle kann vom Bot nicht verwaltet werden. Prüfe die Rollen-Hierarchie.');
  }

  // Mitglieder des Servers laden und 20 zufällige Nicht-Bots auswählen.
  await guild.members.fetch();
  const candidates = [...guild.members.cache.values()].filter(m => !m.user.bot);

  if (candidates.length < TARGET_COUNT) {
    throw new Error(`Es wurden nur ${candidates.length} normale Mitglieder gefunden. Benötigt werden ${TARGET_COUNT}.`);
  }

  const selected = candidates
    .sort(() => Math.random() - 0.5)
    .slice(0, TARGET_COUNT);

  running = true;
  stopRequested = false;
  cycleCount = 0;

  console.log(`Gestartet: ${selected.length} zufällige User, Rolle ${ROLE_ID}`);
  console.log(`IDs: ${selected.map(m => m.id).join(', ')}`);

  let enabled = false;

  try {
    while (!stopRequested) {
      enabled = !enabled;
      let changes = 0;

      for (const member of selected) {
        if (stopRequested) break;

        try {
          if (enabled) {
            await member.roles.add(role);
          } else {
            await member.roles.remove(role);
          }
          changes++;
        } catch (err) {
          console.error(`Rollenänderung für ${member.id} fehlgeschlagen:`, err.message);
          if (err.status === 429) {
            await sleep(2000);
          }
        }

        // Kleine Pause zwischen Änderungen, damit Discord nicht mit Requests zugespammt wird.
        await sleep(500);
      }

      cycleCount++;
      console.log(`${enabled ? 'Rolle hinzugefügt' : 'Rolle entfernt'}: ${changes}/${selected.length} User. Zyklus ${cycleCount}`);

      if (!stopRequested) {
        await sleep(CHANGE_INTERVAL_MS);
      }
    }
  } finally {
    running = false;
    stopRequested = false;
    console.log(`Gestoppt. Insgesamt ${cycleCount} Zyklen.`);
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

  // Die Commands bleiben für den Server sichtbar. Nur Administratoren dürfen sie ausführen.
  if (!interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({ content: '❌ Du brauchst Administrator-Rechte.', ephemeral: true });
  }

  if (interaction.commandName === 'sop') {
    if (!running) {
      return interaction.reply({
        content: 'ℹ️ Es läuft gerade nichts.',
        ephemeral: true
      });
    }

    stopRequested = true;
    return interaction.reply({
      content: '🛑 Wird gestoppt.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'start') {
    if (running) {
      return interaction.reply({
        content: 'ℹ️ Läuft bereits.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: `▶️ Gestartet. Es wurden automatisch ${TARGET_COUNT} zufällige Mitglieder ausgewählt.`,
      ephemeral: true
    });

    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      runToggleLoop(guild).catch(err => {
        running = false;
        console.error('Rollen-Test beendet:', err);
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
