package com.alecocluc.androidls.resources

import com.alecocluc.androidls.AndroidLanguageServer.DocumentState
import com.alecocluc.androidls.project.ProjectModel
import org.eclipse.lsp4j.*
import java.io.File
import java.net.URI
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.helpers.DefaultHandler

/**
 * Indexes all Android resources in the project.
 * 
 * Provides:
 * - Resource completions (R.string.*, R.layout.*, @string/*, etc.)
 * - Resource navigation (go to definition for R.* references)
 * - Resource reference finding (find all usages of a resource)
 * 
 * Scans all res/ directories and builds an in-memory index keyed by (type, name).
 */
class ResourceIndex(private val projectModel: ProjectModel) {

    // Main index: (type, name) → list of resource entries
    private val resources = mutableMapOf<ResourceKey, MutableList<ResourceEntry>>()
    
    // File-based index: file path → list of resource entries in that file
    private val fileIndex = mutableMapOf<String, MutableList<ResourceEntry>>()

    data class ResourceKey(val type: ResourceType, val name: String)
    
    data class ResourceEntry(
        val type: ResourceType,
        val name: String,
        val value: String?,
        val file: File,
        val line: Int,
        val column: Int = 0,
        val qualifier: String = "default"
    )
    
    enum class ResourceType(val dirPrefix: String, val rClass: String) {
        STRING("values", "string"),
        PLURALS("values", "plurals"),
        ARRAY("values", "array"),
        COLOR("values", "color"),
        DIMEN("values", "dimen"),
        BOOL("values", "bool"),
        INTEGER("values", "integer"),
        STYLE("values", "style"),
        ATTR("values", "attr"),
        DRAWABLE("drawable", "drawable"),
        MIPMAP("mipmap", "mipmap"),
        LAYOUT("layout", "layout"),
        MENU("menu", "menu"),
        ANIM("anim", "anim"),
        ANIMATOR("animator", "animator"),
        XML("xml", "xml"),
        RAW("raw", "raw"),
        FONT("font", "font"),
        NAVIGATION("navigation", "navigation"),
        ID("values", "id");
        
        companion object {
            fun fromDirName(dirName: String): ResourceType? {
                val baseName = dirName.substringBefore('-')
                return entries.find { it.dirPrefix == baseName || it.rClass == baseName }
            }
            
            fun fromTagName(tagName: String): ResourceType? {
                return when (tagName) {
                    "string" -> STRING
                    "plurals" -> PLURALS
                    "string-array", "integer-array" -> ARRAY
                    "color" -> COLOR
                    "dimen" -> DIMEN
                    "bool" -> BOOL
                    "integer" -> INTEGER
                    "style" -> STYLE
                    "attr", "declare-styleable" -> ATTR
                    "item" -> null // handled by parent
                    else -> null
                }
            }
        }
    }

    /**
     * Build the resource index by scanning all res/ directories.
     * Returns the total number of resources indexed.
     */
    fun build(): Int {
        resources.clear()
        fileIndex.clear()
        
        for (module in projectModel.modules) {
            val resDirs = module.getResourceDirs()
            for (resDir in resDirs) {
                scanResourceDir(resDir)
            }
        }
        
        return resources.values.sumOf { it.size }
    }
    
    /**
     * Scan a single res/ directory.
     */
    private fun scanResourceDir(resDir: File) {
        if (!resDir.isDirectory) return
        
        for (typeDir in resDir.listFiles() ?: emptyArray()) {
            if (!typeDir.isDirectory) continue
            
            val dirName = typeDir.name
            val qualifier = if (dirName.contains('-')) {
                dirName.substringAfter('-')
            } else "default"
            
            val baseDirName = dirName.substringBefore('-')
            
            when (baseDirName) {
                "values" -> {
                    // Values directories contain XML files with <string>, <color>, etc.
                    for (file in typeDir.listFiles() ?: emptyArray()) {
                        if (file.extension == "xml") {
                            parseValuesXml(file, qualifier)
                        }
                    }
                }
                "layout", "menu", "navigation" -> {
                    // Layout/menu files — each file IS a resource
                    val type = ResourceType.fromDirName(baseDirName) ?: continue
                    for (file in typeDir.listFiles() ?: emptyArray()) {
                        if (file.extension == "xml") {
                            val name = file.nameWithoutExtension
                            addResource(type, name, null, file, 0, qualifier)
                            // Also scan for @+id/ inside layouts
                            if (baseDirName == "layout") {
                                parseLayoutForIds(file, qualifier)
                            }
                        }
                    }
                }
                "drawable", "mipmap", "anim", "animator", "xml", "raw", "font" -> {
                    val type = ResourceType.fromDirName(baseDirName) ?: continue
                    for (file in typeDir.listFiles() ?: emptyArray()) {
                        val name = file.nameWithoutExtension
                        addResource(type, name, null, file, 0, qualifier)
                    }
                }
            }
        }
    }
    
