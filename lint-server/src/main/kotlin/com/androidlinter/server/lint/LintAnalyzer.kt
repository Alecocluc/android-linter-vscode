package com.androidlinter.server.lint

import com.android.tools.lint.client.api.IssueRegistry
import com.android.tools.lint.client.api.LintClient
import com.android.tools.lint.client.api.LintDriver
import com.android.tools.lint.client.api.LintRequest
import com.android.tools.lint.client.api.XmlParser
import com.android.tools.lint.client.api.GradleVisitor
import com.android.tools.lint.LintCliXmlParser
import com.android.tools.lint.LintCliClient
import com.android.tools.lint.LintCliFlags
import com.android.tools.lint.checks.BuiltinIssueRegistry
import com.android.tools.lint.detector.api.Context
import com.android.tools.lint.detector.api.Incident
import com.android.tools.lint.detector.api.Issue
import com.android.tools.lint.detector.api.LintFix
import com.android.tools.lint.detector.api.Location
import com.android.tools.lint.detector.api.Project
import com.android.tools.lint.detector.api.Severity
import com.android.tools.lint.detector.api.TextFormat
import com.androidlinter.server.protocol.LintIssueDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Core lint analyzer that uses Android Lint API directly.
 * This class maintains state between analyses for faster incremental updates.
 */
class LintAnalyzer {
    
    // Cache lint clients per project for faster subsequent analyses
    private val clientCache = ConcurrentHashMap<String, CachedLintClient>()
    
    // Project information cache
    private val projectCache = ConcurrentHashMap<String, ProjectInfo>()
    
    // Last analysis results for incremental updates
    private val lastResults = ConcurrentHashMap<String, List<LintIssueDto>>()
    
    private var currentProjectPath: String? = null
    
    data class CachedLintClient(
        val client: CollectingLintClient,
        val registry: IssueRegistry,
        val createdAt: Long = System.currentTimeMillis()
    )
    
    data class ProjectInfo(
        val projectPath: String,
        val modules: List<String>,
        val sdkPath: String?,
        val lastModified: Long = System.currentTimeMillis()
    )
    
    /**
     * Initialize the analyzer for a specific project.
     * This pre-loads project configuration for faster subsequent analyses.
     */
    suspend fun initialize(projectPath: String): Boolean = withContext(Dispatchers.IO) {
        System.err.println("[LintAnalyzer] Initializing for project: $projectPath")
        
        currentProjectPath = projectPath
        
        try {
            // Create and cache the lint client
            val cached = getOrCreateClient(projectPath)
            
            // Pre-scan project structure
            val projectDir = File(projectPath)
            val modules = findModules(projectDir)
            val sdkPath = findAndroidSdk(projectDir)
            
            projectCache[projectPath] = ProjectInfo(
                projectPath = projectPath,
                modules = modules,
                sdkPath = sdkPath
            )
            
            System.err.println("[LintAnalyzer] Initialized. Found ${modules.size} module(s)")
            System.err.println("[LintAnalyzer] Available checks: ${cached.registry.issues.size}")
            
            true
        } catch (e: Exception) {
            System.err.println("[LintAnalyzer] Initialization failed: ${e.message}")
            e.printStackTrace(System.err)
            false
        }
    }
    
    /**
     * Analyze a single file incrementally.
     * Uses cached project information for speed.
     */
    suspend fun analyzeFile(projectPath: String, filePath: String, fileContent: String? = null): List<LintIssueDto> = 
        withContext(Dispatchers.IO) {
            System.err.println("[LintAnalyzer] Analyzing file: $filePath")
            
            val startTime = System.currentTimeMillis()
            
            try {
                val file = File(filePath)
                // We allow non-existent files if content is provided (in-memory file)
                if (fileContent == null && !file.exists()) {
                    System.err.println("[LintAnalyzer] File not found: $filePath")
                    return@withContext emptyList()
                }
                
                val cached = getOrCreateClient(projectPath)
                val projectDir = File(projectPath)
                
                // Clear previous issues
                cached.client.clearIssues()
                
                // Set virtual content if provided (for as-you-type linting)
                if (fileContent != null) {
                    cached.client.setVirtualFile(file, fileContent)
                }
                
                // Create a lint request for just this file
                val request = LintRequest(cached.client, listOf(projectDir))
                
                runLint(cached, request)
                
                // Clear virtual content
                cached.client.clearVirtualFile()
                
                // Filter issues for this specific file
                val allIssues = cached.client.getCollectedIssues()
                val fileIssues = allIssues.filter { it.file == filePath || it.file.endsWith(file.name) }
                
                val elapsed = System.currentTimeMillis() - startTime
                System.err.println("[LintAnalyzer] Analysis complete: ${fileIssues.size} issues in ${elapsed}ms")
                
                // Cache results
                lastResults[filePath] = fileIssues
                
                fileIssues
            } catch (e: Exception) {
                System.err.println("[LintAnalyzer] Analysis failed: ${e.message}")
                e.printStackTrace(System.err)
                emptyList()
            }
        }
    
    /**
     * Analyze the entire project.
     */
    suspend fun analyzeProject(projectPath: String): List<LintIssueDto> = 
        withContext(Dispatchers.IO) {
            System.err.println("[LintAnalyzer] Analyzing project: $projectPath")
            
            val startTime = System.currentTimeMillis()
            
            try {
                val cached = getOrCreateClient(projectPath)
                val projectDir = File(projectPath)
                
                // Clear previous issues
                cached.client.clearIssues()
                cached.client.clearVirtualFile() // Ensure no virtual file is set
                
                val request = LintRequest(cached.client, listOf(projectDir))
                
                runLint(cached, request)
                
                val issues = cached.client.getCollectedIssues()
                
                val elapsed = System.currentTimeMillis() - startTime
                System.err.println("[LintAnalyzer] Project analysis complete: ${issues.size} issues in ${elapsed}ms")
                
                issues
            } catch (e: Exception) {
                System.err.println("[LintAnalyzer] Project analysis failed: ${e.message}")
                e.printStackTrace(System.err)
                emptyList()
            }
        }
    
