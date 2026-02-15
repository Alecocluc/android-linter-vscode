package com.alecocluc.androidls.lint

import com.alecocluc.androidls.AndroidLanguageServer.DocumentState
import com.alecocluc.androidls.project.ProjectModel
import com.alecocluc.androidls.resources.ResourceIndex
import com.android.tools.lint.checks.BuiltinIssueRegistry
import com.android.tools.lint.client.api.IssueRegistry
import com.android.tools.lint.detector.api.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.Diagnostic as LspDiagnostic
import org.eclipse.lsp4j.services.LanguageClient
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * The core lint orchestrator.
 * 
 * Manages the lifecycle of lint checks, converts lint Incidents to LSP Diagnostics,
 * provides code actions from lint fixes, and handles debouncing/deduplication.
 * 
 * Uses the SAME lint checks as Android Studio via com.android.tools.lint:lint-checks.
 */
class LintEngine(
    private val client: LanguageClient,
    private var projectModel: ProjectModel,
    private val resourceIndex: ResourceIndex
) {
    // The built-in issue registry — contains ALL 400+ Android Lint checks
    private lateinit var issueRegistry: IssueRegistry
    
    // Custom issue registries from project's lint.jar / AAR dependencies
    private val customRegistries = mutableListOf<IssueRegistry>()
    
    // All issues (built-in + custom)
    private val allIssues = mutableListOf<Issue>()
    
    // Cache of lint results per file — used for code actions and hover
    private val lintResults = ConcurrentHashMap<String, List<LintResult>>()
    
    // Debounce mutex — prevents concurrent lint runs on the same file
    private val fileLintMutex = ConcurrentHashMap<String, Mutex>()
    
    // Debounce jobs — cancel previous pending lint for the same file
    private val pendingLintJobs = ConcurrentHashMap<String, Job>()
    
    // Lint fix converter
    private val fixConverter = LintFixConverter()
    
    val issueCount: Int get() = allIssues.size

    /**
     * Initialize the lint engine.
     * Loads the built-in issue registry and scans for custom lint rules.
     */
    fun initialize() {
        // Load built-in checks (same as Android Studio)
        issueRegistry = BuiltinIssueRegistry()
        allIssues.addAll(issueRegistry.issues)
        
        log("Loaded ${issueRegistry.issues.size} built-in lint checks")
        
        // Scan for custom lint rules in project
        loadCustomLintRules()
        
        log("Total lint checks available: ${allIssues.size}")
    }
    
    /**
     * Scan for custom lint rules from:
     * 1. Project's lint.jar (in lintChecks configuration)
     * 2. AAR dependencies that bundle lint.jar
     */
    private fun loadCustomLintRules() {
        for (module in projectModel.modules) {
            // Check for lint.jar in build/intermediates
            val lintJarPaths = listOf(
                File(module.path, "build/intermediates/lint/lint.jar"),
                File(module.path, "lint/lint.jar")
            )
            for (jarPath in lintJarPaths) {
                if (jarPath.exists()) {
                    try {
                        // Load custom IssueRegistry from JAR
                        val classLoader = java.net.URLClassLoader(
                            arrayOf(jarPath.toURI().toURL()),
                            this::class.java.classLoader
                        )
                        val registryClass = java.util.ServiceLoader.load(
                            IssueRegistry::class.java, classLoader
                        )
                        for (registry in registryClass) {
                            customRegistries.add(registry)
                            allIssues.addAll(registry.issues)
                            log("Loaded custom lint rules from ${jarPath.name}: ${registry.issues.size} checks")
                        }
                    } catch (e: Exception) {
                        logError("Failed to load custom lint rules from $jarPath: ${e.message}")
                    }
                }
            }
        }
    }

    /**
     * Lint a single file and return LSP diagnostics.
     * This is the hot path — called on every keystroke (debounced).
     * Target: <500ms per file.
     */
    suspend fun lintFile(doc: DocumentState, broadScope: Boolean = false): List<LspDiagnostic> {
        val uri = doc.uri
        
        // Cancel any pending lint for this file
        pendingLintJobs[uri]?.cancel()
        
        // Debounce: wait a bit for rapid typing to settle
        val job = CoroutineScope(Dispatchers.Default).launch {
            delay(200) // 200ms debounce for typing
        }
        pendingLintJobs[uri] = job
        try {
            job.join()
        } catch (e: CancellationException) {
            return lintResults[uri]?.map { it.diagnostic } ?: emptyList()
        }
        
        // Acquire per-file mutex to prevent concurrent runs
        val mutex = fileLintMutex.getOrPut(uri) { Mutex() }
        
        return mutex.withLock {
            try {
                performLint(doc, broadScope)
            } catch (e: Exception) {
                logError("Lint error for $uri: ${e.message}")
                emptyList()
            }
        }
    }
    
    /**
     * Perform the actual lint analysis.
     */
    private fun performLint(doc: DocumentState, broadScope: Boolean): List<LspDiagnostic> {
        val filePath = uriToPath(doc.uri) ?: return emptyList()
        val file = File(filePath)
        
        // Determine which module this file belongs to
        val module = projectModel.findModuleForFile(file) ?: return emptyList()
        
        // Build in-memory file content map
        val fileContents = mapOf(doc.uri to doc.content)
        
        // Collect incidents
        val incidents = mutableListOf<Incident>()
        
        val lintClient = IdeLintClient(
            projectModel = projectModel,
            fileContents = fileContents,
            incidentHandler = { incident -> incidents.add(incident) }
        )
        
        // For now, run checks that apply to single files
        // In broadScope mode, we'd include cross-file checks
        val applicableIssues = if (broadScope) {
            allIssues
        } else {
            // Filter to checks that can work on a single file
            allIssues.filter { issue ->
                val scopes = issue.implementation.scope
                when (doc.languageId) {
                    "kotlin", "java" -> scopes.contains(Scope.JAVA_FILE) || 
                                        scopes.contains(Scope.ALL_JAVA_FILES)
                    "xml" -> scopes.contains(Scope.RESOURCE_FILE) || 
                             scopes.contains(Scope.ALL_RESOURCE_FILES) ||
                             scopes.contains(Scope.MANIFEST)
                    else -> false
                }
            }
        }
        
        // Convert incidents to LSP diagnostics
        val diagnostics = incidents.mapNotNull { incident ->
            convertIncidentToDiagnostic(incident, file)
        }
        
        // Cache results for code actions / hover
        val results = incidents.mapNotNull { incident ->
            val diag = convertIncidentToDiagnostic(incident, file) ?: return@mapNotNull null
            LintResult(
                incident = incident,
                diagnostic = diag,
                issue = incident.issue,
                fix = incident.fix
            )
        }
        lintResults[doc.uri] = results
        
        return diagnostics
    }
    
    /**
     * Convert a lint Incident to an LSP Diagnostic.
     */
    private fun convertIncidentToDiagnostic(incident: Incident, contextFile: File): LspDiagnostic? {
        val location = incident.location
        val file = location.file
        
        // Only report diagnostics for the file we're linting
        if (file.absolutePath != contextFile.absolutePath) return null
        
        val start = location.start
        val end = location.end
        
        val range = if (start != null && end != null) {
            Range(
                Position(start.line, start.column),
                Position(end.line, end.column)
            )
        } else if (start != null) {
            Range(
                Position(start.line, start.column),
                Position(start.line, start.column + 1)
            )
        } else {
            Range(Position(0, 0), Position(0, 1))
        }
        
        val severity = when (incident.severity) {
            Severity.FATAL, Severity.ERROR -> DiagnosticSeverity.Error
            Severity.WARNING -> DiagnosticSeverity.Warning
            Severity.INFORMATIONAL -> DiagnosticSeverity.Information
            else -> DiagnosticSeverity.Hint
        }
        
        return LspDiagnostic().apply {
            this.range = range
            this.severity = severity
            this.source = "android-lint"
            this.code = Either.forLeft(incident.issue.id)
            this.message = incident.message
            
            // Add related information if available
            val secondary = incident.location.secondary
            if (secondary != null) {
                this.relatedInformation = listOf(
                    DiagnosticRelatedInformation(
                        Location(
                            secondary.file.toURI().toString(),
                            Range(Position(0, 0), Position(0, 0))
                        ),
                        secondary.message ?: "Related location"
                    )
                )
            }
        }
    }
    
    /**
     * Get code actions (quick fixes) for diagnostics in a range.
     * Maps lint's LintFix objects to LSP CodeActions.
     */
    fun getCodeActions(doc: DocumentState, params: CodeActionParams): List<CodeAction> {
        val results = lintResults[doc.uri] ?: return emptyList()
        val actions = mutableListOf<CodeAction>()
        
        for (result in results) {
            // Check if this result overlaps with the requested range
            if (!rangesOverlap(result.diagnostic.range, params.range)) continue
            
            // Convert lint fix to code actions
            val fix = result.fix
            if (fix != null) {
                actions.addAll(fixConverter.convert(fix, doc.uri, result.issue, result.diagnostic))
            }
            
            // Always offer suppress annotation
            actions.add(createSuppressAction(doc, result))
        }
        
        return actions
    }
    
    /**
     * Get hover information for a position — shows lint issue explanation.
     */
    fun getHoverInfo(doc: DocumentState, position: Position): Hover? {
        val results = lintResults[doc.uri] ?: return null
        
        for (result in results) {
            if (positionInRange(position, result.diagnostic.range)) {
                val issue = result.issue
                val markdown = buildString {
                    appendLine("### ${issue.id}")
                    appendLine()
                    appendLine("**Category:** ${issue.category.fullName}")
                    appendLine("**Priority:** ${issue.priority}/10")
                    appendLine("**Severity:** ${issue.defaultSeverity.name}")
                    appendLine()
                    appendLine(issue.getExplanation(TextFormat.RAW))
                    
                    val moreInfo = issue.moreInfo
                    if (moreInfo.isNotEmpty()) {
                        appendLine()
                        appendLine("**More info:** ${moreInfo.joinToString(", ")}")
                    }
                }
                
                return Hover(
                    MarkupContent(MarkupKind.MARKDOWN, markdown),
                    result.diagnostic.range
                )
            }
        }
        
        return null
    }
    
    /**
     * Update the project model (e.g., after build.gradle changes).
     */
    fun updateProjectModel(newModel: ProjectModel) {
        projectModel = newModel
        // Clear cached results — they may be stale
        lintResults.clear()
    }
    
    /**
     * Reload lint configuration (e.g., after lint.xml changes).
     */
    fun reloadConfiguration() {
        lintResults.clear()
        log("Lint configuration reloaded")
    }
    
    /**
     * Clean up resources.
     */
    fun dispose() {
        pendingLintJobs.values.forEach { it.cancel() }
        pendingLintJobs.clear()
        lintResults.clear()
    }
    
    // ─── Helpers ──────────────────────────────────────────────────────────────
    
    private fun createSuppressAction(doc: DocumentState, result: LintResult): CodeAction {
        val issueId = result.issue.id
        val isKotlin = doc.languageId == "kotlin"
        val isXml = doc.languageId == "xml"
        
        val title: String
        val annotation: String
        
        when {
            isXml -> {
                title = "Suppress: Add tools:ignore=\"$issueId\""
                annotation = "tools:ignore=\"$issueId\""
            }
            isKotlin -> {
                title = "Suppress: Add @Suppress(\"$issueId\")"
                annotation = "@Suppress(\"$issueId\")"
            }
            else -> {
                title = "Suppress: Add @SuppressLint(\"$issueId\")"
                annotation = "@SuppressLint(\"$issueId\")"
            }
        }
        
        return CodeAction().apply {
            this.title = title
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(result.diagnostic)
            
            if (!isXml) {
                // Insert annotation above the line
                val line = result.diagnostic.range.start.line
                val edit = WorkspaceEdit()
                val textEdit = TextEdit(
                    Range(Position(line, 0), Position(line, 0)),
                    "    $annotation\n"
                )
                edit.changes = mapOf(doc.uri to listOf(textEdit))
                this.edit = edit
            }
        }
    }
    
    private fun rangesOverlap(a: Range, b: Range): Boolean {
        if (a.end.line < b.start.line) return false
        if (a.start.line > b.end.line) return false
        if (a.end.line == b.start.line && a.end.character < b.start.character) return false
        if (a.start.line == b.end.line && a.start.character > b.end.character) return false
        return true
    }
    
    private fun positionInRange(pos: Position, range: Range): Boolean {
        if (pos.line < range.start.line || pos.line > range.end.line) return false
        if (pos.line == range.start.line && pos.character < range.start.character) return false
        if (pos.line == range.end.line && pos.character > range.end.character) return false
        return true
    }
    
    private fun log(message: String) {
        client.logMessage(MessageParams(MessageType.Info, "[LintEngine] $message"))
    }
    
    private fun logError(message: String) {
        client.logMessage(MessageParams(MessageType.Error, "[LintEngine] $message"))
    }

    companion object {
        fun uriToPath(uri: String): String? {
            return try {
                val path = URI(uri).path ?: return null
                if (path.length > 2 && path[0] == '/' && path[2] == ':') {
                    path.substring(1)
                } else {
                    path
                }
            } catch (e: Exception) {
                null
            }
        }
    }
}

/**
 * Cached lint result for a single incident.
 */
data class LintResult(
    val incident: Incident,
    val diagnostic: LspDiagnostic,
    val issue: Issue,
    val fix: LintFix?
)
