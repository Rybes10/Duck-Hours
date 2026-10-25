if (window.__officeHoursPrepEditorLoaded) {
  throw new Error('Duplicate Office Hours Prep editor script ignored.');
}
window.__officeHoursPrepEditorLoaded = true;

let codeEditor = null;
let currentLanguage = 'python';
let activeFileId = 'file-0';
let nextFileNumber = 1;
const files = [];
const closedFiles = [];
const runButton = document.querySelector('#run');
const output = document.querySelector('#output');
const outputStatus = document.querySelector('#output-status');
const languageSelect = document.querySelector('#language');
const fileTabs = document.querySelector('#file-tabs');
const addFileButton = document.querySelector('#add-file');
const editorContainer = document.querySelector('#editor');
const editorEmptyState = createElement('div', 'editor-empty-state', 'No files open. Reopen a workspace file, add a file, or import one to start coding.');
const testCases = [];
let nextTestCaseId = 1;
let selectedTestCaseId = null;
let maxAiTestCases = 8;
let lastRun = null;
let hintDecorations = [];
const legacyWorkspaceStorageKey = 'office-hours-prep.workspace.v1';
const workspaceCatalogStorageKey = 'office-hours-prep.workspaces.v1';
const workspaceCatalog = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(workspaceCatalogStorageKey) || 'null');
    if (stored?.version === 1 && Array.isArray(stored.workspaces)) return stored;
  } catch {}
  const catalog = {version: 1, activeId: null, workspaces: []};
  try {
    const legacyText = localStorage.getItem(legacyWorkspaceStorageKey);
    const legacyState = JSON.parse(legacyText || 'null');
    if (legacyState?.version === 1) {
      const id = 'workspace-legacy';
      catalog.workspaces.push({id, name: 'My workspace', updatedAt: new Date().toISOString()});
      localStorage.setItem(workspaceStateStorageKey(id), legacyText);
    }
    localStorage.setItem(workspaceCatalogStorageKey, JSON.stringify(catalog));
  } catch {}
  return catalog;
})();
function workspaceStateStorageKey(id) {
  return `office-hours-prep.workspace.${id}.v1`;
}
let activeWorkspaceId = workspaceCatalog.workspaces.some(item => item.id === workspaceCatalog.activeId)
  ? workspaceCatalog.activeId
  : null;
