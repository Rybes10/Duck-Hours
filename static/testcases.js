let targetValidationTimer = null;
let targetValidationSequence = 0;
let targetValidationState = {key: '', status: 'unknown'};

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

  const testPanel = createElement('section', 'sidebar-panel testcase-panel');
  testPanel.id = 'testcases-panel';
  testPanel.setAttribute('role', 'tabpanel');
  testPanel.setAttribute('aria-labelledby', 'testcases-tab');
  testPanel.hidden = true;
  const workspaceFilesPanel = createElement('section', 'sidebar-panel workspace-files-panel');
  workspaceFilesPanel.id = 'workspace-files-panel';
  workspaceFilesPanel.setAttribute('role', 'tabpanel');
  workspaceFilesPanel.setAttribute('aria-labelledby', 'workspace-files-tab');
  workspaceFilesPanel.hidden = true;
  const filesHeading = createElement('div', 'testcase-heading');
  filesHeading.append(createElement('h3', '', 'Workspace files'));
  const filesCount = createElement('span', 'testcase-count');
  filesCount.id = 'workspace-files-count';
  filesHeading.append(filesCount);
  const workspaceFilesList = createElement('div', 'workspace-files-list');
  workspaceFilesList.id = 'workspace-files-list';
  workspaceFilesPanel.append(filesHeading, workspaceFilesList);
  const settingsPanel = createElement('section', 'sidebar-panel settings-panel');
  settingsPanel.id = 'settings-panel';
  settingsPanel.setAttribute('role', 'tabpanel');
  settingsPanel.setAttribute('aria-labelledby', 'settings-tab');
  settingsPanel.hidden = true;
  const settingsHeading = createElement('div', 'testcase-heading');
  settingsHeading.append(createElement('h3', '', 'Settings'));
  const timeoutField = createElement('label', 'settings-field', 'Time until the program stops');
  const timeoutSelect = createElement('select', 'settings-select');
  timeoutSelect.id = 'execution-timeout';
  timeoutSelect.setAttribute('aria-describedby', 'execution-timeout-help');
  for (const [value, label] of [['1', '1 second'], ['2', '2 seconds'], ['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    timeoutSelect.append(option);
  }
  const savedTimeout = Number(savedWorkspace?.settings?.executionTimeout);
  timeoutSelect.value = [1, 2, 5, 10, 20].includes(savedTimeout) ? String(savedTimeout) : '10';
  timeoutField.append(timeoutSelect);
  const timeoutHelp = createElement('span', 'settings-help', 'If the program does not finish in this time, it is stopped. A timeout can point to an infinite loop or work that takes too long.');
  timeoutHelp.id = 'execution-timeout-help';
  settingsPanel.append(settingsHeading, timeoutField, timeoutHelp);

  const navigation = createElement('div', 'sidebar-tabs');
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-label', 'Right sidebar');
  const setupTab = createElement('button', 'sidebar-tab', 'Run setup');
  setupTab.type = 'button';
  setupTab.id = 'run-setup-tab';
  setupTab.setAttribute('role', 'tab');
  setupTab.setAttribute('aria-controls', setupPanel.id);
  setupTab.setAttribute('aria-selected', 'true');
  const casesTab = createElement('button', 'sidebar-tab', 'Test Cases');
  casesTab.type = 'button';
  casesTab.id = 'testcases-tab';
  casesTab.setAttribute('role', 'tab');
  casesTab.setAttribute('aria-controls', testPanel.id);
  casesTab.setAttribute('aria-selected', 'false');
  const workspaceFilesTab = createElement('button', 'sidebar-tab');
  workspaceFilesTab.type = 'button';
  workspaceFilesTab.id = 'workspace-files-tab';
  workspaceFilesTab.setAttribute('role', 'tab');
  workspaceFilesTab.setAttribute('aria-controls', workspaceFilesPanel.id);
  workspaceFilesTab.setAttribute('aria-selected', 'false');
  workspaceFilesTab.append(createElement('span', 'sidebar-tab-label', 'Files'));
  workspaceFilesTab.append(createElement('span', 'sidebar-tab-count', '0'));
  const settingsTab = createElement('button', 'sidebar-tab', 'Settings');
  settingsTab.type = 'button';
  settingsTab.id = 'settings-tab';
  settingsTab.setAttribute('role', 'tab');
  settingsTab.setAttribute('aria-controls', settingsPanel.id);
  settingsTab.setAttribute('aria-selected', 'false');
  navigation.append(setupTab, casesTab, workspaceFilesTab, settingsTab);
  sidebar.replaceChildren(navigation, setupPanel, testPanel, workspaceFilesPanel, settingsPanel);
  setupBriefPanelResizing(sidebar);

  function selectPanel(selectedTab) {
    const showCases = selectedTab === casesTab;
    const showFiles = selectedTab === workspaceFilesTab;
    const showSettings = selectedTab === settingsTab;
    casesTab.setAttribute('aria-selected', String(showCases));
    workspaceFilesTab.setAttribute('aria-selected', String(showFiles));
    settingsTab.setAttribute('aria-selected', String(showSettings));
    setupTab.setAttribute('aria-selected', String(!showCases && !showFiles && !showSettings));
    setupPanel.hidden = showCases || showFiles || showSettings;
    testPanel.hidden = !showCases;
    workspaceFilesPanel.hidden = !showFiles;
    settingsPanel.hidden = !showSettings;
  }

  setupTab.addEventListener('click', () => selectPanel(setupTab));
  casesTab.addEventListener('click', () => selectPanel(casesTab));
  workspaceFilesTab.addEventListener('click', () => selectPanel(workspaceFilesTab));
  settingsTab.addEventListener('click', () => selectPanel(settingsTab));
  timeoutSelect.addEventListener('change', () => {
    persistWorkspace();
    markTestCasesOutdated();
  });
  renderWorkspaceFiles();

  const casesHeading = createElement('div', 'testcase-heading');
  casesHeading.append(createElement('h3', '', 'Cases'));
  const caseCount = createElement('span', 'testcase-count');
  caseCount.id = 'testcase-count';
  casesHeading.append(caseCount);
  const caseActions = createElement('div', 'testcase-tools');
  const generateCasesButton = createElement('button', 'generate-testcases', 'Generate tests for selection');
  generateCasesButton.type = 'button';
  generateCasesButton.addEventListener('click', generateTestCases);
  const clearAllButton = createElement('button', 'clear-testcases', 'Clear tests');
  clearAllButton.type = 'button';
  clearAllButton.addEventListener('click', clearTestCases);
  const addCustomButton = createElement('button', 'add-custom-test', 'Add your own test');
  addCustomButton.type = 'button';
  addCustomButton.addEventListener('click', addCustomTestCase);
  caseActions.append(generateCasesButton, addCustomButton, clearAllButton);
  const instructions = createElement('p', 'testcase-instructions', 'Highlight one complete function or method. Choose a case count, then generate. Use ▶ Run for a complete program.');
  const countField = createElement('label', 'testcase-count-field');
  countField.textContent = 'How many test cases would you like?';
  const countInput = createElement('input', 'testcase-count-input');
  countInput.id = 'testcase-request-count';
  countInput.type = 'number';
  countInput.min = '1';
  countInput.max = '20';
  countInput.step = '1';
  countInput.value = String(window.savedTestCount || 5);
  countInput.setAttribute('aria-describedby', 'testcase-count-help');
  countField.append(countInput);
  const countHelp = createElement('span', 'testcase-count-help', 'Choose 1–20. The default is 5.');
  countHelp.id = 'testcase-count-help';
  const styleField = createElement('label', 'testcase-generation-field', 'What kind of tests?');
  const styleSelect = createElement('select', 'testcase-generation-select');
  styleSelect.id = 'testcase-test-style';
  for (const [value, label] of [['general', 'General testing'], ['edge', 'Edge cases'], ['stress', 'Stress testing']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    styleSelect.append(option);
  }
  styleField.append(styleSelect);
  styleSelect.addEventListener('change', markTestCasesOutdated);
  const methodContext = createElement('div', 'testcase-method-context');
  methodContext.id = 'testcase-method-context';
  methodContext.hidden = true;
  for (const [id, label, placeholder] of [
    ['testcase-method-description', 'Method description (optional)', 'What should this method return or do?'],
    ['testcase-preconditions', 'Preconditions (optional)', 'Which inputs are valid? For example, n must be positive.']
  ]) {
    const field = createElement('label', 'testcase-generation-field', label);
    const input = createElement('textarea', 'testcase-generation-textarea');
    input.id = id;
    input.rows = 2;
    input.maxLength = 5000;
    input.placeholder = placeholder;
    input.addEventListener('input', markTestCasesOutdated);
    field.append(input);
    methodContext.append(field);
  }
  const targetSummary = createElement('p', 'testcase-target-summary');
  targetSummary.id = 'testcase-target-summary';
  targetSummary.textContent = 'No method selected yet.';
  const generatorStatus = createElement('p', 'testcase-generator-status');
  generatorStatus.id = 'testcase-generator-status';
  generatorStatus.setAttribute('aria-live', 'polite');
  const caseList = createElement('div', 'testcase-list');
  caseList.id = 'testcase-list';
  caseList.setAttribute('role', 'listbox');
  caseList.setAttribute('aria-label', 'Test cases');
  const caseEditor = createElement('div', 'testcase-editor');
  caseEditor.id = 'testcase-editor';
  const runCasesButton = createElement('button', 'run-testcases', 'Run with test cases');
  runCasesButton.type = 'button';
  runCasesButton.disabled = true;
  // Do not pass the browser click event as a test-case ID. Passing it made
  // the run-all path filter out every case and display "No results".
  runCasesButton.addEventListener('click', () => runTestCases());
  testPanel.append(casesHeading, instructions, countField, countHelp, styleField, methodContext, targetSummary, caseActions, generatorStatus, caseList, caseEditor, runCasesButton);
  document.addEventListener('click', event => {
    if (selectedTestCaseId === null || caseEditor.contains(event.target)) return;
    if (event.target.closest('.testcase-list-item, .testcase-tools, .testcase-count-field, .testcase-count-help, .testcase-target-summary, .run-testcases, .run-one-testcase')) return;
    selectedTestCaseId = null;
    renderTestCases();
  });
  updateTestGenerationContextVisibility();
  document.querySelector('#intent')?.addEventListener('input', markTestCasesOutdated);
  renderTestCases();
  scheduleTestTargetValidation(true);
}

const briefPanelWidthStorageKey = 'office-hours-prep.brief-panel-width.v1';
const briefPanelMinimumWidth = 280;
const briefPanelMaximumWidth = 520;

function readBriefPanelWidth() {
  try {
    const saved = Number(localStorage.getItem(briefPanelWidthStorageKey));
    return Number.isFinite(saved) ? saved : 310;
  } catch {
    return 310;
  }
}

function briefPanelWidthLimit() {
  const workspace = document.querySelector('#code-workspace');
  const available = workspace?.getBoundingClientRect().width || window.innerWidth;
  return Math.min(briefPanelMaximumWidth, Math.max(360, Math.floor(available * 0.48)));
}

function setBriefPanelWidth(width, {save = true} = {}) {
  const workspace = document.querySelector('#code-workspace');
  const handle = document.querySelector('.brief-panel-resize-handle');
  if (!workspace) return;
  const maximum = briefPanelWidthLimit();
  const nextWidth = Math.round(Math.max(briefPanelMinimumWidth, Math.min(maximum, Number(width) || 310)));
  workspace.style.setProperty('--brief-panel-width', `${nextWidth}px`);
  if (handle) {
    handle.setAttribute('aria-valuenow', String(nextWidth));
    handle.setAttribute('aria-valuemax', String(maximum));
  }
  if (save) {
    try { localStorage.setItem(briefPanelWidthStorageKey, String(nextWidth)); } catch {}
  }
}

function setupBriefPanelResizing(sidebar) {
  if (!sidebar || sidebar.querySelector('.brief-panel-resize-handle')) return;
  sidebar.classList.add('resizable-brief-panel');
  const handle = createElement('button', 'brief-panel-resize-handle');
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Resize right menu');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', String(briefPanelMinimumWidth));
  handle.title = 'Drag to resize the right menu';
  sidebar.insertBefore(handle, sidebar.firstChild);
  setBriefPanelWidth(readBriefPanelWidth(), {save: false});

  let resizeState = null;
  const finishResize = event => {
    if (!resizeState) return;
    if (event && handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    resizeState = null;
    document.body.classList.remove('resizing-brief-panel');
  };
  handle.addEventListener('pointerdown', event => {
    if (window.matchMedia('(max-width: 760px)').matches) return;
    event.preventDefault();
    resizeState = {startX: event.clientX, startWidth: sidebar.getBoundingClientRect().width};
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing-brief-panel');
  });
  handle.addEventListener('pointermove', event => {
    if (!resizeState) return;
    // The right edge stays fixed: dragging left makes the menu wider.
    setBriefPanelWidth(resizeState.startWidth + resizeState.startX - event.clientX);
  });
  handle.addEventListener('pointerup', finishResize);
  handle.addEventListener('pointercancel', finishResize);
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = sidebar.getBoundingClientRect().width;
    const next = event.key === 'ArrowLeft' ? current + 16
      : event.key === 'ArrowRight' ? current - 16
        : event.key === 'Home' ? briefPanelMinimumWidth : briefPanelWidthLimit();
    setBriefPanelWidth(next);
  });
  window.addEventListener('resize', () => setBriefPanelWidth(sidebar.getBoundingClientRect().width, {save: false}));
}

