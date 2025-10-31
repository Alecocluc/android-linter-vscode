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

        // Threadtime format regex
        // Group 1: timestamp (MM-DD HH:MM:SS.mmm)
        // Group 2: PID
        // Group 3: TID
        // Group 4: Level (V/D/I/W/E/F/A)
        // Group 5: Tag
        // Group 6: Message
        const threadtimePattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+([^:]+):\s*(.*)$/;
        
        const match = line.match(threadtimePattern);
        
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
     * Get icon for log level
     */
    public getLevelIcon(level: LogLevel): string {
        const iconMap: Record<LogLevel, string> = {
            'V': '○', // Verbose
            'D': '◐', // Debug
            'I': '●', // Info
            'W': '⚠', // Warning
            'E': '✖', // Error
            'F': '✖', // Fatal
            'A': '✖'  // Assert
        };
        return iconMap[level] || '○';
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
     * Format entry for display
     */
    public formatEntry(entry: ParsedLogEntry, options?: { includeTimestamp?: boolean; includeThreadInfo?: boolean }): string {
        const opts = { includeTimestamp: true, includeThreadInfo: true, ...options };
        
        let formatted = '';
        
        if (opts.includeTimestamp && entry.timestamp) {
            formatted += `[${entry.timestamp}] `;
        }
        
        formatted += `${this.getLevelIcon(entry.level)} ${entry.level} `;
        
        if (opts.includeThreadInfo && entry.pid && entry.tid) {
            formatted += `[${entry.pid}:${entry.tid}] `;
        }
        
        formatted += `${entry.tag}: ${entry.message}`;
        
        return formatted;
    }
}
