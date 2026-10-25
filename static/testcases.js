// Build the sidebar's setup, testcase, and workspace-file views in one place so they share saved editor state.
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
  const workspaceFilesHeading = createElement('div', 'testcase-heading');
  workspaceFilesHeading.append(createElement('h3', '', 'Workspace files'));
  const workspaceFilesCount = createElement('span', 'testcase-count');
  workspaceFilesCount.id = 'workspace-files-count';
  workspaceFilesHeading.append(workspaceFilesCount);
  const workspaceFilesList = createElement('div', 'workspace-files-list');
  workspaceFilesList.id = 'workspace-files-list';
  workspaceFilesPanel.append(workspaceFilesHeading, workspaceFilesList);

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
  const workspaceFilesTab = createElement('button', 'sidebar-tab', 'Files');
  workspaceFilesTab.type = 'button';
  workspaceFilesTab.id = 'workspace-files-tab';
  workspaceFilesTab.setAttribute('role', 'tab');
  workspaceFilesTab.setAttribute('aria-controls', workspaceFilesPanel.id);
  workspaceFilesTab.setAttribute('aria-selected', 'false');
  navigation.append(setupTab, casesTab, workspaceFilesTab);
  sidebar.replaceChildren(navigation, setupPanel, testPanel, workspaceFilesPanel);

  function selectPanel(selectedTab) {
    const showCases = selectedTab === casesTab;
    const showFiles = selectedTab === workspaceFilesTab;
    setupTab.setAttribute('aria-selected', String(!showCases && !showFiles));
    casesTab.setAttribute('aria-selected', String(showCases));
    workspaceFilesTab.setAttribute('aria-selected', String(showFiles));
    setupPanel.hidden = showCases || showFiles;
    testPanel.hidden = !showCases;
    workspaceFilesPanel.hidden = !showFiles;
  }

  setupTab.addEventListener('click', () => selectPanel(setupTab));
  casesTab.addEventListener('click', () => selectPanel(casesTab));
  workspaceFilesTab.addEventListener('click', () => selectPanel(workspaceFilesTab));
  renderWorkspaceFiles();

  const casesHeading = createElement('div', 'testcase-heading');
  casesHeading.append(createElement('h3', '', 'Cases'));
  const caseCount = createElement('span', 'testcase-count');
  caseCount.id = 'testcase-count';
  casesHeading.append(caseCount);
  const caseActions = createElement('div', 'testcase-tools');
  // Cases remain unselected until the user chooses one; manual cases are never counted against the AI generation cap.
  const deselectCaseButton = createElement('button', 'deselect-testcase', 'Deselect');
  deselectCaseButton.type = 'button';
  deselectCaseButton.id = 'deselect-testcase';
  deselectCaseButton.title = 'Deselect this test case';
  deselectCaseButton.addEventListener('click', () => {
    selectedTestCaseId = null;
    renderTestCases();
  });
  caseActions.append(deselectCaseButton);
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
  // This cap limits only AI-created cases and is saved with the workspace so it remains adjustable per project.
  const aiLimitControl = createElement('div', 'testcase-limit-control');
  const aiLimitLabel = createElement('label', '', 'AI case limit');
  aiLimitLabel.htmlFor = 'ai-testcase-limit';
  const aiLimitInput = createElement('input', 'ai-testcase-limit');
  aiLimitInput.type = 'number';
  aiLimitInput.id = 'ai-testcase-limit';
  aiLimitInput.min = '0';
  aiLimitInput.max = '20';
  aiLimitInput.step = '1';
  aiLimitInput.value = String(maxAiTestCases);
  aiLimitInput.title = 'Maximum total AI-generated test cases; manual cases do not count';
  aiLimitInput.addEventListener('change', () => {
    const value = Number(aiLimitInput.value);
    maxAiTestCases = Number.isFinite(value) ? Math.min(20, Math.max(0, Math.trunc(value))) : 8;
    aiLimitInput.value = String(maxAiTestCases);
    persistWorkspace();
    renderTestCases();
  });
  aiLimitControl.append(aiLimitLabel, aiLimitInput, createElement('span', '', 'Manual cases do not count'));
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
    const testCase = {id: nextTestCaseId, name: `Case ${nextTestCaseId}`, origin: 'manual', stdin: '', files: [], expectedOutput: '', expectedFiles: [], status: 'not-run', result: null};
    testCases.push(testCase);
    selectedTestCaseId = testCase.id;
    nextTestCaseId += 1;
    renderTestCases();
  });

  const runCasesButton = createElement('button', 'run-testcases', 'Run with testcases');
  runCasesButton.type = 'button';
  runCasesButton.disabled = true;
  runCasesButton.addEventListener('click', runTestCases);
  testPanel.append(casesHeading, aiLimitControl, generatorStatus, caseList, caseEditor, runCasesButton);
  renderTestCases();
}

