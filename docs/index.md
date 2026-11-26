---
title: Claude Sessions
---

# Claude Sessions

Claude Sessions ist eine Desktop-App (Electron), die mehrere Claude-Code-Sessions in einem Fenster hält. Jede Session läuft als eigener `claude`-Prozess in einem eingebetteten Terminal. Die Liste links zeigt, welche Session gerade arbeitet und welche auf Eingabe wartet.

Die App ist ein Wrapper um die installierte Claude-Code-CLI. Sie ersetzt weder Anmeldung noch Berechtigungen von Claude Code. Ins Internet verbindet sie sich selbst nur für die Update-Prüfung bei GitHub. Details stehen unter [Sicherheit und Datenschutz](sicherheit-und-datenschutz.md).

## Voraussetzungen

- Claude Code ist installiert und angemeldet. Die App sucht zuerst `~/.local/bin/claude(.exe)` (native Installation), sonst `claude` im `PATH`.
- Windows: `curl.exe` unter `%SystemRoot%\System32` (seit Windows 10 vorhanden). Linux: `curl` im `PATH`.

## Installation

**Release-Build:** Unter [Releases](https://github.com/cmimar01/claude-sessions/releases) liegen ein Windows-Installer (`.exe`, NSIS) und ein Linux-AppImage. Die Builds entstehen per GitHub Actions aus `master`: Erhöht ein Merge die Version in `package.json`, setzt der Workflow den Tag `v<version>` auf diesen Commit und baut das Release. Die Builds sind nicht code-signiert, Windows SmartScreen warnt deshalb beim ersten Start. Ein Ruleset im Repository verbietet, `v*`-Tags anzulegen, zu verschieben oder zu löschen. Nur der Workflow darf es, über einen Deploy-Key.

**Vorabversion:** Unter Actions, "Vorabversion", "Run workflow" einen Branch wählen (oder `gh workflow run prerelease.yml --ref <branch>`). Der Lauf baut Installer und AppImage mit der Version `<version>-pre.<laufnummer>` und legt sie als Artefakte am Lauf ab, 14 Tage lang. Tag und Release entstehen nicht, der Autoupdater sieht die Vorabversion nicht. Nach der Installation holt er das nächste stabile Release, das neuer ist. Wer testen will, erhöht deshalb vorher die Version im Branch.

**Updates:** Die installierte App prüft beim Start und danach alle 4 Stunden, ob unter Releases eine neuere Version liegt. Ein Update lädt sie im Hintergrund, meldet es per Systembenachrichtigung und installiert es beim nächsten Beenden. Aus dem Quellcode gestartet, prüft die App nicht.

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
| Berechtigungen überspringen | Checkbox unter dem Standardpfad. Sessions starten dann mit `--dangerously-skip-permissions`; laufende Sessions erst nach dem nächsten Start. Die Einstellung bleibt über Neustarts der App erhalten |
| Session öffnen | Eintrag links anklicken; ein beendeter Prozess startet automatisch neu (`--resume`) |
| Sessions filtern | Text ins Feld über der Liste tippen. Aktive und archivierte Sessions zeigen nur noch Einträge, deren Name, Arbeitsverzeichnis oder Tags jedes eingegebene Wort enthalten. Ein Wort mit `#` sucht nur in den Tags, nach Wortanfang: `#ref` findet `#refinement`. Das Archiv klappt dabei auf |
| Tags vergeben | Rechtsklick auf einen Eintrag, «Tags bearbeiten…», Tags durch Leerzeichen getrennt eintippen (`#refinement #bdd`, das `#` ist optional), Enter speichert. Die Tags stehen unter dem Namen; ein Klick auf einen Tag filtert die Liste danach |
| Beendete Session neu starten | Im Terminal Enter drücken |
| Text einfügen | Strg+V oder Rechtsklick ohne Markierung |
| Bild einfügen | Strg+V mit Bild in der Zwischenablage |
| Kopieren | Text markieren, Rechtsklick. Hat Claude Code die Maus übernommen, kopiert es die eigene Markierung beim Loslassen selbst (OSC 52) |
| Befehle als Session starten | Befehle in der Ausgabe markieren, bis und mit der Zeile, die mit `claude` beginnt; oben rechts erscheint «Als Session starten». Hat Claude Code die Maus übernommen, markiert es selbst und kopiert beim Loslassen; der Knopf erscheint dann, sobald die Kopie in der Zwischenablage liegt. Die App übernimmt aus der Markierung nur Zeilen, deren erstes Wort ein ausführbarer Befehl ist, und zeigt sie vor dem Start zur Bestätigung. Befehle vor der `claude`-Zeile laufen einmalig als Vorbereitung im Arbeitsverzeichnis der aktuellen Session (Windows: PowerShell), schlägt einer fehl, startet Claude nicht. `cd`-Zeilen legen das Arbeitsverzeichnis der neuen Session fest. Die Argumente der `claude`-Zeile, etwa `--plugin-dir`, gelten auch bei jedem Neustart, Fork und im Resume-Befehl; `-n` setzt den Namen |
| Link öffnen | Strg+Klick auf einen Link oder eine URL im Text (nur `http`/`https`). Hat Claude Code die Maus übernommen, öffnet es den Link selbst |
| Neue Zeile im Prompt | Strg+Enter oder Shift+Enter |
| Frühere Prompts der Session | Alt+Pfeil hoch / Alt+Pfeil runter |
| Status «arbeitet» zurücksetzen | Esc oder Strg+C |

## Status in der Liste

Die Liste ist nach der letzten eigenen Nachricht sortiert, ein Statuswechsel verschiebt keinen Eintrag. Den Status zeigt das Symbol vor dem Namen:

| Symbol | Status | Bedeutung |
|---|---|---|
| rotes ■, Name fett | Braucht Freigabe | Claude wartet auf eine Berechtigung oder ein MCP-Server auf eine Antwort |
| gelber Punkt, pulsierend | Claude arbeitet | Prompt abgeschickt oder Tool läuft |
| oranges ◆, Name fett | Wartet auf dich | Claude ist fertig, und die Session war in dem Moment nicht im Blick |
| grüner Punkt, gedämpft | Läuft | Prozess läuft, wartet auf Eingabe, bereits gesehen |
| kein Symbol | Nicht gestartet | Kein Prozess |

«Wartet auf dich» erlischt, sobald die Session geöffnet wird. «Braucht Freigabe» bleibt dagegen stehen, bis die Freigabe beantwortet ist: Claude führt das Werkzeug aus, du schickst einen Prompt, brichst mit Esc ab, oder Claude beendet die Antwort.

Offene Freigaben aller Sessions sammelt der rot umrandete Block «Freigaben» über der Liste, die älteste zuoberst. Jede Zeile nennt Session, Werkzeug, den Befehl oder Pfad und die Wartezeit; ein Klick öffnet das Terminal der Session, dort beantwortest du die Freigabe. Liegt das Fenster im Hintergrund, meldet Windows jede neue Freigabe zusätzlich als Benachrichtigung, ein Klick darauf öffnet die Session. Fragt Claude in einer Session mehrmals hintereinander, zeigt der Block die jüngste Frage.

Der Fenstertitel zeigt die Zahl der offenen Freigaben und der wartenden Sessions, etwa «(1 Freigabe · 2 neu)», und liegt das Fenster im Hintergrund, blinkt der Taskleisten-Knopf, wenn eine Session hinzukommt. Ein roter Zähler am App-Icon in der Taskleiste zeigt die Summe beider Zahlen. Unter Linux erscheint er nur, wenn die Desktop-Umgebung Zähler am Icon unterstützt.

Das Kontextmenü (Rechtsklick auf einen Eintrag) bietet: Umbenennen, Tags bearbeiten, Resume-Befehl kopieren, Ordner öffnen, Neu starten, Session beenden, Arbeitsverzeichnis ändern, Als neue Session forken, Archivieren/Wiederherstellen und Endgültig entfernen. «Entfernen» löscht nur den Listeneintrag; das Transcript von Claude Code bleibt erhalten und ist mit `claude --resume <id>` weiter erreichbar.

## Wo die App Daten ablegt

| Datei | Inhalt | Zugriff |
|---|---|---|
| `%APPDATA%\claude-sessions\sessions.json` (Linux: `~/.config/claude-sessions/`) | Name, Arbeitsverzeichnis, Session-ID, Zeitstempel, Archiv-Flag, zusätzliche `claude`-Argumente und noch nicht ausgeführte Vorbereitungsbefehle pro Session | lesen, schreiben |
| `~/.claude/projects/*/<id>.jsonl` | Transcripts von Claude Code | nur Existenzprüfung, kein Inhalt |
| `~/.claude/history.jsonl` | Prompt-Verlauf von Claude Code | lesen bei Alt+Pfeil, gefiltert auf die eigene Session |

Die App schreibt nichts in `~/.claude` und ändert keine Einstellungen von Claude Code dauerhaft.
