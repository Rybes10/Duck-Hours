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
const editorEmptyState = createElement('div', 'editor-empty-state', 'No files open. Add a file or import one to start coding.');
const testCases = [];
let nextTestCaseId = 1;
let selectedTestCaseId = null;
let lastRun = null;
let hintDecorations = [];
let activeIssue = null;
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
document.querySelector('.editor-toolbar').insertBefore(importButton, runButton);
document.body.append(importInput);

// Keep the workspace language friendly for people who are new to coding.
document.querySelector('#run-status').textContent = 'Runs on this computer';
document.querySelector('#intro .lede').textContent = 'Write down what you want your program to do, try it in the editor, and get a gentle next step when you need help.';
document.querySelector('#intro .intro-grid div:nth-child(2) strong').textContent = 'Run your code here';
document.querySelector('#intro .intro-grid div:nth-child(2) span').textContent = 'Press Run to see what your program does.';
document.querySelector('#intro .intro-grid div:nth-child(3) strong').textContent = 'Learn from one issue';
document.querySelector('#intro .intro-grid div:nth-child(3) span').textContent = 'Ask for a hint only when you want one.';
document.querySelector('#brief-heading').textContent = 'About your program';
document.querySelector('.brief-panel>p').textContent = 'Tell us what your program should do and what rules it needs to follow.';
document.querySelector('label[for="memory-limit"]').textContent = 'Memory';
document.querySelector('label[for="constraints"]').textContent = 'Rules to follow';
document.querySelector('#constraints').placeholder = 'For example: the list may be empty.';
document.querySelector('#constraints').nextElementSibling.textContent = 'Add any special rules or edge cases.';
function growSuggestionBox(field) {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}
document.querySelectorAll('#intent,#constraints').forEach(field => {
  field.addEventListener('input', () => growSuggestionBox(field));
  growSuggestionBox(field);
});
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  await importFiles([...importInput.files]);
  importInput.value = '';
});
const examples = {
  python: `def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Duck Hours"))`,
  javascript: `function greet(name) {\n  return \`Hello, ${'${name}'}!\`;\n}\n\nconsole.log(greet("Duck Hours"));`,
  typescript: `function greet(name: string): string {\n  return \`Hello, ${'${name}'}!\`;\n}\n\nconsole.log(greet("Duck Hours"));`,
  ruby: `def greet(name)\n  "Hello, #{name}!"\nend\n\nputs greet("Duck Hours")`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello, Duck Hours")\n}`,
  java: `class main {\n  public static void main(String[] args) {\n    System.out.println("Hello, Duck Hours");\n  }\n}`,
  c: `#include <stdio.h>\n\nint main(void) {\n  printf("Hello, Duck Hours\\n");\n  return 0;\n}`,
  cpp: `#include <iostream>\n\nint main() {\n  std::cout << "Hello, Duck Hours\\n";\n  return 0;\n}`
};

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function startAiProgress(element, label) {
  if (!element) return () => {};
  const startedAt = performance.now();
  const update = () => {
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    element.textContent = `${label} · ${elapsed}s`;
  };
  update();
  const timer = window.setInterval(update, 100);
  return () => window.clearInterval(timer);
}

async function parseApiResponse(response, fallbackMessage) {
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.detail || fallbackMessage);
  return data;
}