    /**
     * Parse a values XML file for resource definitions.
     */
    private fun parseValuesXml(file: File, qualifier: String) {
        try {
            val factory = SAXParserFactory.newInstance()
            factory.isNamespaceAware = false
            val parser = factory.newSAXParser()
            
            var currentLine = 0
            
            parser.parse(file, object : DefaultHandler() {
                private var locator: org.xml.sax.Locator? = null
                
                override fun setDocumentLocator(locator: org.xml.sax.Locator) {
                    this.locator = locator
                }
                
                override fun startElement(uri: String?, localName: String?, qName: String, attrs: Attributes) {
                    val line = (locator?.lineNumber ?: 1) - 1
                    val name = attrs.getValue("name") ?: return
                    
                    val type = when (qName) {
                        "string" -> ResourceType.STRING
                        "plurals" -> ResourceType.PLURALS
                        "string-array", "integer-array" -> ResourceType.ARRAY
                        "color" -> ResourceType.COLOR
                        "dimen" -> ResourceType.DIMEN
                        "bool" -> ResourceType.BOOL
                        "integer" -> ResourceType.INTEGER
                        "style" -> ResourceType.STYLE
                        "attr" -> ResourceType.ATTR
                        "declare-styleable" -> ResourceType.ATTR
                        "item" -> {
                            val itemType = attrs.getValue("type")
                            when (itemType) {
                                "id" -> ResourceType.ID
                                "string" -> ResourceType.STRING
                                "color" -> ResourceType.COLOR
                                "dimen" -> ResourceType.DIMEN
                                else -> null
                            }
                        }
                        else -> null
                    } ?: return
                    
                    addResource(type, name, null, file, line, qualifier)
                }
            })
        } catch (e: Exception) {
            // Silently skip malformed XML
        }
    }
    
    /**
     * Parse a layout XML for @+id/ declarations.
     */
    private fun parseLayoutForIds(file: File, qualifier: String) {
        try {
            val content = file.readText()
            val idRegex = Regex("""@\+id/(\w+)""")
            
            val lines = content.lines()
            for ((lineIdx, line) in lines.withIndex()) {
                for (match in idRegex.findAll(line)) {
                    val idName = match.groupValues[1]
                    addResource(ResourceType.ID, idName, null, file, lineIdx, qualifier)
                }
            }
        } catch (e: Exception) {
            // Skip
        }
    }
    
    private fun addResource(type: ResourceType, name: String, value: String?, file: File, line: Int, qualifier: String) {
        val key = ResourceKey(type, name)
        val entry = ResourceEntry(type, name, value, file, line, 0, qualifier)
        
        resources.getOrPut(key) { mutableListOf() }.add(entry)
        
        val filePath = file.absolutePath
        fileIndex.getOrPut(filePath) { mutableListOf() }.add(entry)
    }
    
    /**
     * Refresh the index for a single file.
     */
    fun refreshFile(uri: String) {
        val filePath = uriToPath(uri) ?: return
        val file = File(filePath)
        
        // Remove old entries for this file
        val oldEntries = fileIndex.remove(filePath) ?: emptyList()
        for (entry in oldEntries) {
            val key = ResourceKey(entry.type, entry.name)
            resources[key]?.removeAll { it.file.absolutePath == filePath }
        }
        
        // Re-scan
        if (file.exists()) {
            val parentDir = file.parentFile
            val grandparentDir = parentDir?.parentFile
            val baseDirName = parentDir?.name?.substringBefore('-') ?: return
            val qualifier = if (parentDir.name.contains('-')) {
                parentDir.name.substringAfter('-')
            } else "default"
            
            if (baseDirName == "values") {
                parseValuesXml(file, qualifier)
            } else if (baseDirName == "layout") {
                val type = ResourceType.LAYOUT
                addResource(type, file.nameWithoutExtension, null, file, 0, qualifier)
                parseLayoutForIds(file, qualifier)
            }
        }
    }

    // ─── Completions ──────────────────────────────────────────────────────────

