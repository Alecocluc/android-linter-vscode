# 🐛 Debugging Guide - Android Linter Not Working

## Quick Diagnostic Checklist

### 1. Check Output Channel
**Most important step!** The extension now logs everything to help you debug.

1. Open VS Code Output panel: `View` → `Output` (or `Ctrl+Shift+U`)
2. Select **"Android Linter"** from the dropdown menu
3. You should see detailed logs like:
   ```
   🚀 Android Linter extension is now active
   📁 Workspace folders: C:\path\to\your\project
   📄 File opened: MainActivity.kt (language: kotlin)
      Is Android file: true
      ▶️ Running lint on MainActivity.kt
   🔍 Starting lint for: MainActivity.kt
   ```

### 2. Verify Your Project Structure

The extension needs an **Android project with Gradle**. Check you have:

```
your-android-project/
├── gradlew or gradlew.bat  ← REQUIRED!
├── build.gradle            ← REQUIRED!
├── app/
│   ├── build.gradle
│   └── src/
│       └── main/
│           └── kotlin/  or  java/
│               └── YourFile.kt
```

### 3. Test Gradle Manually

Open terminal in your project and run:
```bash
./gradlew lint
# On Windows:
gradlew.bat lint
```

If this fails, the extension won't work either!

### 4. Check File Language

Make sure VS Code recognizes your file as Kotlin or Java:
- Look at bottom-right corner of VS Code
- Should say "Kotlin" or "Java"
- If it says "Plain Text", install the Kotlin extension

### 5. Try Manual Lint

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `Android: Lint Current File`
3. Check Output channel for detailed logs

## Common Issues & Solutions

### ❌ "No workspace folder found"
**Problem**: You opened a single file instead of a folder  
**Solution**: `File` → `Open Folder` → Select your Android project root

### ❌ "Gradle wrapper not found"
**Problem**: Your project doesn't have `gradlew`  
**Solution**: 
```bash
# In your project root:
gradle wrapper
```

### ❌ "Extension not activating"
**Problem**: Extension didn't detect Android project  
**Solution**: 
1. Make sure you have `build.gradle` in workspace root
2. Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"

### ❌ "No lint reports found"
**Problem**: Gradle ran but didn't create reports  
**Solution**:
1. Check your `build.gradle` has lint enabled:
   ```gradle
   android {
       lintOptions {
           xmlReport true
           xmlOutput file("build/reports/lint-results.xml")
       }
   }
   ```
2. Try running `./gradlew clean lint` manually

### ❌ File opens but nothing happens
**Problem**: Logs show file is Android file but no lint runs  
**Check**:
1. Settings → search "android-linter.lintOnOpen"
2. Make sure it's set to `true`

## Step-by-Step Test Procedure

### Test 1: Create Simple Android Project

1. Create new folder: `test-android-lint`
2. Add `build.gradle`:
   ```gradle
   plugins {
       id 'com.android.application' version '8.1.0' apply false
   }
   ```
3. Add `gradlew` wrapper (or copy from existing Android project)
4. Create `app/src/main/kotlin/MainActivity.kt`:
   ```kotlin
   package com.test
   
   class MainActivity {
       fun test() {
           val unused = "test"  // Should trigger UnusedVariable warning
       }
   }
   ```
5. Open folder in VS Code
6. Open MainActivity.kt
7. Check Output channel

### Test 2: Use Existing Android Project

1. Open your Android project in VS Code
2. Open a `.kt` or `.java` file
3. Watch the Output channel ("Android Linter")
4. Should see:
   ```
   📄 File opened: YourFile.kt (language: kotlin)
   ✅ Is Android file: kotlin file in workspace
   ▶️ Running lint on YourFile.kt
   🔧 Looking for Gradle wrapper at: ...
   ✅ Found Gradle wrapper
   ⚙️ Running command: ...
   ```

### Test 3: Manual Command

1. `Ctrl+Shift+P`
2. Type: `Android: Lint Entire Project`
3. Wait for progress notification
4. Check Problems panel (`Ctrl+Shift+M`)

## What the Logs Tell You

### Good Signs ✅
```
🚀 Android Linter extension is now active
📁 Workspace folders: C:\your\project
✅ Found Gradle wrapper
⚙️ Running command: "...\gradlew.bat" lint --continue
✅ Lint completed. Found 5 issue(s)
📊 Issues added to Problems panel
```

### Bad Signs ❌
```
❌ Gradle wrapper not found at ...
```
→ Missing gradlew file

```
❌ Not Android file: wrong language (plaintext)
```
→ Install Kotlin/Java extension

```
❌ No lint reports found
```
→ Gradle didn't generate reports (check build.gradle)

## Advanced Debugging

### Enable Maximum Logging

1. Open Debug Console (`Ctrl+Shift+Y`)
2. You'll see console.log() output there too

### Check Extension Host Logs

1. `Help` → `Toggle Developer Tools`
2. Go to Console tab
3. Look for errors related to "android-linter"

### Verify Extension is Loaded

1. `Ctrl+Shift+P`
2. Type: `Developer: Show Running Extensions`
3. Search for "android-linter"
4. Should show as "Activated"

### Test with Sample Code

Create a file with known lint issues:
```kotlin
package com.test

import android.widget.ImageView  // Unused import
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val text = "Hardcoded"  // HardcodedText if in XML context
        val unused = 123  // UnusedVariable
    }
}
```

## Still Not Working?

1. **Show me the logs**: Copy everything from Output > Android Linter
2. **Check Problems panel**: `View` → `Problems` (Ctrl+Shift+M)
3. **Try terminal first**: `./gradlew lint` should work
4. **Verify Kotlin extension**: Install if language shows "Plain Text"
5. **Reload window**: `Ctrl+Shift+P` → "Reload Window"

## Success Indicators

You know it's working when:
- ✅ Output channel shows lint running
- ✅ Progress notification appears: "Linting YourFile.kt..."
- ✅ Problems panel shows issues
- ✅ Squiggly lines appear under code
- ✅ Lightbulb (💡) shows quick fixes

## Performance Tips

If linting is too slow:
```json
{
  "android-linter.lintOnOpen": true,
  "android-linter.lintOnSave": true,
  "android-linter.lintOnChange": false,  // Disable real-time
  "android-linter.debounceDelay": 3000   // 3 second delay
}
```
