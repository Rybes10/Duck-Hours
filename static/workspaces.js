// Browser-local workspaces keep student files and test setup separate without sending them to the server.
const workspaceCatalogKey = 'office-hours-prep.workspaces.v1';
const legacyWorkspaceKey = 'office-hours-prep.workspace.v1';
const workspaceStateKey = id => `office-hours-prep.workspace.${id}.v1`;
let workspaceCatalog;
try {
  workspaceCatalog = JSON.parse(localStorage.getItem(workspaceCatalogKey) || 'null');
} catch {
  workspaceCatalog = null;
}
if (!workspaceCatalog || workspaceCatalog.version !== 1 || !Array.isArray(workspaceCatalog.workspaces)) {
  workspaceCatalog = {version: 1, activeId: null, workspaces: []};
  const legacyState = localStorage.getItem(legacyWorkspaceKey);
  if (legacyState) {
    const legacyWorkspace = {id: 'workspace-default', name: 'My workspace', updatedAt: new Date().toISOString()};
    workspaceCatalog.workspaces.push(legacyWorkspace);
    workspaceCatalog.activeId = legacyWorkspace.id;
    if (!localStorage.getItem(workspaceStateKey(legacyWorkspace.id))) {
      localStorage.setItem(workspaceStateKey(legacyWorkspace.id), legacyState);
    }
  }
  localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
}
if (!workspaceCatalog.workspaces.some(item => item.id === workspaceCatalog.activeId)) {
  workspaceCatalog.activeId = workspaceCatalog.workspaces[0]?.id || null;
  localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
}
let activeWorkspaceId = workspaceCatalog.activeId;
const homePage = window.location.hash === '#home';
document.body.classList.toggle('workspace-open', Boolean(activeWorkspaceId && !homePage));
let savedWorkspace = null;
try {
  savedWorkspace = JSON.parse(localStorage.getItem(workspaceStateKey(activeWorkspaceId)) || 'null');
  if (savedWorkspace?.version !== 1) savedWorkspace = null;
} catch {
  savedWorkspace = null;
}
if (savedWorkspace?.settings) {
  const settings = savedWorkspace.settings;
  for (const [selector, value] of Object.entries({
    '#intent': settings.intent, '#skip-logic': settings.skipLogicCheck,
    '#memory-limit': settings.memoryLimit,
    '#constraints': settings.constraints
  })) {
    const field = document.querySelector(selector);
    if (field && value !== undefined) {
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = value;
    }
  }
  const count = Number(settings.testCount);
  if (Number.isInteger(count)) window.savedTestCount = Math.max(1, Math.min(20, count));
}
if (Array.isArray(savedWorkspace?.testCases)) {
  for (const item of savedWorkspace.testCases) {
    if (!item || typeof item !== 'object') continue;
    testCases.push({
      ...item,
      files: Array.isArray(item.files) ? item.files : [],
      expectedFiles: Array.isArray(item.expectedFiles) ? item.expectedFiles : [],
      status: 'not-run', result: null
    });
  }
  nextTestCaseId = Math.max(1, ...testCases.map(item => Number(item.id) + 1).filter(Number.isFinite));
}

function allWorkspaceFiles() {
  return [...files, ...closedFiles];
}

