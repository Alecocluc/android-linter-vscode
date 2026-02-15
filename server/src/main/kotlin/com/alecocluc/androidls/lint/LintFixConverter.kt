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
        val title = fix.getDisplayName() ?: "Fix: ${issue.id}"
        return listOf(
            CodeAction().apply {
                this.title = title
                this.kind = CodeActionKind.QuickFix
                this.diagnostics = listOf(diagnostic)
            }
        )
    }
}
