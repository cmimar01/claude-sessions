---
title: Claude Sessions
---

# Claude Sessions

Claude Sessions ist eine Desktop-App (Electron), die mehrere Claude-Code-Sessions in einem Fenster hält. Jede Session läuft als eigener `claude`-Prozess in einem eingebetteten Terminal. Die Liste links zeigt, welche Session gerade arbeitet und welche auf Eingabe wartet.

Die App ist ein Wrapper um die installierte Claude-Code-CLI. Sie ersetzt weder Anmeldung noch Berechtigungen von Claude Code und spricht selbst mit keinem Dienst im Internet. Details stehen unter [Sicherheit und Datenschutz](sicherheit-und-datenschutz.md).

## Voraussetzungen

- Claude Code ist installiert und angemeldet. Die App sucht zuerst `~/.local/bin/claude(.exe)` (native Installation), sonst `claude` im `PATH`.
- Windows: `curl.exe` unter `%SystemRoot%\System32` (seit Windows 10 vorhanden). Linux: `curl` im `PATH`.

## Installation

**Release-Build:** Unter [Releases](https://github.com/cmimar01/claude-sessions/releases) liegen ein Windows-Installer (`.exe`, NSIS) und ein Linux-AppImage. Die Builds entstehen per GitHub Actions aus dem getaggten Stand. Sie sind nicht code-signiert, Windows SmartScreen warnt deshalb beim ersten Start.

**Aus dem Quellcode:**

```sh
npm ci
npm start
```

Node.js-Version laut `.nvmrc`: 22.

## Bedienung

| Aktion | So geht's |
|---|---|
| Neue Session | «Neue Session», Arbeitsverzeichnis wählen, «Starten». Existiert der Ordner nicht, bleibt das Formular offen und es entsteht keine Session. Ohne Namen heisst die Session zuerst wie ihr Ordner und danach wie die ersten 40 Zeichen des ersten Prompts |
| Standardpfad | Feld oben in der Seitenleiste; gilt als Vorgabe für neue Sessions |
| Session öffnen | Eintrag links anklicken; ein beendeter Prozess startet automatisch neu (`--resume`) |
| Beendete Session neu starten | Im Terminal Enter drücken |
| Text einfügen | Strg+V oder Rechtsklick ohne Markierung |
| Bild einfügen | Strg+V mit Bild in der Zwischenablage |
| Kopieren | Text markieren, Rechtsklick |
| Link öffnen | Strg+Klick (nur `http`/`https`) |
| Neue Zeile im Prompt | Strg+Enter |
| Frühere Prompts der Session | Alt+Pfeil hoch / Alt+Pfeil runter |
| Status «arbeitet» zurücksetzen | Esc oder Strg+C |

## Status in der Liste

Die Liste ist nach der letzten eigenen Nachricht sortiert, ein Statuswechsel verschiebt keinen Eintrag. Den Status zeigt das Symbol vor dem Namen:

| Symbol | Status | Bedeutung |
|---|---|---|
| gelber Punkt, pulsierend | Claude arbeitet | Prompt abgeschickt oder Tool läuft |
| oranges ◆, Name fett | Wartet auf dich | Claude ist fertig oder braucht eine Freigabe, und die Session war in dem Moment nicht im Blick |
| grüner Punkt, gedämpft | Läuft | Prozess läuft, wartet auf Eingabe, bereits gesehen |
| kein Symbol | Nicht gestartet | Kein Prozess |

«Wartet auf dich» erlischt, sobald die Session geöffnet wird. Der Fenstertitel zeigt die Zahl der wartenden Sessions, und liegt das Fenster im Hintergrund, blinkt der Taskleisten-Knopf, wenn eine Session hinzukommt.

Das Kontextmenü (Rechtsklick auf einen Eintrag) bietet: Umbenennen, Resume-Befehl kopieren, Ordner öffnen, Neu starten, Session beenden, Arbeitsverzeichnis ändern, Als neue Session forken, Archivieren/Wiederherstellen und Endgültig entfernen. «Entfernen» löscht nur den Listeneintrag; das Transcript von Claude Code bleibt erhalten und ist mit `claude --resume <id>` weiter erreichbar.

## Wo die App Daten ablegt

| Datei | Inhalt | Zugriff |
|---|---|---|
| `%APPDATA%\claude-sessions\sessions.json` (Linux: `~/.config/claude-sessions/`) | Name, Arbeitsverzeichnis, Session-ID, Zeitstempel, Archiv-Flag pro Session | lesen, schreiben |
| `~/.claude/projects/*/<id>.jsonl` | Transcripts von Claude Code | nur Existenzprüfung, kein Inhalt |
| `~/.claude/history.jsonl` | Prompt-Verlauf von Claude Code | lesen bei Alt+Pfeil, gefiltert auf die eigene Session |

Die App schreibt nichts in `~/.claude` und ändert keine Einstellungen von Claude Code dauerhaft.
