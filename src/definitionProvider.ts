import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Provides "Go to Definition" functionality for Kotlin/Java code.
 * Allows Ctrl+Click to navigate to function, class, or variable definitions.
 */
export class DefinitionProvider implements vscode.DefinitionProvider {
    
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Determine what kind of symbol we're looking at
        const symbolType = this.detectSymbolType(word, line, position.character);
        
        // Search for the definition in the workspace
        return await this.findDefinition(word, symbolType, document);
    }

    private detectSymbolType(word: string, line: string, column: number): 'function' | 'class' | 'variable' | 'import' | 'unknown' {
        // Check if it's a function call (followed by parenthesis)
        if (line.includes(`${word}(`)) {
            return 'function';
        }

        // Check if it's a class (capital first letter or after 'class' keyword)
        if (/class\s+/.test(line) || /^[A-Z]/.test(word)) {
            return 'class';
        }

        // Check if it's an import
        if (line.includes('import') && line.includes(word)) {
            return 'import';
        }

        // Check if it's after 'val', 'var', 'let', 'const' (variable declaration)
        if (/\b(val|var|let|const)\s+/.test(line)) {
            return 'variable';
        }

        return 'unknown';
    }

    private async findDefinition(
        symbol: string,
        symbolType: string,
        currentDocument: vscode.TextDocument
    ): Promise<vscode.Location[] | undefined> {
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentDocument.uri);
        if (!workspaceFolder) {
            return undefined;
        }

        const locations: vscode.Location[] = [];

        // Search patterns based on symbol type
        let searchPatterns: string[] = [];

        switch (symbolType) {
            case 'function':
                // Kotlin: fun functionName(, Java: void/Type functionName(
                searchPatterns = [
                    `fun\\s+${symbol}\\s*\\(`,  // Kotlin function
                    `\\s+${symbol}\\s*\\(`      // Java method (with return type before)
                ];
                break;
            case 'class':
                // Kotlin: class ClassName, Java: class ClassName
                searchPatterns = [
                    `class\\s+${symbol}\\b`,
                    `interface\\s+${symbol}\\b`,
                    `object\\s+${symbol}\\b`,      // Kotlin object
                    `enum\\s+class\\s+${symbol}\\b`, // Kotlin enum
                    `data\\s+class\\s+${symbol}\\b`  // Kotlin data class
                ];
                break;
            case 'variable':
                // Kotlin: val/var variableName, Java: Type variableName
                searchPatterns = [
                    `(val|var|let|const)\\s+${symbol}\\b`,
                    `\\s+${symbol}\\s*=`
                ];
                break;
            case 'import':
                // Look for class definition from import
                searchPatterns = [
                    `class\\s+${symbol}\\b`,
                    `interface\\s+${symbol}\\b`,
                    `object\\s+${symbol}\\b`
                ];
                break;
            default:
                // Generic search
                searchPatterns = [
                    `(fun|class|interface|object|val|var)\\s+${symbol}\\b`
                ];
        }

        // Search in Kotlin and Java files
        for (const pattern of searchPatterns) {
            const results = await vscode.workspace.findFiles(
                '**/*.{kt,java}',
                '**/node_modules/**',
                100
            );

            for (const fileUri of results) {
                try {
                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(fileContent).toString('utf8');
                    const lines = text.split('\n');

                    const regex = new RegExp(pattern, 'gm');
                    
                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                        const line = lines[lineIndex];
                        if (regex.test(line)) {
                            // Find the exact position of the symbol in the line
                            const symbolIndex = line.indexOf(symbol);
                            if (symbolIndex !== -1) {
                                const location = new vscode.Location(
                                    fileUri,
                                    new vscode.Position(lineIndex, symbolIndex)
                                );
                                locations.push(location);
                            }
                        }
                    }
                } catch (error) {
                    // Skip files that can't be read
                    continue;
                }
            }

            // If we found definitions, return them
            if (locations.length > 0) {
                break;
            }
        }

        return locations.length > 0 ? locations : undefined;
    }
}
