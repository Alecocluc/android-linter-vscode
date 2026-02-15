package com.alecocluc.androidls

import com.alecocluc.androidls.lint.LintEngine
import com.alecocluc.androidls.project.ProjectModel
import com.alecocluc.androidls.project.GradleModelParser
import com.alecocluc.androidls.resources.ResourceIndex
import com.alecocluc.androidls.xml.XmlSchemaProvider
import com.alecocluc.androidls.xml.XmlCompletionProvider
import kotlinx.coroutines.*
import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.jsonrpc.messages.Either
import org.eclipse.lsp4j.jsonrpc.messages.Either3
import org.eclipse.lsp4j.services.*
import java.io.File
import java.net.URI
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/**
 * The Android Language Server — an LSP server that provides:
 * - Real-time lint diagnostics (400+ checks, identical to Android Studio)
 * - XML completions for layouts, manifests, resources
 * - Resource navigation (R.string.foo, @string/foo, etc.)
 * - Code actions / quick fixes from lint
 * - Hover documentation for lint issues and Android APIs
 */
class AndroidLanguageServer : LanguageServer, LanguageClientAware {

    private lateinit var client: LanguageClient
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    
    // Core modules
    private lateinit var lintEngine: LintEngine
    private lateinit var projectModel: ProjectModel
    private lateinit var resourceIndex: ResourceIndex
    private lateinit var xmlSchemaProvider: XmlSchemaProvider
    private lateinit var xmlCompletionProvider: XmlCompletionProvider
    
    // Document state — maps URI to current content
    private val openDocuments = ConcurrentHashMap<String, DocumentState>()
    
    // Workspace root
    private var workspaceRoot: File? = null
    
    data class DocumentState(
        val uri: String,
        val content: String,
        val version: Int,
        val languageId: String
    )

    override fun connect(client: LanguageClient) {
        this.client = client
    }

    override fun initialize(params: InitializeParams): CompletableFuture<InitializeResult> {
        return CompletableFuture.supplyAsync {
            // Resolve workspace root
            val rootUri = params.rootUri ?: params.workspaceFolders?.firstOrNull()?.uri
            if (rootUri != null) {
                workspaceRoot = File(URI(rootUri))
            }
            
            log("Android Language Server initializing...")
            log("Workspace root: ${workspaceRoot?.absolutePath}")
            
            val capabilities = ServerCapabilities().apply {
                // Text document sync — we need full content on open, incremental on change
                textDocumentSync = Either.forLeft(TextDocumentSyncKind.Full)
                
                // Code completion (XML attributes, resource references)
                completionProvider = CompletionOptions().apply {
                    triggerCharacters = listOf(".", "<", "\"", "@", ":", "/")
                    resolveProvider = true
                }
                
                // Hover info (lint issue explanations, API docs)
                hoverProvider = Either.forLeft(true)
                
                // Code actions (lint quick fixes)
                codeActionProvider = Either.forRight(CodeActionOptions().apply {
                    codeActionKinds = listOf(
                        CodeActionKind.QuickFix,
                        CodeActionKind.Refactor,
                        CodeActionKind.RefactorExtract,
                        CodeActionKind.Source
                    )
                    resolveProvider = true
                })
                
                // Go to definition (resource navigation, R.* references)
                definitionProvider = Either.forLeft(true)
                
                // Find references
                referencesProvider = Either.forLeft(true)
                
                // Document symbols (outline)
                documentSymbolProvider = Either.forLeft(true)
                
                // Workspace symbols
                workspaceSymbolProvider = Either.forLeft(true)
                
                // Formatting
                documentFormattingProvider = Either.forLeft(true)
                
                // Rename
                renameProvider = Either.forRight(RenameOptions().apply {
                    prepareProvider = true
                })
            }
            
            InitializeResult(capabilities).apply {
                serverInfo = ServerInfo("Android Language Server", "0.1.0")
            }
        }
    }

    override fun initialized(params: InitializedParams) {
        log("Android Language Server initialized, starting background setup...")
        
        scope.launch {
            try {
                initializeModules()
            } catch (e: Exception) {
                logError("Failed to initialize modules: ${e.message}")
                e.printStackTrace(System.err)
            }
        }
    }
    
