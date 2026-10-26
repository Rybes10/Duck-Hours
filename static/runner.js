runButton.addEventListener('click', async () => {
  if (!codeEditor || !codeEditor.getModel() || files.length === 0) return;
  const runFileId = activeFileId;
  const previousIssue = activeIssue ? {...activeIssue} : null;
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
    // Send the full non-generated workspace so multi-file programs run together.
    const response = await fetch('/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      active_file: files.find(file => file.id === activeFileId)?.name || 'main.py',
      files: allWorkspaceFiles().filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
      stdin: '',
      memory_limit_mb: Number(document.querySelector('#memory-limit').value) || null,
      timeout_seconds: getExecutionTimeout(),
      intent: getRunIntent()
    })});
    const data = await parseApiResponse(response, 'The code could not be run.');
    // Ignore a delayed result if the user switched files while the request was running.
    if (activeFileId !== runFileId) return;
    showGeneratedFiles(data.generated_files || []);
    lastRun = data;
    evaluateRunChecks(performance.now() - runStartedAt, data.status === 'success', data);
    renderConstraintResults(buildRequirementNotes(data));
    showRunResult(data, previousIssue);
    if (data.status === 'success') {
      await checkLogicAfterRun(previousIssue);
    }
  } catch (error) {
    evaluateRunChecks(performance.now() - runStartedAt, false);
    renderConstraintResults([]);
    output.className = 'output-box error';
    output.innerHTML = `<span class="output-title">Could not run the code</span><span class="output-details">${escapeHtml(error.message)}</span>`;
    outputStatus.textContent = 'Error';
  } finally {
    updateFileControls();
    runButton.textContent = '▶ Run';
  }
});

function getRunIntent() {
  return [
    `Program purpose: ${document.querySelector('#intent').value.trim() || 'Not specified'}`,
    `Execution timeout: ${getExecutionTimeout()} seconds`,
    `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
    `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
  ].join('\n');
}

function getExecutionTimeout() {
  const value = Number(document.querySelector('#execution-timeout')?.value);
  return [1, 2, 5, 10, 20].includes(value) ? value : 10;
}

function setCheckStatus(id, state, message) {
  const indicator = document.querySelector(`#${id}`);
  indicator.dataset.state = state;
  indicator.textContent = message;
}

function evaluateRunChecks(elapsedMs, runSucceeded, data = {}) {
  const memoryLimit = document.querySelector('#memory-limit').value;
  // Report measured usage when available; otherwise distinguish an unmeasured check.
  const measuredMb = Number.isFinite(data.memory_usage_bytes) ? (data.memory_usage_bytes / (1024 * 1024)).toFixed(1) : null;
  setCheckStatus('check-memory', !memoryLimit ? 'idle' : data.memory_limit_exceeded ? 'fail' : measuredMb ? 'pass' : 'review',
    !memoryLimit ? 'Not set' : data.memory_limit_exceeded ? `Over · ${measuredMb} MB` : measuredMb ? `${measuredMb} MB` : 'Not measured');

  const otherConstraints = document.querySelector('#constraints').value.trim();
  setCheckStatus('check-other', otherConstraints ? 'review' : 'idle', otherConstraints ? 'Review' : 'None');
}

const constraintResults = createElement('section', 'constraint-results');
constraintResults.id = 'constraint-results';
constraintResults.hidden = true;
output.after(constraintResults);

function buildRequirementNotes(data) {
  const notes = [];
  if (data.memory_limit_exceeded) notes.push({type: 'error', title: 'Memory limit', detail: data.error || 'The program used more memory than allowed.'});
  const rules = document.querySelector('#constraints').value.trim();
  if (rules) notes.push({type: 'review', title: 'Rules to follow', detail: `Check the program and test results against: ${rules}`});
  return notes;
}

function renderConstraintResults(notes) {
  constraintResults.replaceChildren();
  constraintResults.hidden = notes.length === 0;
  if (!notes.length) return;
  constraintResults.append(createElement('h3', '', 'Requirement review'));
  for (const note of notes) {
    const row = createElement('div', `constraint-issue ${note.type}`);
    row.append(createElement('strong', '', note.title), createElement('span', '', note.detail));
    constraintResults.append(row);
  }
}

