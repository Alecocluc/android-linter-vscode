import * as vscode from 'vscode';

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'A';

export interface ParsedLogEntry {
    timestamp: string;
    pid: string;
    tid: string;
    level: LogLevel;
    tag: string;
    message: string;
    rawLine: string;
}

export class LogcatParser {
    /**
     * Parse a single logcat line in threadtime format
     * Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
     * Example: 10-31 14:23:45.123 1234 5678 I MainActivity: App started
     */
    public parseLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Strip any prefix before the actual log (e.g., "Iunknown" or "Wunknown")
        // Some devices add a prefix like "[LEVEL][identifier]" before the standard format
        let cleanLine = line.replace(/^[VDIWEFA][a-zA-Z]*/, '').trim();

        // Threadtime format regex
        // Group 1: timestamp (MM-DD HH:MM:SS.mmm)
        // Group 2: PID
        // Group 3: TID
        // Group 4: Level (V/D/I/W/E/F/A)
        // Group 5: Tag
        // Group 6: Message
        const threadtimePattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+([^:]+):\s*(.*)$/;
        
        const match = cleanLine.match(threadtimePattern);
        
        if (!match) {
            // Return unparsed line as a special entry
            return {
                timestamp: '',
                pid: '',
                tid: '',
                level: 'I',
                tag: 'unknown',
                message: line,
                rawLine: line
            };
        }

        const [, timestamp, pid, tid, level, tag, message] = match;

        return {
            timestamp: timestamp.trim(),
            pid: pid.trim(),
            tid: tid.trim(),
            level: level as LogLevel,
            tag: tag.trim(),
            message: message.trim(),
            rawLine: line
        };
    }

    /**
     * Parse multiple lines at once
     */
    public parseLines(lines: string[]): ParsedLogEntry[] {
        return lines
            .map(line => this.parseLine(line))
            .filter((entry): entry is ParsedLogEntry => entry !== null);
    }

    /**
     * Get color for log level (for terminal/UI display)
     */
    public getLevelColor(level: LogLevel): string {
        const colorMap: Record<LogLevel, string> = {
            'V': '#808080', // Gray (Verbose)
            'D': '#0066CC', // Blue (Debug)
            'I': '#00AA00', // Green (Info)
            'W': '#FF8800', // Orange (Warning)
            'E': '#FF0000', // Red (Error)
            'F': '#AA0000', // Dark Red (Fatal)
            'A': '#FF0000'  // Red (Assert)
        };
        return colorMap[level] || '#808080';
    }

    /**
     * Get priority number for log level (for filtering)
     */
    public getLevelPriority(level: LogLevel): number {
        const priorityMap: Record<LogLevel, number> = {
            'V': 0, // Verbose
            'D': 1, // Debug
            'I': 2, // Info
            'W': 3, // Warning
            'E': 4, // Error
            'F': 5, // Fatal
            'A': 5  // Assert
        };
        return priorityMap[level] || 0;
    }

    /**
     * Check if entry matches filter criteria
     */
    public matchesFilter(
        entry: ParsedLogEntry,
        filter: {
            minLevel?: LogLevel;
            tags?: string[];
            searchText?: string;
            pid?: string;
        }
    ): boolean {
        // Level filter
        if (filter.minLevel) {
            const entryPriority = this.getLevelPriority(entry.level);
            const minPriority = this.getLevelPriority(filter.minLevel);
            if (entryPriority < minPriority) {
                return false;
            }
        }

        // Tag filter
        if (filter.tags && filter.tags.length > 0) {
            if (!filter.tags.some(tag => entry.tag.includes(tag))) {
                return false;
            }
        }

        // PID filter
        if (filter.pid && entry.pid !== filter.pid) {
            return false;
        }

        // Text search filter
        if (filter.searchText) {
            const searchLower = filter.searchText.toLowerCase();
            const matchesMessage = entry.message.toLowerCase().includes(searchLower);
            const matchesTag = entry.tag.toLowerCase().includes(searchLower);
            if (!matchesMessage && !matchesTag) {
                return false;
            }
        }

        return true;
    }

    /**
     * Format entry for display (Clipboard/Export)
     * Format: MM-DD HH:MM:SS.mmm L/Tag(PID): Message
     */
    public formatEntry(entry: ParsedLogEntry, options?: { includeTimestamp?: boolean; includeThreadInfo?: boolean }): string {
        const opts = { includeTimestamp: true, includeThreadInfo: true, ...options };
        
        let parts: string[] = [];
        
        if (opts.includeTimestamp && entry.timestamp) {
            parts.push(entry.timestamp);
        }
        
        // Standard Android Format: L/Tag
        parts.push(`${entry.level}/${entry.tag}`);
        
        if (opts.includeThreadInfo && entry.pid) {
            parts.push(`(${entry.pid})`);
        }
        
        return `${parts.join(' ')}: ${entry.message}`;
    }
}
