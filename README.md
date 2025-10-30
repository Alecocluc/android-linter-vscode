# Android Linter for VS Code

A powerful VS Code extension that brings Android Studio-like linting capabilities to Visual Studio Code. Get real-time error detection, warnings, and quick fixes for your Android Kotlin/Java projects.

## Features

✨ **Real-time Linting**: Automatically scans files when opened, saved, or edited
🎯 **Comprehensive Diagnostics**: Shows errors, warnings, and informational messages in the Problems panel
� **Compilation Errors**: Detects Kotlin/Java compilation errors before running lint
�🔧 **Quick Fixes**: Right-click on issues to apply suggested fixes
⚡ **Gradle Integration**: Uses Android's official lint tools via Gradle
🚀 **Lightweight**: No need to run Android Studio
📊 **Multiple Report Formats**: Supports XML, JSON, and SARIF lint reports

## Requirements

- VS Code 1.85.0 or higher
- Android project with Gradle wrapper (`gradlew` or `gradlew.bat`)
- Kotlin or Java Android project

## Usage

### Automatic Linting

The extension automatically lints your files when you:
- Open a Kotlin/Java file in an Android project
- Save a file
- Edit a file (if enabled in settings)

### Manual Linting

Use the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):
- `Android: Lint Current File` - Lint the currently open file
- `Android: Lint Entire Project` - Run lint on the entire project
- `Android: Clear Lint Results` - Clear all lint diagnostics

### Quick Fixes

When you see a warning or error:
1. Click on the line with the issue
2. Click the lightbulb icon (💡) or press `Ctrl+.` (or `Cmd+.` on Mac)
3. Select a quick fix from the menu

## Available Quick Fixes

- **Extract string resource** - For hardcoded text
- **Remove unused imports** - Clean up unused code
- **Add contentDescription** - Fix accessibility issues
- **Replace left/right with start/end** - Fix RTL layout issues
- **Suppress lint warnings** - Add @SuppressLint annotations
- And more!

## Extension Settings

Configure the extension through VS Code settings:

- `android-linter.lintOnOpen`: Run lint when opening a file (default: `true`)
- `android-linter.lintOnSave`: Run lint when saving a file (default: `true`)
- `android-linter.lintOnChange`: Run lint when changing a file (default: `false`)
- `android-linter.gradlePath`: Path to gradlew executable (default: `./gradlew`)
- `android-linter.showSeverity`: Which severity levels to show (default: `["Error", "Warning", "Information"]`)
- `android-linter.lintTimeout`: Timeout for lint operations in ms (default: `60000`)
- `android-linter.debounceDelay`: Delay before running lint after changes in ms (default: `2000`)
- `android-linter.enableQuickFixes`: Enable quick fix suggestions (default: `true`)

## How It Works

1. **Detection**: The extension detects Android projects by looking for `build.gradle` or `build.gradle.kts` files
2. **Lint Execution**: Runs `./gradlew lint --continue` (or `gradlew.bat` on Windows) in the background
3. **Error Detection**: Parses both compilation errors and lint warnings from the Gradle output
4. **Report Parsing**: Reads XML/JSON lint reports from `build/reports/` for detailed warnings
5. **Display**: Shows errors and warnings in VS Code's Problems panel with proper severity levels
6. **Quick Fixes**: Provides contextual code actions for common issues

## Performance Tips

- Set `lintOnChange` to `false` for better performance (lint only on save)
- Increase `debounceDelay` if linting feels too aggressive
- Use `lintOnOpen: false` for large projects with many files

## Troubleshooting

### Gradle wrapper not found
Make sure your project has a `gradlew` (Linux/Mac) or `gradlew.bat` (Windows) file in the workspace root.

### No lint results showing
1. Check that you're editing a file in `src/main/`, `src/test/`, or `src/androidTest/`
2. Verify your project builds successfully with `./gradlew lint` from terminal
3. Check the Output panel (View → Output → Android Linter) for errors

### Lint is too slow
1. Increase the `debounceDelay` setting
2. Disable `lintOnChange`
3. Run lint manually with the command palette

## Contributing

Found a bug or want to contribute? Please open an issue or pull request on GitHub.

## License

MIT

## Release Notes

### 0.0.1

Initial release with core features:
- Automatic linting on file open/save
- Quick fix suggestions
- Gradle integration
- XML/JSON report parsing
