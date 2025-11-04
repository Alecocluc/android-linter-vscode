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

## Setup and Configuration

For the extension to work correctly, your development environment needs to be properly configured.

### Core Requirements
- **VS Code**: Version 1.85.0 or higher.
- **Android Project**: Must be a Kotlin or Java project that uses Gradle.
- **Gradle Wrapper**: The project must include the Gradle wrapper scripts (`gradlew` and `gradlew.bat`).

### Environment Setup

1.  **Java Development Kit (JDK)**
    - Gradle requires a compatible JDK to run. The required version can vary by project and Gradle version (check your project's documentation).
    - You must set the `JAVA_HOME` environment variable to the installation directory of your JDK.

2.  **Android SDK**
    - The extension needs access to the Android SDK. Ensure your project is configured correctly in one of two ways:
        - **`local.properties` file**: Your project should have a `local.properties` file in the root that contains a valid `sdk.dir` path (e.g., `sdk.dir=C:\\Users\\YourUser\\AppData\\Local\\Android\\Sdk`).
        - **`ANDROID_HOME` variable**: Alternatively, you can set the `ANDROID_HOME` environment variable to the path of your Android SDK.

3.  **Android Debug Bridge (ADB)**
    - `adb` is essential for device management, app installation, and logcat streaming. The `adb` executable must be available in your system's PATH.
    - It is located in the `platform-tools` directory within your Android SDK.
    - **To add `adb` to your PATH:**
        - **Windows**: Add the full path to your `platform-tools` directory (e.g., `C:\Users\YourUser\AppData\Local\Android\Sdk\platform-tools`) to the `Path` environment variable.
        - **macOS/Linux**: Add a line like `export PATH="$PATH:/path/to/your/android/sdk/platform-tools"` to your shell's startup file (e.g., `~/.zshrc`, `~/.bash_profile`, or `~/.bashrc`).
    - **Alternatively**, you can provide a direct path to the executable in the extension settings via `android-linter.adbPath`.

4.  **Gradle Wrapper Detection**
    - The extension automatically finds the Gradle wrapper (`gradlew` or `gradlew.bat`) if it's in the root of your workspace.
    - If your wrapper is in a non-standard location, you can specify its path using the `android-linter.gradlePath` setting.

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

Configure the extension through VS Code settings (`Ctrl+,`). Settings are grouped by category:

### Linting
- `android-linter.lintOnOpen`: Run lint when opening a file (default: `true`).
- `android-linter.lintOnSave`: Run lint when saving a file (default: `true`).
- `android-linter.lintOnChange`: Run lint when changing a file (can impact performance) (default: `false`).
- `android-linter.debounceDelay`: Delay in milliseconds before running lint after file changes (default: `2000`).
- `android-linter.lintScope`: Scope of lint execution - 'project' for full project or 'module' for a specific module (default: `module`).
- `android-linter.lintModule`: Module name to lint when `lintScope` is 'module' (default: `app`).
- `android-linter.lintTimeout`: Timeout for lint operations in milliseconds (default: `600000`).
- `android-linter.showSeverity`: Which severity levels to show in the Problems panel (default: `["Error", "Warning", "Information"]`).
- `android-linter.enableQuickFixes`: Enable quick fix suggestions for lint issues (default: `true`).

### Build & Launch
- `android-linter.launchModule`: Gradle module that contains the Android application (default: `app`).
- `android-linter.launchApplicationId`: Manually override the `applicationId` for deployment and logcat. If empty, the extension will try to detect it automatically.
- `android-linter.launchRememberApplicationId`: Remember a manually entered `applicationId` in workspace settings (default: `true`).
- `android-linter.launchInstallTask`: Gradle task used to install the debug build (default: `installDebug`).
- `android-linter.launchInstallTimeoutMs`: Timeout for the Gradle install task in milliseconds (default: `240000`).
- `android-linter.adbPath`: Path to the `adb` executable. If set to `adb`, it must be in your system's PATH (default: `adb`).

### Logcat
- `android-linter.logcatUseWebview`: Use the enhanced WebView panel for logcat instead of the plain output channel (default: `true`).
- `android-linter.logcatAutoStartOnLaunch`: Automatically start logcat after launching the app (default: `true`).
- `android-linter.logcatLevel`: Minimum log level for logcat streaming (default: `debug`).
- `android-linter.logcatFormat`: Logcat output format (default: `threadtime`).
- `android-linter.logcatAutoClear`: Clear the device logcat buffer before starting a new session (default: `true`).
- `android-linter.logcatMaxBufferSize`: Maximum number of log entries to keep in the webview's memory (default: `10000`).
- `android-linter.logcatAutoScroll`: Automatically scroll to the newest logs in the webview (default: `true`).
- `android-linter.logcatPidWaitTimeoutMs`: How long to wait for the app process to start before applying a PID filter (default: `10000`).
- `android-linter.logcatPidPollIntervalMs`: How often to check for the app's PID while waiting (default: `500`).

### Gradle
- `android-linter.gradlePath`: Path to the `gradlew` executable, relative to the workspace root (default: `./gradlew`).
- `android-linter.gradleStopDaemonsOnIdle`: Automatically stop Gradle daemons after a period of inactivity to conserve resources (default: `true`).
- `android-linter.gradleDaemonIdleTimeoutMs`: Idle time in milliseconds before Gradle daemons are stopped (default: `300000`).
- `android-linter.gradleJvmArgs`: Additional JVM arguments to pass to Gradle (e.g., `-Xmx4g`).
- `android-linter.gradleMaxWorkers`: Limits the number of concurrent workers Gradle can use. `0` uses Gradle's default (default: `0`).

### General
- `android-linter.showStatusBar`: Show the 'Run on Android' button in the status bar. This is disabled by default as all actions are in the Android Explorer panel (default: `false`).
- `android-linter.verboseLogging`: Enable verbose logging to the output channel for debugging the extension (default: `true`).

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