    /**
     * Get the list of all available lint checks.
     */
    fun getAvailableChecks(): List<LintCheckInfo> {
        val registry = BuiltinIssueRegistry()
        return registry.issues.map { issue ->
            LintCheckInfo(
                id = issue.id,
                briefDescription = issue.getBriefDescription(TextFormat.TEXT),
                explanation = issue.getExplanation(TextFormat.TEXT),
                category = issue.category.fullName,
                priority = issue.priority,
                severity = issue.defaultSeverity.name,
                enabledByDefault = issue.isEnabledByDefault()
            )
        }
    }
    
    /**
     * Clear all caches. Call this when the project structure changes significantly.
     */
    fun clearCache() {
        clientCache.clear()
        projectCache.clear()
        lastResults.clear()
        System.err.println("[LintAnalyzer] Cache cleared")
    }
    
    /**
     * Shutdown the analyzer and release resources.
     */
    fun shutdown() {
        clearCache()
        System.err.println("[LintAnalyzer] Shutdown complete")
    }
    
    // ---- Private implementation ----
    
    private fun getOrCreateClient(projectPath: String): CachedLintClient {
        return clientCache.getOrPut(projectPath) {
            createLintClient(projectPath)
        }
    }
    
    private fun createLintClient(projectPath: String): CachedLintClient {
        System.err.println("[LintAnalyzer] Creating new lint client for: $projectPath")
        
        // Create the client
        val client = CollectingLintClient(projectPath)
        
        // Get the built-in issue registry with all Android lint checks
        val registry = BuiltinIssueRegistry()
        
        return CachedLintClient(client, registry)
    }
    
    private fun runLint(
        cached: CachedLintClient,
        request: LintRequest
    ) {
        // Create and run the driver
        val driver = LintDriver(cached.registry, cached.client, request)
        driver.analyze()
    }
    
    private fun findModules(projectDir: File): List<String> {
        val modules = mutableListOf<String>()
        
        // Look for build.gradle or build.gradle.kts files
        projectDir.listFiles()?.forEach { file ->
            if (file.isDirectory) {
                val hasGradle = file.resolve("build.gradle").exists() ||
                                file.resolve("build.gradle.kts").exists()
                if (hasGradle) {
                    modules.add(file.name)
                }
            }
        }
        
        // Always include "app" if it exists
        if (!modules.contains("app") && projectDir.resolve("app").exists()) {
            modules.add(0, "app")
        }
        
        return modules
    }
    
    private fun findAndroidSdk(projectDir: File): String? {
        // Try local.properties first
        val localProps = projectDir.resolve("local.properties")
        if (localProps.exists()) {
            val props = java.util.Properties()
            localProps.inputStream().use { props.load(it) }
            val sdkDir = props.getProperty("sdk.dir")
            if (sdkDir != null && File(sdkDir).exists()) {
                return sdkDir
            }
        }
        
        // Try environment variable
        val androidHome = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
        if (androidHome != null && File(androidHome).exists()) {
            return androidHome
        }
        
        return null
    }
}

/**
 * Custom LintClient that collects issues instead of printing them.
 */
class CollectingLintClient(
    private val projectPath: String
) : LintCliClient(LintCliFlags(), "AndroidLintServer") {
    
    private val collectedIssues = mutableListOf<LintIssueDto>()
    private var virtualFile: File? = null
    private var virtualContent: String? = null
    
    fun clearIssues() {
        collectedIssues.clear()
    }
    
    fun getCollectedIssues(): List<LintIssueDto> = collectedIssues.toList()
    
    fun setVirtualFile(file: File, content: String) {
        this.virtualFile = file.absoluteFile
        this.virtualContent = content
    }

    fun clearVirtualFile() {
        this.virtualFile = null
        this.virtualContent = null
    }

    override fun readFile(file: File): CharSequence {
        if (virtualFile != null && file.absoluteFile == virtualFile) {
            return virtualContent!!
        }
        return super.readFile(file)
    }
    
    override fun report(
        context: Context,
        incident: Incident,
        format: TextFormat
    ) {
        val location = incident.location
        val file = location.file
        val start = location.start
        val end = location.end
        val issue = incident.issue
        val severity = incident.severity
        val message = incident.message
        
        collectedIssues.add(
            LintIssueDto(
                id = issue.id,
                severity = mapSeverity(severity),
                message = message,
                file = file.absolutePath,
                line = start?.line?.plus(1) ?: 1,
                column = start?.column?.plus(1) ?: 1,
                endLine = end?.line?.plus(1) ?: (start?.line?.plus(1) ?: 1),
                endColumn = end?.column?.plus(1) ?: (start?.column?.plus(1) ?: 1),
                category = issue.category.fullName,
                priority = issue.priority,
                explanation = issue.getExplanation(TextFormat.TEXT),
                quickFix = null
            )
        )
    }
    
    private fun mapSeverity(severity: Severity): String {
        return when (severity) {
            Severity.FATAL -> "error"
            Severity.ERROR -> "error"
            Severity.WARNING -> "warning"
            Severity.INFORMATIONAL -> "information"
            Severity.IGNORE -> "hint"
            else -> "warning"
        }
    }
}

data class LintCheckInfo(
    val id: String,
    val briefDescription: String,
    val explanation: String,
    val category: String,
    val priority: Int,
    val severity: String,
    val enabledByDefault: Boolean
)
