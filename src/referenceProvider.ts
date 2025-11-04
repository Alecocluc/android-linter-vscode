import * as vscode from 'vscode';

/**
 * Provides "Find All References" functionality for Kotlin/Java code.
 * Shows all places where a function, class, or variable is used.
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
        const locations: vscode.Location[] = [];

        // If context.includeDeclaration is true, we should include the definition too
        const includeDeclaration = context.includeDeclaration;

        // Search for all references in workspace
        const files = await vscode.workspace.findFiles(
            '**/*.{kt,java}',
            '**/node_modules/**',
            500
        );

        for (const fileUri of files) {
            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const text = Buffer.from(fileContent).toString('utf8');
                const lines = text.split('\n');

                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];
                    
                    // Find all occurrences of the word in this line
                    let columnIndex = 0;
                    while ((columnIndex = line.indexOf(word, columnIndex)) !== -1) {
                        // Check if it's a whole word match (not part of another identifier)
                        const isWholeWord = this.isWholeWordMatch(line, word, columnIndex);
                        
                        if (isWholeWord) {
                            const location = new vscode.Location(
                                fileUri,
                                new vscode.Position(lineIndex, columnIndex)
                            );

                            // Check if this is a declaration
                            const isDeclaration = this.isDeclaration(line, word, columnIndex);
                            
                            if (includeDeclaration || !isDeclaration) {
                                locations.push(location);
                            }
                        }
                        
                        columnIndex += word.length;
                    }
                }
            } catch (error) {
                // Skip files that can't be read
                continue;
            }
        }

        return locations.length > 0 ? locations : undefined;
    }

    private isWholeWordMatch(line: string, word: string, index: number): boolean {
        const before = index > 0 ? line[index - 1] : ' ';
        const after = index + word.length < line.length ? line[index + word.length] : ' ';
        
        const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);
        
        return !isWordChar(before) && !isWordChar(after);
    }

    private isDeclaration(line: string, word: string, index: number): boolean {
        // Check if this line contains a declaration keyword before the word
        const beforeWord = line.substring(0, index);
        
        // Kotlin/Java declaration patterns
        const declarationPatterns = [
            /\bfun\s+$/,           // Kotlin function
            /\bclass\s+$/,         // Class declaration
            /\binterface\s+$/,     // Interface declaration
            /\bobject\s+$/,        // Kotlin object
            /\bval\s+$/,           // Kotlin val
            /\bvar\s+$/,           // Kotlin var
            /\benum\s+class\s+$/,  // Kotlin enum
            /\bdata\s+class\s+$/   // Kotlin data class
        ];

        return declarationPatterns.some(pattern => pattern.test(beforeWord));
    }
}
