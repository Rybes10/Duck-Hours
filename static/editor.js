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
setupSidebar();
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

function setupSidebar() {
  const removeDuplicateSidebars = () => {
    document.querySelectorAll('body > .brief-panel').forEach(duplicate => duplicate.remove());
  };
  const sidebarObserver = new MutationObserver(removeDuplicateSidebars);
  sidebarObserver.observe(document.body, {childList: true, subtree: true});
  removeDuplicateSidebars();

  const sidebar = document.querySelector('#code-workspace > .brief-panel');
  if (!sidebar || sidebar.dataset.tabsInitialized === 'true') return;
  sidebar.dataset.tabsInitialized = 'true';
  const setupPanel = createElement('section', 'sidebar-panel');
  setupPanel.id = 'run-setup-panel';
  setupPanel.setAttribute('role', 'tabpanel');
  setupPanel.setAttribute('aria-labelledby', 'run-setup-tab');
  [...sidebar.children].forEach(child => setupPanel.append(child));
  setupPanel.querySelector(':scope > p')?.remove();
  setupPanel.querySelector('.stdin-field')?.remove();

  const testPanel = createElement('section', 'sidebar-panel testcase-panel');
  testPanel.id = 'testcases-panel';
  testPanel.setAttribute('role', 'tabpanel');
  testPanel.setAttribute('aria-labelledby', 'testcases-tab');
  testPanel.hidden = true;

  const navigation = createElement('div', 'sidebar-tabs');
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-label', 'Right sidebar');
  const setupTab = createElement('button', 'sidebar-tab', 'Run setup');
  setupTab.type = 'button';
  setupTab.id = 'run-setup-tab';
  setupTab.setAttribute('role', 'tab');
  setupTab.setAttribute('aria-controls', setupPanel.id);
  setupTab.setAttribute('aria-selected', 'true');
  const casesTab = createElement('button', 'sidebar-tab', 'Testcases');
  casesTab.type = 'button';
  casesTab.id = 'testcases-tab';
  casesTab.setAttribute('role', 'tab');
  casesTab.setAttribute('aria-controls', testPanel.id);
  casesTab.setAttribute('aria-selected', 'false');
  navigation.append(setupTab, casesTab);
  sidebar.replaceChildren(navigation, setupPanel, testPanel);

  function selectPanel(selectedTab) {
    const showCases = selectedTab === casesTab;
    setupTab.setAttribute('aria-selected', String(!showCases));
    casesTab.setAttribute('aria-selected', String(showCases));
    setupPanel.hidden = showCases;
    testPanel.hidden = !showCases;
  }

  setupTab.addEventListener('click', () => selectPanel(setupTab));
  casesTab.addEventListener('click', () => selectPanel(casesTab));

  const casesHeading = createElement('div', 'testcase-heading');
  casesHeading.append(createElement('h3', '', 'Cases'));
  const caseCount = createElement('span', 'testcase-count');
  caseCount.id = 'testcase-count';
  casesHeading.append(caseCount);
  const caseActions = createElement('div', 'testcase-tools');
  const generateCasesButton = createElement('button', 'generate-testcases', 'Generate test cases');
  generateCasesButton.type = 'button';
  generateCasesButton.addEventListener('click', generateTestCases);
  const addCaseButton = createElement('button', 'add-testcase', 'Add case');
  addCaseButton.type = 'button';
  const actionMenu = createElement('details', 'testcase-action-menu');
  const actionSummary = createElement('summary', '', 'More');
  actionMenu.append(actionSummary);
  const actionList = createElement('div', 'testcase-action-list');
  actionList.style.display = 'none';
  document.body.append(actionList);
  function closeActionMenu() {
    actionMenu.open = false;
    actionList.style.display = 'none';
    actionSummary.setAttribute('aria-expanded', 'false');
  }
  actionSummary.addEventListener('click', event => {
    event.preventDefault();
    if (actionMenu.open) {
      closeActionMenu();
      return;
    }
    actionMenu.open = true;
    actionList.style.display = 'grid';
    const anchor = actionSummary.getBoundingClientRect();
    const menuWidth = actionList.getBoundingClientRect().width;
    const menuHeight = actionList.getBoundingClientRect().height;
    const left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, anchor.right - menuWidth));
    const top = anchor.bottom + menuHeight + 8 <= window.innerHeight
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - menuHeight - 4);
    actionList.style.left = `${left}px`;
    actionList.style.top = `${top}px`;
    actionSummary.setAttribute('aria-expanded', String(actionMenu.open));
  });
  const clearAiButton = createElement('button', 'testcase-menu-action', 'Clear AI-generated cases');
  clearAiButton.type = 'button';
  clearAiButton.addEventListener('click', () => {
    closeActionMenu();
    clearTestCases('ai');
  });
  const clearAllButton = createElement('button', 'testcase-menu-action danger', 'Clear all test cases');
  clearAllButton.type = 'button';
  clearAllButton.addEventListener('click', () => {
    closeActionMenu();
    clearTestCases('all');
  });
  actionList.append(clearAiButton, clearAllButton);
  caseActions.append(generateCasesButton, addCaseButton, actionMenu);
  casesHeading.append(caseActions);
  const generatorStatus = createElement('p', 'testcase-generator-status');
  generatorStatus.id = 'testcase-generator-status';
  generatorStatus.setAttribute('aria-live', 'polite');
  const caseList = createElement('div', 'testcase-list');
  caseList.id = 'testcase-list';
  caseList.setAttribute('role', 'listbox');
  caseList.setAttribute('aria-label', 'Test cases');
  const caseEditor = createElement('div', 'testcase-editor');
  caseEditor.id = 'testcase-editor';
  addCaseButton.addEventListener('click', () => {
    const testCase = {id: nextTestCaseId, name: `Case ${nextTestCaseId}`, origin: 'manual', stdin: '', files: [], expectedOutput: '', status: 'not-run', result: null};
    testCases.push(testCase);
    selectedTestCaseId = testCase.id;
    nextTestCaseId += 1;
    renderTestCases();
  });

  const runCasesButton = createElement('button', 'run-testcases', 'Run with testcases');
  runCasesButton.type = 'button';
  runCasesButton.disabled = true;
  runCasesButton.addEventListener('click', runTestCases);
  testPanel.append(casesHeading, generatorStatus, caseList, caseEditor, runCasesButton);
  renderTestCases();
}

