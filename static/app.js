let codeEditor = null;
let currentLanguage = 'python';
let lastRun = null;
let hintDecorations = [];
const runButton = document.querySelector('#run');
const output = document.querySelector('#output');
const outputStatus = document.querySelector('#output-status');
const languageSelect = document.querySelector('#language');
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

require(['vs/editor/editor.main'], () => {
  codeEditor = monaco.editor.create(document.querySelector('#editor'), {
    value: examples.python,
    language: 'python',
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
});

document.querySelector('#create-project').addEventListener('click', () => {
  document.querySelector('#intro').classList.add('hidden');
  document.querySelector('#workspace').classList.remove('hidden');
  if (codeEditor) codeEditor.layout();
});

languageSelect.addEventListener('change', () => {
  currentLanguage = languageSelect.value;
  if (!codeEditor) return;
  codeEditor.setValue(examples[currentLanguage]);
  monaco.editor.setModelLanguage(codeEditor.getModel(), currentLanguage === 'cpp' ? 'cpp' : currentLanguage);
  lastRun = null;
  clearHints();
  output.className = 'output-box';
  output.textContent = `Ready to run ${languageSelect.options[languageSelect.selectedIndex].text}.`;
  outputStatus.textContent = 'Ready';
});

runButton.addEventListener('click', async () => {
  if (!codeEditor) return;
  runButton.disabled = true;
  runButton.textContent = 'Running…';
  output.className = 'output-box';
  output.textContent = 'Running locally…';
  outputStatus.textContent = 'Running';
  lastRun = null;
  clearHints();
  try {
    // Keep the source and selected language together in the run request.
    const response = await fetch('/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      language: currentLanguage, code: codeEditor.getValue(), stdin: '', intent: document.querySelector('#intent').value
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'The code could not be run.');
    lastRun = data;
    showRunResult(data);
  } catch (error) {
    output.className = 'output-box error';
    output.innerHTML = `<span class="output-title">Could not run the code</span><span class="output-details">${escapeHtml(error.message)}</span>`;
    outputStatus.textContent = 'Error';
  } finally {
    runButton.disabled = false;
    runButton.textContent = '▶ Run';
  }
});

function showRunResult(data) {
  if (data.status === 'success') {
    output.className = 'output-box';
    output.textContent = data.output || '(The program ran successfully but printed no output.)';
    outputStatus.textContent = 'Success';
    return;
  }
  if (data.status === 'compile_error') {
    // Offer hints only for compile errors, which can identify a source line.
    output.className = 'output-box error';
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
      compiler_error: lastRun.output || lastRun.error || '',
      // The backend may not be able to associate every error with a line.
      line: lastRun.line || null
    })});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'A hint could not be provided.');
    if (!data.hints || data.hints.length === 0) {
      hintButton.disabled = false;
      hintButton.textContent = '? Give me a hint';
      output.insertAdjacentHTML('beforeend', '<span class="output-note">A clear line could not be identified yet.</span>');
      return;
    }
    showHints(data.hints);
    hintButton.textContent = 'Hint added to editor';
  } catch (error) {
    hintButton.disabled = false;
    hintButton.textContent = '? Give me a hint';
    output.insertAdjacentHTML('beforeend', '<span class="output-note">A hint is not available right now.</span>');
  }
}

function showHints(hints) {
  const model = codeEditor.getModel();
  // Replace existing decorations so repeated hints do not accumulate markers.
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, hints.map(hint => ({
    range: new monaco.Range(hint.line, 1, hint.line, 1),
    options: {
      isWholeLine: true,
      className: 'hint-line',
      glyphMarginClassName: 'hint-glyph',
      glyphMarginHoverMessage: {value: `**Hint:** ${hint.message}`}
    }
  })));
  codeEditor.revealLineInCenter(hints[0].line);
}

function clearHints() {
  if (!codeEditor) return;
  hintDecorations = codeEditor.deltaDecorations(hintDecorations, []);
  monaco.editor.setModelMarkers(codeEditor.getModel(), 'office-hours-prep', []);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}