    private suspend fun initializeModules() {
        val root = workspaceRoot ?: run {
            logError("No workspace root — cannot initialize project model")
            return
        }
        
        // 1. Parse project model (build.gradle, settings.gradle, modules)
        log("Parsing project model...")
        val parser = GradleModelParser()
        projectModel = parser.parse(root)
        log("Project model: ${projectModel.modules.size} module(s) found")
        for (mod in projectModel.modules) {
            log("  Module: ${mod.name} (path=${mod.path}, appId=${mod.applicationId})")
        }
        
        // 2. Build resource index
        log("Building resource index...")
        resourceIndex = ResourceIndex(projectModel)
        val resourceCount = resourceIndex.build()
        log("Resource index: $resourceCount resources indexed")
        
        // 3. Initialize XML schema provider
        log("Loading XML schema (attrs.xml)...")
        xmlSchemaProvider = XmlSchemaProvider(projectModel)
        xmlSchemaProvider.initialize()
        log("XML schema loaded: ${xmlSchemaProvider.attributeCount} attributes")
        
        xmlCompletionProvider = XmlCompletionProvider(xmlSchemaProvider, resourceIndex)
        
        // 4. Initialize lint engine (loads 400+ checks from lint-checks)
        log("Initializing lint engine...")
        lintEngine = LintEngine(client, projectModel, resourceIndex)
        lintEngine.initialize()
        log("Lint engine ready: ${lintEngine.issueCount} lint checks loaded")
        
        // 5. Lint any already-open documents
        for ((_, doc) in openDocuments) {
            lintDocument(doc)
        }
        
        log("Android Language Server fully initialized ✓")
    }

    override fun getTextDocumentService(): TextDocumentService = textDocumentService
    override fun getWorkspaceService(): WorkspaceService = workspaceService

    override fun shutdown(): CompletableFuture<Any> {
        return CompletableFuture.supplyAsync {
            log("Android Language Server shutting down...")
            scope.cancel()
            if (::lintEngine.isInitialized) lintEngine.dispose()
            null
        }
    }

    override fun exit() {
        System.exit(0)
    }

    // ─── Text Document Service ────────────────────────────────────────────────
    
    private val textDocumentService = object : TextDocumentService {

        override fun didOpen(params: DidOpenTextDocumentParams) {
            val td = params.textDocument
            val doc = DocumentState(td.uri, td.text, td.version, td.languageId)
            openDocuments[td.uri] = doc
            log("Document opened: ${td.uri} (${td.languageId})")
            
            scope.launch { lintDocument(doc) }
        }

        override fun didChange(params: DidChangeTextDocumentParams) {
            val uri = params.textDocument.uri
            val version = params.textDocument.version
            val existing = openDocuments[uri] ?: return
            
            // Full sync mode — content is the complete new text
            val newContent = params.contentChanges.lastOrNull()?.text ?: return
            val updated = existing.copy(content = newContent, version = version)
            openDocuments[uri] = updated
            
            scope.launch { lintDocument(updated) }
        }

        override fun didSave(params: DidSaveTextDocumentParams) {
            val uri = params.textDocument.uri
            val doc = openDocuments[uri] ?: return
            
            // On save: optionally trigger broader lint pass for cross-file checks
            scope.launch { lintDocument(doc, broadScope = true) }
            
            // Update resource index if a resource file was saved
            if (uri.contains("/res/")) {
                scope.launch {
                    if (::resourceIndex.isInitialized) {
                        resourceIndex.refreshFile(uri)
                    }
                }
            }
        }

        override fun didClose(params: DidCloseTextDocumentParams) {
            val uri = params.textDocument.uri
            openDocuments.remove(uri)
            // Clear diagnostics for closed file
            client.publishDiagnostics(PublishDiagnosticsParams(uri, emptyList()))
        }

        override fun completion(params: CompletionParams): CompletableFuture<Either<List<CompletionItem>, CompletionList>> {
            return CompletableFuture.supplyAsync {
                val doc = openDocuments[params.textDocument.uri]
                if (doc == null) return@supplyAsync Either.forLeft(emptyList())
                
                val items = when (doc.languageId) {
                    "xml" -> {
                        if (::xmlCompletionProvider.isInitialized) {
                            xmlCompletionProvider.provideCompletions(doc, params.position)
                        } else emptyList()
                    }
                    "kotlin", "java" -> {
                        // Resource reference completions (R.string.*, R.layout.*, etc.)
                        if (::resourceIndex.isInitialized) {
                            resourceIndex.provideCompletions(doc.content, params.position)
                        } else emptyList()
                    }
                    else -> emptyList()
                }
                
                Either.forLeft(items)
            }
        }

        override fun hover(params: HoverParams): CompletableFuture<Hover?> {
            return CompletableFuture.supplyAsync {
                val doc = openDocuments[params.textDocument.uri] ?: return@supplyAsync null
                
                // If hovering over a diagnostic, show the lint issue explanation
                if (::lintEngine.isInitialized) {
                    lintEngine.getHoverInfo(doc, params.position)
                } else null
            }
        }

        override fun codeAction(params: CodeActionParams): CompletableFuture<List<Either<Command, CodeAction>>> {
            return CompletableFuture.supplyAsync {
                if (!::lintEngine.isInitialized) return@supplyAsync emptyList()
                
                val doc = openDocuments[params.textDocument.uri] ?: return@supplyAsync emptyList()
                val actions = lintEngine.getCodeActions(doc, params)
                actions.map { Either.forRight<Command, CodeAction>(it) }
            }
        }

        override fun definition(params: DefinitionParams): CompletableFuture<Either<List<out Location>, List<out LocationLink>>> {
            return CompletableFuture.supplyAsync {
                val doc = openDocuments[params.textDocument.uri] ?: return@supplyAsync Either.forLeft(emptyList())
                
                val locations = mutableListOf<Location>()
                
                // Resource navigation: R.string.foo → strings.xml, @layout/main → layout file
                if (::resourceIndex.isInitialized) {
                    val resourceLocations = resourceIndex.findDefinition(doc, params.position)
                    locations.addAll(resourceLocations)
                }
                
                Either.forLeft(locations)
            }
        }

        override fun references(params: ReferenceParams): CompletableFuture<List<out Location>> {
            return CompletableFuture.supplyAsync {
                val doc = openDocuments[params.textDocument.uri] ?: return@supplyAsync emptyList()
                
                if (::resourceIndex.isInitialized) {
                    resourceIndex.findReferences(doc, params.position)
                } else emptyList()
            }
        }

        override fun documentSymbol(params: DocumentSymbolParams): CompletableFuture<List<Either<SymbolInformation, DocumentSymbol>>> {
            return CompletableFuture.supplyAsync {
                // TODO: Implement document symbols using Kotlin Analysis API
                emptyList()
            }
        }

        override fun formatting(params: DocumentFormattingParams): CompletableFuture<List<out TextEdit>> {
            return CompletableFuture.supplyAsync {
                // TODO: Implement formatting
                emptyList()
            }
        }

        override fun prepareRename(params: PrepareRenameParams): CompletableFuture<Either3<Range, PrepareRenameResult, PrepareRenameDefaultBehavior>> {
            return CompletableFuture.completedFuture(
                Either3.forThird(PrepareRenameDefaultBehavior(true))
            )
        }

        override fun rename(params: RenameParams): CompletableFuture<WorkspaceEdit?> {
            return CompletableFuture.supplyAsync {
                // TODO: Implement rename (resources, Kotlin/Java symbols)
                null
            }
        }
    }