    /**
     * Provide completions for R.* and @resource/ references.
     */
    fun provideCompletions(content: String, position: Position): List<CompletionItem> {
        val lines = content.lines()
        if (position.line >= lines.size) return emptyList()
        
        val line = lines[position.line]
        val col = minOf(position.character, line.length)
        val textBefore = line.substring(0, col)
        
        // R.string.* completions
        val rRefRegex = Regex("""R\.(\w+)\.\s*$""")
        val rMatch = rRefRegex.find(textBefore)
        if (rMatch != null) {
            val typeName = rMatch.groupValues[1]
            val type = ResourceType.entries.find { it.rClass == typeName } ?: return emptyList()
            return resources.entries
                .filter { it.key.type == type }
                .map { (key, entries) ->
                    CompletionItem().apply {
                        label = key.name
                        this.kind = CompletionItemKind.Value
                        detail = "${type.rClass} resource"
                        documentation = Either.forLeft(
                            entries.joinToString("\n") { "${it.qualifier}: ${it.file.name}:${it.line + 1}" }
                        )
                    }
                }
        }
        
        // R.* type completions
        if (textBefore.endsWith("R.")) {
            return ResourceType.entries.map { type ->
                CompletionItem().apply {
                    label = type.rClass
                    this.kind = CompletionItemKind.Module
                    detail = "Resource type"
                }
            }.distinctBy { it.label }
        }
        
        // @string/*, @drawable/*, etc. (XML)
        val xmlRefRegex = Regex("""@(\w+)/\s*$""")
        val xmlMatch = xmlRefRegex.find(textBefore)
        if (xmlMatch != null) {
            val typeName = xmlMatch.groupValues[1]
            val type = ResourceType.entries.find { it.rClass == typeName } ?: return emptyList()
            return resources.entries
                .filter { it.key.type == type }
                .map { (key, _) ->
                    CompletionItem().apply {
                        label = key.name
                        this.kind = CompletionItemKind.Value
                        detail = "@${type.rClass}/${key.name}"
                    }
                }
        }
        
        // @* type completions (after typing @)
        if (textBefore.trimEnd().endsWith("@") || textBefore.trimEnd().endsWith("\"@")) {
            return ResourceType.entries.map { type ->
                CompletionItem().apply {
                    label = "${type.rClass}/"
                    this.kind = CompletionItemKind.Module
                    detail = "Resource reference"
                    insertText = "${type.rClass}/"
                }
            }.distinctBy { it.label }
        }
        
        return emptyList()
    }

    // ─── Navigation ───────────────────────────────────────────────────────────

    /**
     * Find the definition of a resource reference at the given position.
     * Handles: R.string.foo, R.layout.main, @string/foo, @layout/main
     */
    fun findDefinition(doc: DocumentState, position: Position): List<Location> {
        val word = getResourceReference(doc.content, position) ?: return emptyList()
        
        val entries = resources[word] ?: return emptyList()
        
        return entries.map { entry ->
            Location(
                entry.file.toURI().toString(),
                Range(
                    Position(entry.line, 0),
                    Position(entry.line, 0)
                )
            )
        }
    }
    
    /**
     * Find all references to the resource at the given position.
     */
    fun findReferences(doc: DocumentState, position: Position): List<Location> {
        val key = getResourceReference(doc.content, position) ?: return emptyList()
        val locations = mutableListOf<Location>()
        
        // TODO: Scan all project files for references to this resource
        // For now, return the definitions
        val entries = resources[key] ?: return emptyList()
        for (entry in entries) {
            locations.add(Location(
                entry.file.toURI().toString(),
                Range(Position(entry.line, 0), Position(entry.line, 0))
            ))
        }
        
        return locations
    }
    
    /**
     * Extract the resource reference at a given position.
     */
    private fun getResourceReference(content: String, position: Position): ResourceKey? {
        val lines = content.lines()
        if (position.line >= lines.size) return null
        
        val line = lines[position.line]
        
        // Check for R.type.name pattern
        val rRefRegex = Regex("""R\.(\w+)\.(\w+)""")
        for (match in rRefRegex.findAll(line)) {
            val matchRange = match.range
            if (position.character in matchRange) {
                val typeName = match.groupValues[1]
                val name = match.groupValues[2]
                val type = ResourceType.entries.find { it.rClass == typeName } ?: continue
                return ResourceKey(type, name)
            }
        }
        
        // Check for @type/name pattern
        val xmlRefRegex = Regex("""@\+?(\w+)/(\w+)""")
        for (match in xmlRefRegex.findAll(line)) {
            val matchRange = match.range
            if (position.character in matchRange) {
                val typeName = match.groupValues[1]
                val name = match.groupValues[2]
                val type = ResourceType.entries.find { it.rClass == typeName } ?: continue
                return ResourceKey(type, name)
            }
        }
        
        return null
    }
    
    /**
     * Get all resources of a given type.
     */
    fun getResourcesByType(type: ResourceType): Map<String, List<ResourceEntry>> {
        return resources.entries
            .filter { it.key.type == type }
            .associate { it.key.name to it.value }
    }
    
    /**
     * Get all known resources.
     */
    fun getAllResources(): Map<ResourceKey, List<ResourceEntry>> = resources.toMap()

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
