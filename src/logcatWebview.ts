import * as vscode from 'vscode';
import { LogcatParser, ParsedLogEntry, LogLevel } from './logcatParser';

export class LogcatWebviewPanel {
    private static instance: LogcatWebviewPanel | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private parser: LogcatParser;
    private logs: ParsedLogEntry[] = [];
    private readonly maxLogs: number = 10000;
    private isPaused: boolean = false;
    private autoScroll: boolean = true;
    private currentFilter: {
        minLevel?: LogLevel;
        tags?: string[];
        searchText?: string;
    } = {};

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
            '📱 Android Logcat',
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
            this.panel.webview.postMessage({
                type: 'addLog',
                log: entry
            });
        }
    }

    public clear(): void {
        this.logs = [];
        if (this.panel) {
            this.panel.webview.postMessage({ type: 'clear' });
        }
    }

    public setPaused(paused: boolean): void {
        this.isPaused = paused;
        if (this.panel) {
            this.panel.webview.postMessage({ 
                type: 'updateState',
                state: { isPaused: paused }
            });
        }
    }

    public setAutoScroll(autoScroll: boolean): void {
        this.autoScroll = autoScroll;
        if (this.panel) {
            this.panel.webview.postMessage({ 
                type: 'updateState',
                state: { autoScroll }
            });
        }
    }

    private handleWebviewMessage(message: any): void {
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
                this.applyFilter({ minLevel: message.level });
                break;
            case 'filterByTag':
                this.applyFilter({ tags: [message.tag] });
                break;
            case 'search':
                this.applyFilter({ searchText: message.text });
                break;
            case 'clearFilter':
                this.applyFilter({});
                break;
            case 'copyAll':
                this.copyAllLogs();
                break;
        }
    }

    private applyFilter(filter: typeof this.currentFilter): void {
        this.currentFilter = filter;
        
        if (!this.panel) {
            return;
        }

        // Send filtered logs to webview
        const filteredLogs = this.logs.filter(log => 
            this.parser.matchesFilter(log, this.currentFilter)
        );

        this.panel.webview.postMessage({
            type: 'replaceAll',
            logs: filteredLogs
        });
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
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        #toolbar {
            display: flex;
            gap: 8px;
            padding: 8px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            flex-wrap: wrap;
            align-items: center;
        }

        .toolbar-group {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .toolbar-divider {
            width: 1px;
            height: 20px;
            background-color: var(--vscode-panel-border);
            margin: 0 4px;
        }

        button {
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            transition: background-color 0.2s;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button.active {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.level-btn {
            font-weight: bold;
            min-width: 32px;
        }

        button.level-V { color: #808080; }
        button.level-D { color: #0066CC; }
        button.level-I { color: #00AA00; }
        button.level-W { color: #FF8800; }
        button.level-E { color: #FF0000; }

        input[type="text"] {
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 11px;
            min-width: 150px;
        }

        input[type="text"]:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        #stats {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
            display: flex;
            gap: 12px;
        }

        #logs-container {
            flex: 1;
            overflow-y: auto;
            padding: 4px;
        }

        .log-entry {
            padding: 2px 4px;
            border-left: 3px solid transparent;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            line-height: 1.4;
        }

        .log-entry:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .log-entry.level-V {
            border-left-color: #808080;
            color: #A0A0A0;
        }

        .log-entry.level-D {
            border-left-color: #0066CC;
            color: #4DA6FF;
        }

        .log-entry.level-I {
            border-left-color: #00AA00;
            color: var(--vscode-editor-foreground);
        }

        .log-entry.level-W {
            border-left-color: #FF8800;
            color: #FFA726;
        }

        .log-entry.level-E {
            border-left-color: #FF0000;
            color: #FF5252;
            font-weight: 500;
        }

        .log-entry.level-F {
            border-left-color: #AA0000;
            color: #FF5252;
            font-weight: bold;
        }

        .log-timestamp {
            color: var(--vscode-descriptionForeground);
            margin-right: 8px;
        }

        .log-level {
            font-weight: bold;
            margin-right: 8px;
            min-width: 12px;
            display: inline-block;
        }

        .log-tag {
            color: var(--vscode-symbolIcon-classForeground);
            margin-right: 8px;
            cursor: pointer;
            font-weight: 500;
        }

        .log-tag:hover {
            text-decoration: underline;
        }

        .log-message {
            color: inherit;
        }

        #empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            gap: 8px;
        }

        #empty-state.hidden {
            display: none;
        }

        .icon {
            font-size: 48px;
            opacity: 0.5;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="toolbar-group">
            <button id="clear-btn" title="Clear logs">🧹 Clear</button>
            <button id="pause-btn" title="Pause/Resume">⏸️ Pause</button>
            <button id="autoscroll-btn" class="active" title="Toggle auto-scroll">🔽 Auto-scroll</button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <span style="font-size: 10px; color: var(--vscode-descriptionForeground);">Level:</span>
            <button class="level-btn level-V" data-level="V" title="Verbose">V</button>
            <button class="level-btn level-D" data-level="D" title="Debug">D</button>
            <button class="level-btn level-I" data-level="I" title="Info">I</button>
            <button class="level-btn level-W" data-level="W" title="Warning">W</button>
            <button class="level-btn level-E" data-level="E" title="Error">E</button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <input type="text" id="search-input" placeholder="Search logs..." />
            <button id="clear-filter-btn" title="Clear filters">✖ Clear Filter</button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
            <button id="copy-btn" title="Copy all visible logs">📋 Copy</button>
        </div>

        <div id="stats">
            <span id="log-count">0 logs</span>
            <span id="error-count">0 errors</span>
            <span id="warning-count">0 warnings</span>
        </div>
    </div>

    <div id="logs-container">
        <div id="empty-state">
            <div class="icon">📱</div>
            <div>Waiting for logcat output...</div>
            <div style="font-size: 10px;">Start logcat to see logs here</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let logs = [];
        let isPaused = false;
        let autoScroll = true;
        let currentMinLevel = null;
        let stats = { total: 0, errors: 0, warnings: 0 };

        const logsContainer = document.getElementById('logs-container');
        const emptyState = document.getElementById('empty-state');
        const pauseBtn = document.getElementById('pause-btn');
        const autoScrollBtn = document.getElementById('autoscroll-btn');
        const searchInput = document.getElementById('search-input');

        // Toolbar event listeners
        document.getElementById('clear-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'clear' });
        });

        pauseBtn.addEventListener('click', () => {
            if (isPaused) {
                vscode.postMessage({ type: 'resume' });
                isPaused = false;
                pauseBtn.textContent = '⏸️ Pause';
            } else {
                vscode.postMessage({ type: 'pause' });
                isPaused = true;
                pauseBtn.textContent = '▶️ Resume';
            }
        });

        autoScrollBtn.addEventListener('click', () => {
            autoScroll = !autoScroll;
            autoScrollBtn.classList.toggle('active', autoScroll);
            vscode.postMessage({ type: 'toggleAutoScroll' });
        });

        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = btn.dataset.level;
                if (currentMinLevel === level) {
                    currentMinLevel = null;
                    btn.classList.remove('active');
                    vscode.postMessage({ type: 'clearFilter' });
                } else {
                    document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                    currentMinLevel = level;
                    btn.classList.add('active');
                    vscode.postMessage({ type: 'filterByLevel', level });
                }
            });
        });

        searchInput.addEventListener('input', debounce((e) => {
            const text = e.target.value;
            if (text) {
                vscode.postMessage({ type: 'search', text });
            } else {
                vscode.postMessage({ type: 'clearFilter' });
            }
        }, 300));

        document.getElementById('clear-filter-btn').addEventListener('click', () => {
            searchInput.value = '';
            currentMinLevel = null;
            document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
            vscode.postMessage({ type: 'clearFilter' });
        });

        document.getElementById('copy-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'copyAll' });
        });

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'addLog':
                    addLogEntry(message.log);
                    break;
                case 'clear':
                    clearLogs();
                    break;
                case 'replaceAll':
                    replaceAllLogs(message.logs);
                    break;
                case 'updateState':
                    updateState(message.state);
                    break;
            }
        });

        function addLogEntry(log) {
            logs.push(log);
            
            emptyState.classList.add('hidden');

            const entry = createLogElement(log);
            logsContainer.appendChild(entry);

            updateStats(log);

            if (autoScroll) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }

            // Limit DOM elements to prevent performance issues
            const children = logsContainer.children;
            if (children.length > 10000) {
                logsContainer.removeChild(children[0]);
            }
        }

        function createLogElement(log) {
            const div = document.createElement('div');
            div.className = \`log-entry level-\${log.level}\`;
            
            const timestamp = log.timestamp ? \`<span class="log-timestamp">[\${log.timestamp}]</span>\` : '';
            const level = \`<span class="log-level">\${log.level}</span>\`;
            const tag = \`<span class="log-tag" data-tag="\${log.tag}">\${log.tag}</span>\`;
            const message = \`<span class="log-message">\${escapeHtml(log.message)}</span>\`;
            
            div.innerHTML = \`\${timestamp}\${level}\${tag}\${message}\`;
            
            // Click tag to filter
            const tagElement = div.querySelector('.log-tag');
            if (tagElement) {
                tagElement.addEventListener('click', () => {
                    vscode.postMessage({ type: 'filterByTag', tag: log.tag });
                });
            }
            
            return div;
        }

        function clearLogs() {
            logs = [];
            stats = { total: 0, errors: 0, warnings: 0 };
            logsContainer.innerHTML = '<div id="empty-state"><div class="icon">📱</div><div>Logs cleared</div></div>';
            emptyState = document.getElementById('empty-state');
            updateStatsDisplay();
        }

        function replaceAllLogs(newLogs) {
            logs = newLogs;
            logsContainer.innerHTML = '';
            stats = { total: 0, errors: 0, warnings: 0 };
            
            if (newLogs.length === 0) {
                logsContainer.innerHTML = '<div id="empty-state"><div class="icon">🔍</div><div>No logs match the current filter</div></div>';
            } else {
                newLogs.forEach(log => {
                    const entry = createLogElement(log);
                    logsContainer.appendChild(entry);
                    updateStats(log);
                });
            }
            
            if (autoScroll) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        }

        function updateState(state) {
            if (state.isPaused !== undefined) {
                isPaused = state.isPaused;
                pauseBtn.textContent = isPaused ? '▶️ Resume' : '⏸️ Pause';
            }
            if (state.autoScroll !== undefined) {
                autoScroll = state.autoScroll;
                autoScrollBtn.classList.toggle('active', autoScroll);
            }
        }

        function updateStats(log) {
            stats.total++;
            if (log.level === 'E' || log.level === 'F') {
                stats.errors++;
            } else if (log.level === 'W') {
                stats.warnings++;
            }
            updateStatsDisplay();
        }

        function updateStatsDisplay() {
            document.getElementById('log-count').textContent = \`\${stats.total} logs\`;
            document.getElementById('error-count').textContent = \`\${stats.errors} errors\`;
            document.getElementById('warning-count').textContent = \`\${stats.warnings} warnings\`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
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