    // ─── Workspace Service ────────────────────────────────────────────────────

    private val workspaceService = object : WorkspaceService {
        
        override fun didChangeConfiguration(params: DidChangeConfigurationParams) {
            log("Configuration changed")
            // Reload lint configuration if needed
        }

        override fun didChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
            for (change in params.changes) {
                val uri = change.uri
                when {
                    uri.endsWith("build.gradle") || uri.endsWith("build.gradle.kts") -> {
                        log("Build file changed: $uri — reloading project model")
                        scope.launch {
                            val root = workspaceRoot ?: return@launch
                            val parser = GradleModelParser()
                            projectModel = parser.parse(root)
                            // Reinitialize lint engine with updated model
                            if (::lintEngine.isInitialized) {
                                lintEngine.updateProjectModel(projectModel)
                            }
                        }
                    }
                    uri.contains("/res/values/") && uri.endsWith(".xml") -> {
                        log("Resource file changed: $uri — updating index")
                        scope.launch {
                            if (::resourceIndex.isInitialized) {
                                resourceIndex.refreshFile(uri)
                            }
                        }
                    }
                    uri.endsWith("lint.xml") -> {
                        log("Lint config changed: $uri — reloading")
                        scope.launch {
                            if (::lintEngine.isInitialized) {
                                lintEngine.reloadConfiguration()
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── Lint Integration ─────────────────────────────────────────────────────
    
    private suspend fun lintDocument(doc: DocumentState, broadScope: Boolean = false) {
        if (!::lintEngine.isInitialized) return
        
        try {
            val diagnostics = lintEngine.lintFile(doc, broadScope)
            client.publishDiagnostics(PublishDiagnosticsParams(doc.uri, diagnostics))
        } catch (e: Exception) {
            logError("Lint failed for ${doc.uri}: ${e.message}")
        }
    }

    // ─── Logging ──────────────────────────────────────────────────────────────

    private fun log(message: String) {
        client.logMessage(MessageParams(MessageType.Info, message))
    }
    
    private fun logError(message: String) {
        client.logMessage(MessageParams(MessageType.Error, message))
    }
}
