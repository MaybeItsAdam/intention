# Intention

**Intention** is a cross-browser extension designed for mindful browsing. Instead of completely blocking distracting websites, it acts as a gatekeeper: it forces you to pause, state your purpose for visiting, and specify how long you need. 

It keeps you accountable by interrupting you with a graceful full-screen "Check-in" when your time is up, asking if you have fulfilled your designated purpose. 

## Features
- **Dynamic Blocklist**: Add or remove highly distracting websites easily from the premium UI Settings page.
- **Intent Check**: Completely pauses site loading out-of-the-gate to ask why you are visiting.
- **Check-ins / Snooze**: When the timer runs out, you get interrupted. You can either close out of the tab or snooze the timer for a little bit longer.
- **Cross-Browser Support**: Built on Manifest V3, supporting both Google Chrome (and Chromium browsers) and Apple Safari.

## Installation

### Google Chrome (and Chromium-based browsers)
1. Download or clone this repository.
2. Open your browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (usually a toggle in the top right corner).
4. Click on **Load unpacked**.
5. Select the `Intention Chrome` subfolder inside this project.
6. Click the extension icon in your browser toolbar to add websites to your blocklist!

### Safari 
Safari requires Web Extensions to be bundled inside a lightweight macOS application. Apple provides a command-line tool to automatically generate this wrapper based on the `Intention Chrome` folder.

1. Open your terminal at the root of this project folder.
2. Run the following command:
   ```bash
   xcrun safari-web-extension-converter "./Intention Chrome" --project-location . --app-name "Intention Safari"
   ```
3. This command will auto-generate an Xcode project folder named `Intention Safari` right inside this repository and immediately open it in Xcode.
4. In Xcode, hit the **Run icon** (represented as a Play button) to build the app and load the extension into Safari.
5. Make sure to go into Safari's Preferences > Extensions to enable it!

## Technology
- HTML, CSS (Vanilla with Glassmorphic styling)
- Vanilla Javascript 
- Google Manifest V3 (`chrome.alarms`, `chrome.storage.local`)
