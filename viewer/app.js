/* pr-timeline viewer: step through an atomized branch change-by-change. */
'use strict';

require.config({ paths: { vs: '/vs' } });

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const THEMES = ['clean', 'linear', 'player'];
const EDITOR_BG = { clean: '#1a1a1d', linear: '#131316', player: '#161619' };
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let theme = store?.getItem('prtl-theme');
if (!THEMES.includes(theme)) theme = 'clean';
document.body.dataset.theme = theme;

const state = {
  timeline: null,
  frames: [],        // one frame per (commit, file), in replay order
  frameIdx: 0,
  changes: [],       // monaco line changes for the current frame
  changeIdx: 0,
  navToken: 0,
  fileCache: new Map(),
  models: [],
  decorations: [],
  foldUnchanged: false,
  showBody: true,
};

let monacoApi = null;
let diffEditor = null;

require(['vs/editor/editor.main'], () => {
  monacoApi = window.monaco;
  init().catch((err) => {
    $('placeholder').hidden = false;
    $('placeholder').textContent = String(err.message ?? err);
  });
});

async function init() {
  const res = await fetch('/api/timeline');
  if (!res.ok) throw new Error(`timeline failed: ${res.status}`);
  state.timeline = await res.json();

  state.timeline.commits.forEach((commit, c) => {
    commit.files.forEach((file, f) => {
      state.frames.push({ c, f, commit, file });
    });
  });
  if (!state.frames.length) throw new Error('no commits to replay on this branch');

  setupMonaco();
  renderScrubber();
  renderRailCommits();
  bindKeys();
  document.title = `${state.timeline.branch} · pr-timeline`;
  $('branch').textContent = `${state.timeline.repo} · ${state.timeline.branch}`;

  const start = parseHash() ?? { frame: 0, change: 0 };
  await loadFrame(start.frame, start.change);
}

