# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2025-11-25

### 🔧 Refactoring & Improvements

#### Added
- **Centralized Logger** - New `Logger` class for consistent logging across all modules
  - Semantic log methods (`success()`, `error()`, `warn()`, `build()`, `stop()`, etc.)
  - Automatic verbose mode support via settings
  - Consistent emoji prefixes for better log readability

- **Constants Module** - Extracted all magic strings to `constants.ts`
  - `CONFIG_NAMESPACE` and `CONFIG_KEYS` for type-safe configuration access
  - `COMMANDS` and `VIEWS` for command/view identifiers
  - `DEFAULTS` and `FILE_PATTERNS` for common values

- **Extract String Resource Command** - New refactoring action
  - Extract hardcoded strings to `strings.xml`
  - Automatically replaces with `@string/` or `R.string.` reference

#### Changed
- **Improved Activation Events** - Extension now activates only for Android projects
  - Triggers on `build.gradle`, `build.gradle.kts`, or `AndroidManifest.xml`
  - Activates on Kotlin/Java file open
  - Reduces VS Code startup time for non-Android workspaces

- **Enhanced Definition & Reference Providers**
  - Now uses VS Code's built-in workspace symbol provider first
  - Falls back to regex-based search for comprehensive coverage
  - Added caching with timestamp validation
  - Skip binary files and common keywords for better performance

- **Type-Safe Webview Messaging** - `logcatWebview.ts` improvements
  - Added `WebviewToExtensionMessage` and `ExtensionToWebviewMessage` types
  - Extracted `LogcatFilter` interface

#### Fixed
- Fixed unreachable code in `gradleLintRunner.ts` error handling
- Fixed missing `await` on `withProgress` calls in `adbWirelessManager.ts`
- Removed duplicate `log()` methods across multiple files (now use `Logger`)

### Internal
- Removed scattered logging functions in favor of centralized `Logger` class
- Configuration access now uses constants instead of hardcoded strings
- Better error handling flow in Gradle lint result parsing

## [0.1.0] - 2025-10-31

### 🎉 Major UI Overhaul

#### Added
- **Android Explorer Panel** - New dedicated sidebar panel with visual device management
  - Device list with real-time status indicators
  - One-click actions (Install & Launch, Start/Stop Logcat, Lint Project)
  - Status section showing active device, app ID, logcat state, and Gradle activity
  - Persistent device selection across sessions
  - Refresh button for detecting new devices

- **Enhanced Logcat WebView Panel** - Revolutionary log viewing experience
  - Color-coded logs by severity (Error=red, Warning=yellow, Info=green, Debug=blue, Verbose=gray)
  - Interactive filtering by log level with toolbar buttons
  - Real-time text search across all logs
  - Click any tag to filter by that component
  - Pause/Resume streaming without stopping collection
  - Auto-scroll toggle for controlling log display
  - Statistics display (total logs, errors, warnings)
  - One-click copy all visible logs to clipboard
  - Performance optimized for 10,000+ log entries
  - Beautiful VS Code theme-aware styling

- **Logcat Parser** - Structured log parsing
  - Parses Android threadtime format
  - Extracts timestamp, PID, TID, level, tag, and message
  - Support for filtering by multiple criteria
  - Formatted output with icons and colors

#### Changed
- Status bar button now hidden by default (use `android-linter.showStatusBar` to re-enable)
- Logcat now uses WebView panel by default (use `android-linter.logcatUseWebview: false` for old behavior)
- Improved device selection UX - no more modal dialogs
- Better visual feedback for running processes

#### New Settings
- `android-linter.logcatUseWebview` - Enable enhanced WebView panel (default: true)
- `android-linter.logcatMaxBufferSize` - Maximum log entries to keep (default: 10000)
- `android-linter.logcatAutoScroll` - Auto-scroll to newest logs (default: true)
- `android-linter.showStatusBar` - Show status bar button (default: false)

#### New Commands
- `android-linter.refreshDevices` - Refresh device list
- `android-linter.selectDevice` - Select active device
- `android-linter.clearLogcat` - Clear logcat display

### Performance Improvements
- Debounced device refresh to prevent excessive ADB calls
- Virtual log rendering for handling large log volumes
- Client-side filtering for instant results
- Automatic log buffer trimming to prevent memory issues

## [0.0.1] - 2025-10-30

### Added

- Initial release of the Android Linter extension.
- Real-time linting for Kotlin, Java, and XML files.
- Quick fix suggestions for common Android issues.
- Gradle integration for running lint tasks.
- Support for XML and JSON lint reports.
