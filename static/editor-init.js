require(['vs/editor/editor.main'], () => {
  const initialModel = monaco.editor.createModel(examples.python, 'python');
  files.push({id: 'file-0', name: 'main.py', language: 'python', model: initialModel});
  codeEditor = monaco.editor.create(editorContainer, {
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
  editorEmptyState.hidden = true;
  editorContainer.append(editorEmptyState);
  document.querySelector('.editor-loading')?.remove();
  renderFileTabs();
  updateFileControls();
  renderTestCases();
});

