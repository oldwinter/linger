# Start Linger on macOS

We are applying for an Apple-recognized signing certificate. **Signed macOS
builds are coming soon.** The steps and screenshots below are a temporary
workaround for the current unsigned package.

You need an Apple silicon Mac running macOS 14.0 or later. There is no package
for Intel Macs; use [Docker Compose](self-hosting.md) there.

## Allow the first launch

[Download the DMG below](#download), open it and drag Linger to Applications.
The package is not yet signed with a certificate Apple recognizes, so macOS
blocks the first launch.

**Run this in Terminal, then open Linger:**

```bash
xattr -dr com.apple.quarantine /Applications/Linger.app
```

**If Terminal prints `Operation not permitted`**, macOS is stopping Terminal
from changing apps, and `sudo` does not help. Open **System Settings › Privacy &
Security › App Management**, turn on **Terminal**, quit and reopen Terminal, and
run the command again.

### Without Terminal

Allow the launch once in System Settings instead:

1. Open Linger from Applications. In the **“Linger” Not Opened** dialog, click
   **Done**. Do not click **Move to Trash**, the highlighted button.

   <img src="../assets/install-macos-not-opened.webp" width="320" alt="The macOS dialog “Linger” Not Opened says Apple could not verify Linger is free of malware, with a highlighted Move to Trash button above a Done button">

2. Open **System Settings › Privacy & Security** and scroll to **Security**.
   Next to **“Linger” was blocked to protect your Mac**, click **Open Anyway**.

   <img src="../assets/install-macos-open-anyway.webp" width="560" alt="System Settings with Privacy &amp; Security selected in the sidebar. Under Security, the message “Linger” was blocked to protect your Mac has an Open Anyway button next to it, and red arrows point to Privacy &amp; Security and to Open Anyway">

3. Click **Open Anyway** again and enter your password or use Touch ID.

If macOS says Linger "is damaged and can't be opened", or **Open Anyway** does
not appear, use the Terminal command above.

## Download

**[Download the latest macOS release](https://github.com/simplexai-labs/linger/releases/latest)**

Under **Assets**, choose `Linger-<version>-macos-arm64.dmg` for Apple silicon.
Check the download against `SHA256SUMS.txt` from the same release.

See [Install the desktop app](https://docs.heylinger.com/install/desktop-app)
for help when setup fails.
