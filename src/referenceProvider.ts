import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, CONFIG_KEYS, FILE_PATTERNS, DEFAULTS } from './constants';

/**
 * Provides "Find All References" functionality for Kotlin/Java code.
 * Shows all places where a function, class, or variable is used.
 * 
 * This provider first attempts to use VS Code's built-in workspace symbol provider
 * for better accuracy, then falls back to text-based search for comprehensive results.
 */
export class ReferenceProvider implements vscode.ReferenceProvider {
    
    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[] | undefined> {
        
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        
        // Skip very short words and common keywords
        if (word.length < 2 || this.isCommonKeyword(word)) {
            return undefined;
        }

        const locations: vscode.Location[] = [];
        const includeDeclaration = context.includeDeclaration;

        // Try to use VS Code's built-in workspace symbol provider first
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                word
            );

            if (symbols && symbols.length > 0 && !token.isCancellationRequested) {
                // Add symbol locations (these are definitions)
                for (const symbol of symbols) {
                    if (symbol.name === word && includeDeclaration) {
                        locations.push(symbol.location);
                    }
                }
            }
        } catch {
            // Symbol provider not available, continue with text search
        }

        if (token.isCancellationRequested) {
            return locations.length > 0 ? locations : undefined;
        }

        // Perform text-based search for comprehensive reference finding
        const textLocations = await this.findTextReferences(word, includeDeclaration, token);
        
        // Merge and deduplicate locations
        for (const loc of textLocations) {
            if (!this.isDuplicateLocation(locations, loc)) {
                locations.push(loc);
            }
        }

        return locations.length > 0 ? locations : undefined;
    }

    private async findTextReferences(
        word: string,
        includeDeclaration: boolean,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        try {
            const files = await vscode.workspace.findFiles(
                FILE_PATTERNS.KOTLIN_JAVA,
                FILE_PATTERNS.EXCLUDE_NODE_MODULES,
                DEFAULTS.MAX_REFERENCE_SEARCH_RESULTS
            );

            for (const fileUri of files) {
                if (token.isCancellationRequested) {
                    break;
                }

                try {
                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(fileContent).toString('utf8');
                    
                    // Skip binary or very large files
                    if (this.isBinaryContent(text) || text.length > 500000) {
                        continue;
                    }

                    const lines = text.split('\n');

                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                        const line = lines[lineIndex];
                        
                        // Skip comment lines for performance
                        const trimmed = line.trim();
                        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                            continue;
                        }
                        
                        // Find all occurrences of the word in this line
                        let columnIndex = 0;
                        while ((columnIndex = line.indexOf(word, columnIndex)) !== -1) {
                            if (this.isWholeWordMatch(line, word, columnIndex)) {
                                const isDeclaration = this.isDeclaration(line, word, columnIndex);
                                
                                if (includeDeclaration || !isDeclaration) {
                                    locations.push(new vscode.Location(
                                        fileUri,
                                        new vscode.Position(lineIndex, columnIndex)
                                    ));
                                }
                            }
                            
                            columnIndex += word.length;
                        }
                    }
                } catch {
                    // Skip files that can't be read
                    continue;
                }
            }
        } catch (error) {
            // Silently handle errors - reference lookup is best-effort
        }

        return locations;
    }

    private isCommonKeyword(word: string): boolean {
        const keywords = new Set([
            'if', 'else', 'for', 'while', 'do', 'when', 'return', 'break', 'continue',
            'fun', 'val', 'var', 'class', 'interface', 'object', 'companion', 'data',
            'sealed', 'enum', 'annotation', 'public', 'private', 'protected', 'internal',
            'abstract', 'final', 'open', 'override', 'lateinit', 'suspend', 'inline',
            'import', 'package', 'as', 'is', 'in', 'this', 'super', 'null', 'true', 'false',
            'void', 'int', 'long', 'float', 'double', 'boolean', 'char', 'byte', 'short',
            'new', 'static', 'extends', 'implements', 'throws', 'throw', 'try', 'catch', 'finally'
        ]);
        return keywords.has(word.toLowerCase());
    }

    private isBinaryContent(content: string): boolean {
        // Check for null bytes which indicate binary content
        return content.includes('\0');
    }

    private isDuplicateLocation(existing: vscode.Location[], newLoc: vscode.Location): boolean {
        return existing.some(loc => 
            loc.uri.toString() === newLoc.uri.toString() && 
            loc.range.start.line === newLoc.range.start.line &&
            loc.range.start.character === newLoc.range.start.character
        );
    }

    private isWholeWordMatch(line: string, word: string, index: number): boolean {
        const before = index > 0 ? line[index - 1] : ' ';
        const after = index + word.length < line.length ? line[index + word.length] : ' ';
        
        const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);
        
        return !isWordChar(before) && !isWordChar(after);
    }

    private isDeclaration(line: string, word: string, index: number): boolean {
        const beforeWord = line.substring(0, index);
        
        // Kotlin/Java declaration patterns
        const declarationPatterns = [
            /\bfun\s+$/,
            /\bclass\s+$/,
            /\binterface\s+$/,
            /\bobject\s+$/,
            /\bval\s+$/,
            /\bvar\s+$/,
            /\benum\s+class\s+$/,
            /\bdata\s+class\s+$/,
            /\bsealed\s+class\s+$/,
        ];

        return declarationPatterns.some(pattern => pattern.test(beforeWord));
    }
}