let workspaceSaveTimer = null;
function saveWorkspaceNow() {
  if (!activeWorkspaceId || !codeEditor) return;
  const state = {
    version: 1,
    files: files.map(file => ({id: file.id, name: file.name, language: file.language, contents: file.model.getValue(), generated: Boolean(file.generated)})),
    closedFiles: closedFiles.map(file => ({id: file.id, name: file.name, language: file.language, contents: file.model.getValue(), generated: Boolean(file.generated)})),
    activeFileId, currentLanguage, nextFileNumber, nextTestCaseId,
    selection: codeEditor.getSelection?.(),
    testCases: testCases.map(({result, status, ...item}) => item),
    settings: {
      intent: document.querySelector('#intent').value,
      skipLogicCheck: Boolean(document.querySelector('#skip-logic')?.checked),
      memoryLimit: document.querySelector('#memory-limit').value,
      executionTimeout: document.querySelector('#execution-timeout')?.value || '10',
      constraints: document.querySelector('#constraints').value,
      testCount: document.querySelector('#testcase-request-count')?.value || 5
    }
  };
  try {
    localStorage.setItem(workspaceStateKey(activeWorkspaceId), JSON.stringify(state));
    const active = workspaceCatalog.workspaces.find(item => item.id === activeWorkspaceId);
    if (active) active.updatedAt = new Date().toISOString();
    localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
  } catch (error) {
    console.warn('This browser could not save the workspace.', error);
  }
}

function persistWorkspace() {
  clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(saveWorkspaceNow, 180);
}

