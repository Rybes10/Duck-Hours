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
    const response = await fetch('/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      active_file: files.find(file => file.id === activeFileId)?.name || 'main.py',
      files: allWorkspaceFiles().filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
      stdin: '',
      memory_limit_mb: Number(document.querySelector('#memory-limit').value) || null,
      intent: getRunIntent()
    })});
    const data = await parseApiResponse(response, 'The code could not be run.');
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
    `Time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
    `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
    `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
  ].join('\n');
}

function setCheckStatus(id, state, message) {
  const indicator = document.querySelector(`#${id}`);
  indicator.dataset.state = state;
  indicator.textContent = message;
}

function evaluateRunChecks(elapsedMs, runSucceeded, data = {}) {
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
  return `<span class="output-note">Office Hours Prep created ${cases || 'some'} automatic test case${cases === 1 ? '' : 's'} for <code>${functionName}</code> and ran them behind the scenes.${caseDescription}</span>`;
}

function targetNotice(data) {
  if (!data?.target_banner) return '';
  return `<span class="target-notice-title">${escapeHtml(data.target_banner)}</span><span class="target-notice-details">${escapeHtml(data.target_explanation || 'You can add an entry point or use the test-case panel to generate one.')}</span>`;
}

function harnessPreview(data) {
  if (!data?.harness_code) return '';
  return `<details class="inline-harness-preview"><summary>View the separate test harness</summary><pre>${escapeHtml(data.harness_code)}</pre></details>`;
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
    activeIssue = rememberIssue({category: 'Compile', line: data.line, message: data.error || data.output || ''});
    output.className = 'output-box error';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">The code did not compile.</span><span class="output-note">${escapeHtml(issueProgressMessage(previousIssue, activeIssue))}</span>${automaticTestNote(data)}${harnessPreview(data)}${errorGuideLink(data.error_type || 'compile')}${issueActions()}`;
    outputStatus.textContent = 'Hint available';
    bindIssueActions();
    return;
  }
  if (data.status === 'harness_error') {
    activeIssue = null;
    output.className = 'output-box error';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">The generated test harness has an issue.</span><span class="output-details">${escapeHtml(data.error || data.output || 'The wrapper could not be compiled or run.')}</span><span class="output-note">This message is about Office Hours Prep’s temporary wrapper, not a line in your submitted code. Review the generated harness in the Testcases panel and try again.</span>`;
    outputStatus.textContent = 'Harness needs attention';
    return;
  }
  if (data.status === 'runtime_error') {
    if (data.target_kind === 'method' && data.target_banner) {
      activeIssue = null;
      output.className = 'output-box runtime';
      output.innerHTML = `${targetNotice(data)}<span class="output-title">The original submission has no entry point.</span><span class="output-details">Use the Testcases tab to test this method with a generated wrapper.</span>${errorGuideLink(data.error_type || 'runtime')}`;
      outputStatus.textContent = 'Method testing available';
      return;
    }
    activeIssue = rememberIssue({category: 'Runtime', line: data.line, message: data.error || data.output || ''});
    output.className = 'output-box runtime';
    output.innerHTML = `${targetNotice(data)}<span class="output-title">The program stopped while running.</span><span class="output-note">${escapeHtml(issueProgressMessage(previousIssue, activeIssue))}</span>${automaticTestNote(data)}${harnessPreview(data)}${errorGuideLink(data.error_type || 'runtime')}${issueActions()}`;
    outputStatus.textContent = 'Hint available';
    bindIssueActions();
    return;
  }
  const details = data.output || data.error || 'No details were returned.';
  output.className = `output-box ${data.status === 'unavailable' ? 'error' : 'runtime'}`;
  output.innerHTML = `${targetNotice(data)}<span class="output-title">${data.status === 'unavailable' ? 'This language is not ready on this computer' : 'The program stopped while running'}</span><span class="output-details">${escapeHtml(details)}</span><span class="output-note">${escapeHtml(data.error || '')}</span>${errorGuideLink(data.error_type || 'runtime')}`;
  outputStatus.textContent = 'Needs attention';
}

async function checkLogicAfterRun(previousIssue) {
  if (document.querySelector('#skip-logic')?.checked) {
    activeIssue = null;
    if (previousIssue && issueColorClass(previousIssue.category) !== 'logic') {
      output.className = 'output-box success';
      output.innerHTML = `<span class="output-title">Nice work — the previous issue is fixed</span><span class="output-details">${escapeHtml(lastRun.output || '(The program ran successfully but printed no output.)')}</span><span class="output-note">The earlier ${escapeHtml(previousIssue.category || 'code')} issue is no longer happening. The logic check was skipped for this run.</span>${automaticTestNote(lastRun)}`;
      outputStatus.textContent = 'Fixed · logic skipped';
    } else {
      outputStatus.textContent = 'Success · logic skipped';
      output.insertAdjacentHTML('beforeend', `<span class="output-note">The code ran successfully. The logic check was skipped for this run.</span>`);
    }
    return;
  }
  outputStatus.textContent = 'Checking logic…';
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
    if (!response.ok) throw new Error(data.detail || 'Meta could not check the program logic.');
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
      output.innerHTML = `<span class="output-title">Nice work — issue fixed</span><span class="output-details">${escapeHtml(lastRun.output || '(The program ran successfully but printed no output.)')}</span><span class="output-note">The previous ${escapeHtml(previousIssue.category || 'code')} issue is no longer happening because the program now runs successfully. Meta found no remaining logic issues.</span>${automaticTestNote(lastRun)}`;
      outputStatus.textContent = 'Fixed';
    } else {
      outputStatus.textContent = 'Success · logic checked';
    }
  } catch (error) {
    outputStatus.textContent = 'Success · logic not checked';
    output.insertAdjacentHTML('beforeend', `<span class="output-note">The code ran successfully, but Meta could not finish the logic check.</span>`);
  }
}