function lineText(line) {
  const model = codeEditor?.getModel();
  return model && Number.isInteger(line) && line >= 1 && line <= model.getLineCount()
    ? model.getLineContent(line)
    : '';
}

function rememberIssue(issue) {
  return {...issue, lineText: issue.line ? lineText(issue.line) : ''};
}

function issueProgressMessage(previousIssue, nextIssue) {
  if (!previousIssue) return 'Press “Give me a hint” when you are ready to inspect one line.';
  if (previousIssue.line && nextIssue.line && previousIssue.line === nextIssue.line) {
    if (previousIssue.lineText !== undefined && previousIssue.lineText !== lineText(nextIssue.line)) {
      return 'You changed the highlighted line, but it still has an issue. Try another small change.';
    }
    return 'The highlighted line is still causing an issue. Try a different change or ask for a new hint.';
  }
  if (previousIssue.line && nextIssue.line && previousIssue.line !== nextIssue.line) {
    return `Your change moved past the earlier issue, but there is still another issue on line ${nextIssue.line}.`;
  }
  return 'The earlier issue is still not fixed. Ask for a hint to inspect the current problem.';
}

function issueActions(showFix = false) {
  const fixButton = showFix ? '<button id="fix" class="fix-button" type="button">Fix it for me</button>' : '';
  return `<div class="issue-actions"><button id="hint" class="hint-button" type="button">? Give me a hint</button>${fixButton}</div>`;
}

function bindIssueActions() {
  document.querySelector('#hint')?.addEventListener('click', requestHint);
  document.querySelector('#fix')?.addEventListener('click', requestFix);
}

function addFixAction() {
  const actions = document.querySelector('.issue-actions');
  if (!actions || document.querySelector('#fix')) return;
  const fixButton = document.createElement('button');
  fixButton.id = 'fix';
  fixButton.className = 'fix-button';
  fixButton.type = 'button';
  fixButton.textContent = 'Fix it for me';
  fixButton.addEventListener('click', requestFix);
  actions.append(fixButton);
}

function automaticTestNote(data) {
  if (!data?.auto_tested) return '';
  if (data.error_source === 'harness') {
    return '<span class="output-note">The automatic test wrapper had a problem. Your submitted code was not blamed for this failure.</span>';
  }
  const functionName = escapeHtml(data.auto_test_function || 'your function');
  const rawCases = Array.isArray(data.auto_test_cases) ? data.auto_test_cases : [];
  const cases = rawCases.length;
  const caseList = rawCases.map(testCase => `<code>${escapeHtml(testCase)}</code>`).join(', ');
  const caseDescription = caseList ? ` It tried: ${caseList}.` : '';
  return `<span class="output-note">Duck Hours created ${cases || 'some'} automatic test case${cases === 1 ? '' : 's'} for <code>${functionName}</code> and ran them behind the scenes.${caseDescription}</span>`;
}

function targetNotice(data) {
  if (!data?.target_banner) return '';
  return `<span class="target-notice-title">${escapeHtml(data.target_banner)}</span><span class="target-notice-details">${escapeHtml(data.target_explanation || 'You can add an entry point or use the test-case panel to generate one.')}</span>`;
}

function harnessPreview(data) {
  if (!data?.harness_code) return '';
  return `<details class="inline-harness-preview"><summary>View the separate test harness</summary><pre>${escapeHtml(data.harness_code)}</pre></details>`;
}

function activeFileName() {
  return files.find(file => file.id === activeFileId)?.name || '';
}

function isDependencyError(data) {
  // A failure in another workspace file should direct the user to that dependency.
  return data?.error_source === 'dependency'
    || (data?.error_file && data.error_file !== activeFileName() && data.error_source !== 'harness');
}

