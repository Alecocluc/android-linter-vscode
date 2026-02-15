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
