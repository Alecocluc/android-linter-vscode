import * as vscode from 'vscode';

export class CodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        const config = vscode.workspace.getConfiguration('android-linter');
        if (!config.get<boolean>('enableQuickFixes')) {
            return undefined;
        }

        const codeActions: vscode.CodeAction[] = [];

        // Check each diagnostic in the current context
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source?.startsWith('Android Lint')) {
                const quickFixes = this.getQuickFixesForDiagnostic(document, diagnostic);
                codeActions.push(...quickFixes);
            }
        }

        return codeActions;
    }

    private getQuickFixesForDiagnostic(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const issueId = diagnostic.code?.toString() || '';

        // Common quick fixes based on lint issue types
        switch (issueId) {
            case 'HardcodedText':
                actions.push(this.createExtractStringAction(document, diagnostic));
                break;
            case 'UnusedImport':
                actions.push(this.createRemoveLineAction(document, diagnostic, 'Remove unused import'));
                break;
            case 'ContentDescription':
                actions.push(this.createAddContentDescriptionAction(document, diagnostic));
                break;
            case 'RtlHardcoded':
                actions.push(this.createReplaceLeftRightAction(document, diagnostic));
                break;
            case 'SetTextI18n':
                actions.push(this.createExtractStringAction(document, diagnostic));
                break;
            case 'ObsoleteLayoutParam':
                actions.push(this.createRemoveLineAction(document, diagnostic, 'Remove obsolete parameter'));
                break;
            case 'UseCompoundDrawables':
                actions.push(this.createInfoAction(diagnostic, issueId, 'Use compound drawable (android:drawableTop/Bottom/Left/Right)'));
                break;
            default:
                // Generic suppress lint action
                if (issueId) {
                    actions.push(this.createSuppressLintAction(document, diagnostic, issueId));
                }
        }

        return actions;
    }

    private createExtractStringAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            '📝 Extract string resource',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // This would typically open a dialog to get the resource name
        action.command = {
            command: 'android-linter.extractString',
            title: 'Extract String Resource',
            arguments: [document.uri, diagnostic.range]
        };

        return action;
    }

    private createRemoveLineAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        title: string
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `🗑️ ${title}`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        edit.delete(document.uri, line.rangeIncludingLineBreak);
        action.edit = edit;

        return action;
    }

    private createAddContentDescriptionAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            '➕ Add contentDescription attribute',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        const lineText = line.text;
        const indentation = lineText.match(/^\s*/)?.[0] || '';
        
        // Insert contentDescription on the next line
        const insertPosition = line.range.end;
        edit.insert(
            document.uri,
            insertPosition,
            `\n${indentation}    android:contentDescription=""`
        );
        action.edit = edit;

        return action;
    }

    private createReplaceLeftRightAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            '🔄 Replace left/right with start/end',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        const lineText = line.text;
        
        const newText = lineText
            .replace(/android:layout_marginLeft/g, 'android:layout_marginStart')
            .replace(/android:layout_marginRight/g, 'android:layout_marginEnd')
            .replace(/android:paddingLeft/g, 'android:paddingStart')
            .replace(/android:paddingRight/g, 'android:paddingEnd');

        edit.replace(document.uri, line.range, newText);
        action.edit = edit;

        return action;
    }

    private createSuppressLintAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        issueId: string
    ): vscode.CodeAction {
        if (document.languageId === 'xml') {
            const action = new vscode.CodeAction(
                `💡 Suppress with tools:ignore="${issueId}"`,
                vscode.CodeActionKind.Empty
            );
            action.diagnostics = [diagnostic];
            return action;
        }

        const action = new vscode.CodeAction(
            `🔇 Suppress "${issueId}" for this line`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];

        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        const lineText = line.text;
        const indentation = lineText.match(/^\s*/)?.[0] || '';
        
        // Add @SuppressLint annotation (Kotlin/Java)
        const isKotlin = document.languageId === 'kotlin';
        const suppressAnnotation = isKotlin
            ? `${indentation}@Suppress("${issueId}")\n`
            : `${indentation}@SuppressLint("${issueId}")\n`;
        
        const insertPosition = new vscode.Position(diagnostic.range.start.line, 0);
        edit.insert(document.uri, insertPosition, suppressAnnotation);
        action.edit = edit;

        return action;
    }

    private createInfoAction(diagnostic: vscode.Diagnostic, issueId: string, message: string): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `💡 ${message}`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        
        action.command = {
            command: 'vscode.open',
            title: 'Show Documentation',
            arguments: [`https://developer.android.com/s/results?q=${issueId}`]
        };

        return action;
    }
}
