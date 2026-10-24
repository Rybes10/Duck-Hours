const vscode = require('vscode');
const http = require('http');
const https = require('https');

function requestJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString + '/api/analyze');
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { method: 'POST', headers: {'Content-Type': 'application/json'} }, response => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { reject(new Error('The analyzer returned an invalid response.')); return; }
        if (response.statusCode >= 400) reject(new Error(parsed.detail || 'The analyzer could not complete the request.'));
        else resolve(parsed);
      });
    });
    request.on('error', reject);
    request.write(JSON.stringify(body));
    request.end();
  });
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('office-hours-prep');
  const highlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(225, 93, 65, 0.25)', isWholeLine: true, overviewRulerColor: '#e36b48', overviewRulerLane: vscode.OverviewRulerLane.Right });
  const command = vscode.commands.registerCommand('office-hours-prep.analyzeCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
      vscode.window.showWarningMessage('Open a Python file in VS Code first.');
      return;
    }
    const problem = await vscode.window.showInputBox({ prompt: 'What went wrong?', placeHolder: 'Example: Python says a name is not defined' });
    if (problem === undefined) return;
    const apiUrl = vscode.workspace.getConfiguration('officeHoursPrep').get('apiUrl');
    try {
      const analysis = await requestJson(apiUrl, { intent: '', code: editor.document.getText(), problem, mode: 'demo' });
      const found = analysis.issues.filter(item => item.line);
      const editorDiagnostics = found.map(item => {
        const line = Math.max(0, Math.min(editor.document.lineCount - 1, item.line - 1));
        const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
        const severity = item.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const diagnostic = new vscode.Diagnostic(range, `${item.title}: ${item.explanation} Try this: ${item.fix}`, severity);
        diagnostic.source = 'Office Hours Prep';
        return diagnostic;
      });
      diagnostics.set(editor.document.uri, editorDiagnostics);
      const ranges = found.map(item => new vscode.Range(item.line - 1, 0, item.line - 1, 0));
      editor.setDecorations(highlight, ranges);
      vscode.window.showInformationMessage(analysis.summary + ' Problem lines are highlighted in the editor.');
    } catch (error) {
      vscode.window.showErrorMessage(`Office Hours Prep could not connect: ${error.message}`);
    }
  });
  context.subscriptions.push(command, diagnostics, highlight);
}

function deactivate() {}
exports.activate = activate;
exports.deactivate = deactivate;
