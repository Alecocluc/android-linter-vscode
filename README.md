# Android Linter for VS Code

![Android Linter Banner](https://placehold.co/1280x320/000000/FFFFFF/png?text=Android%20Linter)

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=AlecoCluc.android-linter">
    <img src="https://img.shields.io/visual-studio-marketplace/v/AlecoCluc.android-linter.svg?style=flat-square&label=Marketplace" alt="Marketplace">
  </a>
  <a href="https://github.com/Alecocluc/android-vscode/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/Alecocluc/android-vscode.svg?style=flat-square" alt="License">
  </a>
</p>

A powerful extension that brings Android Studio-like linting capabilities to Visual Studio Code. Get real-time error detection, warnings, and quick fixes for your Android Kotlin/Java projects.

## Features

### 🎉 NEW: Android Explorer Panel
📱 **Visual Device Management**: Dedicated sidebar panel showing all connected devices and emulators with real-time status indicators.
⚡ **One-Click Actions**: Quick access to Install & Launch, Start/Stop Logcat, and Lint Project.
📊 **Live Status Dashboard**: Monitor active device, app ID, logcat state, and Gradle activity at a glance.
⭐ **Persistent Selection**: Your selected device is remembered across sessions.

### 🎨 NEW: Enhanced Logcat WebView
🌈 **Color-Coded Logs**: Error (red), Warning (yellow), Info (green), Debug (blue), Verbose (gray).
🔍 **Interactive Filtering**: Click level buttons or tags to filter instantly.
⏸️ **Pause/Resume**: Control log streaming without stopping collection.
📋 **One-Click Copy**: Copy all visible logs to clipboard.
📈 **Statistics**: See total logs, error count, and warning count in real-time.
🎯 **Smart Search**: Real-time text search across all logs.

### Core Features
✨ **Real-time Linting**: Automatically scans files when opened, saved, or edited.
🎯 **Comprehensive Diagnostics**: Shows errors, warnings, and informational messages in the Problems panel.
☕ **Compilation Errors**: Detects Kotlin/Java compilation errors before running lint.
🔧 **Quick Fixes**: Right-click on issues to apply suggested fixes.
⚡ **Gradle Integration**: Uses Android's official lint tools via Gradle while managing daemon lifetime.
🚀 **Install & Run**: Deploy and launch your debug build on any connected device.
📡 **Logcat Streaming**: Follow filtered `logcat` output (`package:mine` style) with beautiful UI.
🧠 **Smart Activity Detection**: Auto-detects `applicationId` and launcher activity when possible.
📊 **Multiple Report Formats**: Supports XML, JSON, and SARIF lint reports.

## Requirements

- VS Code 1.85.0 or higher
- Android project with Gradle wrapper (`gradlew` or `gradlew.bat`)
- Kotlin or Java Android project

## Usage

### 🚀 Quick Start with Android Explorer

1. **Open Android Explorer Panel**
   - Click the Android icon (🤖) in the Activity Bar (left sidebar)
   - Panel shows three sections: Devices, Actions, and Status

2. **Select Your Device**
   - In the **Devices** section, click any connected device to select it
   - Selected device is marked with ⭐ and remembered across sessions
   - Use the Refresh button if your device doesn't appear

3. **Launch Your App**
   - Click **"Install & Launch App"** in the Actions section
   - Extension builds, installs, and launches automatically
   - Logcat starts automatically in a beautiful WebView panel

4. **View Logs**
   - Enhanced logcat opens with color-coded logs
   - Use toolbar to filter by level, search text, or pause streaming
   - Click any tag to filter logs by that component

### Automatic Linting

The extension automatically lints your files when you:
- Open a Kotlin/Java file in an Android project
- Save a file
- Edit a file (if enabled in settings)

### Manual Commands

Use the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):
- `Android: Lint Current File` - Lint the currently open file
- `Android: Lint Entire Project` - Run lint on the entire project
- `Android: Clear Lint Results` - Clear all lint diagnostics
- `Android: Install Debug Build on Device` - Install and launch the app
- `Android: Start Logcat (package:mine)` - Stream logcat with package filter
- `Android: Stop Logcat` - Stop the current logcat session
- `Android: Refresh Devices` - Refresh device list
- `Android: Clear Logcat` - Clear logcat display

