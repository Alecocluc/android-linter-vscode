package com.alecocluc.androidls

import org.eclipse.lsp4j.launch.LSPLauncher
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.Executors

/**
 * Entry point for the Android Language Server.
 * 
 * Communicates with VS Code via Language Server Protocol over stdin/stdout.
 * Embeds the Android Lint engine (com.android.tools.lint) for real-time,
 * per-file linting with 1:1 parity to Android Studio's 400+ checks.
 */
fun main(args: Array<String>) {
    // Workaround: IntelliJ's JavaVersion.parse() (bundled in kotlin-compiler-embeddable)
    // crashes on JDK 25+ because it doesn't recognize the version string format.
    // Override java.version to a known-good value so UAST initialization succeeds.
    // The actual JVM is still 25 — only the version string parsing is affected.
    patchJavaVersionIfNeeded()
    
    val input: InputStream = System.`in`
    val output: OutputStream = System.out
    
    // Redirect System.out/err so server logs don't corrupt the LSP stream
    System.setOut(System.err)
    
    val server = AndroidLanguageServer()
    val executor = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "als-worker").apply { isDaemon = true }
    }
    
    val launcher = LSPLauncher.createServerLauncher(
        server,
        input,
        output,
        executor
    ) { builder -> builder }
    
    val client = launcher.remoteProxy
    server.connect(client)
    
    // Start listening — blocks until the connection is closed
    launcher.startListening().get()
}

/**
 * Patch java.version system property if the current JDK version is too new
 * for the IntelliJ platform code bundled in kotlin-compiler-embeddable.
 *
 * IntelliJ's JavaVersion.parse() throws IllegalArgumentException for
 * JDK versions it doesn't recognize (e.g., 25.0.2). We detect this and
 * override with "21.0.2" so UAST/lint initialization succeeds.
 * The actual runtime remains JDK 25 — only the version string is patched.
 */
private fun patchJavaVersionIfNeeded() {
    val version = System.getProperty("java.version") ?: return
    try {
        // Parse major version — handles "25.0.2", "21.0.2", "17.0.1", etc.
        val major = version.split(".").firstOrNull()?.toIntOrNull() ?: return
        if (major >= 24) {
            // IntelliJ platform bundled in kotlin-compiler-embeddable 2.x
            // doesn't support JDK 24+. Override with a compatible version.
            System.setProperty("java.version", "21.0.2")
            System.err.println("[ALS] Patched java.version from $version to 21.0.2 (IntelliJ compat)")
        }
    } catch (_: Exception) {
        // If parsing fails, leave the version as-is and let lint handle it
    }
}
