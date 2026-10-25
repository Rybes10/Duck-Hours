require(['vs/editor/editor.main'], () => {
  if (savedWorkspace && Array.isArray(savedWorkspace.files)) {
    for (const record of savedWorkspace.files.slice(0, 20)) {
      if (!record || typeof record.name !== 'string' || typeof record.language !== 'string') continue;
      const model = monaco.editor.createModel(String(record.contents || ''), record.language);
      files.push({id: String(record.id), name: record.name, language: record.language, model, generated: Boolean(record.generated)});
    }
    for (const record of (savedWorkspace.closedFiles || []).slice(0, 20 - files.length)) {
      if (!record || typeof record.name !== 'string' || typeof record.language !== 'string') continue;
      const model = monaco.editor.createModel(String(record.contents || ''), record.language);
      closedFiles.push({id: String(record.id), name: record.name, language: record.language, model, generated: Boolean(record.generated)});
    }
    nextFileNumber = Math.max(1, Number(savedWorkspace.nextFileNumber) || 1);
    activeFileId = files.some(file => file.id === savedWorkspace.activeFileId)
      ? savedWorkspace.activeFileId : (files.find(file => !file.generated)?.id || files[0]?.id || null);
    currentLanguage = files.find(file => file.id === activeFileId)?.language || 'python';
  } else {
    const initialModel = monaco.editor.createModel(examples.python, 'python');
    files.push({id: 'file-0', name: 'main.py', language: 'python', model: initialModel});
  }
  const activeFile = files.find(file => file.id === activeFileId);
  languageSelect.value = activeFile?.language || currentLanguage;
  codeEditor = monaco.editor.create(editorContainer, {
    model: activeFile?.model || null,
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
  codeEditor.updateOptions({readOnly: Boolean(activeFile?.generated)});
  languageSelect.disabled = Boolean(activeFile?.generated);
  if (savedWorkspace?.selection && activeFile) codeEditor.setSelection(savedWorkspace.selection);
  editorEmptyState.hidden = files.length > 0;
  editorContainer.append(editorEmptyState);
  document.querySelector('.editor-loading')?.remove();
  codeEditor.onDidChangeCursorSelection(() => {
    const targetSummary = document.querySelector('#testcase-target-summary');
    if (targetSummary) targetSummary.textContent = hasEditorSelection()
      ? 'Selection ready. Generate tests to check this method.'
      : 'No method selected yet.';
    markTestCasesOutdated();
  });
  codeEditor.onDidChangeModelContent(() => {
    markTestCasesOutdated();
    persistWorkspace();
  });
  codeEditor.onDidChangeCursorSelection(persistWorkspace);
  renderFileTabs();
  updateFileControls();
  renderTestCases();
});
