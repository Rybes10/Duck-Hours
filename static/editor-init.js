// Rebuild Monaco models from the saved workspace before showing tabs, preserving closed files without opening them automatically.
require(['vs/editor/editor.main'], () => {
  if (savedWorkspace && Array.isArray(savedWorkspace.files)) {
    savedWorkspace.files.slice(0, 20).forEach(file => {
      if (!file || typeof file.name !== 'string' || typeof file.language !== 'string') return;
      const model = monaco.editor.createModel(String(file.contents || ''), file.language);
      files.push({id: String(file.id || `file-${nextFileNumber++}`), name: file.name, language: file.language, model, generated: Boolean(file.generated)});
    });
    (savedWorkspace.closedFiles || []).slice(0, 20 - files.length).forEach(file => {
      if (!file || typeof file.name !== 'string' || typeof file.language !== 'string') return;
      const model = monaco.editor.createModel(String(file.contents || ''), file.language);
      closedFiles.push({id: String(file.id || `file-${nextFileNumber++}`), name: file.name, language: file.language, model, generated: Boolean(file.generated)});
    });
    nextFileNumber = Math.max(nextFileNumber, Number(savedWorkspace.nextFileNumber) || 1, ...allWorkspaceFiles().map(file => Number(String(file.id).match(/(\d+)$/)?.[1]) + 1 || 1));
    activeFileId = files.some(file => file.id === savedWorkspace.activeFileId) ? savedWorkspace.activeFileId : (files.find(file => !file.generated)?.id ?? files[0]?.id ?? null);
    currentLanguage = savedWorkspace.currentLanguage || files.find(file => file.id === activeFileId)?.language || 'python';
  } else {
    const initialModel = monaco.editor.createModel(examples.python, 'python');
    files.push({id: 'file-0', name: 'main.py', language: 'python', model: initialModel});
    activeFileId = 'file-0';
  }
  const activeFile = files.find(file => file.id === activeFileId);
  languageSelect.value = activeFile?.language || currentLanguage;
  codeEditor = monaco.editor.create(editorContainer, {
    model: activeFile?.model ?? null,
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
  codeEditor.onDidChangeModelContent(persistWorkspace);
  editorEmptyState.hidden = true;
  editorContainer.append(editorEmptyState);
  document.querySelector('.editor-loading')?.remove();
  renderFileTabs();
  updateFileControls();
  renderTestCases();
});

