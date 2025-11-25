import * as vscode from 'vscode';
import { LogcatParser, ParsedLogEntry, LogLevel } from './logcatParser';

/**
 * Messages sent FROM the webview TO the extension
 */
type WebviewToExtensionMessage = 
    | { type: 'clear' }
    | { type: 'pause' }
    | { type: 'resume' }
    | { type: 'toggleAutoScroll' }
    | { type: 'filterByLevel'; level: LogLevel | null }
    | { type: 'filterByTag'; tag: string }
    | { type: 'filterByPid'; pid: string }
    | { type: 'filterByTagText'; tag: string }
    | { type: 'search'; text: string }
    | { type: 'clearFilter' }
    | { type: 'copyAll' };

/**
 * Messages sent FROM the extension TO the webview
 */
type ExtensionToWebviewMessage =
    | { type: 'addLog'; log: ParsedLogEntry }
    | { type: 'replaceAll'; logs: ParsedLogEntry[] }
    | { type: 'clear' }
    | { type: 'updateState'; state: { isPaused?: boolean; autoScroll?: boolean } };

/**
 * Filter configuration for logcat entries
 */
interface LogcatFilter {
    minLevel?: LogLevel;
    tags?: string[];
    searchText?: string;
    pid?: string;
}

export class LogcatWebviewPanel {
    private static instance: LogcatWebviewPanel | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private parser: LogcatParser;
    private logs: ParsedLogEntry[] = [];
    private readonly maxLogs: number = 10000;
    private isPaused: boolean = false;
    private autoScroll: boolean = true;
    private currentFilter: LogcatFilter = {};

    private constructor(private readonly extensionUri: vscode.Uri) {
        this.parser = new LogcatParser();
    }

