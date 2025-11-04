import * as vscode from 'vscode';

/**
 * Provides hover information for Kotlin/Java symbols.
 * Shows a tooltip with reference count and quick navigation.
 */
export class HoverProvider implements vscode.HoverProvider {
    
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        
        // Skip common keywords
        const keywords = ['if', 'else', 'for', 'while', 'return', 'import', 'package', 'fun', 'val', 'var', 'class', 'interface', 'public', 'private', 'protected'];
        if (keywords.includes(word)) {
            return undefined;
        }

        // Find all references to this symbol
        const references = await this.findReferences(word);
        
        if (!references || references.length === 0) {
            return undefined;
        }

        // Create hover content
        const markdownString = new vscode.MarkdownString();
        markdownString.isTrusted = true;
        
        // Add symbol info
        markdownString.appendMarkdown(`**${word}**\n\n`);
        
        // Add reference count
        const refCount = references.length;
        markdownString.appendMarkdown(`${refCount} reference${refCount !== 1 ? 's' : ''} found\n\n`);
        
        // Add up to 5 reference locations with clickable links
        const maxDisplay = 5;
        const displayRefs = references.slice(0, maxDisplay);
        
        markdownString.appendMarkdown('**References:**\n');
        for (const ref of displayRefs) {
            const relativePath = vscode.workspace.asRelativePath(ref.uri);
            const lineNum = ref.range.start.line + 1;
            
            // Create a command URI that will open the file at the specific location
            const commandUri = vscode.Uri.parse(
                `command:editor.action.goToLocations?${encodeURIComponent(JSON.stringify([
                    document.uri,
                    position,
                    references.map(r => new vscode.Location(r.uri, r.range))
                ]))}`
            );
            
            markdownString.appendMarkdown(`- [${relativePath}:${lineNum}](${ref.uri.toString()}#L${lineNum})\n`);
        }
        
        if (references.length > maxDisplay) {
            markdownString.appendMarkdown(`\n_...and ${references.length - maxDisplay} more_\n`);
        }
        
        markdownString.appendMarkdown('\n---\n');
        markdownString.appendMarkdown('💡 **Tip:** Use `Ctrl+Click` to go to definition, or right-click → "Go to References" to see all usages');

        return new vscode.Hover(markdownString, wordRange);
    }

    private async findReferences(symbol: string): Promise<vscode.Location[] | undefined> {
        const locations: vscode.Location[] = [];

        try {
            // Search in Kotlin and Java files
            const files = await vscode.workspace.findFiles(
                '**/*.{kt,java}',
                '**/node_modules/**',
                300  // Increased limit for better coverage
            );

            for (const fileUri of files) {
                try {
                    const fileContent = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(fileContent).toString('utf8');
                    const lines = text.split('\n');

                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                        const line = lines[lineIndex];
                        
                        // Skip comment lines for performance
                        const trimmed = line.trim();
                        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                            continue;
                        }
                        
                        // Find all occurrences of the symbol in this line
                        let columnIndex = 0;
                        while ((columnIndex = line.indexOf(symbol, columnIndex)) !== -1) {
                            // Check if it's a whole word match
                            const isWholeWord = this.isWholeWordMatch(line, symbol, columnIndex);
                            
                            if (isWholeWord) {
                                const location = new vscode.Location(
                                    fileUri,
                                    new vscode.Range(
                                        new vscode.Position(lineIndex, columnIndex),
                                        new vscode.Position(lineIndex, columnIndex + symbol.length)
                                    )
                                );
                                locations.push(location);
                            }
                            
                            columnIndex += symbol.length;
                        }
                    }
                } catch (error) {
                    // Skip files that can't be read
                    continue;
                }
            }

            return locations.length > 0 ? locations : undefined;
        } catch (error) {
            console.error('Error finding references:', error);
            return undefined;
        }
    }

    private isWholeWordMatch(line: string, word: string, index: number): boolean {
        const before = index > 0 ? line[index - 1] : ' ';
        const after = index + word.length < line.length ? line[index + word.length] : ' ';
        
        const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);
        
        return !isWordChar(before) && !isWordChar(after);
    }
}
