# Start Linger on macOS

The official macOS package is signed with an Apple Developer ID and notarized
by Apple starting with Linger 0.1.8.

You need an Apple silicon Mac running macOS 14.0 or later. There is no package
for Intel Macs; use [Docker Compose](self-hosting.md) there.

## Install Linger

1. [Download the DMG below](#download).
2. Open the DMG and drag Linger to **Applications**.
3. Open Linger from **Applications** and follow the setup screen.

## Download

**[Download the latest macOS release](https://github.com/simplexai-labs/linger/releases/latest)**

Under **Assets**, choose `Linger-<version>-macos-arm64.dmg` for Apple silicon.
Check the download against `SHA256SUMS.txt` from the same release.

See [Install the desktop app](https://docs.heylinger.com/install/desktop-app)
for help when setup fails.

## Keep Computer permissions after an update

When upgrading from an earlier ad-hoc signed release, such as 0.1.6, to 0.1.8
or later, you may need to grant Screen Recording and Accessibility again once.
macOS should retain these grants across subsequent signed updates.

Computer use involves two apps with their own grants: **CuaDriver**, which
captures the screen and sends input, and **Linger**, which starts it. The
permission card's **Computer use (CuaDriver)** rows read what CuaDriver reports
about itself; macOS may also evaluate Linger, the app that starts CuaDriver, for
the same capture. When signing changes, an older grant may no longer match the
app's identity while **System Settings › Privacy & Security** still shows the
switch on. CuaDriver caches its Screen Recording status until it restarts.

Symptoms: a Room's permission card reports **Computer use (CuaDriver) · Screen
Recording — Not allowed** while System Settings shows the switches on, computer
actions fail, and a message can later fail with `The Runtime process could not
be confirmed stopped`.

Record the grants again:

1. In **System Settings › Privacy & Security › Screen Recording**, switch the
   **CuaDriver** row off and back on. If the row is missing, add it with **+**:
   `Linger.app/Contents/Resources/cli/computer-tools/cua/CuaDriver.app`. Do the
   same for **Linger**.
2. Repeat both rows under **Accessibility**.
3. Quit Linger and open it again, so CuaDriver starts with the new records.

From a terminal, clear both identities instead and grant again afterwards:

```bash
tccutil reset ScreenCapture com.trycua.driver
tccutil reset Accessibility com.trycua.driver
tccutil reset ScreenCapture com.simplexai.linger.desktop.preview
tccutil reset Accessibility com.simplexai.linger.desktop.preview
```