function renderTestCases() {
  const caseList = document.querySelector('#testcase-list');
  const caseEditor = document.querySelector('#testcase-editor');
  if (!caseList || !caseEditor) return;
  caseList.replaceChildren();
  if (!testCases.some(testCase => testCase.id === selectedTestCaseId)) {
    selectedTestCaseId = testCases[0]?.id ?? null;
  }
  const count = document.querySelector('#testcase-count');
  if (count) count.textContent = `${testCases.length} total`;
  const runButton = document.querySelector('.run-testcases');
  if (runButton) runButton.disabled = testCases.length === 0 || runButton.textContent === 'Running tests…';
  const clearAiButton = document.querySelector('.testcase-menu-action.danger')?.previousElementSibling;
  if (clearAiButton) clearAiButton.disabled = !testCases.some(testCase => testCase.origin === 'ai');
  const clearAllButton = document.querySelector('.testcase-menu-action.danger');
  if (clearAllButton) clearAllButton.disabled = testCases.length === 0;

  if (testCases.length === 0) {
    caseList.append(createElement('p', 'testcase-empty', 'No test cases yet. Add one or generate cases from the menu.'));
  }

  testCases.forEach(testCase => {
    const item = createElement('button', 'testcase-list-item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(testCase.id === selectedTestCaseId));
    const caseName = createElement('span', 'testcase-list-name', testCase.name);
    const caseType = createElement('span', 'testcase-list-type', testCase.files.length ? `Input · ${testCase.files.length} files` : 'Input');
    const originTag = createElement('span', `testcase-origin ${testCase.origin === 'ai' ? 'ai' : 'manual'}`, testCase.origin === 'ai' ? 'AI' : 'Manual');
    const statusLabels = {passed: 'Pass', failed: 'Fail', review: 'Review', running: 'Running', 'not-run': 'Not run'};
    const statusTag = createElement('span', `testcase-result-tag ${testCase.status}`, statusLabels[testCase.status] || 'Not run');
    item.append(caseName, caseType, originTag, statusTag);
    item.addEventListener('click', () => {
      selectedTestCaseId = testCase.id;
      renderTestCases();
    });
    caseList.append(item);
  });

  caseEditor.replaceChildren();
  const testCase = testCases.find(item => item.id === selectedTestCaseId);
  if (!testCase) {
    caseEditor.append(createElement('p', 'testcase-empty', 'Select a test case to edit its inputs and expected output.'));
    return;
  }

  const header = createElement('div', 'testcase-title-row');
  const selectedCaseTitle = createElement('div', 'testcase-selected-title');
  selectedCaseTitle.append(createElement('h3', '', testCase.name));
  selectedCaseTitle.append(createElement('span', `testcase-origin ${testCase.origin === 'ai' ? 'ai' : 'manual'}`, testCase.origin === 'ai' ? 'AI generated' : 'Manual'));
  const deleteButton = createElement('button', 'delete-testcase', '×');
  deleteButton.type = 'button';
  deleteButton.setAttribute('aria-label', `Delete ${testCase.name}`);
  deleteButton.addEventListener('click', () => {
    const index = testCases.findIndex(item => item.id === testCase.id);
    if (index >= 0) testCases.splice(index, 1);
    selectedTestCaseId = testCases[Math.min(index, testCases.length - 1)]?.id ?? null;
    renderTestCases();
    renderFileTabs();
  });
  header.append(selectedCaseTitle, deleteButton);

  caseEditor.append(header);

  const stdinField = createElement('div', 'testcase-field');
  stdinField.append(createElement('label', '', 'Standard input'));
  const stdinInput = createElement('textarea', 'testcase-input');
  stdinInput.placeholder = 'One input() value per line';
  stdinInput.setAttribute('aria-label', `${testCase.name} standard input`);
  stdinInput.value = testCase.stdin;
  stdinInput.addEventListener('input', () => { testCase.stdin = stdinInput.value; });
  stdinField.append(stdinInput);
  caseEditor.append(stdinField);

  const filesHeading = createElement('div', 'testcase-heading testcase-files-heading');
  filesHeading.append(createElement('h3', '', 'File overrides'));
  const addFileOverride = createElement('button', 'add-testcase', 'Add file');
  addFileOverride.type = 'button';
  addFileOverride.disabled = files.length === 0;
  addFileOverride.addEventListener('click', () => {
    testCase.files.push({id: `fixture-${Date.now()}-${Math.random()}`, fileName: '', contents: ''});
    renderTestCases();
  });
  filesHeading.append(addFileOverride);
  caseEditor.append(filesHeading);

  const overrideList = createElement('div', 'testcase-overrides');
  if (testCase.files.length === 0) {
    overrideList.append(createElement('p', 'testcase-empty', files.length ? 'No file overrides.' : 'Add an editor file before creating an override.'));
  }
  testCase.files.forEach((fixture, fixtureIndex) => {
    const fixtureCard = createElement('div', 'testcase-file-fixture');
    const fileRow = createElement('div', 'testcase-file-row');
    fileRow.append(createElement('label', '', 'Target file'));
    const fileSelect = createElement('select', 'testcase-file');
    fileSelect.setAttribute('aria-label', `${testCase.name} override ${fixtureIndex + 1} target file`);
    const placeholder = createElement('option', '', 'Choose a file');
    placeholder.value = '';
    fileSelect.append(placeholder);
    files.forEach(file => {
      const option = createElement('option', '', file.name);
      option.value = file.name;
      fileSelect.append(option);
    });
    fileSelect.value = fixture.fileName;
    fileSelect.addEventListener('change', () => {
      fixture.fileName = fileSelect.value;
      renderFileTabs();
    });
    const removeFixture = createElement('button', 'delete-testcase', '×');
    removeFixture.type = 'button';
    removeFixture.setAttribute('aria-label', `Remove file override ${fixtureIndex + 1}`);
    removeFixture.addEventListener('click', () => {
      testCase.files.splice(fixtureIndex, 1);
      renderTestCases();
      renderFileTabs();
    });
    fileRow.append(fileSelect, removeFixture);
    fixtureCard.append(fileRow);

    const contents = createElement('textarea', 'testcase-file-content');
    contents.placeholder = 'Replacement file contents';
    contents.setAttribute('aria-label', `${testCase.name} ${fixture.fileName || 'file'} replacement contents`);
    contents.value = fixture.contents;
    contents.addEventListener('input', () => { fixture.contents = contents.value; });
    fixtureCard.append(contents);
    overrideList.append(fixtureCard);
  });
  caseEditor.append(overrideList);

  const requiredOutput = createElement('section', 'required-output');
  requiredOutput.append(createElement('h3', '', 'Required output'));
  const outputField = createElement('textarea');
  outputField.className = 'required-output-field';
  outputField.placeholder = 'Expected output for this case';
  outputField.setAttribute('aria-label', `${testCase.name} required output`);
  outputField.value = testCase.expectedOutput;
  outputField.addEventListener('input', () => { testCase.expectedOutput = outputField.value; });
  requiredOutput.append(outputField);
  caseEditor.append(requiredOutput);
}

function clearTestCases(scope) {
  const remaining = scope === 'ai' ? testCases.filter(testCase => testCase.origin !== 'ai') : [];
  testCases.splice(0, testCases.length, ...remaining);
  selectedTestCaseId = testCases[0]?.id ?? null;
  renderTestCases();
  renderFileTabs();
}

require(['vs/editor/editor.main'], () => {
  const initialModel = monaco.editor.createModel(examples.python, 'python');
  files.push({id: 'file-0', name: 'main.py', language: 'python', model: initialModel});
  codeEditor = monaco.editor.create(document.querySelector('#editor'), {
    model: initialModel,
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: {enabled: false},
    fontSize: 14,
    lineNumbers: 'on',
    glyphMargin: true,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    padding: {top: 14, bottom: 14}
  });
  document.querySelector('.editor-loading')?.remove();
  renderFileTabs();
  updateFileControls();
  renderTestCases();
});

function renderFileTabs() {
  fileTabs.querySelectorAll('.file-tab-item').forEach(item => item.remove());
  fileTabs.querySelectorAll(':scope > [role="tab"]').forEach(tab => tab.remove());
  const fixtureNames = new Set(testCases.flatMap(testCase => testCase.files.map(fixture => fixture.fileName).filter(Boolean)));
  files.forEach(file => {
    const item = createElement('div', 'file-tab-item');
    item.dataset.fileId = file.id;
    item.dataset.active = String(file.id === activeFileId);
    item.dataset.hasFixture = String(fixtureNames.has(file.name));
    item.draggable = true;
    const tab = createElement('button', 'file-tab', file.name);
    tab.className = 'file-tab';
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'editor');
    tab.setAttribute('aria-selected', String(file.id === activeFileId));
    tab.tabIndex = file.id === activeFileId ? 0 : -1;
    tab.title = file.name;
    tab.addEventListener('click', () => selectFile(file.id));
    const deleteButton = createElement('button', 'delete-file', '×');
    deleteButton.type = 'button';
    deleteButton.disabled = files.length === 1;
    deleteButton.title = files.length === 1 ? 'Keep at least one file open' : `Delete ${file.name}`;
    deleteButton.setAttribute('aria-label', `Delete ${file.name}`);
    deleteButton.addEventListener('click', () => deleteFile(file.id));
    item.append(tab, deleteButton);
    fileTabs.insertBefore(item, addFileButton);
  });
}

