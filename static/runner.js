// Normal runs send the whole workspace snapshot; the active file executes while returned requirement issues stay below the editor.
runButton.addEventListener('click', async () => {
  if (!codeEditor || !codeEditor.getModel() || files.length === 0) return;
  const runFileId = activeFileId;
  document.body.classList.remove('testcase-results-open');
  renderConstraintResults([]);
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
      stdin: document.querySelector('#stdin').value,
      memory_limit_mb: Number(document.querySelector('#memory-limit').value) || null,
      intent: [
        `Program purpose: ${document.querySelector('#intent').value.trim() || 'Not specified'}`,
        `Per-case time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
        `Per-case memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
        `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
      ].join('\n')
    })});
    const data = await parseApiResponse(response, 'The code could not be run.');
    if (activeFileId !== runFileId) return;
    showGeneratedFiles(data.generated_files || []);
    lastRun = data;
    const elapsedMs = performance.now() - runStartedAt;
    const caseIssues = evaluateCaseLimits(elapsedMs, data);
    const programIssues = evaluateProgramRequirements([{
      name: 'Run',
      passed: data.status === 'success',
      memoryMeasured: Number.isFinite(data.memory_usage_bytes)
    }]);
    renderConstraintResults([...caseIssues, ...programIssues]);
    showRunResult(data);
    if (data.line) markLine(data);
  } catch (error) {
    renderConstraintResults([
      {type: 'error', title: 'Execution', detail: error.message},
      ...evaluateCaseLimits(performance.now() - runStartedAt),
      ...evaluateProgramRequirements([{name: 'Run', passed: false, memoryMeasured: false}])
    ]);
    output.className = 'output-box error';
    output.innerHTML = `<span class="output-title">Could not run the code</span><span class="output-details">${escapeHtml(error.message)}</span>`;
    outputStatus.textContent = 'Error';
  } finally {
    updateFileControls();
    runButton.textContent = '▶ Run';
  }
});

// Time and sampled memory limits are per execution, including each individual testcase run.
function evaluateCaseLimits(elapsedMs, data = {}) {
  const issues = [];
  const timeLimit = Number(document.querySelector('#time-limit').value);
  if (timeLimit && elapsedMs > timeLimit * 1000) {
    issues.push({type: 'error', title: 'Time limit', detail: `This run took ${Math.round(elapsedMs)} ms; per-case limit is ${timeLimit} s.`});
  }
  if (data.memory_limit_exceeded) {
    const memoryMb = (data.memory_usage_bytes / (1024 * 1024)).toFixed(1);
    issues.push({type: 'error', title: 'Memory limit', detail: `This case used about ${memoryMb} MB; per-case limit is ${document.querySelector('#memory-limit').value} MB.`});
  }
  return issues;
}

function evaluateProgramRequirements(runs) {
  const issues = [];
  const failedRuns = runs.filter(run => !run.passed);
  if (failedRuns.length) {
    const names = failedRuns.map(run => run.name).join(', ');
    issues.push({type: 'error', title: 'Program execution', detail: `${failedRuns.length} of ${runs.length} run${runs.length === 1 ? '' : 's'} failed${names ? `: ${names}` : ''}.`});
  }
  const memoryLimit = document.querySelector('#memory-limit').value;
  const unmeasuredRuns = runs.filter(run => !run.memoryMeasured);
  if (memoryLimit && unmeasuredRuns.length) {
    issues.push({type: 'review', title: 'Memory limit', detail: `Memory could not be measured for ${unmeasuredRuns.map(run => run.name).join(', ')}.`});
  }
  const otherConstraints = document.querySelector('#constraints').value.trim();
  if (otherConstraints) {
    issues.push({type: 'review', title: 'Other program requirements', detail: `Review against the whole program: ${otherConstraints}`});
  }
  return issues;
}

function renderConstraintResults(issues) {
  const panel = document.querySelector('#constraint-results');
  if (!panel) return;
  panel.replaceChildren();
  panel.hidden = issues.length === 0;
  if (!issues.length) return;
  panel.className = `constraint-results ${issues.some(issue => issue.type === 'error') ? 'has-errors' : 'needs-review'}`;
  panel.append(createElement('h3', '', 'Requirement issues'));
  issues.forEach(issue => {
    const row = createElement('div', `constraint-issue ${issue.type}`);
    row.append(createElement('strong', '', issue.title), createElement('span', '', issue.detail));
    panel.append(row);
  });
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
    const data = await parseApiResponse(response, 'Gemini could not provide a hint.');
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
  const model = codeEditor.getModel();
  if (model) monaco.editor.setModelMarkers(model, 'office-hours-prep', []);
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

