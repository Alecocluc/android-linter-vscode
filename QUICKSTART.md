# Quick Start Guide 🚀

## Testing Your Extension

### 1. Test in Development Mode (Recommended)

Press **F5** or click the "Run Extension" button in the Debug panel. This will:
- Open a new VS Code window with your extension loaded
- Allow you to test changes in real-time
- Show debug output in the Debug Console

### 2. What to Test

Open an Android project in the Extension Development Host window and:

1. **Open a Kotlin/Java file** → Should automatically lint
2. **Check Problems Panel** → View → Problems (or `Ctrl+Shift+M`)
3. **Test Quick Fixes**:
   - Click on a line with a warning/error
   - Press `Ctrl+.` (or click the 💡 lightbulb)
   - Select a quick fix

4. **Try Commands** (Ctrl+Shift+P):
   - Type "Android: Lint Current File"
   - Type "Android: Lint Entire Project"
   - Type "Android: Clear Lint Results"

### 3. Sample Android Code to Test

Create a file `MainActivity.kt` in your test project:

```kotlin
package com.example.test

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.widget.TextView
import android.widget.ImageView  // Unused import - should show warning

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val textView = TextView(this)
        textView.text = "Hardcoded text"  // HardcodedText warning
        
        val imageView = ImageView(this)
        // Missing contentDescription - accessibility warning
    }
}
```

Expected lint issues:
- ❌ **UnusedImport**: Remove unused import for ImageView
- ⚠️ **HardcodedText**: Extract "Hardcoded text" to string resource
- ⚠️ **ContentDescription**: Add contentDescription to ImageView

## Available Commands

| Command | Description |
|---------|-------------|
| `Android: Lint Current File` | Lint the currently active file |
| `Android: Lint Entire Project` | Run lint on entire project |
| `Android: Clear Lint Results` | Clear all diagnostics from Problems panel |

## Settings You Can Configure

Open Settings (`Ctrl+,`) and search for "android-linter":

```json
{
  // Run lint when opening a file
  "android-linter.lintOnOpen": true,
  
  // Run lint when saving a file
  "android-linter.lintOnSave": true,
  
  // Run lint while typing (may impact performance)
  "android-linter.lintOnChange": false,
  
  // Path to Gradle wrapper
  "android-linter.gradlePath": "./gradlew",
  
  // Which severity levels to show
  "android-linter.showSeverity": ["Error", "Warning", "Information"],
  
  // Timeout for lint operations (ms)
  "android-linter.lintTimeout": 60000,
  
  // Delay before linting after changes (ms)
  "android-linter.debounceDelay": 2000,
  
  // Enable quick fix suggestions
  "android-linter.enableQuickFixes": true
}
```

## Expected Behavior

### ✅ When You Open a File
1. Extension detects it's a Kotlin/Java file in an Android project
2. Runs `./gradlew lint` in the background
3. Parses lint report from `build/reports/`
4. Shows issues in Problems panel

### ✅ When You See a Warning
1. Line is underlined with squiggly line
2. Click the lightbulb icon (💡)
3. See available quick fixes:
   - Extract string resource
   - Remove unused import
   - Add content description
   - Suppress lint warning
   - And more!

### ✅ Problems Panel
- **Errors** 🔴 - Critical issues that must be fixed
- **Warnings** ⚠️ - Issues that should be addressed
- **Info** 💡 - Suggestions for improvement

## Troubleshooting

### Extension Not Loading?
- Check that you pressed F5 in the main window (not the Extension Development Host)
- Look for errors in Debug Console

### No Lint Results?
1. Verify your test project has `build.gradle` or `build.gradle.kts`
2. Check that file is in `src/main/`, `src/test/`, or `src/androidTest/`
3. Run `./gradlew lint` manually in terminal to verify it works

### Quick Fixes Not Appearing?
- Make sure the issue has a known quick fix (see `codeActionProvider.ts`)
- Check that `enableQuickFixes` is `true` in settings
- Try clicking the lightbulb icon or pressing `Ctrl+.`

## Next Steps

### 1. Make Changes
Edit files in `src/` directory:
- `extension.ts` - Main entry point
- `lintManager.ts` - Lint coordination
- `codeActionProvider.ts` - Quick fixes
- And more...

### 2. Watch Mode
Run in terminal:
```bash
npm run watch
```
This will automatically recompile when you save files.

### 3. Reload Extension
After making changes:
- Press `Ctrl+R` in the Extension Development Host window
- Or restart debugging (Ctrl+Shift+F5)

### 4. Package Extension
When ready to share:
```bash
npm install -g @vscode/vsce
vsce package
```
This creates a `.vsix` file you can install or share.

## Need Help?

- Read `DEVELOPMENT.md` for detailed development guide
- Check `README.md` for user documentation
- View source code comments for implementation details

---

**Happy Coding! 🎉**
