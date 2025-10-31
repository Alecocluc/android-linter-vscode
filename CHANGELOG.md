# Changelog

All notable changes to this project will be documented in this file.

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