Or use the **Android Explorer Panel** for visual access to all actions!

### Quick Fixes

When you see a warning or error:
1. Click on the line with the issue.
2. Click the lightbulb icon (💡) or press `Ctrl+.` (or `Cmd+.` on Mac).
3. Select a quick fix from the menu.

## Available Quick Fixes

- **Extract string resource** - For hardcoded text
- **Remove unused imports** - Clean up unused code
- **Add contentDescription** - Fix accessibility issues
- **Replace left/right with start/end** - Fix RTL layout issues
- **Suppress lint warnings** - Add @SuppressLint annotations
- And more!

## Extension Settings

Configure the extension through VS Code settings (`Ctrl+,`):

- `android-linter.lintOnOpen`: Run lint when opening a file (default: `true`)
- `android-linter.lintOnSave`: Run lint when saving a file (default: `true`)
- `android-linter.lintOnChange`: Run lint when changing a file (default: `false`)
- `android-linter.gradlePath`: Path to gradlew executable (default: `./gradlew`)
- `android-linter.showSeverity`: Which severity levels to show (default: `["Error", "Warning", "Information"]`)
- `android-linter.lintTimeout`: Timeout for lint operations in ms (default: `60000`)
- `android-linter.debounceDelay`: Delay before running lint after changes in ms (default: `2000`)
- `android-linter.enableQuickFixes`: Enable quick fix suggestions (default: `true`)
- `android-linter.adbPath`: Path to the `adb` executable (default: `adb`)
- `android-linter.launchModule`: Gradle module containing the app (default: `app`)
- `android-linter.launchApplicationId`: Override the detected `applicationId`
- `android-linter.launchInstallTask`: Gradle task for deployment (default: `installDebug`)
- `android-linter.launchInstallTimeoutMs`: Timeout for install task (default: `240000`)
- `android-linter.logcatLevel`: Minimum log level for logcat streaming (default: `info`)
- `android-linter.logcatFormat`: Logcat output format (default: `threadtime`)
- `android-linter.logcatAutoClear`: Clear logcat buffer before streaming (default: `true`)
- `android-linter.logcatAutoStartOnLaunch`: Auto-start logcat after launch (default: `true`)
- `android-linter.logcatPidWaitTimeoutMs`: Time to wait for the app process before falling back to full logcat (default: `10000`)
- `android-linter.logcatPidPollIntervalMs`: Interval between PID checks while waiting for the app process (default: `500`)
- `android-linter.gradleStopDaemonsOnIdle`: Stop Gradle daemons after inactivity (default: `true`)
- `android-linter.gradleDaemonIdleTimeoutMs`: Idle timeout before stopping daemons (default: `300000`)
- `android-linter.gradleJvmArgs`: Additional JVM args for Gradle (default: `''`)
- `android-linter.gradleMaxWorkers`: Limit Gradle max workers (default: `0` for default)
- `android-linter.logcatUseWebview`: Use enhanced WebView panel for logcat (default: `true`)
- `android-linter.logcatMaxBufferSize`: Maximum log entries to keep in memory (default: `10000`)
- `android-linter.logcatAutoScroll`: Automatically scroll to newest logs (default: `true`)
- `android-linter.showStatusBar`: Show 'Run on Android' button in status bar (default: `false`)

## How It Works

1. **Detection**: The extension detects Android projects by looking for `build.gradle` or `build.gradle.kts` files.
2. **Lint Execution**: Runs `./gradlew lint --continue` (or `gradlew.bat` on Windows) in the background.
3. **Daemon Management**: Keeps Gradle daemons alive while work is active and stops them after an idle timeout.
4. **Error Detection**: Parses both compilation errors and lint warnings from the Gradle output.
5. **Report Parsing**: Reads XML/JSON lint reports from `build/reports/` for detailed warnings.
6. **Display**: Shows errors and warnings in VS Code's Problems panel.
7. **Quick Fixes**: Provides contextual code actions for common issues.
8. **Deploy & Launch**: Installs the selected build variant, launches the app, and optionally starts logcat.

## Changelog

See the [CHANGELOG.md](CHANGELOG.md) file for details on each release.

## Contributing

Found a bug or want to contribute? Please open an issue or pull request on the [GitHub repository](https://github.com/Alecocluc/android-vscode).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.