function sameIssue(previousIssue, issue) {
  if (!previousIssue || !issue) return false;
  const sameCategory = issueColorClass(previousIssue.category) === issueColorClass(issue.category);
  const sameLine = previousIssue.line && issue.line && previousIssue.line === issue.line;
  const previousTitle = String(previousIssue.title || '').toLowerCase();
  const nextTitle = String(issue.title || '').toLowerCase();
  return sameCategory && (sameLine || (previousTitle && nextTitle && previousTitle === nextTitle));
}

function showLogicIssue(issue, count, rewarded) {
  output.className = 'output-box logic';
  const issueCount = `${count} issue${count === 1 ? '' : 's'} remaining`;
  const title = rewarded ? `Nice work — one issue fixed. ${issueCount}.` : `${issueCount}: next issue`;
  output.innerHTML = `<span class="output-title">${escapeHtml(title)}</span><span class="output-details">${escapeHtml(issue.title || 'The result may not match the program purpose.')}</span><span class="output-note">Why: ${escapeHtml(issue.explanation || 'This may not match the stated purpose.')} Fix direction: ${escapeHtml(issue.fix || 'Compare the result with the purpose and constraints.')}</span>${errorGuideLink(issue.category || 'logic')}${issueActions()}`;
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
  try {
    const response = await fetch('/api/hint', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage,
      code: codeEditor.getValue(),
      intent: document.querySelector('#intent').value,
      compiler_error: [lastRun.output, lastRun.error, activeIssue?.title, activeIssue?.explanation, activeIssue?.message].filter(Boolean).join('\n')
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Meta could not provide a hint.');
    if (!data.hints || data.hints.length === 0) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">Meta could not identify a clear line yet.</span>');
      return;
    }
    const hint = data.hints[0];
    activeIssue = rememberIssue({...activeIssue, line: hint.line, message: hint.message});
    if (!showHints([hint])) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">Meta returned a line that is not in the current code.</span>');
      return;
    }
    addFixAction();
    output.insertAdjacentHTML('beforeend', `<span class="output-note">Hint: ${escapeHtml(hint.message)}</span>`);
    hintButton.textContent = 'Hint added to editor';
  } catch (error) {
    hintButton.disabled = false;
    hintButton.textContent = '? Give me a hint';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">Meta could not provide a hint right now.</span>');
  }
}

async function requestFix() {
  if (!codeEditor || !lastRun) return;
  const fixButton = document.querySelector('#fix');
  if (!fixButton) return;
  const originalCode = codeEditor.getValue();
  fixButton.disabled = true;
  fixButton.textContent = 'Preparing a fix…';
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
    if (!response.ok) throw new Error(data.detail || 'Meta could not prepare a fix.');
    if (!data.code || !String(data.code).trim()) throw new Error('Meta returned an empty fix.');
    if (data.code === originalCode) {
      fixButton.disabled = false;
      fixButton.textContent = 'Fix it for me';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">Meta did not suggest a change. Try another hint.</span>');
      return;
    }
    codeEditor.setValue(data.code);
    clearHints();
    output.className = 'output-box success';
    output.innerHTML = `<span class="output-title">A possible fix is ready.</span><span class="output-details">${escapeHtml(data.explanation || 'Meta changed the code to address the reported issue.')}</span><span class="output-note">Review the change, then press Run to check whether it fixed the issue.</span><button id="fix" class="fix-button" type="button" disabled>Fix applied — press Run</button>`;
    outputStatus.textContent = 'Review fix';
  } catch (error) {
    fixButton.disabled = false;
    fixButton.textContent = 'Fix it for me';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">Meta could not prepare a fix right now. You can keep editing or ask for a hint.</span>');
  }
}

function showHints(hints) {
  const model = codeEditor.getModel();
  const validHints = hints.filter(hint => Number.isInteger(hint.line) && hint.line >= 1 && hint.line <= model.getLineCount()).slice(0, 1);
  if (!validHints.length) return false;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, validHints.map(hint => ({
    range: new monaco.Range(hint.line, 1, hint.line, model.getLineMaxColumn(hint.line)),
    options: lineDecorationOptions(model, hint.line, activeIssue?.category, `Hint: ${hint.message}`)
  })));
  monaco.editor.setModelMarkers(model, 'office-hours-prep', validHints.map(hint => ({
    startLineNumber: hint.line,
    endLineNumber: hint.line,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(hint.line),
    // The custom decoration owns the beginner-friendly hover. Keep the
    // marker for the underline without opening Monaco's raw diagnostic box.
    message: '',
    severity: activeIssue?.category?.toLowerCase() === 'logic' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error
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
  monaco.editor.setModelMarkers(model, 'office-hours-prep', [{
    startLineNumber: data.line,
    endLineNumber: data.line,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(data.line),
    // The custom decoration owns the beginner-friendly hover.
    message: '',
    severity: data.status === 'compile_error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
  }]);
  codeEditor.revealLineInCenter(data.line);
}