function selectFile(fileId) {
  const file = files.find(item => item.id === fileId);
  if (!file || !codeEditor) return;
  activeFileId = fileId;
  currentLanguage = file.language;
  codeEditor.setModel(file.model);
  languageSelect.value = currentLanguage;
  renderFileTabs();
  output.className = 'output-box';
  output.textContent = `Ready to run ${file.name}.`;
  outputStatus.textContent = 'Ready';
}

addFileButton.addEventListener('click', () => {
  if (!codeEditor) return;
  const extension = extensionByLanguage[currentLanguage] || currentLanguage;
  const fileNumber = nextFileNumber++;
  const fileId = `file-${fileNumber}`;
  const fileName = `untitled-${fileNumber}.${extension}`;
  const model = monaco.editor.createModel('', currentLanguage);
  files.push({id: fileId, name: fileName, language: currentLanguage, model});
  selectFile(fileId);
  renderTestCases();
  updateFileControls();
});

function deleteFile(fileId) {
  if (files.length <= 1) return;
  const index = files.findIndex(file => file.id === fileId);
  if (index < 0) return;
  const [removedFile] = files.splice(index, 1);
  if (activeFileId === fileId) {
    const nextFile = files[Math.min(index, files.length - 1)];
    activeFileId = nextFile.id;
    currentLanguage = nextFile.language;
    codeEditor.setModel(nextFile.model);
    languageSelect.value = currentLanguage;
  }
  removedFile.model.dispose();
  testCases.forEach(testCase => {
    testCase.files = testCase.files.filter(fixture => fixture.fileName !== removedFile.name);
  });
  renderFileTabs();
  renderTestCases();
  updateFileControls();
}

