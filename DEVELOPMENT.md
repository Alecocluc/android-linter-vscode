# Development and Testing Guide

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- VS Code (v1.85.0 or higher)
- An Android project with Gradle for testing

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Compile TypeScript:**
   ```bash
   npm run compile
   ```

3. **Watch mode (for development):**
   ```bash
   npm run watch
   ```

## Testing the Extension

### Method 1: Run Extension (F5)

1. Open this project in VS Code
2. Press `F5` or go to Run → Start Debugging
3. A new VS Code window will open with the extension loaded
4. Open an Android project in that window
5. Open any `.kt` or `.java` file to trigger linting

### Method 2: Install Locally

1. **Package the extension:**
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

2. **Install the .vsix file:**
   - In VS Code: Extensions → `...` menu → Install from VSIX
   - Or use command line: `code --install-extension android-linter-0.0.1.vsix`

## Project Structure

```
android-linter/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── lintManager.ts            # Coordinates linting operations
│   ├── gradleLintRunner.ts       # Runs Gradle lint commands
│   ├── lintReportParser.ts       # Parses XML/JSON lint reports
│   ├── diagnosticProvider.ts     # Manages VS Code diagnostics
│   └── codeActionProvider.ts     # Provides quick fixes
├── out/                          # Compiled JavaScript (generated)
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # User documentation
```

## Key Features

### 1. Automatic Linting
The extension automatically lints files when:
- A Kotlin/Java file is opened
- A file is saved
- A file is changed (optional, with debouncing)

### 2. Diagnostic Provider
- Converts lint issues to VS Code diagnostics
- Shows in Problems panel
- Supports Error, Warning, and Information severity levels

### 3. Quick Fixes
Provides context-aware code actions for:
- Extracting string resources
- Removing unused imports
- Adding content descriptions
- Fixing RTL layout issues
- Suppressing lint warnings

### 4. Gradle Integration
- Detects Android projects by looking for `build.gradle`
- Runs `./gradlew lint` in the background
- Parses XML/JSON reports from `build/reports/`

## Configuration Options

Users can configure the extension in VS Code settings:

```json
{
  "android-linter.lintOnOpen": true,
  "android-linter.lintOnSave": true,
  "android-linter.lintOnChange": false,
  "android-linter.gradlePath": "./gradlew",
  "android-linter.showSeverity": ["Error", "Warning", "Information"],
  "android-linter.lintTimeout": 60000,
  "android-linter.debounceDelay": 2000,
  "android-linter.enableQuickFixes": true
}
```

## Extending the Extension

### Adding New Quick Fixes

1. **Add the issue ID to `codeActionProvider.ts`:**
   ```typescript
   case 'YourIssueId':
       actions.push(this.createYourFixAction(document, diagnostic));
       break;
   ```

2. **Implement the fix action:**
   ```typescript
   private createYourFixAction(
       document: vscode.TextDocument,
       diagnostic: vscode.Diagnostic
   ): vscode.CodeAction {
       const action = new vscode.CodeAction(
           'Your fix title',
           vscode.CodeActionKind.QuickFix
       );
       action.diagnostics = [diagnostic];
       
       const edit = new vscode.WorkspaceEdit();
       // ... create your edit
       action.edit = edit;
       
       return action;
   }
   ```

### Adding Support for New Report Formats

1. **Add parser in `lintReportParser.ts`:**
   ```typescript
   public parseSarifReport(sarifContent: string, workspaceRoot: string): LintIssue[] {
       // Parse SARIF format
   }
   ```

2. **Call from `gradleLintRunner.ts`:**
   ```typescript
   const sarifReportPath = path.join(workspaceRoot, 'app', 'build', 'reports', 'lint-results.sarif');
   if (fs.existsSync(sarifReportPath)) {
       const sarifContent = fs.readFileSync(sarifReportPath, 'utf-8');
       return this.parser.parseSarifReport(sarifContent, workspaceRoot);
   }
   ```

## Commands

The extension provides these commands:

- `android-linter.lintCurrentFile` - Lint the active file
- `android-linter.lintProject` - Lint entire project
- `android-linter.clearDiagnostics` - Clear all diagnostics

## Debugging

### Enable Extension Host Logging

1. Set in your VS Code settings:
   ```json
   {
     "developer.logLevel": "trace"
   }
   ```

2. View logs:
   - Help → Toggle Developer Tools → Console

### Check Extension Output

- View → Output → Select "Android Linter" from dropdown

### Test with Sample Project

Create a simple Android project with lint issues:

```kotlin
// MainActivity.kt
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // This will trigger HardcodedText lint warning
        val textView = TextView(this)
        textView.text = "Hello World"  // Should use string resource
    }
}
```

## Publishing

### Before Publishing

1. Update `package.json`:
   - Set your publisher name
   - Update version number
   - Add icon and repository URLs

2. Test thoroughly with real Android projects

3. Update CHANGELOG.md

### Publish to Marketplace

```bash
# Login to Visual Studio Marketplace
vsce login your-publisher-name

# Publish
vsce publish
```

## Troubleshooting Development Issues

### TypeScript Errors
- Run `npm run compile` to see all errors
- Check `tsconfig.json` for configuration issues

### Extension Not Activating
- Check `activationEvents` in `package.json`
- Ensure Android project has `build.gradle` file

### Lint Not Running
- Verify Gradle wrapper exists in test project
- Check Output panel for error messages
- Try running `./gradlew lint` manually in terminal

### Quick Fixes Not Showing
- Ensure `enableQuickFixes` is true in settings
- Check that diagnostic has matching issue ID in `codeActionProvider.ts`

## Performance Considerations

- **Debouncing**: Used for `lintOnChange` to avoid excessive runs
- **File Filtering**: Only processes Kotlin/Java files in Android directories
- **Incremental Linting**: Attempts to filter results by file when possible
- **Cancellation**: Supports cancellation for long-running operations

## Future Enhancements

Potential improvements:
- [ ] Support for custom lint rules
- [ ] Integration with Kotlin compiler for real-time syntax checking
- [ ] More sophisticated quick fixes with AI assistance
- [ ] Lint rule documentation on hover
- [ ] Performance optimizations for large projects
- [ ] Support for multi-module Android projects
- [ ] Custom severity level mapping
- [ ] Baseline lint report support