function updateTestGenerationContextVisibility() {
  const context = document.querySelector('#testcase-method-context');
  if (context) context.hidden = !hasEditorSelection();
}

function hasEditorSelection() {
  const selection = codeEditor?.getSelection?.();
  return Boolean(selection && !selection.isEmpty());
}

function testSelectionKey() {
  const activeFile = files.find(file => file.id === activeFileId && !file.generated);
  const selection = codeEditor?.getSelection?.();
  if (!activeFile || !selection || selection.isEmpty()) return '';
  const version = activeFile.model?.getVersionId?.() || 0;
  return JSON.stringify({
    file: activeFile.id,
    language: currentLanguage,
    version,
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
  });
}

function updateGenerateTestButtonState() {
  const button = document.querySelector('.generate-testcases');
  if (!button) return;
  const key = testSelectionKey();
  const ready = Boolean(key && targetValidationState.key === key && targetValidationState.status === 'ready');
  const checking = Boolean(key && targetValidationState.key === key && targetValidationState.status === 'checking');
  button.disabled = !ready || button.textContent === 'Generating…';
  button.title = ready
    ? 'Generate tests for the complete selected function or method'
    : checking
      ? 'Checking whether the selection is a complete function or method'
      : 'Select one complete function or method first';
}

function targetValidationPayload() {
  const activeFile = files.find(file => file.id === activeFileId && !file.generated);
  const selection = codeEditor?.getSelection?.();
  if (!activeFile || !selection || selection.isEmpty()) return null;
  return {
    language: currentLanguage,
    active_file: activeFile.name,
    code: activeFile.model.getValue(),
    selection_start_line: selection.startLineNumber,
    selection_end_line: selection.endLineNumber,
    selection_start_column: selection.startColumn,
    selection_end_column: selection.endColumn,
  };
}

