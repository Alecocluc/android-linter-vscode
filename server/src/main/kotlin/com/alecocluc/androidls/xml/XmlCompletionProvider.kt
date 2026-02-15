package com.alecocluc.androidls.xml

import com.alecocluc.androidls.AndroidLanguageServer.DocumentState
import com.alecocluc.androidls.resources.ResourceIndex
import org.eclipse.lsp4j.*

/**
 * Provides XML completions for Android layout files, manifests, and resource files.
 * 
 * Completion types:
 * - Element names (View classes: TextView, LinearLayout, etc.)
 * - Attribute names (android:*, app:*, filtered by element type)
 * - Attribute values (enum values, resource references, dimensions, colors)
 * - Namespace declarations
 */
class XmlCompletionProvider(
    private val schemaProvider: XmlSchemaProvider,
    private val resourceIndex: ResourceIndex
) {

    /**
     * Provide completions for the given document and position.
     */
    fun provideCompletions(doc: DocumentState, position: Position): List<CompletionItem> {
        val content = doc.content
        val lines = content.lines()
        if (position.line >= lines.size) return emptyList()
        
        val line = lines[position.line]
        val col = minOf(position.character, line.length)
        val textBefore = line.substring(0, col)
        
        // Determine context
        val context = analyzeContext(content, position)
        
        return when (context) {
            is XmlContext.ElementName -> completeElementName(context.prefix)
            is XmlContext.AttributeName -> completeAttributeName(context.elementName, context.prefix)
            is XmlContext.AttributeValue -> completeAttributeValue(context.elementName, context.attributeName, context.prefix)
            is XmlContext.Namespace -> completeNamespace()
            is XmlContext.ResourceReference -> completeResourceReference(context.type, context.prefix)
            is XmlContext.Unknown -> emptyList()
        }
    }
    
    /**
     * Analyze the XML context at the cursor position.
     */
    private fun analyzeContext(content: String, position: Position): XmlContext {
        val lines = content.lines()
        val line = lines.getOrNull(position.line) ?: return XmlContext.Unknown
        val col = minOf(position.character, line.length)
        val textBefore = line.substring(0, col)
        
        // Inside attribute value (after = and opening quote)
        val attrValueRegex = Regex("""(\w[\w:.]+)\s*=\s*["']([^"']*)$""")
        val attrValueMatch = attrValueRegex.find(textBefore)
        if (attrValueMatch != null) {
            val attrName = attrValueMatch.groupValues[1]
            val valuePrefix = attrValueMatch.groupValues[2]
            val elementName = findEnclosingElementName(content, position)
            
            // Check for resource reference
            val resRefRegex = Regex("""@(\w*)/?([\w.]*)$""")
            val resRefMatch = resRefRegex.find(valuePrefix)
            if (resRefMatch != null) {
                return XmlContext.ResourceReference(resRefMatch.groupValues[1], resRefMatch.groupValues[2])
            }
            
            return XmlContext.AttributeValue(elementName, attrName, valuePrefix)
        }
        
        // After < — element name completion
        val elementStartRegex = Regex("""<\s*(\w[\w.]*)?\s*$""")
        val elementMatch = elementStartRegex.find(textBefore)
        if (elementMatch != null) {
            return XmlContext.ElementName(elementMatch.groupValues[1])
        }
        
        // Inside element — attribute name completion
        val attrNameRegex = Regex("""<(\w[\w.]*)\s+[^>]*?([\w:.]*)$""")
        val attrMatch = attrNameRegex.find(textBefore)
        if (attrMatch != null) {
            return XmlContext.AttributeName(attrMatch.groupValues[1], attrMatch.groupValues[2])
        }
        
        return XmlContext.Unknown
    }
    
    /**
     * Find the element name that encloses the current position.
     */
    private fun findEnclosingElementName(content: String, position: Position): String {
        val lines = content.lines()
        // Search backwards for the opening tag
        for (i in position.line downTo 0) {
            val line = lines.getOrNull(i) ?: continue
            val endCol = if (i == position.line) position.character else line.length
            val text = line.substring(0, minOf(endCol, line.length))
            
            val tagRegex = Regex("""<(\w[\w.]*)""")
            val matches = tagRegex.findAll(text).toList()
            if (matches.isNotEmpty()) {
                return matches.last().groupValues[1]
            }
        }
        return "View"
    }
    
    // ─── Completion Providers ─────────────────────────────────────────────────
    
    /**
     * Complete element names (View classes).
     */
    private fun completeElementName(prefix: String): List<CompletionItem> {
        val viewClasses = schemaProvider.getViewClasses()
        return viewClasses
            .filter { it.contains(prefix, ignoreCase = true) }
            .map { className ->
                val simpleName = className.substringAfterLast('.')
                CompletionItem().apply {
                    label = simpleName
                    this.kind = CompletionItemKind.Class
                    detail = if (className.contains('.')) className else "android.widget.$className"
                    insertText = if (className.contains('.')) className else simpleName
                    filterText = simpleName
                    
                    // For common widgets, include closing tag snippet
                    insertTextFormat = InsertTextFormat.Snippet
                    this.insertText = "$insertText\n    android:layout_width=\"\${1:wrap_content}\"\n    android:layout_height=\"\${2:wrap_content}\"\n    \$0/>"
                }
            }
            .sortedBy { it.label }
    }
    
    /**
     * Complete attribute names for a given element.
     */
    private fun completeAttributeName(elementName: String, prefix: String): List<CompletionItem> {
        val attrs = schemaProvider.getAttributesForElement(elementName)
        val items = mutableListOf<CompletionItem>()
        
        for (attr in attrs) {
            val fullName = "android:${attr.name}"
            if (!fullName.contains(prefix, ignoreCase = true) && !attr.name.contains(prefix, ignoreCase = true)) continue
            
            items.add(CompletionItem().apply {
                label = fullName
                this.kind = CompletionItemKind.Property
                detail = formatTypeString(attr.format)
                
                // Insert with = and opening quote
                insertTextFormat = InsertTextFormat.Snippet
                insertText = "$fullName=\"\$1\""
                
                // Sort: layout_ attributes first, then alphabetical
                sortText = if (attr.name.startsWith("layout_")) "0_${attr.name}" else "1_${attr.name}"
            })
        }
        
        // Add xmlns completions if prefix contains "xmlns"
        if ("xmlns".contains(prefix, ignoreCase = true) || prefix.startsWith("xmlns")) {
            items.addAll(completeNamespace())
        }
        
        return items
    }
    
    /**
     * Complete attribute values.
     */
    private fun completeAttributeValue(elementName: String, attributeName: String, prefix: String): List<CompletionItem> {
        val attrName = attributeName.removePrefix("android:").removePrefix("app:")
        val schema = schemaProvider.getAttributeSchema(attrName)
        val items = mutableListOf<CompletionItem>()
        
        // Enum values
        if (schema != null) {
            for (enumVal in schema.enumValues) {
                if (enumVal.name.contains(prefix, ignoreCase = true) || prefix.isEmpty()) {
                    items.add(CompletionItem().apply {
                        label = enumVal.name
                        this.kind = CompletionItemKind.EnumMember
                        detail = "= ${enumVal.value}"
                    })
                }
            }
            
            for (flagVal in schema.flagValues) {
                if (flagVal.name.contains(prefix, ignoreCase = true) || prefix.isEmpty()) {
                    items.add(CompletionItem().apply {
                        label = flagVal.name
                        this.kind = CompletionItemKind.EnumMember
                        detail = "flag = ${flagVal.value}"
                    })
                }
            }
        }
        
        // Boolean values
        if (schema?.format?.contains(XmlSchemaProvider.AttributeFormat.BOOLEAN) == true) {
            items.add(CompletionItem().apply { label = "true"; kind = CompletionItemKind.Keyword })
            items.add(CompletionItem().apply { label = "false"; kind = CompletionItemKind.Keyword })
        }
        
        // Resource reference values (@string/, @drawable/, etc.)
        if (schema?.format?.contains(XmlSchemaProvider.AttributeFormat.REFERENCE) == true || 
            prefix.startsWith("@")) {
            items.addAll(completeResourceReference("", prefix.removePrefix("@")))
        }
        
        // Dimension presets
        if (schema?.format?.contains(XmlSchemaProvider.AttributeFormat.DIMENSION) == true) {
            if (prefix.isEmpty() || prefix.all { it.isDigit() }) {
                items.add(CompletionItem().apply { label = "match_parent"; kind = CompletionItemKind.Keyword })
                items.add(CompletionItem().apply { label = "wrap_content"; kind = CompletionItemKind.Keyword })
            }
        }
        
        return items
    }
    
    /**
     * Complete resource references.
     */
    private fun completeResourceReference(type: String, prefix: String): List<CompletionItem> {
        if (type.isEmpty()) {
            // Complete resource type
            return ResourceIndex.ResourceType.entries.map { resType ->
                CompletionItem().apply {
                    label = "@${resType.rClass}/"
                    this.kind = CompletionItemKind.Module
                    detail = "Resource type"
                    insertText = "@${resType.rClass}/"
                }
            }
        }
        
        // Complete resource name for the given type
        val resType = ResourceIndex.ResourceType.entries.find { it.rClass == type } ?: return emptyList()
        val resources = resourceIndex.getResourcesByType(resType)
        
        return resources.map { (name, entries) ->
            CompletionItem().apply {
                label = name
                this.kind = CompletionItemKind.Value
                detail = "@${resType.rClass}/$name"
                documentation = Either.forLeft(
                    entries.joinToString("\n") { "${it.qualifier}: ${it.file.name}" }
                )
            }
        }
    }
    
    /**
     * Complete namespace declarations.
     */
    private fun completeNamespace(): List<CompletionItem> {
        return listOf(
            CompletionItem().apply {
                label = "xmlns:android"
                this.kind = CompletionItemKind.Module
                detail = "Android namespace"
                insertTextFormat = InsertTextFormat.Snippet
                insertText = "xmlns:android=\"http://schemas.android.com/apk/res/android\""
            },
            CompletionItem().apply {
                label = "xmlns:app"
                this.kind = CompletionItemKind.Module
                detail = "App namespace"
                insertTextFormat = InsertTextFormat.Snippet
                insertText = "xmlns:app=\"http://schemas.android.com/apk/res-auto\""
            },
            CompletionItem().apply {
                label = "xmlns:tools"
                this.kind = CompletionItemKind.Module
                detail = "Tools namespace"
                insertTextFormat = InsertTextFormat.Snippet
                insertText = "xmlns:tools=\"http://schemas.android.com/tools\""
            }
        )
    }
    
    private fun formatTypeString(formats: Set<XmlSchemaProvider.AttributeFormat>): String {
        return formats.joinToString("|") { it.name.lowercase() }
    }
    
    // ─── Context Types ────────────────────────────────────────────────────────
    
    sealed class XmlContext {
        data class ElementName(val prefix: String) : XmlContext()
        data class AttributeName(val elementName: String, val prefix: String) : XmlContext()
        data class AttributeValue(val elementName: String, val attributeName: String, val prefix: String) : XmlContext()
        data class ResourceReference(val type: String, val prefix: String) : XmlContext()
        data object Namespace : XmlContext()
        data object Unknown : XmlContext()
    }
}
