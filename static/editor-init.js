const editorHeightStorageKey = 'office-hours-prep.editor-height.v1';
const editorMinimumHeight = 240;
const editorMaximumHeight = 900;

function readEditorHeight() {
  try {
    const raw = localStorage.getItem(editorHeightStorageKey);
    if (raw === null) return null;
    const saved = Number(raw);
    return Number.isFinite(saved) ? saved : null;
  } catch {
    return null;
  }
}

function editorHeightLimit() {
  const viewportHeight = window.innerHeight || 800;
  return Math.max(editorMinimumHeight, Math.min(editorMaximumHeight, Math.floor(viewportHeight * 0.9)));
}

function updateEditorResizeHandle(handle, height) {
  if (!handle) return;
  handle.setAttribute('aria-valuenow', String(Math.round(height)));
  handle.setAttribute('aria-valuemax', String(editorHeightLimit()));
}

function setEditorHeight(height, {save = true} = {}) {
  const editorCard = editorContainer?.closest('.editor-card');
  const handle = document.querySelector('.editor-vertical-resize-handle');
  if (!editorCard) return;
  const nextHeight = Math.round(Math.max(editorMinimumHeight, Math.min(editorHeightLimit(), Number(height) || editorMinimumHeight)));
  editorCard.classList.add('editor-height-resized');
  editorCard.style.setProperty('--code-editor-height', `${nextHeight}px`);
  updateEditorResizeHandle(handle, nextHeight);
  if (save) {
    try { localStorage.setItem(editorHeightStorageKey, String(nextHeight)); } catch {}
  }
  codeEditor?.layout();
}

function setupEditorVerticalResizing() {
  const editorCard = editorContainer?.closest('.editor-card');
  if (!editorCard || editorCard.querySelector('.editor-vertical-resize-handle')) return;
  const handle = createElement('button', 'editor-vertical-resize-handle');
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Resize code window');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-valuemin', String(editorMinimumHeight));
  handle.title = 'Drag to make the code window taller or shorter';
  editorContainer.after(handle);
  updateEditorResizeHandle(handle, editorContainer.getBoundingClientRect().height);

  const savedHeight = readEditorHeight();
  if (savedHeight !== null) setEditorHeight(savedHeight, {save: false});

  let resizeState = null;
  const finishResize = event => {
    if (!resizeState) return;
    if (event && handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    resizeState = null;
    document.body.classList.remove('resizing-code-window');
  };
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    resizeState = {startY: event.clientY, startHeight: editorContainer.getBoundingClientRect().height};
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing-code-window');
  });
  handle.addEventListener('pointermove', event => {
    if (!resizeState) return;
    setEditorHeight(resizeState.startHeight + event.clientY - resizeState.startY);
  });
  handle.addEventListener('pointerup', finishResize);
  handle.addEventListener('pointercancel', finishResize);
  handle.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = editorContainer.getBoundingClientRect().height;
    const next = event.key === 'ArrowUp' ? current - 16
      : event.key === 'ArrowDown' ? current + 16
        : event.key === 'Home' ? editorMinimumHeight : editorHeightLimit();
    setEditorHeight(next);
  });
  window.addEventListener('resize', () => {
    if (!editorCard.classList.contains('editor-height-resized')) {
      updateEditorResizeHandle(handle, editorContainer.getBoundingClientRect().height);
      return;
    }
    setEditorHeight(editorContainer.getBoundingClientRect().height, {save: false});
  });
}

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
    fixedOverflowWidgets: true,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    padding: {top: 14, bottom: 14}
  });
  codeEditor.updateOptions({readOnly: Boolean(activeFile?.generated)});
  languageSelect.disabled = Boolean(activeFile?.generated);
  if (savedWorkspace?.selection && activeFile) codeEditor.setSelection(savedWorkspace.selection);
  editorEmptyState.hidden = files.length > 0;
  editorContainer.append(editorEmptyState);
  setupEditorVerticalResizing();
  document.querySelector('.editor-loading')?.remove();
  codeEditor.onDidChangeCursorSelection(() => {
    updateTestGenerationContextVisibility();
    const targetSummary = document.querySelector('#testcase-target-summary');
    if (targetSummary) targetSummary.textContent = hasEditorSelection()
      ? 'Selection ready. Generate tests to check this method.'
      : 'No method selected yet.';
    markTestCasesOutdated();
    window.scheduleTestTargetValidation?.();
  });
  codeEditor.onDidChangeModelContent(() => {
    markTestCasesOutdated();
    persistWorkspace();
    window.scheduleTestTargetValidation?.();
  });
  codeEditor.onDidChangeCursorSelection(persistWorkspace);
  renderFileTabs();
  updateTestGenerationContextVisibility();
  updateFileControls();
  renderTestCases();
});