function updateFileControls() {
  const atLimit = files.length >= 20;
  addFileButton.disabled = !codeEditor || atLimit;
  importButton.disabled = !codeEditor || atLimit;
  addFileButton.title = atLimit ? 'A workspace can contain up to 20 files' : 'Add file';
}

function uniqueFileName(candidate) {
  const cleaned = candidate.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9_]+/, '') || 'imported.txt';
  const dot = cleaned.lastIndexOf('.');
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const extension = dot > 0 ? cleaned.slice(dot) : '';
  let name = cleaned;
  let suffix = 2;
  while (files.some(file => file.name === name)) {
    name = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return name;
}

async function importFiles(importedFiles) {
  if (!codeEditor) return;
  for (const importedFile of importedFiles) {
    if (files.length >= 20) break;
    const name = uniqueFileName(importedFile.name);
    const extension = name.split('.').pop().toLowerCase();
    const language = languageByExtension[extension] || currentLanguage;
    const source = await importedFile.text();
    const model = monaco.editor.createModel(source, language);
    const id = `file-${nextFileNumber++}`;
    files.push({id, name, language, model});
    activeFileId = id;
    currentLanguage = language;
    codeEditor.setModel(model);
    languageSelect.value = language;
  }
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', []);
  renderFileTabs();
  renderTestCases();
  updateFileControls();
}