function dependencyErrorDetails(data, phase) {
  if (!isDependencyError(data) || !data.error_file) return '';
  const action = phase === 'compile' ? 'could not be compiled' : 'stopped while the program was running';
  return `<span class="output-details">The required file <code>${escapeHtml(data.error_file)}</code> ${action}.</span><span class="output-note">Open that file from the Files list to inspect it. Unrelated workspace files were not checked.</span>`;
}

function showRunResult(data, previousIssue) {
  if (data.status === 'success') {
    activeIssue = null;
    output.className = 'output-box';
    if (data.auto_tested) {
      output.innerHTML = `${targetNotice(data)}<span class="output-details">${escapeHtml(data.output || '(The automatic tests ran successfully but printed no output.)')}</span>${automaticTestNote(data)}${harnessPreview(data)}`;
    } else {
      output.innerHTML = `${targetNotice(data)}<span class="output-details">${escapeHtml(data.output || '(The program ran successfully but printed no output.)')}</span>`;
    }
    outputStatus.textContent = 'Success';
    return;
  }
  if (data.status === 'compile_error') {
    if (isDependencyError(data)) {
      activeIssue = rememberIssue({category: 'Compile', line: data.line, message: data.error || data.output || ''});
      output.className = 'output-box error';
      output.innerHTML = `${targetNotice(data)}<span class="output-title">A required file has a compile error.</span>${dependencyErrorDetails(data, 'compile')}${errorGuideLink(data.error_type || 'compile')}${issueActions()}`;
      outputStatus.textContent = 'Open required file';
      bindIssueActions();
      return;
    }
    activeIssue = rememberIssue({category: 'Compile', line: data.line, message: data.error || data.output || ''});
    output.className = 'output-box error';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">The code did not compile.</span><span class="output-note">${escapeHtml(issueProgressMessage(previousIssue, activeIssue))}</span>${automaticTestNote(data)}${harnessPreview(data)}${errorGuideLink(data.error_type || 'compile')}${issueActions()}`;
    outputStatus.textContent = 'Hint available';
    bindIssueActions();
    return;
  }
  if (data.status === 'harness_error') {
    activeIssue = rememberIssue({category: 'Runtime', line: data.line, message: data.error || data.output || ''});
    output.className = 'output-box error';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">The generated test harness has an issue.</span><span class="output-details">${escapeHtml(data.error || data.output || 'The wrapper could not be compiled or run.')}</span><span class="output-note">This message is about Duck Hours’ temporary wrapper, not a line in your submitted code. Review the generated harness in the Test Cases panel and try again.</span>${issueActions()}`;
    outputStatus.textContent = 'Harness needs attention';
    bindIssueActions();
    return;
  }
  if (data.status === 'runtime_error') {
    if (isDependencyError(data)) {
      activeIssue = rememberIssue({category: 'Runtime', line: data.line, message: data.error || data.output || ''});
      output.className = 'output-box runtime';
      output.innerHTML = `${targetNotice(data)}<span class="output-title">A required file stopped while running.</span>${dependencyErrorDetails(data, 'runtime')}${errorGuideLink(data.error_type || 'runtime')}${issueActions()}`;
      outputStatus.textContent = 'Open required file';
      bindIssueActions();
      return;
    }
    if (data.target_kind === 'method' && data.target_banner) {
      activeIssue = null;
      output.className = 'output-box runtime';
      output.innerHTML = `${targetNotice(data)}<span class="output-title">The original submission has no entry point.</span><span class="output-details">Use the Testcases tab to test this method with a generated wrapper.</span>${errorGuideLink(data.error_type || 'runtime')}`;
      outputStatus.textContent = 'Method testing available';
      return;
    }
    const nonTerminating = ['TimeoutError', 'RecursionError', 'StackOverflowError', 'SystemStackError', 'RangeError'].includes(data.error_type);
    const nonTerminatingTitle = data.error_type === 'TimeoutError'
      ? 'The program timed out — a loop may not be stopping.'
      : 'The program stopped during repeated calls — recursion may not be stopping.';
    const nonTerminatingExplanation = data.error_type === 'TimeoutError'
      ? 'Execution reached the time limit while this loop was active. A very large workload can also produce this result.'
      : 'The same method or function kept calling itself until the runtime stopped it, which indicates that the repeated call did not terminate.';
    activeIssue = rememberIssue({
      category: 'Runtime',
      title: nonTerminating ? nonTerminatingTitle : undefined,
      explanation: nonTerminating ? nonTerminatingExplanation : undefined,
      line: data.line,
      message: data.error || data.output || ''
    });
    output.className = 'output-box runtime';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">${escapeHtml(nonTerminating ? nonTerminatingTitle : 'The program stopped while running.')}</span><span class="output-details">${escapeHtml(data.error || data.output || '')}</span><span class="output-note">${escapeHtml(issueProgressMessage(previousIssue, activeIssue))}${nonTerminating ? ' The likely problem line is highlighted; press the hint button for a short explanation.' : ''}</span>${automaticTestNote(data)}${harnessPreview(data)}${errorGuideLink(data.error_type || 'runtime')}${issueActions()}`;
    if (nonTerminating && data.line) {
      showHints([{line: data.line, message: nonTerminatingExplanation}]);
    }
    outputStatus.textContent = nonTerminating ? 'Runtime error · likely non-terminating code' : 'Hint available';
    bindIssueActions();
    return;
  }
  const details = data.output || data.error || 'No details were returned.';
  output.className = `output-box ${data.status === 'unavailable' ? 'error' : 'runtime'}`;
  output.innerHTML = `${targetNotice(data)}<span class="output-title">${data.status === 'unavailable' ? 'This language is not ready on this computer' : 'The program stopped while running'}</span><span class="output-details">${escapeHtml(details)}</span><span class="output-note">${escapeHtml(data.error || '')}</span>${errorGuideLink(data.error_type || 'runtime')}`;
  outputStatus.textContent = 'Needs attention';
}