function renderWorkspaceList() {
  const list = document.querySelector('#workspace-list');
  if (!list) return;
  list.replaceChildren();
  if (workspaceCatalog.workspaces.length === 0) {
    list.append(createElement('p', 'workspace-empty', 'No workspaces yet. Create one above to get started.'));
    return;
  }
  for (const workspace of workspaceCatalog.workspaces) {
    const row = createElement('div', 'workspace-entry-row');
    const open = createElement('button', 'workspace-entry', workspace.name);
    open.type = 'button';
    if (workspace.id === activeWorkspaceId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => openWorkspace(workspace.id));
    const remove = createElement('button', 'workspace-delete', 'Delete');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${workspace.name}`);
    remove.addEventListener('click', () => {
      if (!window.confirm(`Delete "${workspace.name}" and its saved files and tests?`)) return;
      localStorage.removeItem(workspaceStateKey(workspace.id));
      workspaceCatalog.workspaces = workspaceCatalog.workspaces.filter(item => item.id !== workspace.id);
      if (workspace.id === activeWorkspaceId) workspaceCatalog.activeId = workspaceCatalog.workspaces[0]?.id || null;
      localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
      if (workspace.id === activeWorkspaceId) {
        window.location.hash = workspaceCatalog.activeId ? '' : '#home';
        window.location.reload();
        return;
      }
      renderWorkspaceList();
    });
    row.append(open, remove);
    list.append(row);
  }
}

function renderStartWorkspaces() {
  const list = document.querySelector('#start-workspaces-list');
  if (!list) return;
  list.replaceChildren();
  if (workspaceCatalog.workspaces.length === 0) {
    list.append(createElement('p', 'start-workspaces-empty', 'You do not have any workspaces yet. Create one to start coding.'));
    return;
  }
  workspaceCatalog.workspaces.forEach(workspace => {
    const card = createElement('article', 'start-workspace-card');
    const details = createElement('div', 'start-workspace-details');
    details.append(createElement('strong', '', workspace.name), createElement('span', '', workspace.id === activeWorkspaceId ? 'Last opened workspace' : 'Saved workspace'));
    const actions = createElement('div', 'start-workspace-actions');
    const open = createElement('button', 'start-workspace-open', 'Open');
    open.type = 'button';
    open.addEventListener('click', () => openWorkspace(workspace.id));
    const remove = createElement('button', 'start-workspace-delete', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () => deleteWorkspace(workspace));
    actions.append(open, remove);
    card.append(details, actions);
    list.append(card);
  });
}

function openWorkspace(workspaceId) {
  saveWorkspaceNow();
  workspaceCatalog.activeId = workspaceId;
  localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
  window.location.hash = '';
  window.location.reload();
}

function deleteWorkspace(workspace) {
  if (!window.confirm(`Delete "${workspace.name}" and its saved files and tests?`)) return;
  localStorage.removeItem(workspaceStateKey(workspace.id));
  workspaceCatalog.workspaces = workspaceCatalog.workspaces.filter(item => item.id !== workspace.id);
  if (workspace.id === workspaceCatalog.activeId) workspaceCatalog.activeId = workspaceCatalog.workspaces[0]?.id || null;
  localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
  if (workspace.id === activeWorkspaceId) {
    window.location.hash = workspaceCatalog.activeId ? '' : '#home';
    window.location.reload();
    return;
  }
  renderStartWorkspaces();
  renderWorkspaceList();
}

const workspaceManagerButton = createElement('button', 'workspace-manager', 'Workspaces');
workspaceManagerButton.id = 'workspace-manager';
workspaceManagerButton.type = 'button';
document.querySelector('.editor-toolbar').insertBefore(workspaceManagerButton, runButton);
const workspaceDialog = createElement('dialog', 'workspace-dialog');
workspaceDialog.id = 'workspace-dialog';
const dialogHeading = createElement('h2', '', 'Your workspaces');
const workspaceNameLabel = createElement('label', 'workspace-name-label', 'Workspace name');
workspaceNameLabel.htmlFor = 'workspace-name';
const workspaceName = createElement('input', 'workspace-name');
workspaceName.id = 'workspace-name';
workspaceName.placeholder = 'New workspace name';
workspaceName.setAttribute('aria-label', 'New workspace name');
workspaceName.autocomplete = 'off';
const createWorkspaceButton = createElement('button', 'workspace-create', 'Create workspace');
createWorkspaceButton.id = 'workspace-create';
createWorkspaceButton.type = 'button';
const workspaceList = createElement('div', 'workspace-list');
workspaceList.id = 'workspace-list';
const closeWorkspaceButton = createElement('button', 'workspace-close', 'Close');
closeWorkspaceButton.id = 'workspace-close';
closeWorkspaceButton.type = 'button';
workspaceDialog.append(dialogHeading, workspaceNameLabel, workspaceName, createWorkspaceButton, workspaceList, closeWorkspaceButton);
document.body.append(workspaceDialog);
function showWorkspaceDialog(mode = 'manage') {
  const creating = mode === 'create';
  dialogHeading.textContent = creating ? 'Create a workspace' : 'Your workspaces';
  workspaceList.hidden = creating;
  createWorkspaceButton.textContent = creating ? 'Create workspace' : 'Create workspace';
  workspaceName.value = '';
  workspaceDialog.showModal();
  workspaceName.focus();
}
document.querySelector('#workspace-manager')?.addEventListener('click', () => {
  saveWorkspaceNow();
  window.location.hash = '#home';
  window.location.reload();
});
document.querySelector('#workspace-close')?.addEventListener('click', () => workspaceDialog.close());
document.querySelector('#create-project')?.addEventListener('click', () => {
  showWorkspaceDialog('create');
});
document.querySelector('#workspace-create')?.addEventListener('click', () => {
  saveWorkspaceNow();
  const name = document.querySelector('#workspace-name').value.trim().slice(0, 60) || `Workspace ${workspaceCatalog.workspaces.length + 1}`;
  const id = `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  workspaceCatalog.workspaces.push({id, name, updatedAt: new Date().toISOString()});
  workspaceCatalog.activeId = id;
  localStorage.setItem(workspaceCatalogKey, JSON.stringify(workspaceCatalog));
  window.location.hash = '';
  window.location.reload();
});
workspaceName.addEventListener('keydown', event => {
  if (event.key === 'Enter') createWorkspaceButton.click();
});
document.querySelector('.brand')?.addEventListener('click', event => {
  event.preventDefault();
  saveWorkspaceNow();
  window.location.hash = '#home';
  window.location.reload();
});
document.addEventListener('input', event => {
  if (event.target.matches('#intent,#constraints,#testcase-request-count')) persistWorkspace();
});
document.addEventListener('change', event => {
  if (event.target.matches('#memory-limit,#skip-logic,#execution-timeout')) persistWorkspace();
});
window.addEventListener('beforeunload', saveWorkspaceNow);

renderStartWorkspaces();
