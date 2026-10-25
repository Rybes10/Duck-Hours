runButton.addEventListener('click', async () => {
  if (!codeEditor || !codeEditor.getModel() || files.length === 0) return;
  const runFileId = activeFileId;
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
      files: files.filter(file => !file.generated).map(file => ({name: file.name, code: file.model.getValue()})),
      intent: [
        `Program purpose: ${document.querySelector('#intent').value.trim() || 'Not specified'}`,
        `Time limit: ${document.querySelector('#time-limit').value || 'Not specified'}`,
        `Memory limit: ${document.querySelector('#memory-limit').value || 'Not specified'}`,
        `Expected input size: ${document.querySelector('#input-size').value || 'Not specified'}`,
        `Other constraints: ${document.querySelector('#constraints').value.trim() || 'None specified'}`
      ].join('\n')
    })});
    const data = await response.json();
    if (activeFileId !== runFileId) return;
    if (!response.ok) throw new Error(data.detail || 'The code could not be run.');
    showGeneratedFiles(data.generated_files || []);
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
    updateFileControls();
    runButton.textContent = '▶ Run';
  }
});

function setCheckStatus(id, state, message) {
  const indicator = document.querySelector(`#${id}`);
  indicator.dataset.state = state;
  indicator.textContent = message;
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