function setupMonaco() {
  const m = monacoApi;
  // single-file views: semantic errors are noise, not signal
  for (const lang of ['typescriptDefaults', 'javascriptDefaults']) {
    m.languages.typescript?.[lang]?.setDiagnosticsOptions({
      noSemanticValidation: true, noSyntaxValidation: true,
    });
  }
  for (const t of THEMES) {
    m.editor.defineTheme(`replay-${t}`, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': EDITOR_BG[t],
        'editorGutter.background': EDITOR_BG[t],
        'editorLineNumber.foreground': '#45454d',
        'editorLineNumber.activeForeground': '#77777d',
        'diffEditor.insertedLineBackground': '#1f341f66',
        'diffEditor.insertedTextBackground': '#2ea04326',
        'diffEditor.removedLineBackground': '#3c202066',
        'diffEditor.removedTextBackground': '#e05f5f21',
        'scrollbarSlider.background': '#3d3d4455',
        'scrollbarSlider.hoverBackground': '#3d3d4488',
      },
    });
  }
  diffEditor = m.editor.createDiffEditor($('editor'), {
    theme: `replay-${theme}`,
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    minimap: { enabled: false },
    renderOverviewRuler: true,
    overviewRulerBorder: false,
    scrollBeyondLastLine: true,
    fontSize: 13,
    lineHeight: 21,
    padding: { top: 14 },
    renderLineHighlight: 'none',
    diffAlgorithm: 'advanced',
    hideUnchangedRegions: { enabled: false },
  });
  for (const ed of [diffEditor.getModifiedEditor(), diffEditor.getOriginalEditor()]) {
    ed.onKeyDown((e) => {
      if (handleNavKey(e.browserEvent)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }
  applyTheme(theme);
}

function applyTheme(name) {
  theme = name;
  document.body.dataset.theme = name;
  store?.setItem('prtl-theme', name);
  monacoApi?.editor.setTheme(`replay-${name}`);
  // player mode docks the scrubber inside the playback pill and clears the
  // stage: the rail becomes an on-demand overlay
  if (name === 'player') {
    $('status').prepend($('scrubber'));
    $('rail').classList.add('hidden');
  } else {
    document.body.insertBefore($('scrubber'), $('topcard'));
    $('rail').classList.remove('hidden');
  }
  diffEditor?.updateOptions({
    padding: name === 'player' ? { top: 96, bottom: 120 } : { top: 14 },
  });
  anchorRail();
}

// in player mode the rail floats below the top card, whose height varies
// with the commit body
function anchorRail() {
  const rail = $('rail');
  if (theme === 'player') {
    rail.style.top = `${$('topcard').getBoundingClientRect().bottom + 12}px`;
  } else {
    rail.style.top = '';
  }
}

function cycleTheme() {
  applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
}

/* ---------------- navigation ---------------- */

function frame() { return state.frames[state.frameIdx]; }

async function next() {
  if (state.changeIdx < state.changes.length - 1) {
    state.changeIdx++;
    revealCurrent();
  } else if (state.frameIdx < state.frames.length - 1) {
    await loadFrame(state.frameIdx + 1, 0);
  }
}

async function prev() {
  if (state.changeIdx > 0) {
    state.changeIdx--;
    revealCurrent();
  } else if (state.frameIdx > 0) {
    await loadFrame(state.frameIdx - 1, 'end');
  }
}

function firstFrameOfCommit(c) {
  return state.frames.findIndex((fr) => fr.c === c);
}

async function nextCommit() {
  const c = frame().c;
  if (c < state.timeline.commits.length - 1) await loadFrame(firstFrameOfCommit(c + 1), 0);
}

async function prevCommit() {
  const c = frame().c;
  if (state.changeIdx > 0 || frame().f > 0) await loadFrame(firstFrameOfCommit(c), 0);
  else if (c > 0) await loadFrame(firstFrameOfCommit(c - 1), 0);
}

async function loadFrame(idx, at) {
  const token = ++state.navToken;
  state.frameIdx = Math.max(0, Math.min(idx, state.frames.length - 1));
  const fr = frame();
  renderChrome();
  $('change-label').textContent = '…';

  const payload = await fetchFile(fr);
  if (token !== state.navToken) return;

  disposeModels();
  if (payload.binary) {
    showPlaceholder('binary file — no preview');
    state.changes = [];
    state.changeIdx = 0;
    finishFrame();
    return;
  }
  showPlaceholder(null);

  // whole-file adds/deletes: a real diff renders degenerate — show the
  // content plain with a full-file wash instead
  const wholeFile = payload.added || payload.deleted;
  const m = monacoApi;
  const uid = `${token}`;
  const content = payload.added ? payload.after : payload.before;
  const original = m.editor.createModel(
    wholeFile ? content : payload.before, undefined,
    m.Uri.from({ scheme: 'replay', path: `/${uid}/a/${fr.file.oldPath ?? fr.file.path}` }));
  const modified = m.editor.createModel(
    wholeFile ? content : payload.after, undefined,
    m.Uri.from({ scheme: 'replay', path: `/${uid}/b/${fr.file.path}` }));
  state.models = [original, modified];
  diffEditor.setModel({ original, modified });

  const changes = await waitForDiff(token);
  if (token !== state.navToken) return;
  if (wholeFile) {
    const lines = modified.getLineCount();
    diffEditor.getModifiedEditor().createDecorationsCollection([{
      range: new m.Range(1, 1, lines, 1),
      options: {
        isWholeLine: true,
        className: payload.added ? 'wash-add' : 'wash-del',
      },
    }]);
    state.changes = [{
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: lines,
      originalStartLineNumber: 1,
      originalEndLineNumber: 0,
    }];
  } else {
    state.changes = changes ?? [];
  }
  state.changeIdx = at === 'end'
    ? Math.max(0, state.changes.length - 1)
    : Math.max(0, Math.min(at ?? 0, state.changes.length - 1));
  finishFrame();
}

function finishFrame() {
  renderChrome();
  revealCurrent();
}

function waitForDiff(token) {
  return new Promise((resolve) => {
    const existing = diffEditor.getLineChanges();
    if (existing) return resolve(existing);
    const sub = diffEditor.onDidUpdateDiff(() => {
      sub.dispose();
      resolve(diffEditor.getLineChanges());
    });
    setTimeout(() => {                 // safety net: never strand navigation
      if (token === state.navToken) {
        sub.dispose();
        resolve(diffEditor.getLineChanges() ?? []);
      }
    }, 3000);
  });
}

async function fetchFile(fr) {
  const key = `${fr.commit.sha}:${fr.file.path}`;
  if (state.fileCache.has(key)) return state.fileCache.get(key);
  const params = new URLSearchParams({
    sha: fr.commit.sha,
    path: fr.file.path,
    status: fr.file.status,
  });
  if (fr.file.oldPath) params.set('oldPath', fr.file.oldPath);
  const res = await fetch(`/api/file?${params}`);
  if (!res.ok) throw new Error(`file fetch failed: ${res.status}`);
  const payload = await res.json();
  state.fileCache.set(key, payload);
  return payload;
}

function disposeModels() {
  for (const model of state.models) model.dispose();
  state.models = [];
}

function showPlaceholder(text) {
  $('placeholder').hidden = text == null;
  $('placeholder').textContent = text ?? '';
}

/* ---------------- reveal ---------------- */

function revealCurrent() {
  const change = state.changes[state.changeIdx];
  const editor = diffEditor.getModifiedEditor();
  const n = state.changes.length;
  $('change-label').textContent = n ? `change ${state.changeIdx + 1}/${n}` : 'no text changes';
  updateScrubber();
  updateHash();
  if (!change) return;

  const isDeletion = change.modifiedEndLineNumber === 0;
  const startLine = Math.max(1, change.modifiedStartLineNumber);
  const endLine = isDeletion ? startLine : change.modifiedEndLineNumber;

  state.decorations = editor.deltaDecorations(state.decorations, [{
    range: new monacoApi.Range(startLine, 1, endLine, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: 'playhead-glyph',
      overviewRuler: {
        color: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
        position: monacoApi.editor.OverviewRulerLane.Full,
      },
    },
  }]);
  // for large ranges (whole-file adds), anchor near the top rather than centering
  editor.revealLinesInCenter(startLine, Math.min(endLine, startLine + 24),
    reducedMotion ? monacoApi.editor.ScrollType.Immediate : monacoApi.editor.ScrollType.Smooth);
}

/* ---------------- chrome rendering ---------------- */

function renderChrome() {
  const fr = frame();
  const { commits } = state.timeline;
  $('position').textContent = `${fr.c + 1} / ${commits.length}`;
  $('subject').textContent = fr.commit.subject;
  $('body-toggle').hidden = !fr.commit.body || state.showBody;
  const bodyEl = $('commit-body');
  bodyEl.textContent = fr.commit.body;
  bodyEl.hidden = !fr.commit.body || !state.showBody;

  const dir = fr.file.path.includes('/')
    ? fr.file.path.slice(0, fr.file.path.lastIndexOf('/') + 1) : '';
  const name = fr.file.path.slice(dir.length);
  $('file-label').innerHTML = '';
  const dirSpan = document.createElement('span');
  dirSpan.className = 'dir';
  dirSpan.textContent = dir;
  $('file-label').append(dirSpan, name);

  renderRailFiles();
  updateScrubber();
  anchorRail();
}

function renderScrubber() {
  const el = $('scrubber');
  el.innerHTML = '';
  state.timeline.commits.forEach((commit, c) => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    const churn = commit.files.reduce(
      (sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
    seg.style.flexGrow = String(Math.sqrt(Math.max(churn, 1)));
    commit.files.forEach((file, f) => {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.title = `${commit.subject}\n${file.path}`;
      tick.addEventListener('click', () => {
        loadFrame(state.frames.findIndex((fr) => fr.c === c && fr.f === f), 0);
      });
      seg.appendChild(tick);
    });
    if (!commit.files.length) seg.appendChild(document.createElement('div')).className = 'tick';
    el.appendChild(seg);
  });
  updateScrubber();
}

function updateScrubber() {
  const fr = frame();
  if (!fr) return;
  $('scrubber').querySelectorAll('.seg').forEach((seg, c) => {
    seg.querySelectorAll('.tick').forEach((tick, f) => {
      const before = c < fr.c || (c === fr.c && f < fr.f);
      const current = c === fr.c && f === fr.f;
      tick.classList.toggle('done', before);
      tick.classList.toggle('current', current);
    });
  });
}

function renderRailCommits() {
  const rail = $('rail');
  rail.innerHTML = '';
  state.timeline.commits.forEach((commit, c) => {
    const row = document.createElement('div');
    row.className = 'rail-commit';
    row.dataset.c = String(c);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(c + 1).padStart(2, '0');
    const s = document.createElement('span');
    s.className = 's';
    s.textContent = commit.subject;
    s.title = commit.subject;
    row.append(n, s);
    row.addEventListener('click', () => loadFrame(firstFrameOfCommit(c), 0));
    rail.appendChild(row);
    const files = document.createElement('div');
    files.className = 'rail-files';
    files.dataset.c = String(c);
    files.hidden = true;
    rail.appendChild(files);
  });
}

function renderRailFiles() {
  const fr = frame();
  document.querySelectorAll('.rail-commit').forEach((row) => {
    row.classList.toggle('active', Number(row.dataset.c) === fr.c);
  });
  document.querySelectorAll('.rail-files').forEach((box) => {
    const c = Number(box.dataset.c);
    const isActive = c === fr.c;
    box.hidden = !isActive;
    if (!isActive) { box.innerHTML = ''; return; }
    if (!box.childElementCount) {
      fr.commit.files.forEach((file, f) => {
        const row = document.createElement('div');
        row.className = 'rail-file';
        row.dataset.f = String(f);
        const st = document.createElement('span');
        st.className = `st ${file.status}`;
        st.textContent = file.status;
        const p = document.createElement('span');
        p.className = 'p';
        p.textContent = file.path;
        p.title = file.path;
        const stat = document.createElement('span');
        stat.className = 'stat';
        if (!file.binary) {
          stat.innerHTML = `<span class="a">+${file.additions}</span> <span class="d">−${file.deletions}</span>`;
        } else {
          stat.textContent = 'bin';
        }
        row.append(st, p, stat);
        row.addEventListener('click', () => {
          loadFrame(state.frames.findIndex((x) => x.c === fr.c && x.f === f), 0);
        });
        box.appendChild(row);
      });
    }
    box.querySelectorAll('.rail-file').forEach((row) => {
      row.classList.toggle('active', Number(row.dataset.f) === fr.f);
    });
  });
  const active = document.querySelector('.rail-commit.active');
  active?.scrollIntoView({ block: 'nearest' });
}

/* ---------------- keys, hash ---------------- */

function handleNavKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (!$('help').hidden) {
    if (e.key === 'Escape' || e.key === '?') $('help').hidden = true;
    return true;
  }
  switch (e.key) {
    case 'ArrowRight': case ' ': e.shiftKey ? nextCommit() : next(); return true;
    case 'ArrowLeft': e.shiftKey ? prevCommit() : prev(); return true;
    case 'j': next(); return true;
    case 'k': prev(); return true;
    case 'J': nextCommit(); return true;
    case 'K': prevCommit(); return true;
    case 'g': loadFrame(0, 0); return true;
    case 'G': loadFrame(firstFrameOfCommit(state.timeline.commits.length - 1), 0); return true;
    case 't': toggleRail(); return true;
    case 'x': toggleFold(); return true;
    case 'v': cycleTheme(); return true;
    case 'm': toggleBody(); return true;
    case '?': $('help').hidden = false; return true;
    default: return false;
  }
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (handleNavKey(e)) e.preventDefault();
  });
  $('help').addEventListener('click', () => { $('help').hidden = true; });
  $('body-toggle').addEventListener('click', toggleBody);
  $('btn-prev').addEventListener('click', prev);
  $('btn-next').addEventListener('click', next);
}

function toggleRail() {
  $('rail').classList.toggle('hidden');
}

function toggleFold() {
  state.foldUnchanged = !state.foldUnchanged;
  diffEditor.updateOptions({
    hideUnchangedRegions: { enabled: state.foldUnchanged, revealLineCount: 8, contextLineCount: 4 },
  });
}

function toggleBody() {
  state.showBody = !state.showBody;
  renderChrome();
}

function updateHash() {
  history.replaceState(null, '', `#${state.frameIdx}.${state.changeIdx}`);
}

function parseHash() {
  const m = location.hash.match(/^#(\d+)\.(\d+)$/);
  if (!m) return null;
  return { frame: Number(m[1]), change: Number(m[2]) };
}