    public static getInstance(extensionUri: vscode.Uri): LogcatWebviewPanel {
        if (!LogcatWebviewPanel.instance) {
            LogcatWebviewPanel.instance = new LogcatWebviewPanel(extensionUri);
        }
        return LogcatWebviewPanel.instance;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'androidLogcat',
            'Android Logcat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        this.panel.webview.onDidReceiveMessage(
            message => this.handleWebviewMessage(message),
            undefined
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    public addLog(line: string): void {
        if (this.isPaused) {
            return;
        }

        const entry = this.parser.parseLine(line);
        if (!entry) {
            return;
        }

        this.logs.push(entry);

        // Trim logs if exceeding max
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Send to webview if visible and matches filter
        if (this.panel && this.parser.matchesFilter(entry, this.currentFilter)) {
            const message: ExtensionToWebviewMessage = {
                type: 'addLog',
                log: entry
            };
            this.panel.webview.postMessage(message);
        }
    }

    public clear(): void {
        this.logs = [];
        if (this.panel) {
            const message: ExtensionToWebviewMessage = { type: 'clear' };
            this.panel.webview.postMessage(message);
        }
    }

    public setPaused(paused: boolean): void {
        this.isPaused = paused;
        if (this.panel) {
            const message: ExtensionToWebviewMessage = { 
                type: 'updateState',
                state: { isPaused: paused }
            };
            this.panel.webview.postMessage(message);
        }
    }

    public setAutoScroll(autoScroll: boolean): void {
        this.autoScroll = autoScroll;
        if (this.panel) {
            const message: ExtensionToWebviewMessage = { 
                type: 'updateState',
                state: { autoScroll }
            };
            this.panel.webview.postMessage(message);
        }
    }

    private handleWebviewMessage(message: WebviewToExtensionMessage): void {
        switch (message.type) {
            case 'clear':
                this.clear();
                break;
            case 'pause':
                this.setPaused(true);
                break;
            case 'resume':
                this.setPaused(false);
                break;
            case 'toggleAutoScroll':
                this.setAutoScroll(!this.autoScroll);
                break;
            case 'filterByLevel':
                this.applyFilter({ ...this.currentFilter, minLevel: message.level ?? undefined });
                break;
            case 'filterByTag':
                // Toggle tag filter if clicking the same tag, otherwise set it
                const currentTags = this.currentFilter.tags || [];
                if (currentTags.includes(message.tag)) {
                     // If already filtered by this tag, remove it (toggle off)
                     this.applyFilter({ ...this.currentFilter, tags: undefined });
                } else {
                    this.applyFilter({ ...this.currentFilter, tags: [message.tag] });
                }
                break;
            case 'filterByPid':
                this.applyFilter({ ...this.currentFilter, pid: message.pid || undefined });
                break;
            case 'filterByTagText':
                this.applyFilter({ ...this.currentFilter, tags: message.tag ? [message.tag] : undefined });
                break;
            case 'search':
                this.applyFilter({ ...this.currentFilter, searchText: message.text || undefined });
                break;
            case 'clearFilter':
                this.applyFilter({});
                break;
            case 'copyAll':
                this.copyAllLogs();
                break;
        }
    }

    private applyFilter(filter: LogcatFilter): void {
        this.currentFilter = filter;
        
        if (!this.panel) {
            return;
        }

        // Send filtered logs to webview
        const filteredLogs = this.logs.filter(log => 
            this.parser.matchesFilter(log, this.currentFilter)
        );

        const message: ExtensionToWebviewMessage = {
            type: 'replaceAll',
            logs: filteredLogs
        };
        this.panel.webview.postMessage(message);
    }

    private copyAllLogs(): void {
        const text = this.logs
            .filter(log => this.parser.matchesFilter(log, this.currentFilter))
            .map(log => this.parser.formatEntry(log))
            .join('\n');
        
        vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('Logs copied to clipboard');
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Android Logcat</title>
    <style>
        :root {
            --toolbar-height: 36px;
            --toolbar-bg: var(--vscode-editor-background);
            --border-color: var(--vscode-widget-border);
            --item-hover-bg: var(--vscode-list-hoverBackground);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-editor-font-family), 'Segoe UI', monospace;
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* Toolbar */
        #toolbar {
            display: flex;
            height: auto;
            min-height: var(--toolbar-height);
            padding: 4px 8px;
            background: var(--toolbar-bg);
            border-bottom: 1px solid var(--border-color);
            flex-shrink: 0;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .toolbar-section {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .toolbar-divider {
            width: 1px;
            height: 16px;
            background-color: var(--border-color);
            margin: 0 4px;
        }

        /* Inputs */
        input[type="text"] {
            padding: 2px 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 12px;
            height: 24px;
            outline: none;
        }

        input[type="text"]:focus {
            border-color: var(--vscode-focusBorder);
        }

        input[type="text"]::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        #pid-input { width: 60px; }
        #tag-input { width: 100px; }
        #search-input { width: 180px; flex-grow: 1; }

        /* Buttons */
        button {
            padding: 2px 8px;
            height: 24px;
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid transparent;
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-family: inherit;
            white-space: nowrap;
        }

        button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        button.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        button.secondary:hover {
             background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Level Toggles */
        .level-group {
            display: flex;
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            overflow: hidden;
        }

        .level-btn {
            padding: 0 8px;
            border-radius: 0;
            border-right: 1px solid var(--vscode-input-border);
            font-weight: 600;
            min-width: 24px;
        }

        .level-btn:last-child {
            border-right: none;
        }

        .level-btn.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        /* Stats */
        #stats {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
            display: flex;
            gap: 12px;
            align-items: center;
        }

        /* Logs Area */
        #logs-container {
            flex: 1;
            overflow-y: auto;
            padding: 4px 0;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            line-height: 18px;
        }

        .log-row {
            display: flex;
            padding: 1px 8px;
            border-left: 3px solid transparent;
            width: 100%;
        }

        .log-row:hover {
            background-color: var(--item-hover-bg);
        }

        /* Columns */
        .col-time { color: var(--vscode-descriptionForeground); min-width: 110px; white-space: nowrap; }
        .col-pid  { color: var(--vscode-descriptionForeground); min-width: 80px; white-space: nowrap; text-align: right; margin-right: 8px; }
        .col-level { font-weight: bold; min-width: 20px; text-align: center; margin-right: 4px; }
        .col-tag  { font-weight: 600; min-width: 120px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; color: var(--vscode-symbolIcon-classForeground); cursor: pointer; }
        .col-msg  { flex: 1; white-space: pre-wrap; word-break: break-all; }

        .col-tag:hover { text-decoration: underline; }

        /* Level Colors */
        .lvl-V { color: #A0A0A0; }
        .lvl-D { color: #4FC1FF; } /* VS Code Blue */
        .lvl-I { color: #9CDCFE; } /* VS Code Light Blue */
        .lvl-W { color: #CCA700; } /* VS Code Yellow/Orange */
        .lvl-E { color: #F48771; } /* VS Code Red */
        .lvl-F { color: #FF0000; font-weight: bold; }

        /* Empty State */
        #empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="toolbar-section">
            <button id="clear-btn" class="secondary">Clear</button>
            <button id="pause-btn" class="secondary">Pause</button>
            <button id="autoscroll-btn" class="active secondary">Auto-scroll</button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-section">
            <div class="level-group">
                <button class="level-btn" data-level="V">V</button>
                <button class="level-btn" data-level="D">D</button>
                <button class="level-btn" data-level="I">I</button>
                <button class="level-btn" data-level="W">W</button>
                <button class="level-btn" data-level="E">E</button>
            </div>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-section" style="flex: 1;">
            <input id="pid-filter" type="text" placeholder="PID" />
            <input id="tag-filter" type="text" placeholder="Tag" />
            <input id="search-filter" type="text" placeholder="Search log message..." />
        </div>

        <div class="toolbar-section">
            <button id="copy-btn" class="secondary" title="Copy visible logs">Copy</button>
        </div>

        <div id="stats">
            <span id="log-count">0 logs</span>
        </div>
    </div>

    <div id="logs-container">
        <div id="empty-state">
            <p>Waiting for logs...</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let logs = [];
        let isPaused = false;
        let autoScroll = true;
        let currentMinLevel = null;
        
        // Elements
        const container = document.getElementById('logs-container');
        const emptyState = document.getElementById('empty-state');
        const pauseBtn = document.getElementById('pause-btn');
        const scrollBtn = document.getElementById('autoscroll-btn');
        const logCount = document.getElementById('log-count');

        // Inputs
        const pidInput = document.getElementById('pid-filter');
        const tagInput = document.getElementById('tag-filter');
        const searchInput = document.getElementById('search-filter');

        // State
        function updateUI() {
            pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
            pauseBtn.classList.toggle('active', isPaused);
            scrollBtn.classList.toggle('active', autoScroll);
            logCount.textContent = \`\${logs.length} logs\`;
        }

        // Listeners
        document.getElementById('clear-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'clear' });
        });

        pauseBtn.addEventListener('click', () => {
            if (isPaused) vscode.postMessage({ type: 'resume' });
            else vscode.postMessage({ type: 'pause' });
        });

        scrollBtn.addEventListener('click', () => {
            autoScroll = !autoScroll;
            vscode.postMessage({ type: 'toggleAutoScroll' });
            updateUI();
        });

        document.getElementById('copy-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'copyAll' });
        });

        // Level Filter
        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const level = e.target.dataset.level;
                document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                
                if (currentMinLevel === level) {
                    currentMinLevel = null; // Toggle off
                    vscode.postMessage({ type: 'clearFilter' }); // Resets all filters effectively? No, need to preserve others.
                    // Ideally we just send the level update. 
                    vscode.postMessage({ type: 'filterByLevel', level: null });
                } else {
                    currentMinLevel = level;
                    btn.classList.add('active');
                    vscode.postMessage({ type: 'filterByLevel', level });
                }
            });
        });

        // Input Filters (Debounced)
        const debounce = (fn, ms) => {
            let timeout;
            return function() {
                clearTimeout(timeout);
                timeout = setTimeout(() => fn.apply(this, arguments), ms);
            };
        };

        pidInput.addEventListener('input', debounce((e) => {
            vscode.postMessage({ type: 'filterByPid', pid: e.target.value.trim() });
        }, 300));

        tagInput.addEventListener('input', debounce((e) => {
            vscode.postMessage({ type: 'filterByTagText', tag: e.target.value.trim() });
        }, 300));

        searchInput.addEventListener('input', debounce((e) => {
            vscode.postMessage({ type: 'search', text: e.target.value });
        }, 300));

        // Messaging
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.type) {
                case 'addLog':
                    addLog(msg.log);
                    break;
                case 'replaceAll':
                    renderAll(msg.logs);
                    break;
                case 'clear':
                    logs = [];
                    container.innerHTML = '';
                    container.appendChild(emptyState);
                    emptyState.style.display = 'flex';
                    updateUI();
                    break;
                case 'updateState':
                    if (msg.state.isPaused !== undefined) isPaused = msg.state.isPaused;
                    if (msg.state.autoScroll !== undefined) autoScroll = msg.state.autoScroll;
                    updateUI();
                    break;
            }
        });

        function addLog(log) {
            logs.push(log);
            emptyState.style.display = 'none';
            
            const row = createRow(log);
            container.appendChild(row);

            // Prune DOM if too large (keep last 2000)
            if (container.children.length > 2000) {
                container.removeChild(container.children[0]);
                // Don't remove emptyState if it was index 0 (shouldn't be if logs exist)
            }

            if (autoScroll) {
                container.scrollTop = container.scrollHeight;
            }
            
            updateUI();
        }

        function renderAll(newLogs) {
            logs = newLogs;
            container.innerHTML = '';
            if (logs.length === 0) {
                container.appendChild(emptyState);
                emptyState.style.display = 'flex';
                emptyState.querySelector('p').textContent = 'No logs match filters';
            } else {
                emptyState.style.display = 'none';
                // Use a fragment for performance
                const fragment = document.createDocumentFragment();
                newLogs.forEach(log => fragment.appendChild(createRow(log)));
                container.appendChild(fragment);
            }
            
            if (autoScroll) {
                container.scrollTop = container.scrollHeight;
            }
            updateUI();
        }

        function createRow(log) {
            const div = document.createElement('div');
            div.className = 'log-row';
            // Level specific styling for the row content if needed, usually just color
            div.classList.add(\`lvl-\${log.level}\`);

            // Structure: Time | PID/TID | Lvl | Tag | Msg
            // Note: Using spans for columns
            
            const timeSpan = document.createElement('span');
            timeSpan.className = 'col-time';
            timeSpan.textContent = log.timestamp || '';

            const pidSpan = document.createElement('span');
            pidSpan.className = 'col-pid';
            pidSpan.textContent = \`\${log.pid}-\${log.tid}\`;

            const lvlSpan = document.createElement('span');
            lvlSpan.className = 'col-level';
            lvlSpan.textContent = log.level;
            
            const tagSpan = document.createElement('span');
            tagSpan.className = 'col-tag';
            tagSpan.textContent = log.tag;
            tagSpan.onclick = () => {
                // Populate tag input and trigger filter
                tagInput.value = log.tag;
                vscode.postMessage({ type: 'filterByTagText', tag: log.tag });
            };

            const msgSpan = document.createElement('span');
            msgSpan.className = 'col-msg';
            msgSpan.textContent = log.message;

            div.appendChild(timeSpan);
            div.appendChild(pidSpan);
            div.appendChild(lvlSpan);
            div.appendChild(tagSpan);
            div.appendChild(msgSpan);

            return div;
        }
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
        LogcatWebviewPanel.instance = undefined;
    }
}