async function validateSelectedTestTarget(sequence, key, payload) {
  try {
    const response = await fetch('/api/testcase-target', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(response, 'Could not check the selected code.');
    // Ignore validation results for a selection that has since changed.
    if (sequence !== targetValidationSequence || key !== testSelectionKey()) return;
    const kind = data.target_kind || data.kind;
    const ready = Boolean(data.target_ready) && ['function', 'method'].includes(kind);
    targetValidationState = {key, status: ready ? 'ready' : 'invalid'};
    selectedTestTarget = data;
    renderTestTarget(data);
    const status = document.querySelector('#testcase-generator-status');
    if (status) {
      if (ready) {
        if (status.textContent.startsWith('Checking the selection')) {
          status.textContent = '';
          status.hidden = true;
        }
      } else {
        status.hidden = false;
        status.textContent = data.message || data.missing_information || data.validation_error || 'Select one complete function or method.';
      }
    }
    updateGenerateTestButtonState();
  } catch (error) {
    if (sequence !== targetValidationSequence || key !== testSelectionKey()) return;
    targetValidationState = {key, status: 'invalid'};
    selectedTestTarget = null;
    const status = document.querySelector('#testcase-generator-status');
    if (status) {
      status.hidden = false;
      status.textContent = error.message || 'Could not check the selected code.';
    }
    updateGenerateTestButtonState();
  }
}

function scheduleTestTargetValidation(immediate = false) {
  if (targetValidationTimer) window.clearTimeout(targetValidationTimer);
  targetValidationTimer = null;
  const sequence = ++targetValidationSequence;
  const key = testSelectionKey();
  const payload = targetValidationPayload();
  if (!key || !payload) {
    targetValidationState = {key: '', status: 'none'};
    selectedTestTarget = null;
    updateGenerateTestButtonState();
    return;
  }
  targetValidationState = {key, status: 'checking'};
  const status = document.querySelector('#testcase-generator-status');
  if (status) {
    status.hidden = false;
    status.textContent = 'Checking the selection…';
  }
  updateGenerateTestButtonState();
  const run = () => validateSelectedTestTarget(sequence, key, payload);
  // Debounce editor changes so rapid cursor or selection updates do not flood the API.
  if (immediate) run();
  else targetValidationTimer = window.setTimeout(run, 160);
}

window.scheduleTestTargetValidation = scheduleTestTargetValidation;

function captureTestSnapshot() {
  // Tie generated tests to the exact code, selection, and generation context they describe.
  const selection = codeEditor?.getSelection?.();
  const selected = Boolean(selection && !selection.isEmpty());
  return JSON.stringify({
    language: currentLanguage,
    intent: document.querySelector('#intent')?.value.trim() || '',
    testStyle: document.querySelector('#testcase-test-style')?.value || 'general',
    methodDescription: selected ? document.querySelector('#testcase-method-description')?.value.trim() || '' : '',
    preconditions: selected ? document.querySelector('#testcase-preconditions')?.value.trim() || '' : '',
    selection: selected
      ? {startLine: selection.startLineNumber, startColumn: selection.startColumn, endLine: selection.endLineNumber, endColumn: selection.endColumn}
      : null,
    files: allWorkspaceFiles().filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
  });
}

function markTestCasesOutdated() {
  const current = captureTestSnapshot();
  let changed = false;
  testCases.forEach(testCase => {
    if (!testCase.snapshot || testCase.snapshot === current || testCase.outdated) return;
    testCase.outdated = true;
    testCase.status = 'outdated';
    testCase.result = {actualOutput: '', expectedOutput: testCase.expectedOutput || '', stdin: testCase.stdin || '', error: 'This result is outdated because the code or purpose changed.', files: [], generatedFiles: [], checks: []};
    changed = true;
  });
  if (changed) renderTestCases();
}

function hasOldProgramCases() {
  return testCases.some(testCase => testCase.origin !== 'custom' && (!['function', 'method'].includes(testCase.targetKind)
    || !testCase.invocation || !testCase.harnessCode));
}

let selectedTestTarget = null;

function selectedMethodName() {
  const knownName = selectedTestTarget?.function_name || selectedTestTarget?.method_name;
  if (knownName) return knownName;
  const selection = codeEditor?.getSelection?.();
  const activeFile = files?.find(file => file.id === activeFileId);
  if (!selection || selection.isEmpty() || !activeFile) return '';
  const selectedText = activeFile.model.getValueInRange(selection);
  return selectedText.match(/\b(?:def|function|func)\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1]
    || selectedText.match(/\b(?:const\s+)?(?:static\s+|inline\s+|constexpr\s+|unsigned\s+|signed\s+|long\s+|short\s+|void\s+|bool\s+|char\s+|int\s+|float\s+|double\s+|auto\s+|std::[\w:<>]+\s+)+([A-Za-z_$][\w$]*)\s*\(/)?.[1]
    || selectedText.match(/\b(?:public|private|protected|static|async|final|\s)+[A-Za-z_$][\w$<>\[\]]*\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1]
    || '';
}

function isVoidReturnType(returnType) {
  return ['void', 'none'].includes(String(returnType || '').toLowerCase().replace(/\s/g, ''));
}

function testCaseUsesPrintedOutput(testCase) {
  return Boolean(testCase?.isMain || selectedTestTarget?.target_is_main
    || isVoidReturnType(testCase?.returnType || selectedTestTarget?.return_type));
}

function appendExpectedOutputField(container, testCase) {
  const outputField = createElement('div', 'testcase-field');
  outputField.append(createElement('label', '', 'Expected printed output'));
  const outputInput = createElement('textarea', 'required-output-field');
  outputInput.placeholder = 'Leave blank if the target should not print.';
  outputInput.value = testCase.expectedOutput || '';
  outputInput.addEventListener('input', () => {
    testCase.expectedOutput = outputInput.value;
    testCase.expectedOutputProvided = true;
    markTestCaseEdited(testCase);
  });
  outputField.append(outputInput);
  container.append(outputField);
}

function buildCustomInvocation(testCase) {
  const args = String(testCase.argumentsText || '').trim();
  if (!args) return '';
  if (/[.(].*[)]$/.test(args) && (args.includes('(') || args.includes('.'))) return args;
  const name = selectedMethodName();
  if (!name) return '';
  if (currentLanguage === 'java' && selectedTestTarget?.class_name) {
    const receiver = selectedTestTarget.static_method ? `${selectedTestTarget.class_name}.` : `new ${selectedTestTarget.class_name}().`;
    return `${receiver}${name}(${args})`;
  }
  return `${name}(${args})`;
}

function markTestCaseEdited(testCase) {
  testCase.status = 'not-run';
  testCase.result = null;
  testCase.outdated = false;
  if (testCase.origin === 'custom') testCase.harnessCode = '';
  if (typeof persistWorkspace === 'function') persistWorkspace();
}

function appendSingleTestAction(container, testCase) {
  const actions = createElement('div', 'testcase-custom-actions');
  const runOne = createElement('button', 'run-one-testcase', 'Run this test');
  runOne.type = 'button';
  runOne.disabled = document.querySelector('.run-testcases')?.textContent === 'Running tests…';
  runOne.addEventListener('click', () => runTestCases(testCase.id));
  actions.append(runOne);
  container.append(actions);
}

function renderCustomTestEditor(container, testCase) {
  const help = createElement('p', 'testcase-custom-help', 'Add a name, enter arguments in parameter order, and write the result you expect.');
  container.append(help);
  const nameField = createElement('div', 'testcase-field');
  nameField.append(createElement('label', '', 'Test name or description'));
  const nameInput = createElement('input', 'testcase-text');
  nameInput.type = 'text'; nameInput.value = testCase.name;
  nameInput.addEventListener('input', () => { testCase.name = nameInput.value || 'My test'; markTestCaseEdited(testCase); });
  nameField.append(nameInput); container.append(nameField);

  const argsField = createElement('div', 'testcase-field');
  argsField.append(createElement('label', '', `Arguments${selectedMethodName() ? ` for ${selectedMethodName()}` : ''}`));
  const argsInput = createElement('input', 'testcase-text');
  argsInput.type = 'text'; argsInput.placeholder = 'For example: 2, "hello"'; argsInput.value = testCase.argumentsText || '';
  argsInput.addEventListener('input', () => { testCase.argumentsText = argsInput.value; testCase.invocation = buildCustomInvocation(testCase); markTestCaseEdited(testCase); });
  argsField.append(argsInput); container.append(argsField);

  if (!testCaseUsesPrintedOutput(testCase)) {
    const returnField = createElement('div', 'testcase-field');
    const returnLabel = createElement('label', '', `Expected return value${testCase.returnType ? ` · type: ${testCase.returnType}` : ''}`);
    returnField.append(returnLabel);
    const returnInput = createElement('input', 'testcase-return');
    returnInput.type = 'text'; returnInput.placeholder = testCase.returnType ? `Enter a ${testCase.returnType} value` : 'Enter the expected value';
    returnInput.value = testCase.expectedReturn || '';
    returnInput.addEventListener('input', () => { testCase.expectedReturn = returnInput.value; testCase.expectedReturnProvided = true; markTestCaseEdited(testCase); });
    returnField.append(returnInput); container.append(returnField);
  }

  const outputField = createElement('div', 'testcase-field');
  outputField.append(createElement('label', '', 'Expected printed output (optional)'));
  const outputInput = createElement('textarea', 'required-output-field');
  outputInput.placeholder = 'Leave blank if the method does not print.'; outputInput.value = testCase.expectedOutput || '';
  outputInput.addEventListener('input', () => { testCase.expectedOutput = outputInput.value; testCase.expectedOutputProvided = true; markTestCaseEdited(testCase); });
  outputField.append(outputInput); container.append(outputField);

  appendSingleTestAction(container, testCase);
}

function addCustomTestCase() {
  const testCase = {
    id: nextTestCaseId++, name: 'My test', description: 'A test you entered yourself.', origin: 'custom',
    argumentsText: '', invocation: '', expectedReturn: '', expectedReturnProvided: false,
    expectedOutput: '', expectedOutputProvided: false, returnType: selectedTestTarget?.return_type || '',
    stdin: '', files: [], expectedFiles: [], harnessFile: '', harnessCode: '', isMain: Boolean(selectedTestTarget?.target_is_main), status: 'not-run', result: null,
    snapshot: captureTestSnapshot(), targetKind: selectedTestTarget?.kind || 'invalid', outdated: false
  };
  testCases.push(testCase);
  selectedTestCaseId = testCase.id;
  renderTestCases();
  const nameInput = document.querySelector('#testcase-editor .testcase-text');
  nameInput?.focus();
  nameInput?.select();
}

async function prepareCustomHarness(testCase) {
  // Reuse the generated wrapper until edits invalidate it.
  if (testCase.harnessCode) return true;
  const activeFile = files.find(file => file.id === activeFileId && !file.generated) || files.find(file => !file.generated);
  const selection = codeEditor?.getSelection?.();
  if (!activeFile || !selection || selection.isEmpty() || !testCase.invocation) throw new Error('Select the method and enter its arguments before running this test.');
  const response = await fetch('/api/testcase-harness', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({language: currentLanguage, active_file: activeFile.name, code: activeFile.model.getValue(), invocation: testCase.invocation,
      selection_start_line: selection.startLineNumber, selection_end_line: selection.endLineNumber,
      selection_start_column: selection.startColumn, selection_end_column: selection.endColumn})
  });
  const data = await parseApiResponse(response, 'Could not prepare this test.');
  if (!data.ready) throw new Error(data.message || 'This selected method is not ready for testing.');
  testCase.harnessFile = data.harness_file || '';
  testCase.harnessCode = data.harness_code || '';
  testCase.returnType = testCase.returnType || data.return_type || '';
  testCase.isMain = Boolean(testCase.isMain || data.target_is_main);
  return true;
}

function renderTestCases() {
  const caseList = document.querySelector('#testcase-list');
  const caseEditor = document.querySelector('#testcase-editor');
  if (!caseList || !caseEditor) return;
  caseList.replaceChildren();
  const count = document.querySelector('#testcase-count');
  if (count) count.textContent = `${testCases.length} case${testCases.length === 1 ? '' : 's'}`;
  const runButton = document.querySelector('.run-testcases');
  if (runButton) runButton.disabled = testCases.length === 0 || hasOldProgramCases() || runButton.textContent === 'Running tests…';
  updateGenerateTestButtonState();
  if (hasOldProgramCases()) {
    const message = document.querySelector('#testcase-generator-status');
    if (message) {
      message.hidden = false;
      message.textContent = 'Older whole-program tests cannot run here. Clear tests, then highlight a method to generate new ones.';
    }
  }
  const clearAllButton = document.querySelector('.clear-testcases');
  if (clearAllButton) clearAllButton.disabled = testCases.length === 0;

  if (testCases.length === 0) {
    caseList.append(createElement('p', 'testcase-empty', 'No tests yet. Highlight one complete function or method, then generate tests.'));
  }

  testCases.forEach(testCase => {
    const item = createElement('button', 'testcase-list-item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(testCase.id === selectedTestCaseId));
    const caseName = createElement('span', 'testcase-list-name', testCase.name);
    const caseType = createElement('span', 'testcase-list-type', testCase.invocation ? 'Call' : testCase.files.length ? `Input · ${testCase.files.length} files` : 'Input');
    const originTag = createElement('span', `testcase-origin ${testCase.origin === 'ai' ? 'ai' : testCase.origin === 'custom' ? 'custom' : 'manual'}`, testCase.origin === 'ai' ? 'AI' : 'Manual');
    const statusLabels = {passed: 'Pass', failed: 'Fail', review: 'Review', running: 'Running', 'not-run': 'Not run', outdated: 'Outdated', 'runtime-error': 'Runtime error', 'timed-out': 'Timed out', 'harness-error': 'Harness error'};
    const statusTag = createElement('span', `testcase-result-tag ${testCase.status}`, statusLabels[testCase.status] || 'Not run');
    item.append(caseName, caseType, originTag, statusTag);
    item.addEventListener('click', () => {
      selectedTestCaseId = testCase.id;
      renderTestCases();
    });
    item.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const index = testCases.findIndex(candidate => candidate.id === testCase.id);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, testCases.length - 1) : Math.max(index - 1, 0);
      const nextItem = caseList.children[next];
      nextItem?.focus();
      selectedTestCaseId = testCases[next]?.id ?? null;
      renderTestCases();
    });
    caseList.append(item);
  });

  caseEditor.replaceChildren();
  const testCase = testCases.find(item => item.id === selectedTestCaseId);
  caseEditor.hidden = !testCase;
  if (!testCase) {
    return;
  }

  const header = createElement('div', 'testcase-title-row');
  const selectedCaseTitle = createElement('div', 'testcase-selected-title');
  selectedCaseTitle.append(createElement('h3', '', testCase.name));
  selectedCaseTitle.append(createElement('span', `testcase-origin ${testCase.origin === 'ai' ? 'ai' : testCase.origin === 'custom' ? 'custom' : 'manual'}`, testCase.origin === 'ai' ? 'AI generated' : 'Manual'));
  const deleteButton = createElement('button', 'delete-testcase', '×');
  deleteButton.type = 'button';
  deleteButton.setAttribute('aria-label', `Delete ${testCase.name}`);
  deleteButton.addEventListener('click', () => {
    const index = testCases.findIndex(item => item.id === testCase.id);
    if (index >= 0) testCases.splice(index, 1);
    selectedTestCaseId = null;
    renderTestCases();
    renderFileTabs();
  });
  header.append(selectedCaseTitle, deleteButton);

  caseEditor.append(header);
  if (testCase.origin === 'custom') {
    renderCustomTestEditor(caseEditor, testCase);
    return;
  }

  if (testCase.invocation) {
    const invocationField = createElement('div', 'testcase-field');
    invocationField.append(createElement('label', '', 'Call being tested'));
    const invocationInput = createElement('textarea', 'testcase-input testcase-invocation');
    invocationInput.placeholder = 'For example: add(2, 2)';
    invocationInput.value = testCase.invocation;
    invocationInput.readOnly = true;
    invocationInput.setAttribute('aria-label', `${testCase.name} function call`);
    invocationField.append(invocationInput);
    caseEditor.append(invocationField);

    if (testCaseUsesPrintedOutput(testCase)) {
      appendExpectedOutputField(caseEditor, testCase);
    } else {
      const returnField = createElement('div', 'testcase-field');
      returnField.append(createElement('label', '', 'Expected return value'));
      const returnInput = createElement('input', 'testcase-return');
      returnInput.type = 'text';
      returnInput.placeholder = 'What should the function return?';
      returnInput.value = testCase.expectedReturn || '';
      returnInput.setAttribute('aria-label', `${testCase.name} expected return value`);
      returnInput.addEventListener('input', () => { testCase.expectedReturn = returnInput.value; testCase.expectedReturnProvided = true; markTestCaseEdited(testCase); });
      returnField.append(returnInput);
      caseEditor.append(returnField);
    }
  }

  if (testCase.origin === 'ai') {
    const explanation = createElement('div', 'testcase-ai-explanation');
    const aiNote = testCase.description || 'This test checks a normal, boundary, or relevant edge case for the method.';
    explanation.append(createElement('strong', '', 'AI note:'));
    explanation.append(createElement('span', '', ` ${aiNote}`));
    if (testCase.result) {
      const outcome = testCase.status === 'passed'
        ? 'Why it passed: the actual result matched the expected result.'
        : testCase.status === 'failed'
          ? 'Why it failed: the actual result did not match the expected result.'
          : 'Why it did not pass: the code stopped before a usable result was available.';
      explanation.append(createElement('span', 'testcase-ai-outcome', outcome));
    }
    caseEditor.append(explanation);
    appendSingleTestAction(caseEditor, testCase);
    return;
  }

  const advanced = createElement('details', 'testcase-advanced');
  advanced.append(createElement('summary', '', 'More inputs and checks (optional)'));
  advanced.open = Boolean(testCase.stdin || testCase.files.length || testCase.expectedOutput || testCase.expectedFiles.length);
  if (testCase.invocation) caseEditor.append(advanced);
  const extraFields = testCase.invocation ? advanced : caseEditor;
  const stdinField = createElement('div', 'testcase-field');
  stdinField.append(createElement('label', '', 'Standard input (if needed)'));
  const stdinInput = createElement('textarea', 'testcase-input');
  stdinInput.placeholder = 'One input() value per line';
  stdinInput.setAttribute('aria-label', `${testCase.name} standard input`);
  stdinInput.value = testCase.stdin;
  stdinInput.addEventListener('input', () => { testCase.stdin = stdinInput.value; markTestCaseEdited(testCase); });
  stdinField.append(stdinInput);
  extraFields.append(stdinField);

  const filesHeading = createElement('div', 'testcase-heading testcase-files-heading');
  filesHeading.append(createElement('h3', '', 'File overrides'));
  const addFileOverride = createElement('button', 'add-testcase', 'Add file');
  addFileOverride.type = 'button';
  addFileOverride.disabled = allWorkspaceFiles().every(file => file.generated);
  addFileOverride.addEventListener('click', () => {
    testCase.files.push({id: `fixture-${Date.now()}-${Math.random()}`, fileName: '', contents: ''});
    renderTestCases();
  });
  filesHeading.append(addFileOverride);
  extraFields.append(filesHeading);

  const overrideList = createElement('div', 'testcase-overrides');
  if (testCase.files.length === 0) {
    overrideList.append(createElement('p', 'testcase-empty', allWorkspaceFiles().some(file => !file.generated) ? 'No file overrides.' : 'Add a workspace file before creating an override.'));
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
    allWorkspaceFiles().filter(file => !file.generated).forEach(file => {
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
    contents.addEventListener('input', () => { fixture.contents = contents.value; markTestCaseEdited(testCase); });
    fixtureCard.append(contents);
    overrideList.append(fixtureCard);
  });
  extraFields.append(overrideList);

  const requiredOutput = createElement('section', 'required-output');
  requiredOutput.append(createElement('h3', '', 'Expected printed output'));
  const outputField = createElement('textarea');
  outputField.className = 'required-output-field';
  outputField.placeholder = 'Expected output for this case';
  outputField.setAttribute('aria-label', `${testCase.name} required output`);
  outputField.value = testCase.expectedOutput;
  outputField.addEventListener('input', () => { testCase.expectedOutput = outputField.value; testCase.expectedOutputProvided = true; markTestCaseEdited(testCase); });
  requiredOutput.append(outputField);
  extraFields.append(requiredOutput);

  const requiredFiles = createElement('section', 'required-output required-files');
  const requiredFilesHeading = createElement('div', 'testcase-heading');
  requiredFilesHeading.append(createElement('h3', '', 'Required files'));
  const addRequiredFile = createElement('button', 'add-testcase', 'Add file check');
  addRequiredFile.type = 'button';
  addRequiredFile.addEventListener('click', () => {
    testCase.expectedFiles.push({name: '', contents: ''});
    renderTestCases();
  });
  requiredFilesHeading.append(addRequiredFile);
  requiredFiles.append(requiredFilesHeading);
  if (testCase.expectedFiles.length === 0) {
    requiredFiles.append(createElement('p', 'testcase-empty', 'No required file checks.'));
  }
  testCase.expectedFiles.forEach((expectedFile, fileIndex) => {
    const expectedFileCard = createElement('div', 'required-file-check');
    const expectedFileHeading = createElement('div', 'testcase-file-row');
    const fileName = createElement('input', 'testcase-file');
    fileName.type = 'text';
    fileName.placeholder = 'Output file name, e.g. results.txt';
    fileName.value = expectedFile.name;
    fileName.setAttribute('aria-label', `${testCase.name} required file ${fileIndex + 1} name`);
    fileName.addEventListener('input', () => {
      expectedFile.name = fileName.value.trim();
      markTestCaseEdited(testCase);
      renderFileTabs();
    });
    const removeExpectedFile = createElement('button', 'delete-testcase', '×');
    removeExpectedFile.type = 'button';
    removeExpectedFile.setAttribute('aria-label', `Remove required file check ${fileIndex + 1}`);
    removeExpectedFile.addEventListener('click', () => {
      testCase.expectedFiles.splice(fileIndex, 1);
      renderTestCases();
      renderFileTabs();
    });
    expectedFileHeading.append(fileName, removeExpectedFile);
    const expectedContents = createElement('textarea', 'testcase-file-content');
    expectedContents.placeholder = 'Expected contents of this file';
    expectedContents.value = expectedFile.contents;
    expectedContents.setAttribute('aria-label', `${testCase.name} required contents for ${expectedFile.name || `file ${fileIndex + 1}`}`);
    expectedContents.addEventListener('input', () => { expectedFile.contents = expectedContents.value; markTestCaseEdited(testCase); });
    expectedFileCard.append(expectedFileHeading, expectedContents);
    requiredFiles.append(expectedFileCard);
  });
  extraFields.append(requiredFiles);
  appendSingleTestAction(caseEditor, testCase);
}