async function checkLogicAfterRun(previousIssue) {
  // Allow users to skip the AI check while still reporting the observed run result.
  if (document.querySelector('#skip-logic')?.checked) {
    activeIssue = null;
    if (previousIssue && issueColorClass(previousIssue.category) !== 'logic') {
      output.className = 'output-box success';
      output.innerHTML = `<span class="output-title">Nice work — the previous issue is fixed</span><span class="output-details">${escapeHtml(lastRun.output || '(The program ran successfully but printed no output.)')}</span><span class="output-note">The code now runs successfully without the earlier ${escapeHtml(previousIssue.category || 'code')} failure. The result above is the observed output. The logic check was skipped for this run.</span>${automaticTestNote(lastRun)}`;
      outputStatus.textContent = 'Fixed · logic skipped';
    } else {
      outputStatus.textContent = 'Success · logic skipped';
      output.insertAdjacentHTML('beforeend', `<span class="output-note">The code ran successfully. The logic check was skipped for this run.</span>`);
    }
    return;
  }
  outputStatus.textContent = 'Checking logic…';
  const stopAiProgress = startAiProgress(outputStatus, 'Checking your code');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        mode: 'gemini',
        intent: getRunIntent(),
        code: codeEditor.getValue(),
        predicted_output: '',
        actual_output: lastRun?.output || '',
        problem: previousIssue ? `${previousIssue.category || 'code'} issue from the previous run` : ''
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'The logic check could not finish.');
    // "Understand" is informational, not a remaining logic issue to display.
    const issues = (data.issues || []).filter(issue => issue?.category && issue.category.toLowerCase() !== 'understand');
    if (issues.length) {
      const stillThere = previousIssue && issues.some(issue => sameIssue(previousIssue, issue));
      activeIssue = rememberIssue(issues[0]);
      showLogicIssue(issues[0], issues.length, previousIssue && !stillThere);
      return;
    }
    activeIssue = null;
    if (previousIssue) {
      output.className = 'output-box success';
      output.innerHTML = `<span class="output-title">Nice work — issue fixed</span><span class="output-details">${escapeHtml(lastRun.output || '(The program ran successfully but printed no output.)')}</span><span class="output-note">The code now runs successfully without the previous ${escapeHtml(previousIssue.category || 'code')} failure, and the whole-code check found no remaining issue tied to the stated purpose.</span>${automaticTestNote(lastRun)}`;
      outputStatus.textContent = 'Fixed';
    } else {
      outputStatus.textContent = 'Success · logic checked';
    }
  } catch (error) {
    if (previousIssue && issueColorClass(previousIssue.category) !== 'logic') {
      output.className = 'output-box success';
      output.innerHTML = `<span class="output-title">Nice work — the previous issue is fixed</span><span class="output-details">${escapeHtml(lastRun.output || '(The program ran successfully but printed no output.)')}</span><span class="output-note">The code now runs successfully without the earlier ${escapeHtml(previousIssue.category || 'code')} failure. The result above is the observed output. A whole-code logic check was unavailable, so this confirms the run behavior only.</span>${automaticTestNote(lastRun)}`;
      outputStatus.textContent = 'Fixed · logic check unavailable';
    } else {
      outputStatus.textContent = 'Success · logic not checked';
      output.insertAdjacentHTML('beforeend', `<span class="output-note">The code ran successfully, but the whole-code logic check could not finish.</span>`);
    }
  } finally {
    stopAiProgress();
  }
}

