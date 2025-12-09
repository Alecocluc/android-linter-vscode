package com.androidlinter.server.protocol

import com.androidlinter.server.lint.LintAnalyzer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter

/**
 * JSON-RPC server that handles communication with the VS Code extension.
 * Uses stdin/stdout for communication.
 */
class JsonRpcServer(private val analyzer: LintAnalyzer) {
    
    private val json = Json { 
        ignoreUnknownKeys = true 
        encodeDefaults = true
    }
    
    private var running = true
    private var currentProjectPath: String? = null
    
    fun start() {
        System.err.println("[JsonRpcServer] Starting server...")
        
        val reader = BufferedReader(InputStreamReader(System.`in`))
        val writer = PrintWriter(System.out, true)
        
        // Send ready notification to indicate server is ready to receive requests
        val readyNotification = """{"method":"ready"}"""
        writer.println(readyNotification)
        writer.flush()
        System.err.println("[JsonRpcServer] Sent ready notification")
        
        while (running) {
            try {
                val line = reader.readLine() ?: break
                
                if (line.isBlank()) continue
                
                System.err.println("[JsonRpcServer] Received: $line")
                
                val response = processRequest(line)
                writer.println(response)
                writer.flush()
                
                System.err.println("[JsonRpcServer] Sent: $response")
            } catch (e: Exception) {
                System.err.println("[JsonRpcServer] Error: ${e.message}")
                e.printStackTrace(System.err)
            }
        }
        
        System.err.println("[JsonRpcServer] Server stopped")
    }
    
    private fun processRequest(requestJson: String): String {
        return try {
            val request = json.decodeFromString<RpcRequest>(requestJson)
            val result = handleMethod(request)
            val response = RpcResponse(id = request.id, result = result)
            json.encodeToString(RpcResponse.serializer(), response)
        } catch (e: Exception) {
            val error = RpcError(code = -1, message = e.message ?: "Unknown error")
            val response = RpcResponse(error = error)
            json.encodeToString(RpcResponse.serializer(), response)
        }
    }
    
    private fun handleMethod(request: RpcRequest): RpcResult = runBlocking {
        when (request.method) {
            "initialize" -> handleInitialize(request.params)
            "analyzeFile" -> handleAnalyzeFile(request.params)
            "analyzeProject" -> handleAnalyzeProject(request.params)
            "getChecks" -> handleGetChecks()
            "clearCache" -> handleClearCache()
            "shutdown" -> handleShutdown()
            "ping" -> RpcResult(success = true, message = "pong")
            else -> RpcResult(success = false, message = "Unknown method: ${request.method}")
        }
    }
    
    private suspend fun handleInitialize(params: Map<String, String>): RpcResult {
        val projectPath = params["projectPath"] 
            ?: return RpcResult(success = false, message = "Missing projectPath parameter")
        
        currentProjectPath = projectPath
        val success = analyzer.initialize(projectPath)
        
        return if (success) {
            RpcResult(
                success = true, 
                message = "Initialized for project: $projectPath",
                checksCount = analyzer.getAvailableChecks().size
            )
        } else {
            RpcResult(success = false, message = "Failed to initialize")
        }
    }
    
    private suspend fun handleAnalyzeFile(params: Map<String, String>): RpcResult {
        val filePath = params["filePath"]
            ?: return RpcResult(success = false, message = "Missing filePath parameter")
        
        val projectPath = params["projectPath"] ?: currentProjectPath
            ?: return RpcResult(success = false, message = "No project initialized")
            
        val fileContent = params["fileContent"]
        
        val issues = analyzer.analyzeFile(projectPath, filePath, fileContent)
        
        return RpcResult(success = true, issues = issues)
    }
    
    private suspend fun handleAnalyzeProject(params: Map<String, String>): RpcResult {
        val projectPath = params["projectPath"] ?: currentProjectPath
            ?: return RpcResult(success = false, message = "No project initialized")
        
        val issues = analyzer.analyzeProject(projectPath)
        
        return RpcResult(success = true, issues = issues)
    }
    
    private fun handleGetChecks(): RpcResult {
        val checks = analyzer.getAvailableChecks()
        return RpcResult(success = true, checksCount = checks.size)
    }
    
    private fun handleClearCache(): RpcResult {
        analyzer.clearCache()
        return RpcResult(success = true, message = "Cache cleared")
    }
    
    private fun handleShutdown(): RpcResult {
        running = false
        analyzer.shutdown()
        return RpcResult(success = true, message = "Shutting down")
    }
}
