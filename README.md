# ZXPInstaller

ZXPInstaller is a simple cross platform (OS X and Windows) installer for third party Adobe extensions (`.zxp` files). It serves as a replacement for the Extension Manager which no longer is not supported after CC 2014. It provides a drag-and-drop GUI for installation, and [a website](https://zxpinstaller.com/) to which extension developers can point users to download the installer.

# How it works

ZXPInstaller uses Electron (https://electron.org) to create a cross platform HTML/node.js app. The app spawns a child process for the Adobe Extension Manager command line utility to install the ZXP.

# Setup

1. Install [Node.js](https://nodejs.org).

2. Install the dependencies and start the app.

  ```
  yarn
  yarn dev
  ```

# Compiling

1. Run the build script

  ```
  yarn pack:mac-x64
  ```

2. You will find the compiled binaries in the `dist` directory.

# Credits

ZXPInstaller was originally created by [**@maxoos**](https://github.com/maxoos) and maintained by [Cameron McEfee](https://github.com/cameronmcefee) and [GuideGuide](https://github.com/guideguide).

## Extension manager (fork additions)

The **Extensions** tab scans your user and system CEP extension folders and Adobe apps, then flags:

- older or duplicate copies of the same extension (cleanup suggestions, removed items go to the Trash)
- extensions that target no installed Adobe app, or whose declared host version range excludes yours
- extensions requiring a newer CEP runtime than current Creative Cloud ships (CEP 12)
- broken manifests, unsigned extensions, and whether CEP debug mode is on

Extensions can be disabled/enabled (moved to a sibling `extensions.disabled` folder, fully reversible), revealed, or removed. Adobe-managed extensions are protected. System-level changes prompt for an admin password on macOS.

Installs prefer Adobe's Unified Plugin Installer Agent (installed with Creative Cloud, handles `.zxp` and `.ccx`) and fall back to the bundled ExManCmd. UXP plugins are not scanned yet.