function sameIssue(previousIssue, issue) {
  if (!previousIssue || !issue) return false;
  const sameCategory = issueColorClass(previousIssue.category) === issueColorClass(issue.category);
  // Match by source line where possible, with title as a fallback for line-less findings.
  const sameLine = previousIssue.line && issue.line && previousIssue.line === issue.line;
  const previousTitle = String(previousIssue.title || '').toLowerCase();
  const nextTitle = String(issue.title || '').toLowerCase();
  return sameCategory && (sameLine || (previousTitle && nextTitle && previousTitle === nextTitle));
}

function showLogicIssue(issue, count, rewarded) {
  output.className = 'output-box logic';
  const issueCount = `${count} issue${count === 1 ? '' : 's'} remaining`;
  const title = rewarded ? `Nice work — one issue fixed. ${issueCount}.` : `${issueCount}: next issue`;
  output.innerHTML = `<span class="output-title">${escapeHtml(title)}</span><span class="output-details">${escapeHtml(issue.title || 'The result may not match the program purpose.')}</span><span class="output-note">Why: ${escapeHtml(issue.explanation || 'This may not match the stated purpose.')}</span>${errorGuideLink(issue.category || 'logic')}${issueActions()}`;
  outputStatus.textContent = 'Logic needs attention';
  bindIssueActions();
}

function errorGuideLink(type) {
  const safeType = encodeURIComponent(type || 'runtime');
  return `<a class="error-guide-link" href="/learn/errors?type=${safeType}">Learn what this means</a>`;
}

async function requestHint() {
  if (!codeEditor || !lastRun) return;
  const hintButton = document.querySelector('#hint');
  hintButton.disabled = true;
  hintButton.textContent = 'Getting a hint…';
  const stopAiProgress = startAiProgress(outputStatus, 'Finding a hint');
  try {
    const response = await fetch('/api/hint', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      intent: document.querySelector('#intent').value,
      issue_line: activeIssue?.line || lastRun?.line || null,
      issue_category: activeIssue?.category || '',
      compiler_error: [lastRun.output, lastRun.error, activeIssue?.title, activeIssue?.explanation, activeIssue?.message].filter(Boolean).join('\n')
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'A hint could not be provided.');
    if (!data.hints || data.hints.length === 0) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      outputStatus.textContent = 'No clear hint';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">A clear line could not be identified yet.</span>');
      return;
    }
    const hint = data.hints[0];
    activeIssue = rememberIssue({...activeIssue, line: hint.line, message: hint.message});
    if (!showHints([hint])) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      outputStatus.textContent = 'Hint available';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">The hint pointed to a line that is not in the current code.</span>');
      return;
    }
    addFixAction();
    output.insertAdjacentHTML('beforeend', `<span class="output-note">Hint: ${escapeHtml(hint.message)}</span>`);
    hintButton.textContent = 'Hint added to editor';
    outputStatus.textContent = 'Hint added';
  } catch (error) {
    hintButton.disabled = false;
    hintButton.textContent = '? Give me a hint';
    outputStatus.textContent = 'Hint unavailable';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">A hint is not available right now.</span>');
  } finally {
    stopAiProgress();
  }
}