// Rebuild the case list and editor from state; an empty or deselected editor stays blank rather than implying a selection.
function renderTestCases() {
  persistWorkspace();
  const caseList = document.querySelector('#testcase-list');
  const caseEditor = document.querySelector('#testcase-editor');
  if (!caseList || !caseEditor) return;
  caseList.replaceChildren();
  if (selectedTestCaseId !== null && !testCases.some(testCase => testCase.id === selectedTestCaseId)) {
    selectedTestCaseId = testCases[0]?.id ?? null;
  }
  const deselectButton = document.querySelector('#deselect-testcase');
  if (deselectButton) deselectButton.disabled = selectedTestCaseId === null;
  const count = document.querySelector('#testcase-count');
  const aiCaseCount = testCases.filter(testCase => testCase.origin === 'ai').length;
  if (count) count.textContent = `${testCases.length} total · ${aiCaseCount}/${maxAiTestCases} AI`;
  const aiLimitInput = document.querySelector('#ai-testcase-limit');
  if (aiLimitInput && document.activeElement !== aiLimitInput) aiLimitInput.value = String(maxAiTestCases);
  const generateButton = document.querySelector('.generate-testcases');
  if (generateButton && generateButton.dataset.generating !== 'true') {
    generateButton.disabled = aiCaseCount >= maxAiTestCases;
    generateButton.title = aiCaseCount >= maxAiTestCases ? 'AI testcase limit reached; increase the limit to generate more' : 'Generate additional AI test cases';
  }
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
  if (!testCase) return;

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

  if (testCase.generationStrategy) {
    const strategyDetails = createElement('details', 'testcase-generation-strategy');
    const strategySummary = createElement('summary', '', `Generated with: ${testCase.generationStrategy.name}`);
    strategyDetails.append(strategySummary);
    if (testCase.generationStrategy.description) strategyDetails.append(createElement('p', '', testCase.generationStrategy.description));
    if (testCase.generationStrategy.code) strategyDetails.append(createElement('pre', '', testCase.generationStrategy.code));
    caseEditor.append(strategyDetails);
  }

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
  addFileOverride.disabled = allWorkspaceFiles().every(file => file.generated);
  addFileOverride.addEventListener('click', () => {
    testCase.files.push({id: `fixture-${Date.now()}-${Math.random()}`, fileName: '', contents: ''});
    renderTestCases();
  });
  filesHeading.append(addFileOverride);
  caseEditor.append(filesHeading);

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
  requiredFiles.append(createElement('p', 'required-file-help', 'Checks that the named file exists after execution and that its contents match. Matching open file tabs are marked in blue.'));
  if (testCase.expectedFiles.length === 0) {
    requiredFiles.append(createElement('p', 'testcase-empty', 'No required file checks.'));
  }
  testCase.expectedFiles.forEach((expectedFile, fileIndex) => {
    const expectedFileCard = createElement('div', 'required-file-check');
    const expectedFileHeading = createElement('div', 'testcase-file-row');
    const fileName = createElement('input', 'testcase-file');
    fileName.type = 'text';
    fileName.placeholder = 'e.g. results.txt';
    fileName.autocomplete = 'off';
    fileName.spellcheck = false;
    fileName.required = true;
    fileName.title = 'Name used to identify this expected output and highlight a matching editor file';
    fileName.value = expectedFile.name;
    fileName.setAttribute('aria-label', `${testCase.name} required file ${fileIndex + 1} name`);
    fileName.addEventListener('input', () => {
      expectedFile.name = fileName.value.trim();
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
    const fileNameLabel = createElement('label', 'required-file-name-label', 'Output file');
    fileNameLabel.htmlFor = `expected-file-name-${testCase.id}-${fileIndex}`;
    fileName.id = fileNameLabel.htmlFor;
    expectedFileHeading.append(fileNameLabel, fileName, removeExpectedFile);
    const expectedContents = createElement('textarea', 'testcase-file-content');
    expectedContents.placeholder = 'Expected contents of this file';
    expectedContents.value = expectedFile.contents;
    expectedContents.setAttribute('aria-label', `${testCase.name} required contents for ${expectedFile.name || `file ${fileIndex + 1}`}`);
    expectedContents.addEventListener('input', () => { expectedFile.contents = expectedContents.value; });
    expectedFileCard.append(expectedFileHeading, expectedContents);
    requiredFiles.append(expectedFileCard);
  });
  caseEditor.append(requiredFiles);
}

function clearTestCases(scope) {
  const remaining = scope === 'ai' ? testCases.filter(testCase => testCase.origin !== 'ai') : [];
  testCases.splice(0, testCases.length, ...remaining);
  selectedTestCaseId = testCases[0]?.id ?? null;
  renderTestCases();
  renderFileTabs();
}

// Run every case against the same program while applying that case's stdin/file overrides and expected outputs.
async function runTestCases() {
  const button = document.querySelector('.run-testcases');
  if (!codeEditor || !button || button.disabled || testCases.length === 0) return;
  document.body.classList.add('testcase-results-open');
  renderConstraintResults([]);
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
          files_to_check: testCase.expectedFiles.map(expectedFile => expectedFile.name.trim()).filter(Boolean),
          memory_limit_mb: Number(document.querySelector('#memory-limit').value) || null,
          intent: document.querySelector('#intent').value.trim()
        })
      });
      const data = await parseApiResponse(response, 'The test case could not be run.');
      const actualOutput = data.output || '';
      const hasRequiredOutput = normalizeOutput(testCase.expectedOutput).length > 0;
      const outputMatches = !hasRequiredOutput || (data.status === 'success' && normalizeOutput(actualOutput) === normalizeOutput(testCase.expectedOutput));
      const checks = evaluateTestCaseConstraints(performance.now() - caseStartedAt);
      if (data.memory_limit_exceeded) {
        checks.push({
          name: 'Memory limit',
          status: 'failed',
          detail: `Peak sampled process-tree memory: ${(data.memory_usage_bytes / (1024 * 1024)).toFixed(1)} MB / ${document.querySelector('#memory-limit').value} MB`
        });
      }
      checks.push({
        name: 'Execution',
        status: data.status === 'success' ? 'passed' : 'failed',
        detail: data.status === 'success' ? 'Program completed successfully' : (data.error || data.status)
      });
      if (hasRequiredOutput) {
        checks.push({name: 'Stdout', status: outputMatches ? 'passed' : 'failed', detail: outputMatches ? 'Matches required output' : 'Does not match required output'});
      }
      const generatedFiles = data.generated_files || [];
      // Required file checks inspect the post-run workspace snapshot and fail when a named target is absent; they never fall back to editor contents.
      const hasWorkspaceSnapshot = Array.isArray(data.workspace_files);
      const workspaceFiles = hasWorkspaceSnapshot ? data.workspace_files : generatedFiles;
      const filesAfterRunByName = new Map(workspaceFiles.map(file => [String(file.name || '').trim().toLowerCase(), file.contents || '']));
      testCase.expectedFiles.forEach(expectedFile => {
        const fileName = expectedFile.name.trim();
        if (!fileName) {
          checks.push({name: 'Output file', status: 'failed', detail: 'Enter the output file name to check'});
          return;
        }
        const fileContents = filesAfterRunByName.get(fileName.toLowerCase());
        const existsAfterRun = fileContents !== undefined;
        const fileMatches = existsAfterRun && normalizeOutput(fileContents) === normalizeOutput(expectedFile.contents);
        checks.push({
          name: `Output: ${fileName}`,
          status: data.status === 'success' && fileMatches ? 'passed' : 'failed',
          detail: !hasWorkspaceSnapshot
            ? 'The runner did not return a post-execution workspace snapshot. Restart the server and reload the page.'
            : !existsAfterRun ? `File "${fileName}" does not exist after execution` : fileMatches ? 'File contents match' : 'File contents do not match'
        });
      });
      const hasFailure = checks.some(check => check.status === 'failed');
      const needsReview = checks.some(check => check.status === 'review');
      testCase.status = hasFailure ? 'failed' : needsReview ? 'review' : 'passed';
      testCase.result = {
        actualOutput,
        expectedOutput: testCase.expectedOutput,
        stdin: testCase.stdin,
        memoryUsageBytes: data.memory_usage_bytes ?? null,
        error: data.status === 'success' ? '' : (data.error || data.status),
        files: [...overrides.keys()],
        generatedFiles: generatedFiles.map(file => file.name),
        checks
      };
      showGeneratedFiles(generatedFiles);
    } catch (error) {
      testCase.status = 'failed';
      testCase.result = {
        actualOutput: '', expectedOutput: testCase.expectedOutput, stdin: testCase.stdin, memoryUsageBytes: null, error: error.message, files: [], generatedFiles: [],
        checks: [{name: 'Execution', status: 'failed', detail: error.message}]
      };
    }
    results.push(testCase);
    renderTestCases();
  }

  renderConstraintResults(evaluateProgramRequirements(testCases.map(testCase => ({
    name: testCase.name,
    passed: testCase.status === 'passed',
    memoryMeasured: Number.isFinite(testCase.result?.memoryUsageBytes)
  }))));
  renderTestRunOutput(results);
  button.disabled = false;
  button.textContent = 'Run with testcases';
}

