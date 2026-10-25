if (window.__officeHoursPrepEditorLoaded) {
  throw new Error('Duplicate Office Hours Prep editor script ignored.');
}
window.__officeHoursPrepEditorLoaded = true;

let codeEditor = null;
let currentLanguage = 'python';
let activeFileId = 'file-0';
let nextFileNumber = 1;
const files = [];
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