async function requestFix() {
  if (!codeEditor || !lastRun) return;
  const fixButton = document.querySelector('#fix');
  if (!fixButton) return;
  const originalCode = codeEditor.getValue();
  fixButton.disabled = true;
  fixButton.textContent = 'Preparing a fix…';
  const stopAiProgress = startAiProgress(outputStatus, 'Preparing a suggestion');
  try {
    const issue = activeIssue || {};
    const response = await fetch('/api/fix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        language: currentLanguage,
        code: originalCode,
        intent: document.querySelector('#intent').value,
        problem: [issue.category, issue.title, issue.message].filter(Boolean).join(': '),
        compiler_error: lastRun.output || lastRun.error || ''
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'A fix could not be prepared.');
    if (!data.code || !String(data.code).trim()) throw new Error('The suggested fix was empty.');
    if (data.code === originalCode) {
      fixButton.disabled = false;
      fixButton.textContent = 'Fix it for me';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">No change was suggested. Try another hint.</span>');
      return;
    }
    codeEditor.setValue(data.code);
    clearHints();
    output.className = 'output-box success';
    output.innerHTML = `<span class="output-title">A possible fix is ready.</span><span class="output-details">${escapeHtml(data.explanation || 'The code was changed to address the reported issue.')}</span><span class="output-note">Review the change, then press Run to check whether it fixed the issue.</span><button id="fix" class="fix-button" type="button" disabled>Fix applied — press Run</button>`;
    outputStatus.textContent = 'Review fix';
  } catch (error) {
    fixButton.disabled = false;
    fixButton.textContent = 'Fix it for me';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">A fix is not available right now. You can keep editing or ask for a hint.</span>');
  } finally {
    stopAiProgress();
  }
}

function showHints(hints) {
  const model = codeEditor.getModel();
  // Ignore hints that point outside the current editor model.
  const validHints = hints.filter(hint => Number.isInteger(hint.line) && hint.line >= 1 && hint.line <= model.getLineCount()).slice(0, 1);
  if (!validHints.length) return false;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, validHints.map(hint => ({
    range: new monaco.Range(hint.line, 1, hint.line, model.getLineMaxColumn(hint.line)),
    options: lineDecorationOptions(model, hint.line, activeIssue?.category, `Hint: ${hint.message}`)
  })));
  codeEditor.revealLineInCenter(validHints[0].line);
  return true;
}

function clearHints() {
  if (!codeEditor) return;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, []);
  const model = codeEditor.getModel();
  if (model) monaco.editor.setModelMarkers(model, 'office-hours-prep', []);
}

function issueColorClass(category) {
  const value = String(category || '').toLowerCase();
  if (value.includes('logic')) return 'logic';
  if (value.includes('type')) return 'type';
  if (value.includes('compile') || value.includes('syntax')) return 'compile';
  return 'runtime';
}

function lineDecorationOptions(model, line, category, message) {
  const color = issueColorClass(category);
  return {
    isWholeLine: true,
    className: `issue-line-${color}`,
    after: {content: ' ?', inlineClassName: `issue-question-${color}`},
    hoverMessage: {value: `**${category || 'Issue'}:** ${message}`}
  };
}

function markLine(data, category = 'runtime') {
  activeIssue = rememberIssue({...activeIssue, category, line: data.line, message: data.error});
  const message = data.error || 'This line needs attention.';
  const model = codeEditor.getModel();
  codeEditor.deltaDecorations(hintDecorations, []);
  hintDecorations = codeEditor.deltaDecorations([], [{
    range: new monaco.Range(data.line, 1, data.line, model.getLineMaxColumn(data.line)),
    options: lineDecorationOptions(model, data.line, category, message)
  }]);
  codeEditor.revealLineInCenter(data.line);
}
