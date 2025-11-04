import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Provides "Go to Definition" functionality for Kotlin/Java code.
 * Allows Ctrl+Click to navigate to function, class, or variable definitions.
 * When multiple definitions exist, VS Code will show a peek window to choose.
 */
export class DefinitionProvider implements vscode.DefinitionProvider {
    private cache: Map<string, vscode.Location[]> = new Map();
    private cacheTimeout = 30000; // 30 seconds
    
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
        
        // Skip if the word is too short or is a keyword
        if (word.length < 2 || this.isKeyword(word)) {
            return undefined;
        }

        const line = document.lineAt(position.line).text;

        // Check if we're already on a definition line (don't navigate to itself)
        if (this.isDefinitionLine(word, line)) {
            return undefined;
        }

        // Determine what kind of symbol we're looking at
        const symbolType = this.detectSymbolType(word, line, position.character);
        
        // Search for the definition in the workspace
        const locations = await this.findDefinition(word, symbolType, document, token);
        
        // If we found exactly 1 definition, return it (will navigate directly)
        // If we found multiple definitions, return all (VS Code shows peek window)
        // If we found none, return undefined (no navigation)
        return locations;
    }

    private isKeyword(word: string): boolean {
        const keywords = [
            'if', 'else', 'for', 'while', 'do', 'when', 'return', 'break', 'continue',
            'fun', 'val', 'var', 'class', 'interface', 'object', 'companion', 'data',
            'sealed', 'enum', 'annotation', 'public', 'private', 'protected', 'internal',
            'abstract', 'final', 'open', 'override', 'lateinit', 'suspend', 'inline',
            'import', 'package', 'as', 'is', 'in', 'this', 'super', 'null', 'true', 'false',
            'void', 'int', 'long', 'float', 'double', 'boolean', 'char', 'byte', 'short',
            'new', 'static', 'extends', 'implements', 'throws', 'throw', 'try', 'catch', 'finally'
        ];
        return keywords.includes(word.toLowerCase());
    }

    private isDefinitionLine(word: string, line: string): boolean {
        // Check if this line is declaring the symbol
        const definitionPatterns = [
            new RegExp(`\\b(fun|class|interface|object|val|var|enum|data)\\s+${word}\\b`),
            new RegExp(`\\b${word}\\s*\\(`), // Function/method declaration
        ];
        return definitionPatterns.some(pattern => pattern.test(line));
    }

    private detectSymbolType(word: string, line: string, column: number): 'function' | 'class' | 'variable' | 'import' | 'unknown' {
        const trimmedLine = line.trim();
        
        // Check if it's an import statement
        if (trimmedLine.startsWith('import') && line.includes(word)) {
            return 'import';
        }

        // Get the portion of the line before and after the word
        const wordIndex = line.indexOf(word);
        const before = line.substring(0, wordIndex);
        const after = line.substring(wordIndex + word.length);

        // Check if it's a function call (followed by parenthesis or generic type)
        if (/^\s*[(<]/.test(after)) {
            return 'function';
        }

        // Check if it's a class/type (starts with uppercase)
        if (/^[A-Z]/.test(word)) {
            // Could be a class, type, constant, or enum
            // Check context to be more specific
            
            // Property/constant access (has a dot before or after)
            if (/\.\s*$/.test(before) || /^\s*\./.test(after)) {
                return 'variable'; // Accessing a property/constant
            }
            
            // Type annotation or inheritance
            if (/:\s*$/.test(before) || /implements\s+$/.test(before) || /extends\s+$/.test(before)) {
                return 'class';
            }
            
            // Constructor call with parentheses
            if (/^\s*\(/.test(after)) {
                return 'class';
            }
            
            // If followed by method call (.copy, .toString, etc.), it's likely a constant/variable
            if (/^\s*\./.test(after)) {
                return 'variable';
            }
            
            // Default to variable for uppercase identifiers (could be constants like BrandPurpleAccent)
            // This will make it search for both class and val definitions
            return 'variable';
        }

        // Check if it's a variable declaration
        if (/\b(val|var|const|let)\s+$/.test(before)) {
            return 'variable';
        }

        // Check if it's a property access
        if (/\.\s*$/.test(before)) {
            // Could be a method or property
            if (/^\s*\(/.test(after)) {
                return 'function';
            }
            return 'variable'; // Property access
        }

        // Default: try to determine from context
        if (/^\s*\(/.test(after)) {
            return 'function';
        }

        return 'unknown';
    }

    private async findDefinition(
        symbol: string,
        symbolType: string,
        currentDocument: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[] | undefined> {
        
        // Check cache first
        const cacheKey = `${symbol}_${symbolType}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (cached && cached.length > 0) {
                return cached;
            }
        }

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
                    `fun\\s+${this.escapeRegex(symbol)}\\s*\\(`,  // Kotlin function
                    `\\s+${this.escapeRegex(symbol)}\\s*\\(`,     // Java method
                    `override\\s+fun\\s+${this.escapeRegex(symbol)}\\s*\\(` // Kotlin override
                ];
                break;
            case 'class':
                // Kotlin: class ClassName, Java: class ClassName
                searchPatterns = [
                    `\\bclass\\s+${this.escapeRegex(symbol)}\\b`,
                    `\\binterface\\s+${this.escapeRegex(symbol)}\\b`,
                    `\\bobject\\s+${this.escapeRegex(symbol)}\\b`,      // Kotlin object
                    `\\benum\\s+class\\s+${this.escapeRegex(symbol)}\\b`, // Kotlin enum
                    `\\bdata\\s+class\\s+${this.escapeRegex(symbol)}\\b`, // Kotlin data class
                    `\\bsealed\\s+class\\s+${this.escapeRegex(symbol)}\\b` // Kotlin sealed class
                ];
                break;
            case 'variable':
                // Kotlin: val/var variableName, constants, Java: Type variableName
                // Also searches for top-level constants and properties
                searchPatterns = [
                    `^\\s*(val|var|const|let)\\s+${this.escapeRegex(symbol)}\\b`, // Top-level or local declaration
                    `\\b(val|var|const|let)\\s+${this.escapeRegex(symbol)}\\b`,   // Any declaration
                    `^val\\s+${this.escapeRegex(symbol)}\\s*=`,                   // Top-level val (Kotlin constant)
                    `\\s+${this.escapeRegex(symbol)}\\s*[:=]`,                    // Variable with type annotation or assignment
                    `^\\s*${this.escapeRegex(symbol)}\\s*=`,                      // Top-level assignment
                    // For uppercase constants, also search for class definitions (might be companion object property)
                    ...((/^[A-Z]/.test(symbol)) ? [`\\bval\\s+${this.escapeRegex(symbol)}\\s*=\\s*`] : [])
                ];
                break;
            case 'import':
                // Look for class definition from import
                searchPatterns = [
                    `\\bclass\\s+${this.escapeRegex(symbol)}\\b`,
                    `\\binterface\\s+${this.escapeRegex(symbol)}\\b`,
                    `\\bobject\\s+${this.escapeRegex(symbol)}\\b`
                ];
                break;
            default:
                // Generic search - try all patterns
                searchPatterns = [
                    `\\b(fun|class|interface|object|val|var|const)\\s+${this.escapeRegex(symbol)}\\b`,
                    `^\\s*(val|var|const)\\s+${this.escapeRegex(symbol)}\\b`, // Top-level constants
                    `\\s+${this.escapeRegex(symbol)}\\s*[:(=]` // Method, variable, or property
                ];
        }

        // Add a universal fallback pattern that will catch most declarations
        searchPatterns.push(`\\b${this.escapeRegex(symbol)}\\s*[=:]`);

        try {
            // Get all Kotlin and Java files
            const results = await vscode.workspace.findFiles(
                '**/*.{kt,java}',
                '**/node_modules/**',
                200 // Increased limit
            );

            if (token.isCancellationRequested) {
                return undefined;
            }

            // Search through files
            for (const fileUri of results) {
                if (token.isCancellationRequested) {
                    break;
                }

                try {
                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(fileContent).toString('utf8');
                    const lines = text.split('\n');

                    // Try each pattern
                    for (const pattern of searchPatterns) {
                        const regex = new RegExp(pattern, 'gm');
                        
                        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                            const line = lines[lineIndex];
                            
                            // Skip comment lines
                            const trimmed = line.trim();
                            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                                continue;
                            }

                            // Reset regex for each line
                            regex.lastIndex = 0;
                            
                            if (regex.test(line)) {
                                // Find the exact position of the symbol in the line
                                const symbolIndex = line.indexOf(symbol);
                                if (symbolIndex !== -1) {
                                    // Verify it's a whole word match
                                    const before = symbolIndex > 0 ? line[symbolIndex - 1] : ' ';
                                    const after = symbolIndex + symbol.length < line.length ? line[symbolIndex + symbol.length] : ' ';
                                    const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);
                                    
                                    if (!isWordChar(before) && !isWordChar(after)) {
                                        const location = new vscode.Location(
                                            fileUri,
                                            new vscode.Position(lineIndex, symbolIndex)
                                        );
                                        
                                        // Avoid duplicates
                                        if (!locations.some(loc => 
                                            loc.uri.toString() === location.uri.toString() && 
                                            loc.range.start.line === location.range.start.line)) {
                                            locations.push(location);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Skip files that can't be read
                    continue;
                }
            }

            // Cache the results
            if (locations.length > 0) {
                this.cache.set(cacheKey, locations);
                // Clear cache after timeout
                setTimeout(() => this.cache.delete(cacheKey), this.cacheTimeout);
            }

        } catch (error) {
            console.error('Error finding definition:', error);
            return undefined;
        }

        return locations.length > 0 ? locations : undefined;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
