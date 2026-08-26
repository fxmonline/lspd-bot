RENDER SETUP

Dieser Bot ist jetzt für Render als Web Service geeignet.
Keine .env-Datei notwendig.

Render:
Build Command: npm install
Start Command: npm start

Environment Variables bei Render:
BOT_TOKEN=dein Bot Token
GUILD_ID=deine Server-ID

Der Bot öffnet automatisch process.env.PORT auf 0.0.0.0, damit Render den Web Service erkennt.

Discord:
 /start = startet
 /sop   = stoppt

Ziel-User: 1411036678046486619
Ziel-Rolle: 1445502657799258293

Hinweis:
Discord kann Rollenänderungen durch Rate-Limits verlangsamen. Die 100 Zyklen pro 5 Sekunden sind daher eine Anforderung an den Bot, aber Discord bestimmt die tatsächlich mögliche Geschwindigkeit.
