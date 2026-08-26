Render Discord Role Toggle Bot

Environment Variables bei Render:
- BOT_TOKEN
- GUILD_ID

Keine .env-Datei nötig.

Start Command:
npm start

Slash-Commands:
/start - startet den Vorgang
/sop   - stoppt den Vorgang

Die Commands werden als Guild Commands für GUILD_ID registriert.
Sie haben keine Discord-Standardberechtigung, damit sie sichtbar sind.
Beim Ausführen wird geprüft, ob der Benutzer Administrator ist.