function clearTestCases() {
  testCases.splice(0, testCases.length);
  selectedTestCaseId = null;
  const status = document.querySelector('#testcase-generator-status');
  if (status) status.textContent = '';
  renderTestCases();
  renderFileTabs();
}

async function runTestCases(onlyTestCaseId = null) {
  const button = document.querySelector('.run-testcases');
  if (!codeEditor || !button || button.disabled || testCases.length === 0) return;
  if (hasOldProgramCases()) {
    document.querySelector('#testcase-generator-status').textContent = 'These older tests are not for a selected method. Clear them, then generate new tests.';
    return;
  }
  const selectedBeforeRun = selectedTestCaseId;
  markTestCasesOutdated();
  // Use one snapshot for the batch so cases cannot silently run against changed code.
  const runSnapshot = captureTestSnapshot();
  document.body.classList.add('testcase-results-open');
  button.disabled = true;
  button.textContent = 'Running tests…';
  output.className = 'output-box testcase-results';
  output.textContent = 'Running test cases…';
  outputStatus.textContent = 'Running';

  const results = [];
  const casesToRun = onlyTestCaseId === null ? testCases : testCases.filter(testCase => testCase.id === onlyTestCaseId);
  for (const [caseIndex, testCase] of casesToRun.entries()) {
    const caseStartedAt = performance.now();
    if (testCase.outdated || (testCase.snapshot && testCase.snapshot !== runSnapshot)) {
      testCase.status = 'outdated';
      testCase.result = {
        actualOutput: '', actualReturn: '', expectedOutput: testCase.expectedOutput || '', expectedReturn: testCase.expectedReturn || '', stdin: testCase.stdin || '',
        error: 'This test is outdated because the code or program purpose changed. Generate the tests again.', files: [], generatedFiles: [], checks: []
      };
      results.push(testCase);
      for (const remaining of casesToRun.slice(caseIndex + 1)) {
        remaining.status = 'not-run';
        remaining.result = {actualOutput: '', actualReturn: '', expectedOutput: remaining.expectedOutput || '', expectedReturn: remaining.expectedReturn || '', stdin: remaining.stdin || '', error: 'Not run because the test target changed.', files: [], generatedFiles: [], checks: []};
        results.push(remaining);
      }
      break;
    }
    testCase.status = 'running';
    testCase.result = null;
    renderTestCases();
    try {
      if (testCase.origin === 'custom') await prepareCustomHarness(testCase);
      const preDeclaredType = testCase.returnType || selectedTestTarget?.return_type || '';
      const outputTarget = testCaseUsesPrintedOutput(testCase);
      const preHasExpectedReturn = !outputTarget && (testCase.expectedReturnProvided ?? Boolean(String(testCase.expectedReturn ?? '').trim()));
      const preExpectedReturn = parseExpectedReturn(testCase.expectedReturn, null, preDeclaredType, preHasExpectedReturn);
      if (testCase.invocation && preHasExpectedReturn && preExpectedReturn?.type === 'invalid') {
        testCase.status = 'review';
        testCase.result = {
          actualOutput: '', actualReturn: '', expectedOutput: testCase.expectedOutput || '', expectedReturn: testCase.expectedReturn || '', stdin: testCase.stdin || '',
          error: 'Fix the expected return value before running this test.', files: [], generatedFiles: [], checks: [{name: 'Expected return', status: 'review', detail: 'This value does not match the method return type.'}]
        };
        results.push(testCase);
        renderTestCases();
        continue;
      }
      // Apply each test's file fixtures to a request-local copy, not the editor models.
      const overrides = new Map();
      for (const fixture of testCase.files) {
        if (!fixture.fileName) throw new Error('Choose a target editor file for each file override.');
        if (!allWorkspaceFiles().some(file => file.name === fixture.fileName && !file.generated)) {
          throw new Error(`The workspace file "${fixture.fileName}" is no longer available.`);
        }
        overrides.set(fixture.fileName, fixture.contents);
      }

      const activeFile = files.find(file => file.id === activeFileId && !file.generated) || files.find(file => !file.generated);
      if (!activeFile) throw new Error('Select an editor file before running test cases.');
      const requestFiles = allWorkspaceFiles().filter(file => !file.generated).map(file => ({
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
          files_to_check: testCase.expectedFiles.map(file => file.name.trim()).filter(Boolean),
          memory_limit_mb: Number(document.querySelector('#memory-limit').value) || null,
          timeout_seconds: getExecutionTimeout(),
          intent: document.querySelector('#intent').value.trim(),
          harness_file: testCase.harnessFile || null,
          harness_code: testCase.harnessCode || null
        })
      });
      const data = await parseApiResponse(response, 'The test case could not be run.');
      if (captureTestSnapshot() !== runSnapshot) {
        testCase.status = 'outdated';
        testCase.result = {actualOutput: '', actualReturn: '', expectedOutput: testCase.expectedOutput || '', expectedReturn: testCase.expectedReturn || '', stdin: testCase.stdin || '', error: 'The code changed while this test was running. The result was discarded.', files: [], generatedFiles: [], checks: []};
        results.push(testCase);
        for (const remaining of casesToRun.slice(caseIndex + 1)) {
          remaining.status = 'not-run';
          remaining.result = {actualOutput: '', actualReturn: '', expectedOutput: remaining.expectedOutput || '', expectedReturn: remaining.expectedReturn || '', stdin: remaining.stdin || '', error: 'Not run because the test target changed.', files: [], generatedFiles: [], checks: []};
          results.push(remaining);
        }
        break;
      }
      const rawOutput = data.output || '';
      const actualOutput = removeHarnessOutput(rawOutput);
      const declaredReturnType = testCase.returnType || data.return_type || '';
      const actualReturnValue = extractHarnessReturn(rawOutput, declaredReturnType);
      const hasExpectedReturn = !outputTarget && (testCase.expectedReturnProvided ?? Boolean(String(testCase.expectedReturn ?? '').trim()));
      const expectedReturnValue = parseExpectedReturn(testCase.expectedReturn, actualReturnValue, declaredReturnType, hasExpectedReturn);
      const actualReturn = actualReturnValue ? formatReturnValue(actualReturnValue) : '';
      const expectedReturnDisplay = expectedReturnValue ? formatReturnValue(expectedReturnValue) : '';
      const hasRequiredOutput = testCase.expectedOutputProvided ?? normalizeOutput(testCase.expectedOutput).length > 0;
      const outputMatches = !hasRequiredOutput || (data.status === 'success' && normalizeOutput(actualOutput) === normalizeOutput(testCase.expectedOutput));
      const checks = evaluateTestCaseConstraints(testCase, performance.now() - caseStartedAt, data);
      checks.push({
        name: 'Execution',
        status: data.status === 'success' ? 'passed' : 'failed',
        detail: data.status === 'success' ? 'Program completed successfully' : (data.error || data.status)
      });
      if (hasRequiredOutput) {
        checks.push({name: 'Stdout', status: outputMatches ? 'passed' : 'failed', detail: outputMatches ? 'Matches required output' : 'Does not match required output'});
      }
      if (testCase.invocation && !outputTarget) {
        if (hasExpectedReturn) {
          const returnMatches = data.status === 'success' && actualReturnValue !== null && typedValuesEqual(actualReturnValue, expectedReturnValue);
          const typeWarning = expectedReturnValue?.type === 'invalid' ? 'The expected value does not match the declared return type.' : '';
          const comparisonNote = expectedReturnValue?.type === 'number' ? 'Matches within absolute/relative tolerance (1e-9).' : 'Matches the expected typed value.';
          checks.push({name: 'Return value', status: returnMatches ? 'passed' : 'failed', detail: returnMatches ? comparisonNote : (typeWarning || `Expected ${expectedReturnDisplay || '(empty string)'}; received ${actualReturn || '(no value)'}`)});
        } else {
          checks.push({name: 'Return value', status: 'review', detail: 'Add the expected return value before calling this a pass'});
        }
      }
      const generatedFiles = data.generated_files || [];
      const workspaceSnapshot = Array.isArray(data.workspace_files) ? data.workspace_files : [];
      const filesAfterRun = new Map(workspaceSnapshot.map(file => [String(file.name).toLowerCase(), file.contents]));
      testCase.expectedFiles.forEach(expectedFile => {
        const fileName = expectedFile.name.trim();
        if (!fileName) {
          checks.push({name: 'Required file', status: 'failed', detail: 'Enter a file name to check'});
          return;
        }
        const exists = filesAfterRun.has(fileName.toLowerCase());
        const matches = exists && normalizeOutput(filesAfterRun.get(fileName.toLowerCase())) === normalizeOutput(expectedFile.contents);
        checks.push({
          name: `File: ${fileName}`,
          status: data.status === 'success' && matches ? 'passed' : 'failed',
          detail: !exists ? 'The file does not exist after the run' : matches ? 'Contents match' : 'Contents do not match'
        });
      });
      const hasFailure = checks.some(check => check.status === 'failed');
      const needsReview = checks.some(check => check.status === 'review');
      if (data.status === 'harness_error') testCase.status = 'harness-error';
      else if (data.error_type === 'TimeoutError') testCase.status = 'timed-out';
      else if (data.status !== 'success') testCase.status = 'runtime-error';
      else testCase.status = hasFailure ? 'failed' : needsReview ? 'review' : 'passed';
      testCase.outdated = false;
      testCase.result = {
        actualOutput,
        actualReturn,
        actualReturnValue,
        expectedReturnValue,
        hasReturnValue: actualReturnValue !== null,
        expectedOutput: testCase.expectedOutput,
        expectedOutputProvided: hasRequiredOutput,
        expectedReturn: expectedReturnDisplay || testCase.expectedReturn || '',
        actualReturnType: actualReturnValue?.type || 'none',
        expectedReturnType: expectedReturnValue?.type || (hasExpectedReturn ? declaredReturnType || 'unknown' : 'not specified'),
        hasExpectedReturn,
        stdin: testCase.stdin,
        error: data.status === 'success' ? '' : (data.error || data.status),
        files: [...overrides.keys()],
        generatedFiles: generatedFiles.map(file => file.name),
        memoryUsageBytes: data.memory_usage_bytes ?? null,
        checks,
        errorSource: data.error_source || 'user'
      };
      showGeneratedFiles(generatedFiles);
      if (['compile_error', 'harness_error', 'unavailable'].includes(data.status)) {
        for (const remaining of casesToRun.slice(caseIndex + 1)) {
          remaining.status = 'not-run';
          remaining.result = {actualOutput: '', actualReturn: '', expectedOutput: remaining.expectedOutput || '', expectedReturn: remaining.expectedReturn || '', stdin: remaining.stdin || '', error: 'Not run because validation stopped the test run.', files: [], generatedFiles: [], checks: []};
          results.push(remaining);
        }
        results.push(testCase);
        break;
      }
    } catch (error) {
      testCase.status = 'runtime-error';
      testCase.result = {
        actualOutput: '', actualReturn: '', expectedOutput: testCase.expectedOutput, expectedReturn: testCase.expectedReturn || '', stdin: testCase.stdin, error: error.message, files: [], generatedFiles: [],
        checks: [{name: 'Execution', status: 'failed', detail: error.message}]
      };
    }
    results.push(testCase);
    renderTestCases();
  }

  renderTestRunOutput(results);
  const rules = document.querySelector('#constraints').value.trim();
  renderConstraintResults(rules ? [{type: 'review', title: 'Rules to follow', detail: `Review all test results against: ${rules}`}]: []);
  button.disabled = false;
  button.textContent = 'Run with test cases';
  selectedTestCaseId = selectedBeforeRun;
  renderTestCases();
}

