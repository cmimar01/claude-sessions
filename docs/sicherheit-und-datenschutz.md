---
title: Sicherheit und Datenschutz
---

# Sicherheit und Datenschutz

Stand der Prüfung: Version 0.6.11 (Commit `2dc4782`), November 2026. Erste Prüfung: Version 0.5.0 (Commit `cd7d43a`).

**Befund:** Die App schickt keine Inhalte an Dritte. Ihre einzige eigene Internetverbindung ist die Update-Prüfung bei GitHub, die nur die installierte Version abfragt. Alles, was sie speichert oder liest, bleibt lokal im Benutzerprofil. Was Claude Code selbst an Anthropic überträgt, ändert sich durch die App nicht: Es gelten dieselben Regeln wie beim Start von `claude` im Terminal. Einen Befund mit hohem Risiko im Code gibt es nicht. Die offenen Punkte betreffen die Herkunft des Release-Builds; seit dem Autoupdater gilt das nicht mehr nur für die erste Installation, sondern für jedes Update.

## Datenflüsse

| Fluss | Ziel | Inhalt |
|---|---|---|
| Terminal-Ein-/Ausgabe | lokaler `claude`-Prozess (Pseudo-Terminal) | Tastatureingaben, Ausgabe von Claude Code |
| Hook-Ereignisse | `http://127.0.0.1:<zufälliger Port>/<zufälliges Token>/…` | JSON der Claude-Code-Hooks `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `Notification` |
| Sessionliste | `sessions.json` im App-Datenordner | Name, Pfad, Session-ID, Zeitstempel |
| Prompt-Verlauf | Lesen aus `~/.claude/history.jsonl` | nur Prompts der gewählten Session |
| Links | Standardbrowser | nur `http`/`https`, nur auf Strg+Klick |
| Update-Prüfung | `github.com` / `api.github.com`, Releases von `cmimar01/claude-sessions` | Abfrage von `latest.yml`, bei neuer Version Download des Installers; GitHub sieht IP-Adresse und Zeitpunkt |

Die App enthält keine Telemetrie und lädt keine Skripte oder Styles aus dem Netz in die Oberfläche. Die Content-Security-Policy (`default-src 'self'`) verhindert das auch technisch. Für die Update-Prüfung gilt sie nicht, weil diese im Hauptprozess läuft.

## Geprüfte Punkte

**Electron-Härtung.** Das Fenster lädt nur lokale Dateien. Es gelten die Electron-Standards `contextIsolation`, `sandbox` und `nodeIntegration: false`; die Oberfläche erreicht den Hauptprozess nur über die in `preload.js` freigegebenen Funktionen. Session-Namen und Pfade werden per `textContent` gesetzt, nicht als HTML.

**Hook-Server.** Damit die Liste den Status «arbeitet» kennt, startet die App einen HTTP-Server, der nur auf `127.0.0.1` lauscht, also von aussen nicht erreichbar ist. Anfragen ohne das beim Start erzeugte Zufallstoken (UUID) im Pfad werden ignoriert. Das Token steht in der Kommandozeile des `claude`-Prozesses und ist damit für Programme desselben Windows-Benutzers sichtbar. Ein solches Programm könnte höchstens die Statusanzeige verfälschen; Befehle ausführen oder Daten abziehen kann es über diesen Weg nicht. Die Hook-Daten von `PostToolUse` enthalten Werkzeug-Ein- und Ausgaben (z. B. gelesene Dateiinhalte). Sie gehen unverschlüsselt über die Loopback-Schnittstelle, verlassen den Rechner aber nicht und werden nicht gespeichert.

**Claude-Code-Konfiguration.** Die App übergibt die Hooks pro Prozess mit `--settings`. Bestehende Einstellungen, Berechtigungen und der Permission-Modus bleiben unverändert; die App schreibt keine Datei in `~/.claude`. Ausnahme: Ist «Berechtigungen überspringen» aktiv, startet die App jede Session mit `--dangerously-skip-permissions`. Claude führt dann Befehle und Dateiänderungen ohne Rückfrage aus. Die Einstellung ist standardmässig aus. Die Hooks antworten mit leerem Inhalt, es gelangt also nichts zusätzlich in den Kontext von Claude.

**Prozessstart.** `claude` wird direkt gestartet, nicht über eine Shell. Session-Namen landen dadurch nicht in einer Befehlszeile, die eine Shell auswertet. Die Umgebungsvariablen werden unverändert weitergegeben, ausser `CLAUDE_CODE_CHILD_SESSION`.

**Autoupdater.** `electron-updater` prüft beim Start und danach alle 4 Stunden die GitHub Releases, lädt eine neuere Version im Hintergrund und installiert sie beim Beenden der App, ohne Rückfrage. Die Prüfung läuft nur in der installierten App, nicht beim Start aus dem Quellcode. Der Updater vergleicht den SHA-512-Hash aus `latest.yml` mit dem Download. Das schützt vor beschädigten Downloads, nicht vor einem manipulierten Release, denn Hash und Installer stammen aus demselben Release. Eine Signaturprüfung gibt es nicht, weil die Builds nicht signiert sind.

**Abhängigkeiten.** Zur Laufzeit braucht die App sechs Pakete: `@xterm/xterm`, drei xterm-Addons, `node-pty` und `electron-updater`. `npm audit --omit=dev` meldet dafür keine Schwachstelle (Stand 0.6.11). Sechs mittelschwere Meldungen betreffen nur das Build-Werkzeug `electron-builder` (ReDoS in `minimatch`) und landen nicht im ausgelieferten Programm.

## Offene Punkte

**Herkunft des Installers.** Das Repository liegt in einem persönlichen GitHub-Konto, die Releases sind nicht code-signiert. Wer den Installer nutzt, vertraut dem Konto und dem Build in GitHub Actions, und über den Autoupdater auch jedem künftigen Release: Wer das Konto oder die Pipeline übernimmt, kann Code auf alle installierten Rechner verteilen, ohne dass jemand zustimmt. Die Actions sind über Versions-Tags (`@v4`) eingebunden, nicht über Commit-Hashes. Wer das vermeiden will, baut aus dem geprüften Quellstand selbst (`npm ci && npm start`); dann prüft die App nicht auf Updates.

**Firmenrichtlinien.** Ob nicht signierte Software aus einem privaten Konto auf Firmengeräten zulässig ist, entscheidet die interne IT, nicht diese Prüfung.

**Lokale Klartextdateien.** `sessions.json` enthält Session-Namen und Pfade im Klartext. Wer Namen mit Kunden- oder Personenbezug vergibt, legt diese Information unverschlüsselt im Benutzerprofil ab, wie es Claude Code mit seinen Transcripts ohnehin tut. Bleibt das Namensfeld leer, übernimmt die App die ersten 40 Zeichen des ersten Prompts als Namen; damit steht auch dieser Prompt-Anfang in `sessions.json`.

**Entfernen heisst nicht Löschen.** «Endgültig entfernen» löscht nur den Listeneintrag. Transcript und Prompt-Verlauf in `~/.claude` bleiben bestehen und müssen bei Bedarf dort gelöscht werden.

## Empfehlungen für den Betrieb

1. Beim ersten Einsatz aus dem Quellcode starten oder den Installer nur aus der Releases-Seite dieses Repositorys beziehen. Wo automatische Updates aus einem privaten Konto nicht zulässig sind, aus dem Quellcode starten.
2. Für Sessions mit vertraulichem Kontext neutrale Namen wählen, statt das Feld leer zu lassen.
3. Nach Abschluss eines Mandats Transcripts in `~/.claude/projects` gezielt löschen, nicht nur den Listeneintrag.
