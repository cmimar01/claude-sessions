# Claude Sessions

Desktop-App (Electron), die mehrere Claude-Code-Sessions in einem Fenster hält. Jede Session läuft als eigener `claude`-Prozess in einem eingebetteten Terminal; die Liste links zeigt, welche Session arbeitet und welche auf Eingabe wartet.

Die App ist ein Wrapper um die installierte Claude-Code-CLI und spricht selbst mit keinem Dienst im Internet.

**Dokumentation:** https://cmimar01.github.io/claude-sessions/ ([Quelle](docs/index.md), [Sicherheit und Datenschutz](docs/sicherheit-und-datenschutz.md))

**Download:** [Releases](https://github.com/cmimar01/claude-sessions/releases) (Windows-Installer, Linux-AppImage)

**Aus dem Quellcode:**

```sh
npm ci
npm start
```