function evaluateTestCaseConstraints(testCase, elapsedMs, data) {
  const checks = [];
  const runSucceeded = data.status === 'success';

  const memoryLimit = document.querySelector('#memory-limit').value;
  checks.push(memoryLimit
    ? data.memory_limit_exceeded
      ? {name: 'Memory', status: 'failed', detail: `Exceeded ${memoryLimit} MB; sampled ${(data.memory_usage_bytes / (1024 * 1024)).toFixed(1)} MB`}
      : Number.isFinite(data.memory_usage_bytes)
        ? {name: 'Memory', status: 'passed', detail: `Peak sampled ${(data.memory_usage_bytes / (1024 * 1024)).toFixed(1)} MB / ${memoryLimit} MB`}
        : {name: 'Memory', status: 'review', detail: 'Memory could not be measured'}
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
  const countInput = document.querySelector('#testcase-request-count');
  if (hasOldProgramCases()) {
    status.hidden = false;
    status.textContent = 'Clear older whole-program tests before generating tests for a selected method.';
    return;
  }
  const requestedCount = Math.max(1, Math.min(20, Number(countInput?.value || 5)));
  if (countInput) countInput.value = String(requestedCount);
  const selection = codeEditor.getSelection();
  if (!selection || selection.isEmpty()) {
    status.hidden = false;
    status.textContent = 'Highlight one complete function or method in the editor first.';
    return;
  }
  const selectionKey = testSelectionKey();
  if (targetValidationState.key !== selectionKey || targetValidationState.status !== 'ready') {
    status.hidden = false;
    status.textContent = targetValidationState.status === 'checking'
      ? 'Checking the selection before generating tests…'
      : 'Highlight one complete function or method in the editor first.';
    scheduleTestTargetValidation(true);
    return;
  }
  button.disabled = true;
  button.textContent = 'Generating…';
  const generationSnapshot = captureTestSnapshot();
  status.hidden = false;
  const stopAiProgress = startAiProgress(status, 'Generating test cases');
  try {
    const response = await fetch('/api/testcases', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        language: currentLanguage,
        active_file: activeFile.name,
        code: activeFile.model.getValue(),
        files: allWorkspaceFiles().filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
        existing_cases: testCases.filter(testCase => testCase.origin === 'ai').map(testCase => ({
          name: testCase.name,
          stdin: testCase.stdin,
          invocation: testCase.invocation || null,
          expected_return: testCase.expectedReturn || null,
          return_type: testCase.returnType || null,
          files: testCase.files.map(fixture => ({file_name: fixture.fileName, contents: fixture.contents})),
          expected_output: testCase.expectedOutput
        })),
        intent: document.querySelector('#intent').value.trim(),
        count: requestedCount,
        test_style: document.querySelector('#testcase-test-style')?.value || 'general',
        method_description: document.querySelector('#testcase-method-description')?.value.trim() || '',
        preconditions: document.querySelector('#testcase-preconditions')?.value.trim() || '',
        selection_start_line: selection ? selection.startLineNumber : null,
        selection_end_line: selection ? selection.endLineNumber : null,
        selection_start_column: selection ? selection.startColumn : null,
        selection_end_column: selection ? selection.endColumn : null,
        constraints: [
          `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
          `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
        ].join('\n')
      })
    });
    const data = await parseApiResponse(response, 'Could not generate test cases.');
    renderTestTarget(data);
    if (!data.target_ready) {
      status.textContent = data.message || data.missing_information || data.validation_error || 'This target is not ready for tests yet.';
      return;
    }
    if (!['function', 'method'].includes(data.target_kind)) {
      status.textContent = 'Only a selected function or method can be tested here. Use Run for the whole program.';
      return;
    }
    const strategyByCase = new Map((data.strategies || []).flatMap(strategy => (strategy.cases || []).map(item => [JSON.stringify(item), {
      name: strategy.name, description: strategy.description, code: strategy.code
    }])));
  const generated = (data.cases || []).slice(0, requestedCount).map((generatedCase, index) => ({
      id: nextTestCaseId + index,
      name: generatedCase.name || `AI case ${nextTestCaseId + index}`,
      description: generatedCase.description || '',
      origin: 'ai',
      generationStrategy: strategyByCase.get(JSON.stringify(generatedCase)) || null,
      stdin: generatedCase.stdin || '',
      files: (generatedCase.files || []).map((fixture, fixtureIndex) => ({
        id: `ai-fixture-${nextTestCaseId + index}-${fixtureIndex}`,
        fileName: fixture.file_name,
        contents: fixture.contents || ''
      })),
      expectedOutput: generatedCase.expected_output || '',
      expectedOutputProvided: Boolean(data.target_is_main || isVoidReturnType(generatedCase.return_type || data.return_type) || generatedCase.expected_output),
      invocation: generatedCase.invocation || '',
      expectedReturn: generatedCase.expected_return ?? '',
      // `""` is a valid expected return for a string method. Only null or
      // undefined means that the generator did not provide a return value.
      expectedReturnProvided: generatedCase.expected_return !== null && generatedCase.expected_return !== undefined,
      returnType: generatedCase.return_type || data.return_type || '',
      isMain: Boolean(data.target_is_main),
      harnessFile: generatedCase.harness_file || data.harness_file || '',
      harnessCode: generatedCase.harness_code || '',
      expectedFiles: [],
      status: 'not-run',
      result: null,
      snapshot: generationSnapshot,
      targetKind: data.target_kind || 'program',
      outdated: generationSnapshot !== captureTestSnapshot()
    }));
    if (!generated.length) {
      status.textContent = data.message || `No test cases were generated. The requested count was ${requestedCount}.`;
      return;
    }
    testCases.push(...generated);
    nextTestCaseId += generated.length;
    selectedTestCaseId = null;
    renderTestCases();
    renderFileTabs();
    const countMessage = data.complete
      ? `Exactly ${generated.length} test case${generated.length === 1 ? '' : 's'} generated.`
      : (data.message || `Only ${generated.length} of ${requestedCount} requested test cases were generated.`);
    status.textContent = countMessage;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    stopAiProgress();
    status.hidden = false;
    button.disabled = false;
    button.textContent = 'Generate tests for selection';
  }
}

