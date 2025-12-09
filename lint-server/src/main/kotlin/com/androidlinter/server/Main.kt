package com.androidlinter.server

import com.androidlinter.server.lint.LintAnalyzer
import com.androidlinter.server.protocol.JsonRpcServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json

/**
 * Main entry point for the Android Lint Server.
 * 
 * This server provides fast lint analysis by keeping the Android Lint library
 * loaded in memory, avoiding the overhead of starting Gradle for each analysis.
 * 
 * Usage:
 *   java -jar lint-server.jar daemon          # Run as daemon (default)
 *   java -jar lint-server.jar analyze <path>  # Analyze a single file
 *   java -jar lint-server.jar version         # Print version info
 */
fun main(args: Array<String>) {
    val mode = args.getOrNull(0) ?: "daemon"
    
    when (mode) {
        "daemon" -> runDaemon()
        "analyze" -> {
            val path = args.getOrNull(1) ?: run {
                System.err.println("Usage: lint-server analyze <file-or-project-path>")
                System.exit(1)
                return
            }
            runSingleAnalysis(path)
        }
        "version" -> {
            println("Android Lint Server v1.0.0")
            println("Java: ${System.getProperty("java.version")}")
            println("Kotlin: ${KotlinVersion.CURRENT}")
        }
        "help", "-h", "--help" -> {
            println("""
                Android Lint Server
                
                Usage:
                  lint-server daemon          Run as JSON-RPC daemon (stdin/stdout)
                  lint-server analyze <path>  Analyze a file or project
                  lint-server version         Print version information
                  lint-server help            Show this help message
            """.trimIndent())
        }
        else -> {
            System.err.println("Unknown mode: $mode")
            System.err.println("Use 'lint-server help' for usage information")
            System.exit(1)
        }
    }
}

private fun runDaemon() {
    System.err.println("[LintServer] Starting in daemon mode...")
    
    val analyzer = LintAnalyzer()
    val server = JsonRpcServer(analyzer)
    
    // Handle shutdown gracefully
    Runtime.getRuntime().addShutdownHook(Thread {
        System.err.println("[LintServer] Shutting down...")
        analyzer.shutdown()
    })
    
    server.start()
}

private fun runSingleAnalysis(path: String) = runBlocking {
    System.err.println("[LintServer] Analyzing: $path")
    
    val analyzer = LintAnalyzer()
    val json = Json { prettyPrint = true }
    
    try {
        val file = java.io.File(path)
        
        if (!file.exists()) {
            System.err.println("Error: Path does not exist: $path")
            System.exit(1)
            return@runBlocking
        }
        
        // Find project root (directory with build.gradle)
        val projectRoot = findProjectRoot(file)
        if (projectRoot == null) {
            System.err.println("Error: Could not find Android project root for: $path")
            System.exit(1)
            return@runBlocking
        }
        
        analyzer.initialize(projectRoot.absolutePath)
        
        val issues = if (file.isDirectory) {
            analyzer.analyzeProject(path)
        } else {
            analyzer.analyzeFile(projectRoot.absolutePath, path)
        }
        
        // Output as JSON
        println(json.encodeToString(
            kotlinx.serialization.builtins.ListSerializer(
                com.androidlinter.server.protocol.LintIssueDto.serializer()
            ), 
            issues
        ))
        
    } finally {
        analyzer.shutdown()
    }
}

private fun findProjectRoot(file: java.io.File): java.io.File? {
    var current = if (file.isDirectory) file else file.parentFile
    
    while (current != null) {
        if (current.resolve("build.gradle").exists() || 
            current.resolve("build.gradle.kts").exists()) {
            // Check if this is the root or a module
            val parent = current.parentFile
            if (parent != null && 
                (parent.resolve("settings.gradle").exists() || 
                 parent.resolve("settings.gradle.kts").exists())) {
                return parent
            }
            return current
        }
        current = current.parentFile
    }
    
    return null
}