fileTabs.addEventListener('dragstart', event => {
  const item = event.target.closest('.file-tab-item');
  if (!item) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', item.dataset.fileId);
  item.classList.add('dragging');
});

fileTabs.addEventListener('dragover', event => {
  const target = event.target.closest('.file-tab-item');
  if (!target) return;
  event.preventDefault();
  fileTabs.querySelectorAll('.drop-target').forEach(item => item.classList.remove('drop-target'));
  target.classList.add('drop-target');
});

fileTabs.addEventListener('drop', event => {
  const target = event.target.closest('.file-tab-item');
  const sourceId = event.dataTransfer.getData('text/plain');
  if (!target || !sourceId || target.dataset.fileId === sourceId) return;
  event.preventDefault();
  const sourceIndex = files.findIndex(file => file.id === sourceId);
  const targetIndex = files.findIndex(file => file.id === target.dataset.fileId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const targetBounds = target.getBoundingClientRect();
  const insertIndex = targetIndex + (event.clientX > targetBounds.left + targetBounds.width / 2 ? 1 : 0);
  const [movedFile] = files.splice(sourceIndex, 1);
  files.splice(sourceIndex < insertIndex ? insertIndex - 1 : insertIndex, 0, movedFile);
  renderFileTabs();
  fileTabs.querySelector(`[data-file-id="${activeFileId}"]`)?.scrollIntoView({block: 'nearest', inline: 'nearest'});
});

fileTabs.addEventListener('dragend', () => {
  fileTabs.querySelectorAll('.dragging,.drop-target').forEach(item => item.classList.remove('dragging', 'drop-target'));
});

fileTabs.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...fileTabs.querySelectorAll('[role="tab"]')];
  const activeIndex = tabs.indexOf(document.activeElement);
  if (activeIndex < 0 || tabs.length < 2) return;
  event.preventDefault();
  const offset = event.key === 'ArrowRight' ? 1 : -1;
  const nextTab = tabs[(activeIndex + offset + tabs.length) % tabs.length];
  nextTab.focus();
  nextTab.click();
});

languageSelect.addEventListener('change', () => {
  currentLanguage = languageSelect.value;
  if (!codeEditor) return;
  const activeFile = files.find(file => file.id === activeFileId);
  if (activeFile) {
    const previousName = activeFile.name;
    activeFile.language = currentLanguage;
    activeFile.name = activeFile.name.replace(/\.[^.]+$/, `.${extensionByLanguage[currentLanguage] || currentLanguage}`);
    testCases.forEach(testCase => {
      testCase.files.forEach(fixture => {
        if (fixture.fileName === previousName) fixture.fileName = activeFile.name;
      });
    });
  }
  codeEditor.setValue(examples[currentLanguage]);
  monaco.editor.setModelLanguage(codeEditor.getModel(), currentLanguage);
  lastRun = null;
  clearHints();
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', []);
  renderFileTabs();
  output.className = 'output-box';
  output.textContent = `Ready to run ${languageSelect.options[languageSelect.selectedIndex].text}.`;
  outputStatus.textContent = 'Ready';
  renderTestCases();
});