function renderTestTarget(data) {
  selectedTestTarget = data;
  const summary = document.querySelector('#testcase-target-summary');
  if (!summary) return;
  const targetName = data.target_is_main
    ? 'main function'
    : data.target_kind === 'function' ? 'function' : data.target_kind === 'method' ? 'method' : 'selection';
  summary.textContent = data.target_ready ? `Testing the selected ${targetName}.` : 'Select one complete function or method.';
  if (data.target_banner) summary.textContent += ` ${data.target_banner}`;
  if (data.target_explanation) summary.textContent += ` ${data.target_explanation}`;
}

function normalizeOutput(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd();
}

function stripOuterReturnParentheses(value) {
  // Remove only balanced wrapper parentheses, not parentheses inside strings or expressions.
  let text = String(value ?? '').trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let closesBeforeEnd = false;
    let quote = '';
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '(') depth += 1;
      if (character === ')') {
        depth -= 1;
        if (depth === 0 && index < text.length - 1) { closesBeforeEnd = true; break; }
      }
    }
    if (closesBeforeEnd || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function returnTypeCategory(returnType) {
  const value = String(returnType || '').toLowerCase().replace(/\s/g, '');
  if (!value) return '';
  if (value.includes('string') || value === 'str' || value.includes('char')) return 'string';
  if (value.includes('bool')) return 'boolean';
  if (value === 'none' || value === 'null' || value === 'void') return 'null';
  if (value.includes('list') || value.includes('array') || value.includes('tuple') || value.endsWith('[]')) return 'array';
  if (value.includes('set')) return 'set';
  if (value.includes('dict') || value.includes('map') || value.includes('object')) return 'object';
  if (/(^|\b)(int|long|short|byte)(\b|$)/.test(value)) return 'integer';
  if (/(^|\b)(float|double|decimal|number)(\b|$)/.test(value)) return 'number';
  return '';
}

function decodeSingleQuotedString(text) {
  const body = text.slice(1, -1);
  return body.replace(/\\([\\'"nrtb])/g, (_, escaped) => ({n: '\n', r: '\r', t: '\t', b: '\b'}[escaped] || escaped));
}

function parseReturnLiteral(value) {
  const text = stripOuterReturnParentheses(value);
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return {type: 'string', value: decodeSingleQuotedString(text)};
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try { return {type: 'string', value: JSON.parse(text)}; } catch { return {type: 'string', value: text.slice(1, -1)}; }
  }
  const pythonLike = text.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null').replace(/'/g, '"');
  try {
    const parsed = JSON.parse(pythonLike);
    if (parsed === null) return {type: 'null', value: null};
    if (typeof parsed === 'boolean') return {type: 'boolean', value: parsed};
    if (typeof parsed === 'number') return {type: 'number', value: parsed};
    if (Array.isArray(parsed)) return {type: 'array', value: parsed};
    if (typeof parsed === 'object') return {type: 'object', value: parsed};
  } catch {}
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return {type: 'number', value: Number(text)};
  if (text === 'true' || text === 'True') return {type: 'boolean', value: true};
  if (text === 'false' || text === 'False') return {type: 'boolean', value: false};
  if (text === 'null' || text === 'None') return {type: 'null', value: null};
  return {type: 'string', value: text};
}

function parseReturnValue(value, declaredType = '', fallbackType = '') {
  const category = returnTypeCategory(declaredType) || fallbackType;
  const raw = String(value ?? '').trim();
  if (category === 'string') {
    if (raw.length >= 2 && ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))) {
      return parseReturnLiteral(raw);
    }
    // A returned string such as (a) is data, not a wrapper added by the harness.
    if (raw.startsWith('(') && raw.endsWith(')')) {
      const inside = raw.slice(1, -1).trim();
      if ((inside.startsWith("'") && inside.endsWith("'")) || (inside.startsWith('"') && inside.endsWith('"'))) return parseReturnLiteral(inside);
    }
    return {type: 'string', value: raw};
  }
  if (category === 'integer') {
    const integerText = raw.replace(/^\((.*)\)$/, '$1').trim();
    return /^[-+]?\d+$/.test(integerText) ? {type: 'integer', value: integerText.replace(/^\+/, '')} : {type: 'invalid', value: raw};
  }
  if (category === 'boolean') {
    if (raw === 'true' || raw === 'True') return {type: 'boolean', value: true};
    if (raw === 'false' || raw === 'False') return {type: 'boolean', value: false};
    return {type: 'invalid', value: raw};
  }
  if (category === 'null') {
    return ['null', 'None', 'nil'].includes(raw) ? {type: 'null', value: null} : {type: 'invalid', value: raw};
  }
  const parsed = parseReturnLiteral(value);
  if (category === 'number') return {type: 'number', value: parsed.type === 'number' ? parsed.value : Number(parsed.value)};
  if (category === 'array') return parsed.type === 'array' ? parsed : {type: 'invalid', value: raw};
  if (category === 'set') {
    if (parsed.type === 'array') return {type: 'set', value: parsed.value};
    const setText = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1).trim() : '';
    if (!setText) return {type: 'set', value: []};
    return {type: 'set', value: setText.split(',').map(item => parseReturnLiteral(item.trim()).value)};
  }
  if (category === 'object') return parsed.type === 'object' ? parsed : {type: 'invalid', value: raw};
  return parsed;
}

