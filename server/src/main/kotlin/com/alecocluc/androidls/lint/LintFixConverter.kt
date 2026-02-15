package com.alecocluc.androidls.lint

import com.android.tools.lint.detector.api.*
import org.eclipse.lsp4j.*
import org.eclipse.lsp4j.Diagnostic as LspDiagnostic

/**
 * Converts Android Lint's LintFix objects to LSP CodeAction objects.
 * 
 * LintFix is the structured fix representation from the lint API.
 * It supports: ReplaceString, SetAttribute, CreateFile, AnnotateFix,
 * GroupFix (composite), and more. Each is mapped to an appropriate
 * LSP CodeAction with WorkspaceEdit.
 */
class LintFixConverter {

    /**
     * Convert a LintFix to one or more CodeActions.
     */
    fun convert(
        fix: LintFix,
        documentUri: String,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): List<CodeAction> {
        val actions = mutableListOf<CodeAction>()
        
        when (fix) {
            is LintFix.ReplaceString -> {
                convertReplaceString(fix, documentUri, issue, diagnostic)?.let { actions.add(it) }
            }
            is LintFix.SetAttribute -> {
                convertSetAttribute(fix, documentUri, issue, diagnostic)?.let { actions.add(it) }
            }
            is LintFix.GroupFix -> {
                // Composite fix — handle based on type
                when (fix.type) {
                    LintFix.GroupType.ALTERNATIVES -> {
                        // Multiple alternative fixes — each becomes a separate CodeAction
                        for (childFix in fix.fixes) {
                            actions.addAll(convert(childFix, documentUri, issue, diagnostic))
                        }
                    }
                    LintFix.GroupType.COMPOSITE -> {
                        // All fixes must be applied together
                        convertComposite(fix, documentUri, issue, diagnostic)?.let { actions.add(it) }
                    }
                }
            }
            is LintFix.AnnotateFix -> {
                convertAnnotate(fix, documentUri, issue, diagnostic)?.let { actions.add(it) }
            }
            is LintFix.CreateFileFix -> {
                convertCreateFile(fix, issue, diagnostic)?.let { actions.add(it) }
            }
            else -> {
                // Unknown fix type — create a generic action with the display name
                val displayName = fix.getDisplayName()
                if (displayName != null) {
                    actions.add(CodeAction().apply {
                        title = displayName
                        kind = CodeActionKind.QuickFix
                        diagnostics = listOf(diagnostic)
                    })
                }
            }
        }
        
        return actions
    }
    
    /**
     * Convert ReplaceString fix → TextEdit.
     * This handles: replacing text, inserting text, deleting text.
     */
    private fun convertReplaceString(
        fix: LintFix.ReplaceString,
        documentUri: String,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): CodeAction? {
        val displayName = fix.getDisplayName() ?: "Fix: ${issue.id}"
        val range = diagnostic.range
        
        val edit = WorkspaceEdit()
        val newText = fix.replacement ?: return null
        
        // If the fix specifies exact old text, we need to find it in the range
        // For simplicity, replace the diagnostic range
        val textEdit = TextEdit(range, newText)
        edit.changes = mapOf(documentUri to listOf(textEdit))
        
        return CodeAction().apply {
            this.title = displayName
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(diagnostic)
            this.edit = edit
            this.isPreferred = fix.autoFix
        }
    }
    
    /**
     * Convert SetAttribute fix → TextEdit for XML files.
     */
    private fun convertSetAttribute(
        fix: LintFix.SetAttribute,
        documentUri: String,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): CodeAction? {
        val displayName = fix.getDisplayName() ?: "Set attribute: ${fix.attribute}"
        
        // SetAttribute needs context about the XML element to insert properly
        // For now, create a basic action
        return CodeAction().apply {
            this.title = displayName
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(diagnostic)
            // Edit will be resolved lazily when the user selects the action
        }
    }
    
    /**
     * Convert AnnotateFix → insert annotation above the line.
     */
    private fun convertAnnotate(
        fix: LintFix.AnnotateFix,
        documentUri: String,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): CodeAction? {
        val annotation = fix.annotation ?: return null
        val displayName = fix.getDisplayName() ?: "Add $annotation"
        
        val line = diagnostic.range.start.line
        val edit = WorkspaceEdit()
        val textEdit = TextEdit(
            Range(Position(line, 0), Position(line, 0)),
            "    $annotation\n"
        )
        edit.changes = mapOf(documentUri to listOf(textEdit))
        
        return CodeAction().apply {
            this.title = displayName
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(diagnostic)
            this.edit = edit
        }
    }
    
    /**
     * Convert CreateFileFix → command to create a file.
     */
    private fun convertCreateFile(
        fix: LintFix.CreateFileFix,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): CodeAction? {
        val displayName = fix.getDisplayName() ?: "Create file"
        
        return CodeAction().apply {
            this.title = displayName
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(diagnostic)
            // File creation will be handled via command
        }
    }
    
    /**
     * Convert a composite fix (multiple fixes that must be applied together).
     */
    private fun convertComposite(
        fix: LintFix.GroupFix,
        documentUri: String,
        issue: Issue,
        diagnostic: LspDiagnostic
    ): CodeAction? {
        val displayName = fix.getDisplayName() ?: "Fix: ${issue.id}"
        
        val allEdits = mutableListOf<TextEdit>()
        
        for (childFix in fix.fixes) {
            when (childFix) {
                is LintFix.ReplaceString -> {
                    val newText = childFix.replacement ?: continue
                    allEdits.add(TextEdit(diagnostic.range, newText))
                }
                is LintFix.AnnotateFix -> {
                    val annotation = childFix.annotation ?: continue
                    val line = diagnostic.range.start.line
                    allEdits.add(TextEdit(
                        Range(Position(line, 0), Position(line, 0)),
                        "    $annotation\n"
                    ))
                }
                else -> { /* skip unsupported child types in composite */ }
            }
        }
        
        if (allEdits.isEmpty()) return null
        
        val edit = WorkspaceEdit()
        edit.changes = mapOf(documentUri to allEdits)
        
        return CodeAction().apply {
            this.title = displayName
            this.kind = CodeActionKind.QuickFix
            this.diagnostics = listOf(diagnostic)
            this.edit = edit
        }
    }
    
    /**
     * Extension to get display name from any LintFix.
     */
    private fun LintFix.getDisplayName(): String? {
        return try {
            // LintFix has a displayName field accessible via reflection if not directly
            val field = LintFix::class.java.getDeclaredField("displayName")
            field.isAccessible = true
            field.get(this) as? String
        } catch (e: Exception) {
            null
        }
    }
}