runButton.addEventListener('click', async () => {
  if (!codeEditor) return;
  document.body.classList.remove('testcase-results-open');
  const runStartedAt = performance.now();
  runButton.disabled = true;
  runButton.textContent = 'Running…';
  output.className = 'output-box';
  output.textContent = 'Running locally…';
  outputStatus.textContent = 'Running';
  lastRun = null;
  clearHints();
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', []);
  try {
    const response = await fetch('/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      active_file: files.find(file => file.id === activeFileId)?.name || 'main.py',
      files: files.map(file => ({name: file.name, code: file.model.getValue()})),
      intent: [
        `Program purpose: ${document.querySelector('#intent').value.trim() || 'Not specified'}`,
        `Time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
        `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
        `Expected input size: ${document.querySelector('#input-size').value || 'Not specified'}`,
        `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
      ].join('\n')
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'The code could not be run.');
    lastRun = data;
    evaluateRunChecks(performance.now() - runStartedAt, data.status === 'success');
    showRunResult(data);
    if (data.line) markLine(data);
  } catch (error) {
    evaluateRunChecks(performance.now() - runStartedAt, false);
    output.className = 'output-box error';
    output.innerHTML = `<span class="output-title">Could not run the code</span><span class="output-details">${escapeHtml(error.message)}</span>`;
    outputStatus.textContent = 'Error';
  } finally {
    runButton.disabled = false;
    runButton.textContent = '▶ Run';
  }
});

function setCheckStatus(id, state, message) {
  const indicator = document.querySelector(`#${id}`);
  indicator.dataset.state = state;
  indicator.textContent = message;
}

async function runTestCases() {
  const button = document.querySelector('.run-testcases');
  if (!codeEditor || !button || button.disabled || testCases.length === 0) return;
  document.body.classList.add('testcase-results-open');
  button.disabled = true;
  button.textContent = 'Running tests…';
  output.className = 'output-box testcase-results';
  output.textContent = 'Running test cases…';
  outputStatus.textContent = 'Running';

  const results = [];
  for (const testCase of testCases) {
    const caseStartedAt = performance.now();
    testCase.status = 'running';
    testCase.result = null;
    renderTestCases();
    try {
      const overrides = new Map();
      for (const fixture of testCase.files) {
        if (!fixture.fileName) throw new Error('Choose a target editor file for each file override.');
        if (!files.some(file => file.name === fixture.fileName)) {
          throw new Error(`The editor file "${fixture.fileName}" is no longer available.`);
        }
        overrides.set(fixture.fileName, fixture.contents);
      }

      const activeFile = files.find(file => file.id === activeFileId);
      if (!activeFile) throw new Error('Select an editor file before running test cases.');
      const requestFiles = files.map(file => ({
        name: file.name,
        code: overrides.has(file.name) ? overrides.get(file.name) : file.model.getValue()
      }));
      const activeCode = overrides.has(activeFile.name) ? overrides.get(activeFile.name) : activeFile.model.getValue();
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          language: currentLanguage,
          code: activeCode,
          active_file: activeFile.name,
          stdin: testCase.stdin,
          files: requestFiles,
          intent: document.querySelector('#intent').value.trim()
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'The test case could not be run.');
      const actualOutput = data.output || '';
      const outputMatches = data.status === 'success' && normalizeOutput(actualOutput) === normalizeOutput(testCase.expectedOutput);
      const checks = evaluateTestCaseConstraints(testCase, performance.now() - caseStartedAt, data.status === 'success');
      checks.push({name: 'Output', status: outputMatches ? 'passed' : 'failed', detail: outputMatches ? 'Matches required output' : 'Does not match required output'});
      const hasFailure = checks.some(check => check.status === 'failed');
      const needsReview = checks.some(check => check.status === 'review');
      testCase.status = hasFailure ? 'failed' : needsReview ? 'review' : 'passed';
      testCase.result = {
        actualOutput,
        expectedOutput: testCase.expectedOutput,
        error: data.status === 'success' ? '' : (data.error || data.status),
        files: [...overrides.keys()],
        checks
      };
    } catch (error) {
      testCase.status = 'failed';
      testCase.result = {
        actualOutput: '', expectedOutput: testCase.expectedOutput, error: error.message, files: [],
        checks: [{name: 'Execution', status: 'failed', detail: error.message}]
      };
    }
    results.push(testCase);
    renderTestCases();
  }

  renderTestRunOutput(results);
  button.disabled = false;
  button.textContent = 'Run with testcases';
}

function evaluateTestCaseConstraints(testCase, elapsedMs, runSucceeded) {
  const checks = [];
  const timeLimit = Number(document.querySelector('#time-limit').value);
  if (!timeLimit) {
    checks.push({name: 'Time', status: 'not-set', detail: 'No time limit selected'});
  } else {
    const passed = runSucceeded && elapsedMs <= timeLimit * 1000;
    checks.push({
      name: 'Time', status: passed ? 'passed' : 'failed',
      detail: runSucceeded ? `${Math.round(elapsedMs)} ms / ${timeLimit} s` : 'Program did not complete successfully'
    });
  }

  const inputLimit = Number(document.querySelector('#input-size').value);
  const inputBytes = new Blob([testCase.stdin, ...testCase.files.map(fixture => fixture.contents)]).size;
  if (!inputLimit) {
    checks.push({name: 'Input size', status: 'not-set', detail: `${inputBytes} B; no limit selected`});
  } else {
    const passed = inputBytes <= inputLimit;
    checks.push({
      name: 'Input size', status: passed ? 'passed' : 'failed',
      detail: `${inputBytes} B / ${inputLimit} B`
    });
  }

  const memoryLimit = document.querySelector('#memory-limit').value;
  checks.push(memoryLimit
    ? {name: 'Memory', status: 'review', detail: `${memoryLimit} MB selected; runner does not report memory use`}
    : {name: 'Memory', status: 'not-set', detail: 'No memory limit selected'});

  const otherConstraints = document.querySelector('#constraints').value.trim();
  checks.push(otherConstraints
    ? {name: 'Other constraints', status: 'review', detail: 'Requires manual review'}
    : {name: 'Other constraints', status: 'not-set', detail: 'None specified'});
  return checks;
}

async function generateTestCases() {
  const button = document.querySelector('.generate-testcases');
  const status = document.querySelector('#testcase-generator-status');
  const activeFile = files.find(file => file.id === activeFileId);
  if (!button || !status || !codeEditor || !activeFile) return;
  button.disabled = true;
  button.textContent = 'Generating…';
  status.textContent = '';
  status.hidden = true;
  try {
    const response = await fetch('/api/testcases', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        language: currentLanguage,
        active_file: activeFile.name,
        code: activeFile.model.getValue(),
        files: files.map(file => ({name: file.name, code: file.model.getValue()})),
        existing_cases: testCases.map(testCase => ({
          name: testCase.name,
          stdin: testCase.stdin,
          files: testCase.files.map(fixture => ({file_name: fixture.fileName, contents: fixture.contents})),
          expected_output: testCase.expectedOutput
        })),
        intent: document.querySelector('#intent').value.trim(),
        constraints: [
          `Time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
          `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
          `Expected input size: ${document.querySelector('#input-size').value || 'Not specified'}`,
          `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
        ].join('\n')
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not generate test cases.');
    const generated = (data.cases || []).map((generatedCase, index) => ({
      id: nextTestCaseId + index,
      name: generatedCase.name || `AI case ${nextTestCaseId + index}`,
      origin: 'ai',
      stdin: generatedCase.stdin || '',
      files: (generatedCase.files || []).map((fixture, fixtureIndex) => ({
        id: `ai-fixture-${nextTestCaseId + index}-${fixtureIndex}`,
        fileName: fixture.file_name,
        contents: fixture.contents || ''
      })),
      expectedOutput: generatedCase.expected_output || '',
      status: 'not-run',
      result: null
    }));
    if (!generated.length) {
      status.textContent = 'No meaningful additional test cases were found.';
      return;
    }
    testCases.push(...generated);
    nextTestCaseId += generated.length;
    selectedTestCaseId = generated[0].id;
    renderTestCases();
    renderFileTabs();
    status.textContent = `${generated.length} AI-generated test case${generated.length === 1 ? '' : 's'} added.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    status.hidden = false;
    button.disabled = false;
    button.textContent = 'Generate test cases';
  }
}

function normalizeOutput(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd();
}

function renderTestRunOutput(results) {
  const passed = results.filter(testCase => testCase.status === 'passed').length;
  const failed = results.filter(testCase => testCase.status === 'failed').length;
  const review = results.filter(testCase => testCase.status === 'review').length;
  output.replaceChildren();
  output.className = `output-box testcase-results ${failed ? 'error' : review ? 'review' : 'success'}`;
  output.append(createElement('strong', 'testcase-results-summary', `${passed} passed · ${failed} failed · ${review} review`));
  results.forEach(testCase => {
    const resultCard = createElement('section', `testcase-result ${testCase.status}`);
    const resultHeading = createElement('div', 'testcase-result-heading');
    resultHeading.append(createElement('strong', '', testCase.name));
    const resultLabels = {passed: 'Pass', failed: 'Fail', review: 'Review'};
    resultHeading.append(createElement('span', `testcase-result-tag ${testCase.status}`, resultLabels[testCase.status] || testCase.status));
    resultCard.append(resultHeading);
    if (testCase.result.checks?.length) {
      const checks = createElement('div', 'testcase-checks');
      testCase.result.checks.forEach(check => {
        const checkRow = createElement('div', 'testcase-check');
        checkRow.append(createElement('span', '', check.name));
        checkRow.append(createElement('span', `testcase-check-status ${check.status}`, check.detail));
        checks.append(checkRow);
      });
      resultCard.append(checks);
    }
    if (testCase.result.files.length) {
      resultCard.append(createElement('div', 'testcase-result-files', `Files overridden: ${testCase.result.files.join(', ')}`));
    }
    if (testCase.result.error) resultCard.append(createElement('div', 'testcase-result-error', testCase.result.error));
    const actual = createElement('pre', 'testcase-result-output');
    actual.textContent = `Actual stdout\n${testCase.result.actualOutput || '(empty)'}`;
    resultCard.append(actual);
    if (testCase.status !== 'passed') {
      const expected = createElement('pre', 'testcase-result-output');
      expected.textContent = `Required output\n${testCase.result.expectedOutput || '(empty)'}`;
      resultCard.append(expected);
    }
    output.append(resultCard);
  });
  outputStatus.textContent = `${passed} passed · ${failed} failed · ${review} review`;
}

function evaluateRunChecks(elapsedMs, runSucceeded) {
  const timeLimit = Number(document.querySelector('#time-limit').value);
  if (!timeLimit) {
    setCheckStatus('check-time', 'idle', 'Not set');
  } else if (!runSucceeded) {
    setCheckStatus('check-time', 'review', 'Run failed');
  } else {
    const elapsed = Math.round(elapsedMs);
    const passed = elapsedMs <= timeLimit * 1000;
    setCheckStatus('check-time', passed ? 'pass' : 'fail', `${passed ? 'Pass' : 'Over'} · ${elapsed} ms`);
  }

  const memoryLimit = document.querySelector('#memory-limit').value;
  setCheckStatus('check-memory', memoryLimit ? 'review' : 'idle', memoryLimit ? 'Not measured' : 'Not set');

  const otherConstraints = document.querySelector('#constraints').value.trim();
  setCheckStatus('check-other', otherConstraints ? 'review' : 'idle', otherConstraints ? 'Review' : 'None');
}

function showRunResult(data) {
  if (data.status === 'success') {
    output.className = 'output-box';
    output.textContent = data.output || '(The program ran successfully but printed no output.)';
    outputStatus.textContent = 'Success';
    return;
  }
  if (data.status === 'compile_error') {
    output.className = 'output-box error';
    output.innerHTML = '<span class="output-title">Your code has run into an issue.</span><button id="hint" class="hint-button" type="button">? Give me a hint</button>';
    outputStatus.textContent = 'Needs attention';
    document.querySelector('#hint').addEventListener('click', requestHint);
    return;
  }
  if (data.status === 'runtime_error') {
    output.className = 'output-box runtime';
    output.innerHTML = '<span class="output-title">Your code has run into an issue.</span><button id="hint" class="hint-button" type="button">? Give me a hint</button>';
    outputStatus.textContent = 'Needs attention';
    document.querySelector('#hint').addEventListener('click', requestHint);
    return;
  }
  const details = data.output || data.error || 'No details were returned.';
  output.className = `output-box ${data.status === 'unavailable' ? 'error' : 'runtime'}`;
  output.innerHTML = `<span class="output-title">${data.status === 'unavailable' ? 'Language unavailable' : 'The program stopped while running'}</span><span class="output-details">${escapeHtml(details)}</span><span class="output-note">${escapeHtml(data.error || '')}</span>`;
  outputStatus.textContent = 'Needs attention';
}

async function requestHint() {
  if (!codeEditor || !lastRun) return;
  const hintButton = document.querySelector('#hint');
  hintButton.disabled = true;
  hintButton.textContent = 'Getting a hint…';
  try {
    const response = await fetch('/api/hint', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      intent: document.querySelector('#intent').value,
      compiler_error: lastRun.output || lastRun.error || ''
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Gemini could not provide a hint.');
    if (!data.hints || data.hints.length === 0) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">Gemini could not identify a clear line yet.</span>');
      return;
    }
    showHints(data.hints);
    hintButton.textContent = 'Hint added to editor';
  } catch (error) {
    hintButton.disabled = false;
    hintButton.textContent = '? Give me a hint';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">Gemini could not provide a hint right now.</span>');
  }
}

function showHints(hints) {
  const model = codeEditor.getModel();
  const validHints = hints.filter(hint => Number.isInteger(hint.line) && hint.line >= 1 && hint.line <= model.getLineCount());
  if (!validHints.length) return;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, validHints.map(hint => ({
    range: new monaco.Range(hint.line, 1, hint.line, 1),
    options: {
      isWholeLine: true,
      className: 'hint-line',
      glyphMarginClassName: 'hint-glyph',
      glyphMarginHoverMessage: {value: `**Hint:** ${hint.message}`}
    }
  })));
  monaco.editor.setModelMarkers(model, 'office-hours-prep', validHints.map(hint => ({
    startLineNumber: hint.line,
    endLineNumber: hint.line,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(hint.line),
    message: 'A gentle hint is available for this line.',
    severity: monaco.MarkerSeverity.Hint
  })));
  codeEditor.revealLineInCenter(validHints[0].line);
}

function clearHints() {
  if (!codeEditor) return;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, []);
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', []);
}

function markLine(data) {
  const message = data.error || 'This line needs attention.';
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', [{
    startLineNumber: data.line,
    endLineNumber: data.line,
    startColumn: 1,
    endColumn: codeEditor.getModel().getLineMaxColumn(data.line),
    message,
    severity: data.status === 'compile_error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
  }]);
  codeEditor.revealLineInCenter(data.line);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