function parseExpectedReturn(value, actualValue, declaredType = '', provided = true) {
  if (!provided) return null;
  return parseReturnValue(value, declaredType, actualValue?.type || '');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
  return value;
}

function typedValuesEqual(left, right) {
  if (!left || !right || left.type !== right.type) return false;
  if (left.type === 'invalid') return false;
  if (left.type === 'integer') {
    try { return BigInt(left.value) === BigInt(right.value); } catch { return false; }
  }
  if (left.type === 'number') {
    const a = Number(left.value); const b = Number(right.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
    // Allow small floating-point representation differences in numeric results.
    const tolerance = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tolerance;
  }
  if (left.type === 'set') {
    const normalizeSet = value => value.map(stableValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify(normalizeSet(left.value)) === JSON.stringify(normalizeSet(right.value));
  }
  return JSON.stringify(stableValue(left.value)) === JSON.stringify(stableValue(right.value));
}

function formatReturnValue(value) {
  if (!value) return '';
  if (value.type === 'string') return value.value;
  if (value.type === 'null') return 'null';
  if (value.type === 'array' || value.type === 'object') return JSON.stringify(value.value);
  return String(value.value);
}

function extractHarnessReturn(outputText, declaredType = '') {
  const matches = [...String(outputText || '').matchAll(/Office Hours Prep result \d+:\s*(.*)/g)];
  return matches.length ? parseReturnValue(matches[matches.length - 1][1], declaredType) : null;
}

function removeHarnessOutput(outputText) {
  return String(outputText || '')
    .replace(/^Office Hours Prep result \d+:.*(?:\r?\n|$)/gm, '')
    .replace(/^Office Hours Prep test \d+ failed:.*(?:\r?\n|$)/gm, '');
}

function renderTestRunOutput(results) {
  const passed = results.filter(testCase => testCase.status === 'passed').length;
  const failed = results.filter(testCase => testCase.status === 'failed').length;
  const review = results.filter(testCase => testCase.status === 'review').length;
  const runtimeErrors = results.filter(testCase => testCase.status === 'runtime-error').length;
  const harnessErrors = results.filter(testCase => testCase.status === 'harness-error').length;
  const timedOut = results.filter(testCase => testCase.status === 'timed-out').length;
  const notRun = results.filter(testCase => testCase.status === 'not-run').length;
  const outdated = results.filter(testCase => testCase.status === 'outdated').length;
  output.replaceChildren();
  output.className = `output-box testcase-results ${failed || runtimeErrors || harnessErrors || timedOut ? 'error' : review || notRun ? 'review' : 'success'}`;
  const summaryParts = [
    [passed, 'passed'], [failed, 'failed'], [review, 'review'],
    [runtimeErrors, 'runtime error'], [harnessErrors, 'harness error'], [timedOut, 'timed out'],
    [notRun, 'not run'], [outdated, 'outdated']
  ].filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  output.append(createElement('strong', 'testcase-results-summary', summaryParts.join(' · ')));
  results.forEach(testCase => {
    const resultCard = createElement('section', `testcase-result ${testCase.status}`);
    const resultHeading = createElement('div', 'testcase-result-heading');
    resultHeading.append(createElement('strong', '', testCase.name));
    const resultLabels = {passed: 'Passed', failed: 'Failed', review: 'Review', 'runtime-error': 'Runtime error', 'timed-out': 'Timed out', 'harness-error': 'Harness error', outdated: 'Outdated', 'not-run': 'Not run'};
    resultHeading.append(createElement('span', `testcase-result-tag ${testCase.status}`, resultLabels[testCase.status] || testCase.status));
    resultCard.append(resultHeading);
    if (testCase.origin !== 'ai') {
      resultCard.append(createElement('div', 'testcase-result-checking', `What this checks: ${testCase.description || testCase.name}`));
    }
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
    if (testCase.result.generatedFiles?.length) {
      resultCard.append(createElement('div', 'testcase-result-files generated', `Generated files: ${testCase.result.generatedFiles.join(', ')}`));
    }
    if (testCase.result.error) resultCard.append(createElement('div', 'testcase-result-error', testCase.result.error));
    if (testCase.result.errorSource === 'harness') resultCard.append(createElement('div', 'testcase-result-error', 'This was a generated harness failure, not a failure attributed to your original code.'));
    const input = createElement('pre', 'testcase-result-output');
    input.textContent = testCase.invocation
      ? `Input / call\n${testCase.invocation}`
      : `Input\n${testCase.result.stdin || '(none)'}`;
    resultCard.append(input);
    const actual = createElement('pre', 'testcase-result-output');
    actual.textContent = `Actual stdout\n${testCase.result.actualOutput || '(empty)'}`;
    resultCard.append(actual);
    const expected = createElement('pre', 'testcase-result-output');
    expected.textContent = `Expected stdout\n${testCase.result.expectedOutputProvided ? (testCase.result.expectedOutput || '(empty)') : '(not specified)'}`;
    resultCard.append(expected);
    if (testCase.invocation && (testCase.result.hasReturnValue || testCase.result.expectedReturnValue || testCase.result.hasExpectedReturn)) {
      const actual = createElement('pre', 'testcase-result-output');
      actual.textContent = `Actual return value (${testCase.result.actualReturnType || 'unknown'})\n${testCase.result.hasReturnValue ? testCase.result.actualReturn : '(no return value recorded)'}`;
      resultCard.append(actual);
      if (testCase.result.hasExpectedReturn) {
        const expected = createElement('pre', 'testcase-result-output');
        expected.textContent = `Expected return value (${testCase.result.expectedReturnType || 'unknown'})\n${testCase.result.expectedReturnValue ? formatReturnValue(testCase.result.expectedReturnValue) : '(empty string)'}`;
        resultCard.append(expected);
      }
    }
    output.append(resultCard);
  });
  outputStatus.textContent = summaryParts.join(' · ') || 'No results';
}


setupSidebar();