function evaluateTestCaseConstraints(elapsedMs) {
  const checks = [];
  const timeLimit = Number(document.querySelector('#time-limit').value);
  if (timeLimit && elapsedMs > timeLimit * 1000) {
    checks.push({name: 'Time limit', status: 'failed', detail: `${Math.round(elapsedMs)} ms / ${timeLimit} s`});
  }
  return checks;
}

// Send only prior AI cases as model context; manual testcase contents remain private and do not consume the AI cap.
async function generateTestCases() {
  const button = document.querySelector('.generate-testcases');
  const status = document.querySelector('#testcase-generator-status');
  const activeFile = files.find(file => file.id === activeFileId);
  if (!button || !status || !codeEditor || !activeFile) return;
  const remainingAiSlots = Math.max(0, maxAiTestCases - testCases.filter(testCase => testCase.origin === 'ai').length);
  if (!remainingAiSlots) {
    status.textContent = 'AI testcase limit reached. Increase the limit to generate more.';
    status.hidden = false;
    return;
  }
  button.disabled = true;
  button.dataset.generating = 'true';
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
        files: allWorkspaceFiles().filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
        existing_cases: testCases.filter(testCase => testCase.origin === 'ai').map(testCase => ({
          name: testCase.name,
          stdin: testCase.stdin,
          files: testCase.files.map(fixture => ({file_name: fixture.fileName, contents: fixture.contents})),
          expected_output: testCase.expectedOutput
        })),
        max_cases: remainingAiSlots,
        intent: document.querySelector('#intent').value.trim(),
        constraints: [
          `Per-case time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
          `Per-case memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
          `Program requirements: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
        ].join('\n')
      })
    });
    const data = await parseApiResponse(response, 'Could not generate test cases.');
    // Keep the strategy recipe with each concrete case so users can inspect why random/boundary/repeated inputs were chosen.
    const strategyCases = (data.strategies || []).flatMap(strategy => (strategy.cases || []).map(generatedCase => ({
      generatedCase,
      strategy: {name: strategy.name, description: strategy.description, code: strategy.code}
    })));
    const generatedCases = strategyCases.length
      ? strategyCases
      : (data.cases || []).map(generatedCase => ({generatedCase, strategy: null}));
    const currentAiSlots = Math.max(0, maxAiTestCases - testCases.filter(testCase => testCase.origin === 'ai').length);
    const generated = generatedCases.slice(0, Math.min(remainingAiSlots, currentAiSlots)).map(({generatedCase, strategy}, index) => ({
      id: nextTestCaseId + index,
      name: generatedCase.name || `AI case ${nextTestCaseId + index}`,
      origin: 'ai',
      generationStrategy: strategy,
      stdin: generatedCase.stdin || '',
      files: (generatedCase.files || []).map((fixture, fixtureIndex) => ({
        id: `ai-fixture-${nextTestCaseId + index}-${fixtureIndex}`,
        fileName: fixture.file_name,
        contents: fixture.contents || ''
      })),
      expectedOutput: generatedCase.expected_output || '',
      expectedFiles: [],
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
    button.dataset.generating = 'false';
    button.disabled = false;
    button.textContent = 'Generate test cases';
    renderTestCases();
  }
}

// Normalize platform newlines and ignore only trailing line breaks so copy/pasted output compares predictably.
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
    if (testCase.result.generatedFiles?.length) {
      resultCard.append(createElement('div', 'testcase-result-files generated', `Generated files: ${testCase.result.generatedFiles.join(', ')}`));
    }
    if (testCase.result.error) resultCard.append(createElement('div', 'testcase-result-error', testCase.result.error));
    if (testCase.result.stdin) {
      const input = createElement('pre', 'testcase-result-output');
      input.textContent = `Input\n${testCase.result.stdin}`;
      resultCard.append(input);
    }
    if (normalizeOutput(testCase.result.expectedOutput)) {
      const actual = createElement('pre', 'testcase-result-output');
      actual.textContent = `Actual stdout\n${testCase.result.actualOutput || '(empty)'}`;
      resultCard.append(actual);
      const expected = createElement('pre', 'testcase-result-output');
      expected.textContent = `Required stdout\n${testCase.result.expectedOutput}`;
      resultCard.append(expected);
    }
    output.append(resultCard);
  });
  outputStatus.textContent = `${passed} passed · ${failed} failed · ${review} review`;
}


setupSidebar();
