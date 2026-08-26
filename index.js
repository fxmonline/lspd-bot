require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const TARGET_USER_ID = '1411036678046486619';
const ROLE_ID = '1445502657799258293';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN fehlt');
if (!GUILD_ID) throw new Error('GUILD_ID fehlt');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let running = false;
let stopRequested = false;
let cycleCount = 0;

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Startet den Rollen-Test für den festgelegten Benutzer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('sop')
    .setDescription('Stoppt den laufenden Rollen-Test.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
}

async function runToggleLoop(guild) {
  if (running) return;

  const role = await guild.roles.fetch(ROLE_ID).catch(() => null);
  if (!role) throw new Error(`Rolle ${ROLE_ID} nicht gefunden.`);

  const member = await guild.members.fetch(TARGET_USER_ID).catch(() => null);
  if (!member) throw new Error(`Benutzer ${TARGET_USER_ID} nicht gefunden.`);

  if (!role.editable) {
    throw new Error('Die Rolle kann vom Bot nicht verwaltet werden. Prüfe die Rollen-Hierarchie.');
  }

  running = true;
  stopRequested = false;
  cycleCount = 0;

  console.log(`Start: User ${TARGET_USER_ID}, Rolle ${ROLE_ID}`);

  // Discord kann bei sehr vielen Rollenänderungen rate-limitieren.
  // Deshalb wird jeder Vorgang einzeln ausgeführt und bei einem Rate-Limit
  // wartet discord.js automatisch die notwendige Zeit.
  while (!stopRequested) {
    const batchStart = Date.now();

    for (let i = 0; i < 100 && !stopRequested; i++) {
      try {
        await member.roles.add(role);
        if (stopRequested) break;

        await member.roles.remove(role);
        cycleCount++;
      } catch (err) {
        console.error('Rollenänderung fehlgeschlagen:', err.message);
        break;
      }
    }

    const elapsed = Date.now() - batchStart;
    console.log(`Batch ${cycleCount}: 100 Wechsel angefordert, ${elapsed} ms`);

    if (!stopRequested && elapsed < 5000) {
      await new Promise(resolve => setTimeout(resolve, 5000 - elapsed));
    }
  }

  running = false;
  console.log('Gestoppt.');
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

  if (interaction.commandName === 'sop') {
    if (!running) {
      return interaction.reply({ content: 'ℹ️ Es läuft gerade kein Rollen-Test.', ephemeral: true });
    }

    stopRequested = true;
    return interaction.reply({ content: '🛑 Rollen-Test wird gestoppt.', ephemeral: true });
  }

  if (interaction.commandName === 'start') {
    if (running) {
      return interaction.reply({ content: 'ℹ️ Der Rollen-Test läuft bereits.', ephemeral: true });
    }

    await interaction.reply({
      content: `▶️ Starte den Rollen-Test für <@${TARGET_USER_ID}>.`,
      ephemeral: true,
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

client.login(BOT_TOKEN);
