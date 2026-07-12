/* pr-timeline viewer: step through an atomized branch change-by-change. */
'use strict';

require.config({ paths: { vs: '/vs' } });

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// One source of truth for "is this a touch/phone layout": drives both the
// .mobile CSS class and Monaco's options, so the two can never disagree.
const mobileMq = matchMedia('(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))');
const isMobile = () => mobileMq.matches;

const CORNERS = ['tc-tr', 'tc-br', 'tc-bl', 'tc-tl'];
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let cardCorner = store?.getItem('prtl-corner');
if (!CORNERS.includes(cardCorner)) cardCorner = 'tc-tr';
let cardMin = store?.getItem('prtl-cardmin') === '1';
let splitView = store?.getItem('prtl-split') === '1';
// wrap defaults to the form factor (on for phones) until the user toggles it
const wrapStored = store?.getItem('prtl-wrap');
let wrapLines = wrapStored == null ? isMobile() : wrapStored === '1';

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
  $('topbar-branch').textContent = `${state.timeline.repo} · ${state.timeline.branch}`;
  const styleEl = $('topbar-style');
  styleEl.textContent = state.timeline.style ?? '';
  styleEl.hidden = !state.timeline.style;

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
  m.editor.defineTheme('replay-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#161619',
      'editorGutter.background': '#161619',
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
  diffEditor = m.editor.createDiffEditor($('editor'), {
    theme: 'replay-dark',
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: splitView,
    useInlineViewWhenSpaceIsLimited: false,   /* the toggle decides, not the width */
    minimap: { enabled: false },
    renderOverviewRuler: true,
    overviewRulerBorder: false,
    scrollBeyondLastLine: true,
    fontSize: 13,
    lineHeight: 21,
    padding: { top: 14, bottom: 72 },   /* clear the floating timeline pill */
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
  applyCard();
  applyEditorMode();
  mobileMq.addEventListener('change', applyEditorMode);
}

/* Reconfigure Monaco and the layout for the current form factor. Called at
   setup and whenever the mobile breakpoint is crossed (e.g. rotation). */
function applyEditorMode() {
  const mobile = isMobile();
  document.documentElement.classList.toggle('mobile', mobile);
  // fold unchanged regions by default on a phone (right density), off on desktop
  state.foldUnchanged = mobile;
  // sidebar overlays on mobile and starts closed; on desktop it's docked open
  $('rail').classList.toggle('hidden', mobile);
  $('scrim').hidden = true;
  diffEditor.updateOptions(editorModeOptions());
  applyFold();
  applyWrap();
  syncBarButtons();
  if (state.changes.length) revealCurrent();   // panes/layout changed; re-anchor
}

function editorModeOptions() {
  if (isMobile()) return {
    renderSideBySide: false,             // unified only; the split toggle is hidden
    fontSize: 12,
    lineHeight: 19,
    lineNumbersMinChars: 3,
    folding: false,
    glyphMargin: false,
    contextmenu: false,
    selectionHighlight: false,
    occurrencesHighlight: 'off',
    padding: { top: 8, bottom: 16 },     // bars are docked in-flow, not floating
  };
  return {
    renderSideBySide: splitView,
    fontSize: 13,
    lineHeight: 21,
    lineNumbersMinChars: 5,
    folding: true,
    glyphMargin: true,
    contextmenu: true,
    selectionHighlight: true,
    occurrencesHighlight: 'singleFile',
    padding: { top: 14, bottom: 72 },    // clear the floating timeline pill
  };
}

function applyFold() {
  diffEditor.updateOptions({
    hideUnchangedRegions: {
      enabled: state.foldUnchanged, revealLineCount: 8, contextLineCount: 4,
    },
  });
}

function applyWrap() {
  diffEditor.updateOptions({ wordWrap: wrapLines ? 'on' : 'off' });
}

function applyCard() {
  const card = $('topcard');
  card.classList.remove(...CORNERS, 'min');
  card.classList.add(cardCorner);
  if (cardMin) card.classList.add('min');
}

function cycleCorner() {
  cardCorner = CORNERS[(CORNERS.indexOf(cardCorner) + 1) % CORNERS.length];
  store?.setItem('prtl-corner', cardCorner);
  applyCard();
}

function toggleCardMin(min = !cardMin) {
  cardMin = min;
  store?.setItem('prtl-cardmin', cardMin ? '1' : '0');
  applyCard();
}

function syncBarButtons() {
  $('tb-rail').classList.toggle('active', !$('rail').classList.contains('hidden'));
  $('tb-fold').classList.toggle('active', state.foldUnchanged);
  $('tb-split').classList.toggle('active', splitView);
  $('tb-wrap').classList.toggle('active', wrapLines);
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
  const bodyEl = $('commit-body');
  bodyEl.textContent = fr.commit.body;
  bodyEl.hidden = !fr.commit.body;

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
}

function renderScrubber() {
  const el = $('scrubber');
  el.innerHTML = '';
  let fi = 0;                              // flat frame index, matches state.frames order
  state.timeline.commits.forEach((commit) => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    const churn = commit.files.reduce(
      (sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
    seg.style.flexGrow = String(Math.sqrt(Math.max(churn, 1)));
    commit.files.forEach((file) => {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.title = `${commit.subject}\n${file.path}`;
      tick.dataset.frame = String(fi++);
      seg.appendChild(tick);
    });
    if (!commit.files.length) seg.appendChild(document.createElement('div')).className = 'tick';
    el.appendChild(seg);
  });
  bindScrubberDrag();
  updateScrubber();
}

/* Press-and-drag anywhere on the bar to seek live to the change under the
   pointer. Works for touch and mouse; a tap is just a zero-length drag. */
let scrubbing = false;
let scrubCenters = [];      // [{frame, x}] cached at drag start; layout is stable mid-drag
let scrubLastFrame = -1;

function bindScrubberDrag() {
  const el = $('scrubber');
  if (el.dataset.dragBound) return;       // bind once; renderScrubber only clears children
  el.dataset.dragBound = '1';

  const seek = (clientX) => {
    let best = -1, bestDist = Infinity;
    for (const c of scrubCenters) {
      const d = Math.abs(c.x - clientX);
      if (d < bestDist) { bestDist = d; best = c.frame; }
    }
    if (best < 0 || best === scrubLastFrame) return;
    scrubLastFrame = best;
    loadFrame(best, 0);
  };

  el.addEventListener('pointerdown', (e) => {
    scrubCenters = [...el.querySelectorAll('.tick[data-frame]')].map((t) => {
      const r = t.getBoundingClientRect();
      return { frame: Number(t.dataset.frame), x: r.left + r.width / 2 };
    });
    if (!scrubCenters.length) return;
    scrubbing = true;
    scrubLastFrame = -1;
    el.setPointerCapture(e.pointerId);
    seek(e.clientX);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => { if (scrubbing) seek(e.clientX); });
  const end = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
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
    row.addEventListener('click', () => { loadFrame(firstFrameOfCommit(c), 0); closeRailIfMobile(); });
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
          closeRailIfMobile();
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
    case 's': toggleSplit(); return true;
    case 'w': toggleWrap(); return true;
    case 'c': cycleCorner(); return true;
    case 'm': toggleCardMin(); return true;
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
  $('btn-prev').addEventListener('click', prev);
  $('btn-next').addEventListener('click', next);
  $('tb-rail').addEventListener('click', toggleRail);
  $('tb-fold').addEventListener('click', toggleFold);
  $('tb-split').addEventListener('click', toggleSplit);
  $('tb-wrap').addEventListener('click', toggleWrap);
  $('tb-keys').addEventListener('click', () => { $('help').hidden = false; });
  document.querySelector('.dot-min').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCardMin();
  });
  document.querySelector('.dot-corner').addEventListener('click', (e) => {
    e.stopPropagation();
    cycleCorner();
  });
  $('topcard').addEventListener('click', () => {
    if (isMobile()) { $('topcard').classList.toggle('expanded'); return; }
    if (cardMin) toggleCardMin(false);
  });
  $('scrim').addEventListener('click', closeRailIfMobile);
}

function toggleRail() {
  const opening = $('rail').classList.contains('hidden');
  $('rail').classList.toggle('hidden');
  $('scrim').hidden = !(isMobile() && opening);   // scrim only backs the mobile drawer
  syncBarButtons();
}

function closeRailIfMobile() {
  if (!isMobile()) return;
  $('rail').classList.add('hidden');
  $('scrim').hidden = true;
  syncBarButtons();
}

function toggleFold() {
  state.foldUnchanged = !state.foldUnchanged;
  applyFold();
  syncBarButtons();
}

function toggleSplit() {
  if (isMobile()) return;                // unified is forced on a phone
  splitView = !splitView;
  store?.setItem('prtl-split', splitView ? '1' : '0');
  diffEditor.updateOptions({ renderSideBySide: splitView });
  syncBarButtons();
  revealCurrent();   // the modified editor is a new pane; re-anchor the playhead
}

function toggleWrap() {
  wrapLines = !wrapLines;
  store?.setItem('prtl-wrap', wrapLines ? '1' : '0');
  applyWrap();
  syncBarButtons();
  revealCurrent();   // wrapping shifts line positions; keep the playhead in view
}

function updateHash() {
  history.replaceState(null, '', `#${state.frameIdx}.${state.changeIdx}`);
}

function parseHash() {
  const m = location.hash.match(/^#(\d+)\.(\d+)$/);
  if (!m) return null;
  return { frame: Number(m[1]), change: Number(m[2]) };
}