workspaceCatalog.activeId = activeWorkspaceId;
function saveWorkspaceCatalog() {
  try {
    localStorage.setItem(workspaceCatalogStorageKey, JSON.stringify(workspaceCatalog));
  } catch (error) {
    console.warn('Could not save the workspace list in this browser.', error);
  }
}
let savedWorkspace = null;
try {
  savedWorkspace = activeWorkspaceId
    ? JSON.parse(localStorage.getItem(workspaceStateStorageKey(activeWorkspaceId)) || 'null')
    : null;
  if (!savedWorkspace || savedWorkspace.version !== 1) savedWorkspace = null;
} catch {
  savedWorkspace = null;
}
if (savedWorkspace?.settings) {
  document.querySelector('#intent').value = savedWorkspace.settings.intent || '';
  document.querySelector('#stdin').value = savedWorkspace.settings.stdin || '';
  document.querySelector('#time-limit').value = savedWorkspace.settings.timeLimit || '';
  document.querySelector('#memory-limit').value = savedWorkspace.settings.memoryLimit || '';
  document.querySelector('#constraints').value = savedWorkspace.settings.constraints || '';
  const savedAiLimit = Number(savedWorkspace.settings.maxAiTestCases);
  maxAiTestCases = Number.isFinite(savedAiLimit) ? Math.min(20, Math.max(0, savedAiLimit)) : 8;
}
if (savedWorkspace && Array.isArray(savedWorkspace.testCases)) {
  testCases.push(...savedWorkspace.testCases.filter(testCase => testCase && typeof testCase === 'object' && !(
    testCase.name === 'Example: greeting' && testCase.origin !== 'ai' && !testCase.stdin &&
    (!Array.isArray(testCase.files) || testCase.files.length === 0) &&
    testCase.expectedOutput === 'Hello, Office Hours!' && (!Array.isArray(testCase.expectedFiles) || testCase.expectedFiles.length === 0)
  )).map(testCase => ({
    id: testCase.id,
    name: String(testCase.name || 'Case'),
    origin: testCase.origin === 'ai' ? 'ai' : 'manual',
    generationStrategy: testCase.generationStrategy || null,
    stdin: String(testCase.stdin || ''),
    files: Array.isArray(testCase.files) ? testCase.files : [],
    expectedOutput: String(testCase.expectedOutput || ''),
    expectedFiles: Array.isArray(testCase.expectedFiles) ? testCase.expectedFiles : [],
    status: 'not-run',
    result: null
  })));
  nextTestCaseId = Math.max(1, ...testCases.map(testCase => Number(testCase.id) + 1).filter(Number.isFinite));
  selectedTestCaseId = null;
}
let workspaceSaveTimer = null;
function allWorkspaceFiles() {
  return [...files, ...closedFiles];
}
function writeWorkspaceSnapshot() {
  if (!codeEditor || !activeWorkspaceId) return;
  try {
      localStorage.setItem(workspaceStateStorageKey(activeWorkspaceId), JSON.stringify({
        version: 1,
        files: files.map(file => ({id: file.id, name: file.name, language: file.language, contents: file.model.getValue(), generated: Boolean(file.generated)})),
        closedFiles: closedFiles.map(file => ({id: file.id, name: file.name, language: file.language, contents: file.model.getValue(), generated: Boolean(file.generated)})),
        activeFileId,
        currentLanguage,
        nextFileNumber,
        testCases: testCases.map(testCase => ({
          id: testCase.id,
          name: testCase.name,
          origin: testCase.origin,
          generationStrategy: testCase.generationStrategy || null,
          stdin: testCase.stdin,
          files: testCase.files,
          expectedOutput: testCase.expectedOutput,
          expectedFiles: testCase.expectedFiles
        })),
        nextTestCaseId,
        selectedTestCaseId,
        settings: {
          intent: document.querySelector('#intent').value,
          stdin: document.querySelector('#stdin').value,
          timeLimit: document.querySelector('#time-limit').value,
          memoryLimit: document.querySelector('#memory-limit').value,
          constraints: document.querySelector('#constraints').value,
          maxAiTestCases
        }
      }));
      const workspace = workspaceCatalog.workspaces.find(item => item.id === activeWorkspaceId);
      if (workspace) workspace.updatedAt = new Date().toISOString();
      saveWorkspaceCatalog();
  } catch (error) {
    console.warn('Could not save the workspace in this browser.', error);
  }
}
function persistWorkspace() {
  if (!codeEditor || !activeWorkspaceId) return;
  clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(writeWorkspaceSnapshot, 150);
}
function renderWorkspaceList() {
  const container = document.querySelector('#workspace-items');
  if (!container) return;
  container.replaceChildren();
  if (workspaceCatalog.workspaces.length === 0) {
    container.append(createElement('p', 'workspace-list-empty', 'No workspaces yet. Create one to get started.'));
    return;
  }
  workspaceCatalog.workspaces.slice().sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))).forEach(workspace => {
    const row = createElement('div', 'workspace-entry-row');
    const openButton = createElement('button', 'workspace-entry');
    openButton.type = 'button';
    openButton.append(createElement('strong', '', workspace.name));
    const modified = workspace.updatedAt ? new Date(workspace.updatedAt).toLocaleString() : 'Not opened yet';
    openButton.append(createElement('span', '', `Last updated ${modified}`));
    openButton.addEventListener('click', () => {
      activeWorkspaceId = workspace.id;
      workspaceCatalog.activeId = workspace.id;
      saveWorkspaceCatalog();
      window.location.reload();
    });
    const deleteButton = createElement('button', 'workspace-delete', 'Delete');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `Delete ${workspace.name}`);
    deleteButton.title = `Delete ${workspace.name} and its saved files and test cases`;
    deleteButton.addEventListener('click', () => {
      if (!window.confirm(`Delete "${workspace.name}" and all of its saved files and test cases? This cannot be undone.`)) return;
      try {
        localStorage.removeItem(workspaceStateStorageKey(workspace.id));
      } catch (error) {
        console.warn('Could not delete the saved workspace data.', error);
        return;
      }
      if (workspace.id === 'workspace-legacy') {
        try {
          localStorage.removeItem(legacyWorkspaceStorageKey);
        } catch (error) {
          console.warn('Could not remove the legacy workspace copy.', error);
        }
      }
      workspaceCatalog.workspaces = workspaceCatalog.workspaces.filter(item => item.id !== workspace.id);
      if (activeWorkspaceId === workspace.id) {
        activeWorkspaceId = null;
        workspaceCatalog.activeId = null;
      }
      saveWorkspaceCatalog();
      renderWorkspaceList();
    });
    row.append(openButton, deleteButton);
    container.append(row);
  });
}
function createWorkspace(name) {
  const id = `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  workspaceCatalog.workspaces.push({id, name, updatedAt: new Date().toISOString()});
  workspaceCatalog.activeId = id;
  activeWorkspaceId = id;
  saveWorkspaceCatalog();
  window.location.reload();
}
function showWorkspaceScreen() {
  const landing = document.querySelector('#intro');
  const workspace = document.querySelector('#workspace');
  const isOpen = Boolean(activeWorkspaceId);
  document.body.classList.toggle('workspace-active', isOpen);
  landing?.classList.toggle('hidden', isOpen);
  workspace?.classList.toggle('hidden', !isOpen);
  const activeName = workspaceCatalog.workspaces.find(item => item.id === activeWorkspaceId)?.name || '';
  const activeNameElement = document.querySelector('#active-workspace-name');
  if (activeNameElement) activeNameElement.textContent = activeName;
  renderWorkspaceList();
}
document.querySelector('#create-project')?.addEventListener('click', () => {
  const input = document.querySelector('#new-workspace-name');
  const name = input?.value.trim() || `Workspace ${workspaceCatalog.workspaces.length + 1}`;
  createWorkspace(name.slice(0, 60));
});
document.querySelector('#new-workspace-name')?.addEventListener('keydown', event => {
  if (event.key === 'Enter') document.querySelector('#create-project')?.click();
});
document.querySelector('#workspace-home')?.addEventListener('click', () => {
  writeWorkspaceSnapshot();
  workspaceCatalog.activeId = null;
  activeWorkspaceId = null;
  saveWorkspaceCatalog();
  window.location.reload();
});
showWorkspaceScreen();
document.addEventListener('input', event => {
  if (event.target.closest('#testcase-editor') || event.target.matches('#intent,#stdin,#constraints')) persistWorkspace();
});
document.addEventListener('change', event => {
  if (event.target.matches('#time-limit,#memory-limit')) persistWorkspace();
});
addFileButton.disabled = true;
const extensionByLanguage = {python: 'py', javascript: 'js', typescript: 'ts', ruby: 'rb', go: 'go', java: 'java', c: 'c', cpp: 'cpp'};
const languageByExtension = {py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', rb: 'ruby', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp'};
const importButton = document.createElement('button');
importButton.type = 'button';
importButton.className = 'import-files-button';
importButton.textContent = 'Import files';
importButton.title = 'Import files from your computer';
importButton.disabled = true;
const importInput = document.createElement('input');
importInput.type = 'file';
importInput.multiple = true;
importInput.accept = '.py,.js,.mjs,.ts,.rb,.go,.java,.c,.h,.cpp,.cc,.hpp,.txt';
importInput.hidden = true;
const workspaceHomeButton = document.querySelector('#workspace-home');
const toolbarStart = document.querySelector('.toolbar-start');
if (toolbarStart) toolbarStart.insertBefore(importButton, document.querySelector('#active-workspace-name'));
else document.querySelector('.editor-toolbar').insertBefore(importButton, workspaceHomeButton?.nextSibling || runButton);
document.body.append(importInput);
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  await importFiles([...importInput.files]);
  importInput.value = '';
});
const examples = {
  python: `def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Office Hours"))`,
  javascript: `function greet(name) {\n  return \`Hello, ${'${name}'}!\`;\n}\n\nconsole.log(greet("Office Hours"));`,
  typescript: `function greet(name: string): string {\n  return \`Hello, ${'${name}'}!\`;\n}\n\nconsole.log(greet("Office Hours"));`,
  ruby: `def greet(name)\n  "Hello, #{name}!"\nend\n\nputs greet("Office Hours")`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello, Office Hours")\n}`,
  java: `class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, Office Hours");\n  }\n}`,
  c: `#include <stdio.h>\n\nint main(void) {\n  printf("Hello, Office Hours\\n");\n  return 0;\n}`,
  cpp: `#include <iostream>\n\nint main() {\n  std::cout << "Hello, Office Hours\\n";\n  return 0;\n}`
};

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function parseApiResponse(response, fallbackMessage) {
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    const preview = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const detail = preview ? ` ${preview}` : '';
    throw new Error(`The server returned a non-JSON response (${response.status}).${detail}`);
  }
  if (!response.ok) throw new Error(data.detail || fallbackMessage);
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
