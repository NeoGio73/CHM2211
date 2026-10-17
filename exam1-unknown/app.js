/*
 * Exam 1 Unknown: page logic.
 * Talks to the 3D room (a Unity build in the canvas: the bench where the sample is made up, the
 * magnet, the spectrometer's computer, an IR and a GC-MS), keeps the student's work, and is the
 * spectrometer's software: the lock display, the shims, recording, and processing the recordings
 * into spectra. It is also the IR's software and the GC-MS's: it draws what those two send.
 * Last come the student's structure (drawn on the board in draw.js) and the printed report.
 *
 * The page does not know what the unknown is. The 3D room sends the formula, the state of the
 * sample, the lock level and the recordings (FIDs); the page only turns recordings into spectra.
 * Which compound it is, is never checked here: the instructor marks that from the answer key.
 */
(function () {
  'use strict';

  var M = window.NmrLabModel;
  var STORE_KEY = 'nmr-lab:v1';
  var params = new URLSearchParams(window.location.search);
  var standIn = typeof window.NmrLabStandIn === 'function' ? window.NmrLabStandIn : null;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function expInfo(key) { return M.EXPERIMENTS.filter(function (e) { return e.key === key; })[0] || M.EXPERIMENTS[0]; }
  function proton(key) { return String(key || '').indexOf('1H') === 0; }

  // ---- Saved work ----------------------------------------------------------------------------

  /** The four tables of readings: proton and carbon NMR, IR bands, and the other peaks of the mass spectrum. */
  var KINDS = ['h', 'c', 'ir', 'mf'];
  var FIRST = { h: 'ppm', c: 'ppm', ir: 'cm1', mf: 'mz' };      // the box that makes a row count
  function blankRow(kind) {
    if (kind === 'h') return { ppm: '', mult: '', j: '', nH: '', who: '' };
    if (kind === 'c') return { ppm: '', type: '', who: '' };
    if (kind === 'ir') return { cm1: '', strength: '', shape: '', who: '' };
    return { mz: '', who: '' };
  }
  function blankRows(kind, n) { var out = []; for (var i = 0; i < n; i++) out.push(blankRow(kind)); return out; }

  function blankStructure() { return { mol: { atoms: [], bonds: [] }, name: '', condensed: '', why: { formula: '', ir: '', ms: '', nmr: '' } }; }

  function blankState(code) {
    return {
      v: 1,
      code: code || M.randomCode(),
      name: '',
      dou: '',
      sample: null,                 // the sample as the 3D room last reported it
      spectro: { locked: false, solvent: '', shims: null },
      acq: { experiment: '1H', scans: 16, gain: 32 },
      data: {},                     // experiment -> what was recorded and how it is processed
      tab: 'lock',
      dataset: null,
      nextId: 1,
      routine: 'nmr',               // which list of steps is shown beside the room
      sound: true,                  // the lift air's sound
      software: false,              // the spectrometer software has been opened: the room's monitor shows its status
      ir: null,                     // the last IR spectrum: { from, step, background, sample, t }
      irView: null, irBands: false, irThreshold: 10,
      gc: null,                     // the last GC-MS run: { seed, done } (its chromatogram is asked for again after a reload)
      ms: null,                     // the mass spectrum last looked at: { minutes, peaks }
      msView: null, ticView: null,
      msFields: { rt: '', m: '', base: '' },
      structure: blankStructure(),
      readings: { h: blankRows('h', 5), c: blankRows('c', 5), ir: blankRows('ir', 5), mf: blankRows('mf', 5) }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 1 || !M.isCode(saved.code)) return null;
      var fresh = blankState(saved.code);
      Object.keys(fresh).forEach(function (k) { if (saved[k] !== undefined && typeof saved[k] === typeof fresh[k]) fresh[k] = saved[k]; });
      if (saved.sample && typeof saved.sample === 'object') fresh.sample = saved.sample;
      return fresh;
    } catch (e) {
      return null;
    }
  }

  var saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window: work is not kept */ }
    }, 150);
    scheduleReport();
  }

  var state = loadState();
  var requested = M.normalizeCode(params.get('code') || '');
  if (requested && M.isCode(requested) && (!state || state.code !== requested)) state = blankState(requested);
  if (!state) state = blankState();

  var formula = '';
  var solid = false;

  // ---- The 3D room ---------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var configured = false;
  var blockedSeen = false;
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function sendBench(method, value) {
    if (!unity) return;
    try { unity.SendMessage('Lab', method, value == null ? '' : String(value)); } catch (e) { console.error(e); }
  }

  function workUnderWay() { var s = state.sample; return !!s && (s.addedMl > 0 || s.place !== 'rack'); }

  function configureBench() {
    if (!unity || !unityAwake) return;
    configured = false;
    sendBench('Configure', JSON.stringify({
      code: state.code,
      hasState: !!state.sample,
      state: state.sample || {},
      locked: !!state.spectro.locked,
      solvent: state.spectro.solvent || '',
      shims: state.spectro.shims || [],
      intro: params.get('intro') !== '0' && !calm && !workUnderWay(),
      calm: calm,
      view: state.routine !== 'nmr' ? ROUTINE_VIEW[state.routine] : (workUnderWay() ? 'prep' : ''),
      software: !!state.software
    }));
  }

  /** Runs steps one after another, as the 3D room's own words ("take solvent", "use vial"...), stopping at the first it refuses. */
  function sendSteps(list) {
    for (var i = 0; i < list.length; i++) {
      blockedSeen = false;
      sendBench('Act', list[i]);
      if (blockedSeen) {
        if (state.sample && state.sample.held) sendBench('Act', 'putback');
        break;
      }
    }
  }

  // ---- Notes under the room --------------------------------------------------------------------

  var holdNoteUntil = 0, pendingHover = null, hoverTimer = null, persistent = { text: '', kind: '' };

  function note(text, kind, temporary) {
    if (!temporary) {
      persistent = { text: text, kind: kind || '' };
      holdNoteUntil = Date.now() + (kind === 'warn' ? 4500 : 2200);
      pendingHover = null;
    }
    var node = $('stage-note');
    node.textContent = text;
    if (kind) node.setAttribute('data-kind', kind); else node.removeAttribute('data-kind');
  }

  function hoverNote(text) {
    clearTimeout(hoverTimer);
    var wait = holdNoteUntil - Date.now();
    if (wait > 0) {
      pendingHover = text;
      if (text !== null) hoverTimer = setTimeout(function () { if (pendingHover !== null) { var t = pendingHover; pendingHover = null; note(t, '', true); } }, wait);
      return;
    }
    pendingHover = null;
    note(text === null ? persistent.text : text, text === null ? persistent.kind : '', true);
  }

  function updateNote() {
    var text = M.nextStep(state.sample, state.routine, { solid: solid, recorded: irRecorded(), gc: !!state.gc, running: gcRunning });
    if (persistent.kind === 'warn' && Date.now() < holdNoteUntil) return;
    persistent = { text: text, kind: '' };
    note(text, '', true);
  }

  function showView(view) {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }

  // ---- The routine's buttons and what each step has come to ------------------------------------------

  function showRoutine() {
    var s = state.sample || {};
    function put(id, text, done) {
      var node = $('state-' + id);
      node.textContent = text || '';
      node.closest('.routine-step').setAttribute('data-state', done ? 'done' : '');
    }
    var column = s.tubeMl > 0 ? s.tubeMl / (Math.PI * 0.21 * 0.21) : 0;
    put('solvent', s.addedMl > 0 ? s.addedMl.toFixed(1) + ' mL' : '', s.addedMl >= 0.55);
    put('dissolved', s.dissolved ? 'Dissolved' : (s.addedMl > 0 && solid ? 'Some solid left' : ''), !!s.dissolved);
    put('tube', column > 0 ? column.toFixed(1) + ' cm of solution' : '', column > 0);
    put('capped', s.capped ? 'Capped' : '', !!s.capped);
    put('spinner', s.inSpinner ? 'In the spinner' : '', !!s.inSpinner);
    put('depth', s.place === 'gauge' ? 'On the gauge' : (s.gauged ? 'Set on the gauge' : ''), !!s.gauged && s.place !== 'gauge');
    put('air', s.air ? 'On' : 'Off', false);
    put('standard', s.standard === 'magnet' ? 'In the magnet' : (s.standard === 'top' ? 'Floating at the top' : 'In its holder'), s.standard === 'holder');
    put('magnet', s.place === 'magnet' ? 'In the magnet' : (s.place === 'top' ? 'Floating at the top' : ''), s.place === 'magnet');
    put('d2o', s.d2o ? (s.shaken ? 'D₂O added and shaken' : 'D₂O added, not shaken yet') : '', !!(s.d2o && s.shaken));
    // the IR
    put('ir-clean', s.crystal === 'sample' ? '' : 'Clean', s.crystal !== 'sample' || !!s.background);
    put('ir-background', s.background ? 'Recorded' : '', !!s.background);
    put('ir-sample', s.crystal === 'sample' ? 'On the crystal' : '', s.crystal === 'sample');
    put('ir-clamp', s.clamp ? 'Down' : 'Up', !!s.clamp);
    put('ir-record', irRecorded() ? 'Recorded' : '', irRecorded());
    $('clamp-button').setAttribute('aria-pressed', s.clamp ? 'true' : 'false');
    // the GC-MS
    put('gc-fill', s.held === 'syringefull' ? 'Filled' : (state.gc ? 'Injected' : ''), s.held === 'syringefull' || !!state.gc);
    var runText = '';
    if (gcRunning && tic) runText = 'Running: ' + (tic.upTo * tic.step).toFixed(1) + ' min';
    else if (gcRunning) runText = 'Running';
    else if (state.gc) runText = 'Run finished';
    put('gc-inject', runText, !!(state.gc && state.gc.done));
    $('air-button').setAttribute('aria-pressed', s.air ? 'true' : 'false');
    Array.prototype.forEach.call(document.querySelectorAll('#depth-buttons button'), function (b) { b.disabled = s.place !== 'gauge'; });
    var held = {
      solvent: 'You are holding a pipet of CDCl₃.', pipet: 'You are holding a clean Pasteur pipet.',
      solution: 'You are holding a pipet of the solution.', cap: 'You are holding a cap.', d2o: 'You are holding a pipet with a drop of D₂O.',
      tube: 'You are holding your tube.', spinner: 'You are holding the spinner with your tube in it.',
      irdrop: solid ? 'You are holding a spatula with a few crystals of your unknown.' : 'You are holding a pipet with a drop of your unknown.',
      syringe: 'You are holding the empty syringe.', syringefull: 'You are holding the syringe with 1 µL of the GC sample.'
    }[s.held || ''];
    $('held-note').textContent = held || '';
    $('put-down').disabled = !s.held;
  }

  function bindRoutine() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-steps]'), function (b) {
      b.addEventListener('click', function () {
        var s = state.sample || {};
        var list = b.getAttribute('data-steps').split('|').filter(function (step) {
          // already in the hand: picking it up again would put it down
          if (step === 'take syringe') return s.held !== 'syringe' && s.held !== 'syringefull';
          if (step === 'take irvial') return s.held !== 'irdrop';
          return true;
        }).map(function (step) {
          if ((step === 'use tube' || step === 'take tube') && s.tube >= 0) return step + ' ' + s.tube;
          return step;
        });
        sendSteps(list);
      });
    });
    $('air-button').addEventListener('click', function () {
      var on = !(state.sample && state.sample.air);
      sendSteps(['air ' + (on ? 'on' : 'off')]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (b) {
      b.addEventListener('click', function () { sendBench('SetView', b.getAttribute('data-view')); });
    });
    ROUTINES.forEach(function (t) { $('rtab-' + t).addEventListener('click', function () { showRoutineTab(t, true); }); });
    $('reset-sample').addEventListener('click', function () { $('reset-confirm').hidden = false; $('reset-sample').hidden = true; });
    $('reset-no').addEventListener('click', function () { $('reset-confirm').hidden = true; $('reset-sample').hidden = false; });
    $('reset-yes').addEventListener('click', function () {
      $('reset-confirm').hidden = true; $('reset-sample').hidden = false;
      sendBench('ResetBench', '');
    });
  }

  // The three lists of steps beside the room: the NMR sample, the IR, the GC-MS. Choosing one turns
  // the camera to it, and turning the camera to one of them shows its steps.
  var ROUTINES = ['nmr', 'ir', 'ms'];
  var ROUTINE_LIST = { nmr: 'routine', ir: 'routine-ir', ms: 'routine-ms' };
  var ROUTINE_VIEW = { nmr: 'prep', ir: 'ir', ms: 'ms' };
  var ROUTINE_FOR_VIEW = { prep: 'nmr', gauge: 'nmr', top: 'nmr', magnet: 'nmr', ir: 'ir', ms: 'ms' };

  function showRoutineTab(tab, moveCamera) {
    if (ROUTINES.indexOf(tab) < 0) tab = 'nmr';
    state.routine = tab;
    ROUTINES.forEach(function (t) {
      $('rtab-' + t).setAttribute('aria-selected', t === tab ? 'true' : 'false');
      $(ROUTINE_LIST[t]).hidden = t !== tab;
    });
    $('ms-aside').hidden = tab !== 'ms';
    if (moveCamera) sendBench('SetView', ROUTINE_VIEW[tab]);
    updateNote();
    saveState();
  }

  // ---- The formula ---------------------------------------------------------------------------------

  function writeFormula(node) {
    node.textContent = '';
    if (!formula) { node.textContent = '—'; return; }
    M.formulaParts(formula).forEach(function (p) {
      node.appendChild(document.createTextNode(p.symbol));
      if (p.count) node.appendChild(el('sub', null, p.count));
    });
  }

  function showFormula() {
    writeFormula($('formula'));
    writeFormula($('formula-again'));
    checkDou();
    if (board) showStructure();
  }

  function checkDou() {
    var r = formula ? M.checkUnsaturation(state.dou, formula) : { ok: null, message: '' };
    var input = $('dou');
    if (r.ok === true) input.setAttribute('data-state', 'ok');
    else if (r.ok === false) input.setAttribute('data-state', 'bad');
    else input.removeAttribute('data-state');
    $('dou-msg').textContent = r.message;
  }

  // ---- The spectrometer: tabs --------------------------------------------------------------------------

  var TABS = ['lock', 'shim', 'acquire', 'process'];
  function showTab(tab) {
    state.tab = tab;
    TABS.forEach(function (t) {
      $('tab-' + t).setAttribute('aria-selected', t === tab ? 'true' : 'false');
      $('panel-' + t).hidden = t !== tab;
    });
    $('lock-area').hidden = !(tab === 'lock' || tab === 'shim');
    sendBench('WatchLock', tab === 'lock' || tab === 'shim' ? '1' : '0');
    if (tab === 'process') { buildDatasets(); drawSpectrum(); }
    saveState();
  }

  function inMagnet() { return !!(state.sample && state.sample.place === 'magnet'); }

  function consoleStatus() {
    var parts = [];
    parts.push(inMagnet() ? 'Sample in the magnet' : 'No sample in the magnet');
    parts.push(state.spectro.locked ? 'Locked on ' + state.spectro.solvent : 'Not locked');
    if (acquiring) parts.push('Recording');
    $('console-status').textContent = parts.join(' · ');
  }

  // ---- Lock ----------------------------------------------------------------------------------------------

  var lockShown = { locked: false, searching: false, level: 0, target: 0 };

  /**
   * The spectrometer software is "opened" by a click on the room's monitor, or by using it here:
   * from then on the monitor shows the live status instead of the workstation's login screen.
   * A click on the monitor also brings the software into view.
   */
  function openSoftware(bringIntoView) {
    if (!state.software) {
      state.software = true;
      sendBench('SetScreen', 'status');
      saveState();
    }
    if (bringIntoView) $('part-spectrometer').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  function bindSoftware() {
    // using the software here opens it too (a tab, a button, a slider)
    ['pointerdown', 'click', 'keydown', 'input', 'change'].forEach(function (type) {
      $('console').addEventListener(type, function () { openSoftware(false); }, true);
    });
  }

  function bindLock() {
    var sel = $('lock-solvent');
    M.SOLVENTS.forEach(function (s) { sel.appendChild(el('option', { value: s.key }, s.name)); });
    sel.value = state.spectro.solvent || 'CDCl3';
    $('lock-button').addEventListener('click', function () {
      if (!inMagnet()) { $('lock-msg').textContent = 'Put your sample in the magnet first (part 1).'; return; }
      sendBench('Lock', sel.value);
    });
    $('unlock-button').addEventListener('click', function () { sendBench('Unlock', ''); });
    requestAnimationFrame(drawLock);
  }

  function drawLock(time) {
    requestAnimationFrame(drawLock);
    var area = $('lock-area');
    if (area.hidden) return;
    var c = $('lock-canvas'), g = c.getContext('2d'), W = c.width, H = c.height;
    lockShown.level += (lockShown.target - lockShown.level) * 0.15;
    g.fillStyle = '#0d1a14'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120, 200, 150, 0.18)'; g.lineWidth = 1;
    for (var k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, H * k / 4); g.lineTo(W, H * k / 4); g.stroke(); }
    g.strokeStyle = '#6dff9c'; g.lineWidth = 2; g.beginPath();
    var t = time / 1000;
    for (var x = 0; x <= W; x += 2) {
      var y;
      var noise = (Math.sin(x * 12.9898 + t * 40) * 43758.5453) % 1;
      if (lockShown.locked) {
        y = H - 12 - (lockShown.level / 100) * (H - 24) + noise * 2.5;
      } else if (inMagnet()) {
        // unlocked: the field sweeps, and the deuterium signal passes by as a dispersion wiggle
        var speed = lockShown.searching ? 1.6 : 0.6;
        var x0 = ((t * speed * W * 0.5) % (W * 1.4)) - W * 0.2, u = (x - x0) / 22;
        y = H / 2 - (lockShown.searching ? 70 : 45) * u / (1 + u * u) + noise * 3;
      } else {
        y = H / 2 + noise * 3;
      }
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    var text, level = null;
    if (lockShown.locked) { level = String(Math.round(lockShown.level)); text = 'Locked on ' + state.spectro.solvent + ' · lock level '; }
    else if (lockShown.searching) text = 'Searching for the deuterium signal…';
    else text = inMagnet() ? 'Lock off: the field is sweeping' : 'Lock off: no sample in the magnet';
    // the level itself stands out, large and red, for anyone who finds small print hard to read;
    // the line is rebuilt only when it changes, since this runs on every frame
    var readout = $('lock-readout'), key = text + (level || '');
    if (readout.getAttribute('data-shown') !== key) {
      readout.setAttribute('data-shown', key);
      readout.textContent = text;
      if (level !== null) {
        var num = document.createElement('span');
        num.className = 'lock-level';
        num.textContent = level;
        readout.appendChild(num);
      }
    }
  }

  // ---- Shims ---------------------------------------------------------------------------------------------

  var SHIM_NAMES = ['Z1', 'Z2', 'X', 'Y'];
  var shimSendTimer = {};

  function shims() { return state.spectro.shims && state.spectro.shims.length === 4 ? state.spectro.shims : [0, 0, 0, 0]; }

  function buildShims() {
    var box = $('shims');
    box.textContent = '';
    SHIM_NAMES.forEach(function (name, i) {
      var row = el('div', { 'class': 'shim-row' });
      row.appendChild(el('span', { 'class': 'shim-name' }, name));
      [-50, -10, -1].forEach(function (d) { row.appendChild(shimButton(i, d)); });
      var slider = el('input', { type: 'range', min: '-1000', max: '1000', step: '1', id: 'shim-' + i, 'aria-label': name + ' shim' });
      slider.value = shims()[i];
      slider.addEventListener('input', function () { setShim(i, parseInt(slider.value, 10)); });
      row.appendChild(slider);
      [1, 10, 50].forEach(function (d) { row.appendChild(shimButton(i, d)); });
      row.appendChild(el('span', { 'class': 'shim-value', id: 'shim-value-' + i }, String(shims()[i])));
      box.appendChild(row);
    });
  }

  function shimButton(i, d) {
    var b = el('button', { type: 'button', 'class': 'quiet-button shim-step', 'aria-label': SHIM_NAMES[i] + (d > 0 ? ' up ' : ' down ') + Math.abs(d) }, (d > 0 ? '+' : '−') + Math.abs(d));
    b.addEventListener('click', function () { setShim(i, shims()[i] + d); });
    return b;
  }

  function setShim(i, value) {
    value = Math.max(-1000, Math.min(1000, Math.round(value)));
    var s = shims().slice();
    s[i] = value;
    state.spectro.shims = s;
    $('shim-' + i).value = value;
    $('shim-value-' + i).textContent = String(value);
    clearTimeout(shimSendTimer[i]);
    shimSendTimer[i] = setTimeout(function () { sendBench('SetShim', SHIM_NAMES[i] + ' ' + value); }, 30);
    saveState();
  }

  function showShims() {
    var s = shims();
    for (var i = 0; i < 4; i++) {
      if (!$('shim-' + i)) return;
      $('shim-' + i).value = s[i];
      $('shim-value-' + i).textContent = String(s[i]);
    }
  }

  // ---- Acquire -------------------------------------------------------------------------------------------

  var acquiring = false, acquiringId = 0;

  function bindAcquire() {
    var box = $('experiments');
    M.EXPERIMENTS.forEach(function (e) {
      if (e.recorded) return;
      var b = el('button', { type: 'button', role: 'radio', 'class': 'quiet-button exp-button', 'data-exp': e.key }, e.name);
      b.addEventListener('click', function () { chooseExperiment(e.key); });
      box.appendChild(b);
    });
    var sel = $('scans');
    M.SCAN_CHOICES.forEach(function (n) { sel.appendChild(el('option', { value: String(n) }, String(n))); });
    sel.addEventListener('change', function () { state.acq.scans = parseInt(sel.value, 10); saveState(); showAcquire(); });
    $('gain').addEventListener('change', function () {
      var g = Math.max(1, Math.min(256, Math.round(parseFloat($('gain').value) || 1)));
      $('gain').value = g; state.acq.gain = g; saveState();
    });
    $('auto-gain').addEventListener('click', function () {
      if (!inMagnet()) { $('acquire-msg').textContent = 'Put your sample in the magnet first (part 1).'; return; }
      $('acquire-msg').textContent = 'Finding the receiver gain…';
      sendBench('AutoGain', state.acq.experiment);
    });
    $('acquire-start').addEventListener('click', startRecording);
    $('acquire-stop').addEventListener('click', function () { sendBench('StopAcquisition', ''); });
    chooseExperiment(state.acq.experiment);
  }

  function chooseExperiment(key) {
    state.acq.experiment = key;
    Array.prototype.forEach.call(document.querySelectorAll('.exp-button'), function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-exp') === key ? 'true' : 'false');
    });
    showAcquire();
    saveState();
  }

  function showAcquire() {
    $('scans').value = String(state.acq.scans);
    $('gain').value = state.acq.gain;
    var per = state.acq.experiment === '1H' ? 4.0 : 1.6;
    if (!acquiring) $('acq-text').textContent = 'About ' + formatTime(per * state.acq.scans) + ' on a real spectrometer';
    $('acquire-start').disabled = acquiring;
    $('acquire-stop').disabled = !acquiring;
  }

  function formatTime(s) {
    if (s < 90) return Math.round(s) + ' s';
    return Math.round(s / 60) + ' min';
  }

  function startRecording() {
    if (!inMagnet()) { $('acquire-msg').textContent = 'Put your sample in the magnet first (part 1).'; return; }
    var msg = state.spectro.locked ? '' : 'The spectrometer is not locked: the field will drift and the lines will broaden. Lock first (Lock tab) for a good spectrum. ';
    var seed = Math.floor(Math.random() * 2147483647);
    acquiringId = state.nextId++;
    pending[acquiringId] = { experiment: state.acq.experiment, scans: state.acq.scans, gain: state.acq.gain, seed: seed, shims: shims().slice(), locked: !!state.spectro.locked };
    sendBench('Acquire', JSON.stringify({ experiment: state.acq.experiment, scans: state.acq.scans, gain: state.acq.gain, seed: seed, id: acquiringId }));
    $('acquire-msg').textContent = msg;
    saveState();
  }

  var pending = {};        // id -> what was asked for, until its recording arrives

  // ---- Recordings and processing ------------------------------------------------------------------------

  var fids = {};           // experiment -> recording (not saved: it is asked for again after a reload)
  var cache = {};          // experiment -> { lb, spec, key, y }

  function defaultProc(exp) {
    return { lb: expInfo(exp).lb, ft: false, ph0: 0, ph1: 0, baseline: false, ref: 0, integrals: [], intRef: -1, intValue: 1, peaks: false, threshold: proton(exp) ? 6 : 10 };
  }

  function receiveFid(msg) {
    var fid = M.readFid(msg), exp = fid.experiment + (msg.d2o ? '-D2O' : ''), ask = pending[msg.id];
    delete pending[msg.id];
    fids[exp] = fid;
    delete cache[exp];
    if (ask) {
      // a new recording replaces the old one of the same kind
      state.data[exp] = { seed: ask.seed, scans: fid.scans, gain: fid.gain, shims: ask.shims, locked: ask.locked, id: msg.id, overflow: fid.overflow, proc: defaultProc(exp), view: null };
      state.dataset = exp;
      var text = 'Recorded: ' + expInfo(exp).name + ', ' + fid.scans + (fid.scans === 1 ? ' scan' : ' scans') + '.';
      if (fid.overflow) text = 'The receiver gain was too high: the FID was clipped (the digitizer overflowed). Lower the gain, or use Automatic gain, and record again. ' + text;
      $('acquire-msg').textContent = text;
      showTab('process');
    }
    buildDatasets();
    drawSpectrum();
    scheduleFigures();
    saveState();
  }

  /** After a reload: ask the 3D room for each recording again (the same seed gives the same recording). */
  function replayRecordings() {
    Object.keys(state.data).forEach(function (exp) {
      var d = state.data[exp];
      if (!d || fids[exp]) return;
      var after = /-D2O$/.test(exp);
      sendBench('Acquire', JSON.stringify({ experiment: exp.replace('-D2O', ''), scans: d.scans, gain: d.gain, seed: d.seed, id: d.id, instant: true, shims: d.shims || [], locked: !!d.locked, d2o: after, shaken: after }));
    });
  }

  function processed(exp) {
    var d = state.data[exp], fid = fids[exp];
    if (!d || !fid) return null;
    var p = d.proc, c = cache[exp] || (cache[exp] = {});
    if (!p.ft) return { fid: fid };
    if (!c.spec || c.lb !== p.lb) { c.spec = M.transform(fid, p.lb); c.lb = p.lb; c.key = null; }
    var key = [p.ph0, p.ph1, p.baseline].join('/');
    if (c.key !== key) {
      var y = M.phased(c.spec, p.ph0, p.ph1);
      if (p.baseline) y = M.baseline(y);
      c.y = y; c.key = key; c.max = 0;
      for (var i = 0; i < y.length; i++) if (Math.abs(y[i]) > c.max) c.max = Math.abs(y[i]);
      c.noise = M.noiseLevel(y);
    }
    return { fid: fid, spec: c.spec, y: c.y, max: c.max, noise: c.noise };
  }

  function current() { return state.dataset && state.data[state.dataset] ? state.dataset : null; }

  function buildDatasets() {
    var box = $('datasets');
    box.textContent = '';
    var any = false;
    M.EXPERIMENTS.forEach(function (e) {
      if (!state.data[e.key]) return;
      any = true;
      var b = el('button', { type: 'button', 'class': 'quiet-button toggle', 'aria-pressed': state.dataset === e.key ? 'true' : 'false' }, e.name);
      b.addEventListener('click', function () { state.dataset = e.key; buildDatasets(); drawSpectrum(); saveState(); });
      box.appendChild(b);
    });
    if (!any) box.appendChild(el('span', { 'class': 'soft' }, 'No spectra yet: record one on the Acquire tab.'));
    var exp = current();
    var refSel = $('ref-line');
    refSel.textContent = '';
    (M.REFERENCES[exp || '1H'] || []).forEach(function (r, i) { refSel.appendChild(el('option', { value: String(i) }, r.name + ' = ' + r.ppm.toFixed(2) + ' ppm')); });
    showProcControls();
  }

  function showProcControls() {
    var exp = current(), d = exp ? state.data[exp] : null, p = d ? d.proc : null;
    var tools = ['do-ft', 'lb', 'do-autophase', 'ph0', 'ph0-num', 'ph1', 'ph1-num', 'do-baseline', 'ref-line', 'mode-ref', 'mode-int', 'clear-int', 'do-peaks', 'threshold', 'full-view', 'taller', 'shorter'];
    tools.forEach(function (id) { $(id).disabled = !p || (id !== 'do-ft' && id !== 'lb' && !p.ft); });
    if (!p) return;
    $('lb').value = p.lb;
    $('ph0').value = p.ph0; $('ph0-num').value = p.ph0;
    $('ph1').value = p.ph1; $('ph1-num').value = p.ph1;
    $('do-baseline').setAttribute('aria-pressed', p.baseline ? 'true' : 'false');
    $('do-peaks').setAttribute('aria-pressed', p.peaks ? 'true' : 'false');
    $('threshold').value = p.threshold;
    $('mode-int').disabled = !p.ft || !proton(exp);
    $('clear-int').disabled = !p.ft || !proton(exp) || !p.integrals.length;
    $('mode-int').setAttribute('aria-pressed', mode === 'int' ? 'true' : 'false');
    $('mode-ref').setAttribute('aria-pressed', mode === 'ref' ? 'true' : 'false');
    $('do-ft').textContent = p.ft ? 'Fourier transform again' : 'Fourier transform';
  }

  var mode = '';              // '', 'int' (integrate) or 'ref' (click the reference peak)

  function changeProc(fn) {
    var exp = current();
    if (!exp) return;
    fn(state.data[exp].proc, exp);
    showProcControls();
    drawSpectrum();
    scheduleFigures();
    saveState();
  }

  function bindProcess() {
    $('do-ft').addEventListener('click', function () { changeProc(function (p) { p.lb = Math.max(0, parseFloat($('lb').value) || 0); p.ft = true; }); $('process-msg').textContent = ''; });
    $('lb').addEventListener('change', function () { changeProc(function (p) { p.lb = Math.max(0, Math.min(10, parseFloat($('lb').value) || 0)); }); });
    $('do-autophase').addEventListener('click', function () {
      changeProc(function (p, exp) {
        var c = processed(exp);
        if (!c || !c.spec) return;
        var carbon = state.data['13C'];
        var r = exp === 'DEPT135' && carbon && carbon.proc.ft && (carbon.proc.ph0 || carbon.proc.ph1)
          ? { ph0: carbon.proc.ph0, ph1: carbon.proc.ph1 }      // DEPT takes the carbon spectrum's phases
          : M.autophase(c.spec, exp === 'DEPT135' ? -p.ref : null);
        p.ph0 = Math.round(normalAngle(r.ph0) * 2) / 2;
        p.ph1 = Math.round(r.ph1 * 2) / 2;
      });
    });
    [['ph0', 'ph0-num'], ['ph1', 'ph1-num']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () { changeProc(function (p) { p[pair[0]] = parseFloat($(pair[0]).value); }); });
      $(pair[1]).addEventListener('change', function () { changeProc(function (p) { p[pair[0]] = normalAngle(parseFloat($(pair[1]).value) || 0); }); });
    });
    $('do-baseline').addEventListener('click', function () { changeProc(function (p) { p.baseline = !p.baseline; }); });
    $('mode-ref').addEventListener('click', function () { mode = mode === 'ref' ? '' : 'ref'; showProcControls(); $('process-msg').textContent = mode === 'ref' ? 'Click the peak of the reference you chose.' : ''; });
    $('mode-int').addEventListener('click', function () { mode = mode === 'int' ? '' : 'int'; showProcControls(); $('process-msg').textContent = mode === 'int' ? 'Drag across a group of peaks to integrate it.' : ''; });
    $('clear-int').addEventListener('click', function () { changeProc(function (p) { p.integrals = []; p.intRef = -1; }); $('int-edit').hidden = true; });
    $('do-peaks').addEventListener('click', function () { changeProc(function (p) { p.peaks = !p.peaks; }); });
    $('threshold').addEventListener('input', function () { changeProc(function (p) { p.threshold = parseInt($('threshold').value, 10); }); });
    $('full-view').addEventListener('click', function () { var exp = current(); if (exp) { state.data[exp].view = null; drawSpectrum(); saveState(); } });
    $('taller').addEventListener('click', function () { zoomHeight(2); });
    $('shorter').addEventListener('click', function () { zoomHeight(0.5); });
    $('int-set').addEventListener('click', setIntegralValue);
    $('int-value').addEventListener('keydown', function (e) { if (e.key === 'Enter') setIntegralValue(); });
    $('int-remove').addEventListener('click', function () {
      changeProc(function (p) { if (editing >= 0) { p.integrals.splice(editing, 1); if (p.intRef === editing) p.intRef = -1; else if (p.intRef > editing) p.intRef--; } });
      $('int-edit').hidden = true; editing = -1;
    });
    bindCanvas();
  }

  function normalAngle(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }

  function view(exp) {
    var d = state.data[exp], info = expInfo(exp);
    if (!d.view) d.view = { from: info.from, to: info.to, vscale: 1 };
    return d.view;
  }

  function zoomHeight(f) {
    var exp = current();
    if (!exp) return;
    var v = view(exp);
    v.vscale = Math.max(0.05, Math.min(400, v.vscale * f));
    drawSpectrum();
    scheduleFigures();
    saveState();
  }

  // ---- Drawing the spectrum ----------------------------------------------------------------------------

  var PAD = { left: 12, right: 12, top: 34, bottom: 42 };
  var drag = null, hoverPx = null, intLabels = [], editing = -1;

  function canvasSize() {
    var c = $('spec-canvas'), rect = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(320, Math.round(rect.width * dpr)), h = Math.round(Math.max(260, rect.width * 0.36) * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { c: c, g: c.getContext('2d'), W: w, H: h, dpr: dpr };
  }

  function drawSpectrum() {
    if ($('panel-process').hidden) return;
    renderNmr(null, current(), false);
  }

  /** The whole width of a spectrum, at the height the student chose. */
  function wholeView(exp) {
    var d = state.data[exp], info = expInfo(exp);
    return { from: info.from, to: info.to, vscale: d && d.view ? d.view.vscale : 1 };
  }

  /** Draws a spectrum as it is processed: in the console, or (report) as a figure for the report, the whole spectrum with no cursor. */
  function renderNmr(c, exp, report) {
    var s = report ? surface(c, 0.36, 0, true) : canvasSize(), g = s.g, W = s.W, H = s.H, dpr = s.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.font = Math.round(12 * dpr) + 'px system-ui, sans-serif';
    if (!exp) { message(g, W, H, 'Record a spectrum on the Acquire tab; it will appear here.'); return; }
    var d = state.data[exp], pr = processed(exp);
    if (!pr) { message(g, W, H, 'Fetching the recording…'); return; }
    var x0 = PAD.left * dpr, x1 = W - PAD.right * dpr, y0 = PAD.top * dpr, y1 = H - PAD.bottom * dpr;

    if (!d.proc.ft) {
      // the FID itself, before the Fourier transform
      var fid = pr.fid, n = Math.min(fid.n, 6000), max = 0, i;
      for (i = 0; i < n; i++) max = Math.max(max, Math.abs(fid.re[i]));
      var mid = (y0 + y1) / 2;
      g.strokeStyle = '#1c4c9a'; g.lineWidth = 1; g.beginPath();
      for (var px = 0; px <= x1 - x0; px++) {
        var a = Math.floor(px / (x1 - x0) * n), b = Math.max(a + 1, Math.floor((px + 1) / (x1 - x0) * n)), lo = 0, hi = 0;
        for (i = a; i < b && i < n; i++) { lo = Math.min(lo, fid.re[i]); hi = Math.max(hi, fid.re[i]); }
        g.moveTo(x0 + px, mid - hi / (max || 1) * (y1 - y0) * 0.48);
        g.lineTo(x0 + px, mid - lo / (max || 1) * (y1 - y0) * 0.48 + 0.5);
      }
      g.stroke();
      g.fillStyle = '#4b5854';
      g.fillText('FID: ' + expInfo(exp).name + ', ' + fid.scans + ' scans, receiver gain ' + fid.gain + '. Fourier transform it to see the spectrum.', x0, y0 - 12 * dpr);
      g.fillText('time →  (' + (n / fid.width).toFixed(2) + ' s shown)', x0, H - 14 * dpr);
      return;
    }

    var spec = pr.spec, y = pr.y, v = report ? wholeView(exp) : view(exp), ref = d.proc.ref;
    var dept = exp === 'DEPT135';
    var zeroY = dept ? y0 + (y1 - y0) * 0.55 : y1 - 4 * dpr;
    var top = pr.max / v.vscale || 1;
    var span = dept ? (zeroY - y0) : (zeroY - y0);
    function px2ppm(px) { return v.from - (v.from - v.to) * (px - x0) / (x1 - x0); }
    function ppm2px(ppm) { return x0 + (v.from - ppm) / (v.from - v.to) * (x1 - x0); }
    function idx(ppm) { return M.indexAt(spec, ppm - ref); }
    var fill = report ? 0.75 : 0.92;        // a printed figure leaves room above the tallest peak for its label
    function yPix(val) { return zeroY - val / top * span * fill; }

    // axis
    g.strokeStyle = '#8d9994'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y1 + 2 * dpr); g.lineTo(x1, y1 + 2 * dpr); g.stroke();
    var stepPpm = niceStep(Math.abs(v.from - v.to) / 12);
    g.fillStyle = '#17211e'; g.textAlign = 'center';
    for (var t = Math.ceil(v.to / stepPpm) * stepPpm; t <= v.from + 1e-9; t += stepPpm) {
      var xp = ppm2px(t);
      g.beginPath(); g.moveTo(xp, y1 + 2 * dpr); g.lineTo(xp, y1 + 7 * dpr); g.stroke();
      g.fillText(t.toFixed(stepPpm < 0.1 ? 2 : (stepPpm < 1 ? 1 : 0)), xp, y1 + 20 * dpr);
    }
    g.fillText('ppm', x1 - 14 * dpr, H - 6 * dpr);
    g.textAlign = 'left';
    if (dept) { g.strokeStyle = '#c7d1cc'; g.beginPath(); g.moveTo(x0, zeroY); g.lineTo(x1, zeroY); g.stroke(); }

    // selection band while dragging
    if (!report && drag && Math.abs(drag.x1 - drag.x0) > 3) {
      g.fillStyle = mode === 'int' ? 'rgba(27, 122, 64, 0.12)' : 'rgba(28, 76, 154, 0.10)';
      g.fillRect(Math.min(drag.x0, drag.x1), y0, Math.abs(drag.x1 - drag.x0), y1 - y0);
    }

    // the spectrum: the lowest and highest point under each column of pixels
    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, y1 + dpr); g.clip();
    g.strokeStyle = '#17211e'; g.lineWidth = Math.max(1, dpr * 0.9); g.beginPath();
    for (var col = 0; col <= x1 - x0; col++) {
      var ia = idx(px2ppm(x0 + col)), ib = idx(px2ppm(x0 + col + 1));
      var lo2 = Math.round(Math.min(ia, ib)), hi2 = Math.round(Math.max(ia, ib));
      lo2 = Math.max(0, lo2); hi2 = Math.min(y.length - 1, Math.max(hi2, lo2));
      if (lo2 >= y.length || hi2 < 0) continue;
      var mn = Infinity, mx = -Infinity;
      for (var k = lo2; k <= hi2; k++) { if (y[k] < mn) mn = y[k]; if (y[k] > mx) mx = y[k]; }
      if (col === 0) g.moveTo(x0 + col, yPix(mx)); else g.lineTo(x0 + col, yPix(mx));
      if (mn !== mx) g.lineTo(x0 + col, yPix(mn));
    }
    g.stroke();

    // integrals: the running sum over each region, and its value
    if (!report) intLabels = [];
    if (proton(exp) && d.proc.integrals.length) {
      var areas = d.proc.integrals.map(function (r) { return M.integrate(y, Math.round(idx(r[0])), Math.round(idx(r[1]))); });
      var refI = d.proc.intRef >= 0 && d.proc.intRef < areas.length ? d.proc.intRef : 0;
      var factor = areas[refI] ? (d.proc.intRef >= 0 ? d.proc.intValue : 1) / areas[refI] : 0;
      var biggest = Math.max.apply(null, areas.map(Math.abs)) || 1;
      d.proc.integrals.forEach(function (r, n2) {
        var a2 = Math.round(Math.min(idx(r[0]), idx(r[1]))), b2 = Math.round(Math.max(idx(r[0]), idx(r[1])));
        var hgt = (y1 - y0) * 0.45 * areas[n2] / biggest, run = 0, base = zeroY - 26 * dpr;
        g.strokeStyle = '#1b7a40'; g.lineWidth = Math.max(1, dpr * 1.2); g.beginPath();
        for (var j = a2; j <= b2; j++) {
          run += y[j];
          var xx = ppm2px(M.ppmAt(spec, j) + ref), yy = base - run / (areas[n2] || 1) * hgt;
          if (j === a2) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.stroke();
        var label = (areas[n2] * factor).toFixed(2);
        var lx = ppm2px((r[0] + r[1]) / 2);
        g.fillStyle = n2 === d.proc.intRef ? '#1b7a40' : '#17211e';
        g.textAlign = 'center';
        g.font = 'bold ' + Math.round(12 * dpr) + 'px system-ui, sans-serif';
        g.fillText(label, lx, zeroY - 8 * dpr);
        g.font = Math.round(12 * dpr) + 'px system-ui, sans-serif';
        g.textAlign = 'left';
        if (!report) intLabels.push({ n: n2, x: lx, y: zeroY - 8 * dpr, w: 36 * dpr });
      });
    }

    // picked peaks, labelled with their shifts
    if (d.proc.peaks) {
      // never so low that the noise itself is picked
      var thr = Math.max(pr.max * d.proc.threshold / 100, 5 * pr.noise);
      var peaks = M.pickPeaks(spec, y, thr, dept, proton(exp) ? 0.6 : 2);
      var shown = peaks.filter(function (pi) { var pp = M.ppmAt(spec, pi) + ref; return pp <= v.from && pp >= v.to; });
      if (shown.length > 80) shown = shown.slice(0, 80);
      g.fillStyle = '#1c4c9a';
      shown.forEach(function (pi) {
        var pp = M.ppmAt(spec, pi) + ref, xx = ppm2px(pp);
        g.save();
        g.translate(xx + 4 * dpr, Math.max(y0 + 2 * dpr, Math.min(yPix(y[pi]), zeroY) - 6 * dpr));
        g.rotate(-Math.PI / 2);
        g.fillText(pp.toFixed(proton(exp) ? 3 : 1), 0, 0);
        g.restore();
      });
    }
    g.restore();

    // the cursor
    if (!report && hoverPx !== null && hoverPx >= x0 && hoverPx <= x1) {
      g.strokeStyle = 'rgba(171, 42, 28, 0.55)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(hoverPx, y0 - 6 * dpr); g.lineTo(hoverPx, y1); g.stroke();
      var hp = px2ppm(hoverPx), hi3 = Math.round(idx(hp));
      var val = hi3 >= 0 && hi3 < y.length ? y[hi3] / (pr.max || 1) * 100 : 0;
      $('spec-readout').textContent = 'δ ' + hp.toFixed(proton(exp) ? 3 : 2) + ' ppm · height ' + val.toFixed(1) + '% of the tallest peak';
    }
    g.fillStyle = '#4b5854';
    g.fillText(expInfo(exp).name + ' · ' + d.scans + ' scans · LB ' + d.proc.lb + ' Hz · ph0 ' + d.proc.ph0 + '° · ph1 ' + d.proc.ph1 + '°' + (d.proc.baseline ? ' · baseline corrected' : '') + (d.proc.ref ? ' · referenced' : ' · not referenced'), x0, 16 * dpr);

    if (!report) drawSpectrum.map = { x0: x0, x1: x1, px2ppm: px2ppm, idx: idx };
  }

  function message(g, W, H, text) {
    g.fillStyle = '#74807c';
    g.textAlign = 'center';
    g.fillText(text, W / 2, H / 2);
    g.textAlign = 'left';
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  function bindCanvas() {
    var c = $('spec-canvas');
    function pos(e) { var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), dpr: dpr }; }
    c.addEventListener('pointerdown', function (e) {
      var exp = current();
      if (!exp || !state.data[exp].proc.ft) return;
      var p = pos(e);
      // a click on an integral's number opens it for editing
      for (var i = 0; i < intLabels.length; i++) {
        var L = intLabels[i];
        if (Math.abs(p.x - L.x) < L.w / 2 && Math.abs(p.y - L.y + 4 * p.dpr) < 12 * p.dpr) { openIntegral(L.n); return; }
      }
      drag = { x0: p.x, x1: p.x };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    c.addEventListener('pointermove', function (e) {
      var p = pos(e);
      hoverPx = p.x;
      if (drag) drag.x1 = p.x;
      drawSpectrum();
    });
    c.addEventListener('pointerleave', function () { hoverPx = null; if (!drag) drawSpectrum(); $('spec-readout').innerHTML = '&nbsp;'; });
    c.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var exp = current(), map = drawSpectrum.map, p = pos(e), d0 = drag;
      drag = null;
      if (!exp || !map) return;
      var a = map.px2ppm(d0.x0), b = map.px2ppm(p.x);
      if (Math.abs(p.x - d0.x0) > 4 * p.dpr) {
        if (mode === 'int' && proton(exp)) changeProc(function (pr) { pr.integrals.push([Math.max(a, b), Math.min(a, b)]); });
        else { var v = view(exp); v.from = Math.max(a, b); v.to = Math.min(a, b); drawSpectrum(); saveState(); }
      } else if (mode === 'ref') {
        setReference(exp, map.idx(a));
      }
    });
    c.addEventListener('dblclick', function () { var exp = current(); if (exp) { state.data[exp].view = null; drawSpectrum(); saveState(); } });
    c.addEventListener('wheel', function (e) { if (!current()) return; e.preventDefault(); zoomHeight(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    window.addEventListener('resize', function () { drawSpectrum(); });
  }

  function setReference(exp, index) {
    var pr = processed(exp);
    if (!pr || !pr.y) return;
    var w = Math.round(pr.spec.size * (proton(exp) ? 0.0015 : 0.002));
    var peak = M.nearestPeak(pr.y, index, w);
    var target = (M.REFERENCES[exp] || [])[parseInt($('ref-line').value, 10) || 0];
    if (!target) return;
    changeProc(function (p) { p.ref = target.ppm - M.ppmAt(pr.spec, peak); });
    mode = '';
    showProcControls();
    $('process-msg').textContent = 'Referenced: that peak is now at ' + target.ppm.toFixed(2) + ' ppm.';
  }

  function openIntegral(n) {
    editing = n;
    var exp = current(), p = state.data[exp].proc;
    $('int-edit').hidden = false;
    $('int-value').value = p.intRef === n ? String(p.intValue) : '';
    $('int-value').focus();
  }

  function setIntegralValue() {
    var v = M.readNumber($('int-value').value);
    if (v === null || v <= 0 || editing < 0) return;
    changeProc(function (p) { p.intRef = editing; p.intValue = v; });
    $('int-edit').hidden = true;
    editing = -1;
  }

  // ---- Charts: the IR spectrum, the chromatogram, the mass spectrum ----------------------------------------

  /** Readies a canvas: sized to its place on the page, or (for the report) 1440 wide at twice the scale, so that it prints sharp. */
  function surface(c, ratio, minH, fixed) {
    var w, h, dpr;
    if (fixed) { dpr = 2; w = 1440; h = Math.round(w * ratio); }
    else {
      var rect = c.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = Math.max(320, Math.round(rect.width * dpr));
      h = Math.round(Math.max(minH, rect.width * ratio) * dpr);
    }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.font = Math.round(12 * dpr) + 'px system-ui, sans-serif';
    g.textAlign = 'left';
    return { g: g, W: w, H: h, dpr: dpr };
  }

  /** Pointer handling shared by the three charts: hover, drag across to zoom, click, double-click for all of it. */
  function bindChart(id, h) {
    var c = $(id), drag = null;
    function px(e) { var r = c.getBoundingClientRect(); return (e.clientX - r.left) * (c.width / r.width); }
    c.addEventListener('pointerdown', function (e) {
      drag = { x0: px(e), x1: px(e) };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    c.addEventListener('pointermove', function (e) {
      var x = px(e);
      if (drag) { drag.x1 = x; if (h.drag) h.drag(drag); }
      if (h.hover) h.hover(x);
    });
    c.addEventListener('pointerleave', function () { if (!drag && h.leave) h.leave(); });
    c.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var d = drag, x = px(e), dpr = window.devicePixelRatio || 1;
      drag = null;
      if (h.drag) h.drag(null);
      if (h.zoom && Math.abs(x - d.x0) > 4 * dpr) h.zoom(d.x0, x);
      else if (h.click) h.click(x);
    });
    c.addEventListener('dblclick', function () { if (h.full) h.full(); });
  }

  function axisLabel(g, text, x, y, vertical) {
    g.save();
    g.translate(x, y);
    if (vertical) g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillStyle = '#4b5854';
    g.fillText(text, 0, 0);
    g.restore();
  }

  // ---- The IR -------------------------------------------------------------------------------------------

  var irHover = null, irDrag = null;

  function receiveIr(msg) {
    state.ir = { from: msg.from, step: msg.step, background: !!msg.background, sample: !!msg.sample, clamped: !!(state.sample && state.sample.clamp), t: msg.t };
    state.irView = null;
    var notes = [];
    if (!msg.sample) notes.push('There was nothing on the crystal, so this is the spectrum of the empty crystal' + (msg.background ? '.' : ' and the air.'));
    else if (solid && !(state.sample && state.sample.clamp)) notes.push('The bands are weak: crystals of a solid hardly touch the crystal until the clamp presses them down.');
    if (!msg.background) notes.push('No background was recorded, so the carbon dioxide (near 2350 cm⁻¹) and the water vapour in the air are in the spectrum. Record a background on the clean crystal, then the sample again.');
    $('ir-status').textContent = notes.length ? notes.join(' ') : 'Recorded. Read the bands into Table 3.';
    drawIr();
    scheduleFigures();
    showRoutine();
    updateNote();
    saveState();
  }

  function irView() { return state.irView || { from: 4000, to: 600 }; }

  /** Whether the last IR spectrum was of the unknown, pressed down if it is a solid. */
  function irRecorded() { return !!(state.ir && state.ir.sample && (!solid || state.ir.clamped)); }

  function drawIr(c, report) {
    var s = surface(c || $('ir-canvas'), 0.34, 240, report), g = s.g, W = s.W, H = s.H, dpr = s.dpr, ir = state.ir;
    if (!ir) { if (!report) drawIr.map = null; message(g, W, H, 'Record a spectrum: it will appear here.'); return; }
    var x0 = 50 * dpr, x1 = W - 14 * dpr, y0 = 16 * dpr, y1 = H - 42 * dpr, v = report ? { from: 4000, to: 600 } : irView(), i;
    var low = 100;
    for (i = 0; i < ir.t.length; i++) if (ir.t[i] < low) low = ir.t[i];
    // room under the deepest band for its label
    var bottom = Math.min(80, Math.floor((low - 0.2 * (100 - low) - 2) / 10) * 10), top = 104;
    function cmToPx(cm) { return x0 + (v.from - cm) / (v.from - v.to) * (x1 - x0); }
    function pxToCm(px) { return v.from - (px - x0) / (x1 - x0) * (v.from - v.to); }
    function tToPx(t) { return y1 - (t - bottom) / (top - bottom) * (y1 - y0); }

    g.lineWidth = 1;
    g.textAlign = 'right'; g.fillStyle = '#17211e';
    var tStep = 100 - bottom > 60 ? 20 : 10;
    for (var tt = Math.max(0, Math.ceil(bottom / tStep) * tStep); tt <= 100; tt += tStep) {
      var yy = tToPx(tt);
      g.strokeStyle = '#e6ebe9'; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.fillText(String(tt), x0 - 6 * dpr, yy + 4 * dpr);
    }
    g.textAlign = 'center'; g.strokeStyle = '#8d9994';
    var step = niceStep((v.from - v.to) / 10);
    for (var cm = Math.ceil(v.to / step) * step; cm <= v.from + 1e-9; cm += step) {
      var xx = cmToPx(cm);
      g.beginPath(); g.moveTo(xx, y1); g.lineTo(xx, y1 + 5 * dpr); g.stroke();
      g.fillText(String(Math.round(cm)), xx, y1 + 18 * dpr);
    }
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke();
    axisLabel(g, 'Wavenumber (cm⁻¹)', (x0 + x1) / 2, H - 6 * dpr, false);
    axisLabel(g, 'Transmittance (%)', 14 * dpr, (y0 + y1) / 2, true);

    if (!report && irDrag && Math.abs(irDrag.x1 - irDrag.x0) > 3) {
      g.fillStyle = 'rgba(28, 76, 154, 0.10)';
      g.fillRect(Math.min(irDrag.x0, irDrag.x1), y0, Math.abs(irDrag.x1 - irDrag.x0), y1 - y0);
    }

    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, y1); g.clip();
    g.strokeStyle = '#a3241a'; g.lineWidth = Math.max(1, dpr * 1.1); g.beginPath();
    var first = true;
    for (i = 0; i < ir.t.length; i++) {
      var at = ir.from - i * ir.step;
      if (at > v.from + ir.step || at < v.to - ir.step) continue;
      if (first) { g.moveTo(cmToPx(at), tToPx(ir.t[i])); first = false; } else g.lineTo(cmToPx(at), tToPx(ir.t[i]));
    }
    g.stroke();
    if (state.irBands) {
      // each band's wavenumber, running down from the bottom of its dip
      g.fillStyle = '#1c4c9a'; g.textAlign = 'left';
      M.pickBands(ir.t, ir.from, ir.step, state.irThreshold / 100).forEach(function (b) {
        if (b.cm1 > v.from || b.cm1 < v.to) return;
        g.save();
        g.translate(cmToPx(b.cm1) - 4 * dpr, tToPx(ir.t[b.i]) + 6 * dpr);
        g.rotate(Math.PI / 2);
        g.fillText(String(Math.round(b.cm1)), 0, 0);
        g.restore();
      });
    }
    g.restore();

    if (!report && irHover !== null && irHover >= x0 && irHover <= x1) {
      g.strokeStyle = 'rgba(28, 76, 154, 0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(irHover, y0); g.lineTo(irHover, y1); g.stroke();
      var hc = pxToCm(irHover), hi = Math.round((ir.from - hc) / ir.step);
      if (hi >= 0 && hi < ir.t.length) $('ir-readout').textContent = Math.round(hc) + ' cm⁻¹ · ' + ir.t[hi].toFixed(1) + '% transmittance';
    }
    if (!report) drawIr.map = { pxToCm: pxToCm };
  }

  function bindIr() {
    $('ir-bands').addEventListener('click', function () {
      state.irBands = !state.irBands;
      $('ir-bands').setAttribute('aria-pressed', state.irBands ? 'true' : 'false');
      drawIr(); scheduleFigures(); saveState();
    });
    $('ir-threshold').addEventListener('input', function () { state.irThreshold = parseInt($('ir-threshold').value, 10) || 10; drawIr(); scheduleFigures(); saveState(); });
    $('ir-full').addEventListener('click', function () { state.irView = null; drawIr(); saveState(); });
    $('ir-bands').setAttribute('aria-pressed', state.irBands ? 'true' : 'false');
    $('ir-threshold').value = state.irThreshold;
    bindChart('ir-canvas', {
      hover: function (x) { irHover = x; drawIr(); },
      leave: function () { irHover = null; drawIr(); $('ir-readout').innerHTML = '&nbsp;'; },
      drag: function (d) { irDrag = d; drawIr(); },
      zoom: function (a, b) {
        if (!drawIr.map) return;
        var ca = drawIr.map.pxToCm(a), cb = drawIr.map.pxToCm(b);
        state.irView = { from: Math.min(4000, Math.max(ca, cb)), to: Math.max(600, Math.min(ca, cb)) };
        drawIr(); saveState();
      },
      full: function () { state.irView = null; drawIr(); saveState(); }
    });
  }

  // ---- The GC-MS ------------------------------------------------------------------------------------------

  var tic = null;            // the chromatogram: { step, values, upTo } (not saved: asked for again after a reload)
  var gcRunning = false, ticHover = null, ticDrag = null, msHover = null, msDrag = null;

  function receiveGcStart(msg) {
    state.gc = { seed: msg.seed, done: false };
    state.ms = null;
    state.msView = null;
    state.ticView = null;
    tic = null;
    gcRunning = true;
    gcStatus(); drawTic(); drawMs(); checkRetention();
    showRoutine(); updateNote(); saveState();
  }

  function receiveTic(msg) {
    if (!tic || tic.values.length !== msg.length) tic = { step: msg.step, values: new Array(msg.length), upTo: 0 };
    for (var i = 0; i < msg.values.length; i++) tic.values[msg.from + i] = msg.values[i];
    tic.upTo = Math.max(tic.upTo, msg.from + msg.values.length);
    if (msg.done) {
      gcRunning = false;
      if (state.gc) state.gc.done = true;
      updateNote(); checkRetention(); scheduleFigures(); saveState();
    }
    gcStatus(); drawTic(); showRoutine();
  }

  function receiveMs(msg) {
    state.ms = { minutes: msg.minutes, peaks: msg.peaks || [] };
    drawTic(); drawMs(); scheduleFigures(); saveState();
  }

  function gcStatus() {
    var text;
    if (tic && gcRunning) {
      var t = tic.upTo * tic.step;
      text = 'Run under way: ' + t.toFixed(1) + ' of ' + M.GC.minutes.toFixed(1) + ' min · oven ' + Math.round(M.ovenAt(t)) + ' °C' + (t < M.GC.delay ? ' · the detector stays off for the first 2 min, while the solvent comes off' : '');
    } else if (gcRunning) text = 'Injected: the run has started.';
    else if (tic) text = 'Run finished. The oven held 35 °C for 2 min, then rose 15 °C a minute to 280 °C. Click your compound’s peak to see its mass spectrum.';
    else if (state.gc) text = 'Fetching the run…';
    else text = 'No run yet: inject your sample (part 1, the GC-MS tab).';
    $('gc-status').textContent = text;
  }

  function drawTic(c, report) {
    var s = surface(c || $('tic-canvas'), 0.2, 170, report), g = s.g, W = s.W, H = s.H, dpr = s.dpr;
    var x0 = 50 * dpr, x1 = W - 14 * dpr, y0 = 12 * dpr, y1 = H - 40 * dpr, i;
    var v = (!report && state.ticView) || { from: 0, to: M.GC.minutes };
    function tToPx(t) { return x0 + (t - v.from) / (v.to - v.from) * (x1 - x0); }
    function pxToT(px) { return v.from + (px - x0) / (x1 - x0) * (v.to - v.from); }
    if (!report) drawTic.map = { pxToT: pxToT };
    g.lineWidth = 1; g.strokeStyle = '#8d9994'; g.fillStyle = '#17211e'; g.textAlign = 'center';
    var tStep = niceStep((v.to - v.from) / 9);
    for (var m = Math.ceil(v.from / tStep) * tStep; m <= v.to + 1e-9; m += tStep) {
      var xx = tToPx(m);
      g.beginPath(); g.moveTo(xx, y1); g.lineTo(xx, y1 + 5 * dpr); g.stroke();
      g.fillText(tStep < 0.1 ? m.toFixed(2) : (tStep < 1 ? m.toFixed(1) : String(Math.round(m))), xx, y1 + 18 * dpr);
    }
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke();
    axisLabel(g, 'Time (min)', (x0 + x1) / 2, H - 6 * dpr, false);
    axisLabel(g, 'Ion current', 14 * dpr, (y0 + y1) / 2, true);
    if (!tic) { message(g, W, H, state.gc ? 'Fetching the run…' : 'Inject your sample: the chromatogram builds up here.'); return; }
    // the scale follows the tallest point in view
    var max = 0, a = Math.max(0, Math.floor(v.from / tic.step)), b = Math.min(tic.upTo, Math.ceil(v.to / tic.step) + 1);
    for (i = a; i < b; i++) if (tic.values[i] > max) max = tic.values[i];
    var topV = (max || 1) * 1.08;
    function vToPx(val) { return y1 - val / topV * (y1 - y0); }
    if (!report && ticDrag && Math.abs(ticDrag.x1 - ticDrag.x0) > 3) {
      g.fillStyle = 'rgba(28, 76, 154, 0.10)';
      g.fillRect(Math.min(ticDrag.x0, ticDrag.x1), y0, Math.abs(ticDrag.x1 - ticDrag.x0), y1 - y0);
    }
    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, y1 + dpr); g.clip();
    g.strokeStyle = '#17211e'; g.lineWidth = Math.max(1, dpr); g.beginPath();
    for (i = a; i < b; i++) {
      var xp = tToPx(i * tic.step), yp = vToPx(tic.values[i] || 0);
      if (i === a) g.moveTo(xp, yp); else g.lineTo(xp, yp);
    }
    g.stroke();
    g.restore();
    if (state.ms && state.ms.minutes >= v.from && state.ms.minutes <= v.to) {
      var xm = tToPx(state.ms.minutes);
      g.strokeStyle = '#1c4c9a'; g.lineWidth = Math.max(1, dpr * 1.5);
      g.beginPath(); g.moveTo(xm, y0); g.lineTo(xm, y1); g.stroke();
    }
    if (!report && ticHover !== null && ticHover >= x0 && ticHover <= x1) {
      var th = pxToT(ticHover);
      g.strokeStyle = 'rgba(171, 42, 28, 0.55)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ticHover, y0); g.lineTo(ticHover, y1); g.stroke();
      $('tic-readout').textContent = th.toFixed(2) + ' min · oven ' + Math.round(M.ovenAt(th)) + ' °C · click for the mass spectrum here';
    }
  }

  function msView(whole) {
    if (state.msView && !whole) return state.msView;
    var hi = 60;
    (state.ms ? state.ms.peaks : []).forEach(function (p) { if (p[1] >= 1 && p[0] + 12 > hi) hi = p[0] + 12; });
    return { from: 10, to: Math.ceil(hi / 10) * 10 };
  }

  function drawMs(c, report) {
    var s = surface(c || $('ms-canvas'), 0.3, 220, report), g = s.g, W = s.W, H = s.H, dpr = s.dpr;
    var x0 = 50 * dpr, x1 = W - 14 * dpr, y0 = 30 * dpr, y1 = H - 40 * dpr;
    if (!state.ms) { if (!report) drawMs.map = null; message(g, W, H, tic ? 'Click the chromatogram above to see the mass spectrum at that moment.' : 'The mass spectrum will appear here.'); return; }
    var v = msView(report), peaks = state.ms.peaks;
    function mzToPx(mz) { return x0 + (mz - v.from) / (v.to - v.from) * (x1 - x0); }
    function pxToMz(px) { return v.from + (px - x0) / (x1 - x0) * (v.to - v.from); }
    function hToPx(h) { return y1 - h / 100 * (y1 - y0); }
    if (!report) drawMs.map = { pxToMz: pxToMz };
    g.lineWidth = 1; g.textAlign = 'right'; g.fillStyle = '#17211e';
    for (var h = 0; h <= 100; h += 20) {
      var yy = hToPx(h);
      g.strokeStyle = '#e6ebe9'; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.fillText(String(h), x0 - 6 * dpr, yy + 4 * dpr);
    }
    g.textAlign = 'center'; g.strokeStyle = '#8d9994';
    var step = niceStep((v.to - v.from) / 12);
    for (var mz = Math.ceil(v.from / step) * step; mz <= v.to + 1e-9; mz += step) {
      var xx = mzToPx(mz);
      g.beginPath(); g.moveTo(xx, y1); g.lineTo(xx, y1 + 5 * dpr); g.stroke();
      g.fillText(String(Math.round(mz)), xx, y1 + 18 * dpr);
    }
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke();
    axisLabel(g, 'm/z', (x0 + x1) / 2, H - 6 * dpr, false);
    axisLabel(g, 'Relative abundance (%)', 14 * dpr, (y0 + y1) / 2, true);
    g.fillStyle = '#4b5854'; g.textAlign = 'left';
    g.fillText('Mass spectrum at ' + state.ms.minutes.toFixed(2) + ' min', x0, 16 * dpr);

    if (!report && msDrag && Math.abs(msDrag.x1 - msDrag.x0) > 3) {
      g.fillStyle = 'rgba(28, 76, 154, 0.10)';
      g.fillRect(Math.min(msDrag.x0, msDrag.x1), y0, Math.abs(msDrag.x1 - msDrag.x0), y1 - y0);
    }
    var perUnit = (x1 - x0) / (v.to - v.from), bar = Math.max(1, Math.min(5 * dpr, perUnit * 0.55));
    g.fillStyle = '#17211e';
    var shown = peaks.filter(function (p) { return p[0] >= v.from && p[0] <= v.to; });
    shown.forEach(function (p) { g.fillRect(mzToPx(p[0]) - bar / 2, hToPx(p[1]), bar, y1 - hToPx(p[1])); });
    // the m/z of the taller peaks, tallest first, where there is room
    var labelled = [];
    g.fillStyle = '#1c4c9a'; g.textAlign = 'center';
    shown.slice().sort(function (a, b) { return b[1] - a[1]; }).forEach(function (p) {
      if (p[1] < 4) return;
      var x = mzToPx(p[0]);
      for (var k = 0; k < labelled.length; k++) if (Math.abs(labelled[k] - x) < 26 * dpr) return;
      labelled.push(x);
      g.fillText(String(p[0]), x, hToPx(p[1]) - 5 * dpr);
    });
    if (!report && msHover !== null && msHover >= x0 && msHover <= x1) {
      var at = pxToMz(msHover), best = null;
      shown.forEach(function (p) { if (Math.abs(p[0] - at) <= Math.max(0.6, 4 * dpr / perUnit) && (!best || Math.abs(p[0] - at) < Math.abs(best[0] - at))) best = p; });
      $('ms-readout').textContent = best ? 'm/z ' + best[0] + ' · ' + best[1].toFixed(1) + '% of the base peak' : 'm/z ' + Math.round(at);
    }
  }

  function bindGc() {
    bindChart('tic-canvas', {
      hover: function (x) { ticHover = x; drawTic(); },
      leave: function () { ticHover = null; drawTic(); $('tic-readout').innerHTML = '&nbsp;'; },
      drag: function (d) { ticDrag = d; drawTic(); },
      zoom: function (a, b) {
        if (!tic || !drawTic.map) return;
        var ta = drawTic.map.pxToT(a), tb = drawTic.map.pxToT(b);
        if (Math.abs(ta - tb) < 0.05) return;
        state.ticView = { from: Math.max(0, Math.min(ta, tb)), to: Math.min(M.GC.minutes, Math.max(ta, tb)) };
        drawTic(); saveState();
      },
      click: function (x) {
        if (!tic || !drawTic.map) return;
        var t = drawTic.map.pxToT(x);
        if (t < 0 || t > tic.upTo * tic.step) return;
        sendBench('MsAt', t.toFixed(2));
      },
      full: function () { state.ticView = null; drawTic(); saveState(); }
    });
    bindChart('ms-canvas', {
      hover: function (x) { msHover = x; drawMs(); },
      leave: function () { msHover = null; drawMs(); $('ms-readout').innerHTML = '&nbsp;'; },
      drag: function (d) { msDrag = d; drawMs(); },
      zoom: function (a, b) {
        if (!drawMs.map) return;
        var ma = drawMs.map.pxToMz(a), mb = drawMs.map.pxToMz(b);
        if (Math.abs(ma - mb) < 3) return;
        state.msView = { from: Math.max(0, Math.floor(Math.min(ma, mb))), to: Math.ceil(Math.max(ma, mb)) };
        drawMs(); saveState();
      },
      full: function () { state.msView = null; drawMs(); saveState(); }
    });
    ['rt', 'm', 'base'].forEach(function (key) {
      var box = $(key === 'rt' ? 'ms-rt' : (key === 'm' ? 'ms-m' : 'ms-base'));
      box.value = state.msFields[key] || '';
      box.addEventListener('input', function () {
        state.msFields[key] = box.value;
        saveState();
        if (key === 'rt') checkRetention();
        else { scheduleCheck(400); if (key === 'm') showLost(); }
      });
    });
    window.addEventListener('resize', function () { drawIr(); drawTic(); drawMs(); });
  }

  /** The retention time is checked here, against the top of the student's own chromatogram. */
  function checkRetention() {
    var finished = tic && tic.upTo >= tic.values.length;
    var apex = finished ? M.ticApex(tic.values, tic.step) : null;
    var r = M.checkRetention(state.msFields.rt, apex);
    if (apex === null && state.gc) r = { ok: null, message: '' };       // the run is still coming
    mark('ms-rt', r.ok === true ? 1 : (r.ok === false ? -1 : 0));
    $('ms-rt-msg').textContent = r.message;
  }

  /** Table 4's "lost from M+" column, from the molecular ion the student gave. */
  function showLost() {
    state.readings.mf.forEach(function (r, i) {
      var cell = $('mf' + i + '-lost');
      if (!cell) return;
      var lost = M.massLost(state.msFields.m, r.mz);
      cell.textContent = lost === null ? '' : String(lost);
    });
  }

  // ---- What the spectra show: the reading tables ---------------------------------------------------
  // Each row goes to the 3D room to be judged against the student's own unknown; the page keeps no
  // list of anyone's signals. All the rows go together, since one signal may only be claimed once.

  var verdicts = {};          // field -> the 3D room's verdict
  var checkId = 0, checkTimer = null, lastEdited = { h: -1, c: -1, ir: -1, mf: -1 };

  function buildReadings() {
    KINDS.forEach(function (kind) {
      var body = $(kind + '-rows');
      body.textContent = '';
      state.readings[kind].forEach(function (row, i) { body.appendChild(readingRow(kind, row, i)); });
    });
    showLost();
    scheduleCheck(0);
    showReadingStatus();
  }

  function readingRow(kind, row, i) {
    var tr = el('tr', { 'data-row': String(i) });
    function markEmpty() { tr.classList.toggle('is-empty', !String(row[FIRST[kind]] || '').trim()); }
    markEmpty();
    function input(key, label, mode, cls) {
      var td = el('td', cls ? { 'class': cls } : null);
      var box = el('input', { type: 'text', autocomplete: 'off', inputmode: mode || 'text', 'aria-label': label + ', row ' + (i + 1), id: kind + i + '-' + key });
      box.value = row[key] || '';
      box.addEventListener('input', function () {
        row[key] = box.value; lastEdited[kind] = i; saveState();
        if (key === FIRST[kind]) markEmpty();
        if (key !== 'who') scheduleCheck(400);
        if (kind === 'mf') showLost();
        showReadingStatus();
      });
      box.addEventListener('focus', function () { lastEdited[kind] = i; showReadingMessage(kind); });
      td.appendChild(box);
      return td;
    }
    function select(key, label, options, names) {
      var td = el('td');
      var sel = el('select', { 'aria-label': label + ', row ' + (i + 1), id: kind + i + '-' + key });
      sel.appendChild(el('option', { value: '' }, '—'));
      options.forEach(function (o) { sel.appendChild(el('option', { value: o }, names[o] || o)); });
      sel.value = row[key] || '';
      sel.addEventListener('change', function () { row[key] = sel.value; lastEdited[kind] = i; saveState(); scheduleCheck(0); });
      sel.addEventListener('focus', function () { lastEdited[kind] = i; showReadingMessage(kind); });
      td.appendChild(sel);
      return td;
    }
    if (kind === 'h' || kind === 'c') tr.appendChild(input('ppm', 'δ in ppm', 'decimal', 'col-shift'));
    if (kind === 'h') {
      tr.appendChild(select('mult', 'Splitting', M.SPLITTINGS, M.SPLITTING_NAMES));
      tr.appendChild(input('j', 'J in Hz', 'text', 'col-j'));
      tr.appendChild(input('nH', 'Number of H', 'decimal', 'col-n'));
    } else if (kind === 'c') {
      tr.appendChild(select('type', 'DEPT-135 shows', M.CARBON_TYPES, M.CARBON_NAMES));
    } else if (kind === 'ir') {
      tr.appendChild(input('cm1', 'Band in cm⁻¹', 'numeric', 'col-shift'));
      tr.appendChild(select('strength', 'How strong', M.IR_STRENGTHS, M.IR_STRENGTH_NAMES));
      tr.appendChild(select('shape', 'Shape', M.IR_SHAPES, M.IR_SHAPE_NAMES));
    } else {
      tr.appendChild(input('mz', 'm/z', 'numeric', 'col-shift'));
      tr.appendChild(el('td', { 'class': 'col-lost', id: 'mf' + i + '-lost' }));
    }
    tr.appendChild(input('who', { h: 'Which H', c: 'Which C', ir: 'Which bond', mf: 'What it is' }[kind], 'text', 'col-who'));
    var td = el('td', { 'class': 'col-x' });
    var del = el('button', { type: 'button', 'class': 'link-button', 'aria-label': 'Remove row ' + (i + 1) }, '×');
    del.addEventListener('click', function () {
      state.readings[kind].splice(i, 1);
      if (!state.readings[kind].length) state.readings[kind].push(blankRow(kind));
      saveState();
      buildReadings();
    });
    td.appendChild(del);
    tr.appendChild(td);
    return tr;
  }

  function scheduleCheck(delay) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(sendCheck, delay);
  }

  function sendCheck() {
    if (!configured) return;
    var rows = [];
    KINDS.forEach(function (kind) {
      state.readings[kind].forEach(function (r, i) {
        if (!String(r[FIRST[kind]] || '').trim()) return;
        if (kind === 'h') rows.push({ field: 'h' + i, kind: 'h', ppm: r.ppm, mult: r.mult, j: r.j, nH: r.nH });
        else if (kind === 'c') rows.push({ field: 'c' + i, kind: 'c', ppm: r.ppm, type: r.type });
        else if (kind === 'ir') rows.push({ field: 'ir' + i, kind: 'ir', value: r.cm1, strength: r.strength, shape: r.shape });
        else rows.push({ field: 'mf' + i, kind: 'mf', value: r.mz });
      });
    });
    // the molecular ion and the base peak come last, so that the rows above keep their places
    if (String(state.msFields.m || '').trim()) rows.push({ field: 'mm', kind: 'mm', value: state.msFields.m });
    if (String(state.msFields.base || '').trim()) rows.push({ field: 'mb', kind: 'mb', value: state.msFields.base });
    checkId++;
    verdicts = {};
    if (!rows.length) { showVerdicts(); return; }
    sendBench('Check', JSON.stringify({ id: checkId, rows: rows }));
  }

  function receiveVerdicts(msg) {
    if (msg.id !== checkId) return;
    verdicts = {};
    msg.results.forEach(function (r) { verdicts[r.field] = r; });
    showVerdicts();
    scheduleReport();
  }

  function mark(id, v) {
    var node = $(id);
    if (!node) return;
    if (v === 1) node.setAttribute('data-state', 'ok');
    else if (v === -1) node.setAttribute('data-state', 'bad');
    else node.removeAttribute('data-state');
  }

  function showVerdicts() {
    KINDS.forEach(function (kind) {
      state.readings[kind].forEach(function (r, i) {
        var v = verdicts[kind + i] || {};
        mark(kind + i + '-' + FIRST[kind], v.ppm || 0);
        if (kind === 'h') { mark(kind + i + '-mult', v.mult || 0); mark(kind + i + '-j', v.j || 0); mark(kind + i + '-nH', v.nH || 0); }
        else if (kind === 'c') mark(kind + i + '-type', v.ctype || 0);
        else if (kind === 'ir') { mark(kind + i + '-strength', v.strength || 0); mark(kind + i + '-shape', v.shape || 0); }
      });
      showReadingMessage(kind);
    });
    [['mm', 'ms-m'], ['mb', 'ms-base']].forEach(function (f) {
      var v = verdicts[f[0]] || {};
      mark(f[1], v.ppm || 0);
      $(f[1] + '-msg').textContent = v.code ? M.checkText(v.code, v.off, '', f[0]) : '';
    });
    showReadingStatus();
  }

  /** The message under a table: for the row being worked on, or else the first row that needs looking at. */
  function showReadingMessage(kind) {
    var rows = state.readings[kind], pick = -1;
    function problem(i) { var v = verdicts[kind + i]; return v && v.code ? v : null; }
    if (lastEdited[kind] >= 0 && problem(lastEdited[kind])) pick = lastEdited[kind];
    else for (var i = 0; i < rows.length; i++) if (problem(i)) { pick = i; break; }
    var msg = $(kind + '-msg');
    if (pick < 0) { msg.textContent = ''; return; }
    var v = problem(pick);
    msg.textContent = 'Row ' + (pick + 1) + ': ' + M.checkText(v.code, v.off, sameRow(v.sameAs), kind);
    msg.removeAttribute('data-kind');
  }

  /** The row number on the page of a row the 3D room named by its place in the request. */
  function sameRow(index) {
    if (index < 0) return '';
    var all = [];
    KINDS.forEach(function (kd) { state.readings[kd].forEach(function (r, i) { if (String(r[FIRST[kd]] || '').trim()) all.push(i); }); });
    return all[index] !== undefined ? String(all[index] + 1) : '';
  }

  function showReadingStatus() {
    var hs = M.hydrogenSum(state.readings.h, formula), text = '';
    if (formula && hs && hs.any) text = 'Your H column adds up to ' + fmt(hs.sum) + ' H; the formula has ' + hs.formula + '.';
    var hStatus = $('h-status');
    hStatus.textContent = text;
    if (hs && hs.any && formula && Math.abs(hs.sum - hs.formula) > 1e-9) hStatus.setAttribute('data-kind', 'warn'); else hStatus.removeAttribute('data-kind');
    var carbons = state.readings.c.filter(function (r) { return String(r.ppm || '').trim(); }).length;
    var c = M.parseFormula(formula).C || 0, cText = '';
    if (formula && carbons) cText = carbons + (carbons === 1 ? ' carbon signal' : ' carbon signals') + ' for the ' + c + ' carbons in the formula' + (carbons > c ? ': more signals than carbons, so one of them is not your compound.' : (carbons < c ? ' (fewer is fine when some carbons are alike).' : '.'));
    var cStatus = $('c-status');
    cStatus.textContent = cText;
    if (carbons > c) cStatus.setAttribute('data-kind', 'warn'); else cStatus.removeAttribute('data-kind');
  }

  function fmt(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2); }

  function bindReadings() {
    KINDS.forEach(function (kind) {
      $(kind + '-add').addEventListener('click', function () {
        state.readings[kind].push(blankRow(kind));
        saveState();
        buildReadings();
        var last = state.readings[kind].length - 1;
        var box = $(kind + last + '-' + FIRST[kind]);
        if (box) box.focus();
      });
    });
  }

  // ---- Part 7: the structure ------------------------------------------------------------------------
  // Drawn on the board (draw.js). The page compares only its formula with the unknown's: whether it is
  // the right compound is for the instructor to mark.

  var board = null;

  function bindStructure() {
    var st = state.structure;
    board = window.NmrDraw.Board($('board-svg'), {
      onChange: function (mol) { state.structure.mol = mol; saveState(); showStructure(); }
    });
    board.load(st.mol);
    Array.prototype.forEach.call(document.querySelectorAll('.board-tools [data-tool]'), function (b) {
      b.addEventListener('click', function () { board.setTool(b.getAttribute('data-tool')); showTools(); });
    });
    $('board-undo').addEventListener('click', function () { board.undo(); });
    $('board-clear').addEventListener('click', function () { board.clear(); });
    // the report prints the structure cropped to what is drawn
    $('board').parentNode.insertBefore(el('div', { 'class': 'print-structure', id: 'print-structure', 'aria-hidden': 'true' }), $('board').nextSibling);
    [['structure-name', 'name'], ['structure-condensed', 'condensed']].forEach(function (f) {
      var box = $(f[0]), field = box.closest('.field');
      function markEmpty() { field.classList.toggle('is-empty', !box.value.trim()); }
      box.value = st[f[1]] || '';
      markEmpty();
      box.addEventListener('input', function () { state.structure[f[1]] = box.value; markEmpty(); saveState(); });
    });
    ['formula', 'ir', 'ms', 'nmr'].forEach(function (k) {
      var box = $('why-' + k), copy = el('div', { 'class': 'print-copy', 'aria-hidden': 'true' });
      box.value = st.why[k] || '';
      copy.textContent = box.value;
      box.parentNode.insertBefore(copy, box.nextSibling);
      box.addEventListener('input', function () { state.structure.why[k] = box.value; copy.textContent = box.value; saveState(); });
    });
    showStructure();
  }

  function showTools() {
    var tool = board.tool();
    Array.prototype.forEach.call(document.querySelectorAll('.board-tools [data-tool]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-tool') === tool ? 'true' : 'false');
    });
    $('board-undo').disabled = !board.canUndo();
  }

  /** What the page can say about a drawing: its formula against the unknown's, and anything impossible in it. */
  function structureCheck() {
    var mol = state.structure.mol;
    if (!mol.atoms.length) return null;
    var f = window.NmrDraw.formula(mol);
    f.same = !!formula && M.sameFormula(f.counts, formula);
    f.fine = f.same && !f.over.length && f.pieces === 1 && !f.charge;
    return f;
  }

  function showStructure() {
    var msg = $('board-msg'), f = structureCheck();
    $('print-structure').innerHTML = window.NmrDraw.svgMarkup(state.structure.mol, 420);
    showTools();
    msg.removeAttribute('data-kind');
    if (!f) { msg.textContent = ''; return; }
    var notes = [];
    if (f.over.length) notes.push(f.over.length === 1 ? 'One atom has more bonds than it can take (circled in red).' : f.over.length + ' atoms have more bonds than they can take (circled in red).');
    if (f.pieces > 1) notes.push('Your drawing is in ' + f.pieces + ' separate pieces; your unknown is one molecule.');
    if (f.charge) notes.push('Your structure has an overall charge; your unknown is a neutral molecule.');
    if (formula) notes.push(f.same ? 'Your structure is ' + M.subscripts(f.text) + ', the same formula as your unknown.' : 'Your structure is ' + M.subscripts(f.text) + '; your unknown is ' + M.subscripts(formula) + '.');
    msg.textContent = notes.join(' ');
    msg.setAttribute('data-kind', f.fine ? 'ok' : 'warn');
  }

  // ---- Part 8: the report ----------------------------------------------------------------------------

  var figureTimer = null, reportTimer = null;
  function scheduleFigures() { clearTimeout(figureTimer); figureTimer = setTimeout(buildFigures, 300); }
  function scheduleReport() { clearTimeout(reportTimer); reportTimer = setTimeout(updateReportStatus, 300); }

  var NMR_CAPTIONS = {
    '1H': '¹H NMR (400 MHz, CDCl₃)', '13C': '¹³C NMR (101 MHz, CDCl₃)', 'DEPT135': 'DEPT-135 (101 MHz, CDCl₃)',
    '1H-D2O': '¹H NMR (400 MHz, CDCl₃) after the D₂O shake'
  };

  /** Every spectrum recorded, drawn again for the report: the whole of each, processed as the student left it. */
  function buildFigures() {
    var box = $('report-figures'), n = 0;
    box.textContent = '';
    function figure(caption, draw) {
      var fig = el('figure', { 'class': 'report-figure' }), c = el('canvas', { 'class': 'report-canvas' });
      fig.appendChild(c);
      fig.appendChild(el('figcaption', null, 'Figure ' + (++n) + '. ' + caption));
      box.appendChild(fig);
      draw(c);
    }
    M.EXPERIMENTS.forEach(function (e) {
      var d = state.data[e.key];
      if (!d) return;
      figure(NMR_CAPTIONS[e.key] + ', ' + d.scans + (d.scans === 1 ? ' scan.' : ' scans.'), function (c) { renderNmr(c, e.key, true); });
    });
    if (state.ir) figure('IR (ATR), the pure compound' + (state.ir.sample ? '' : ': nothing on the crystal') + (state.ir.background ? '.' : ', with no background recorded.'), function (c) { drawIr(c, true); });
    if (tic) figure('Gas chromatogram (total ion current): oven 35 °C for 2 min, then 15 °C a minute to 280 °C.' + (state.ms ? ' The blue line marks where the mass spectrum was taken.' : ''), function (c) { drawTic(c, true); });
    if (state.ms) figure('Mass spectrum (EI, 70 eV) at ' + state.ms.minutes.toFixed(2) + ' min.', function (c) { drawMs(c, true); });
    if (!n) box.appendChild(el('p', { 'class': 'soft' }, 'No spectra yet: the ones you record will appear here.'));
  }

  /** A row of a table: "empty", "pending" (not judged yet), "ok" (every box right), "partial" (right so far) or "wrong". */
  function rowState(kind, i) {
    var r = state.readings[kind][i], v = verdicts[kind + i];
    if (!String(r[FIRST[kind]] || '').trim()) return 'empty';
    if (!v) return 'pending';
    var boxes = kind === 'h' ? [v.ppm, v.mult, v.j, v.nH] : (kind === 'c' ? [v.ppm, v.ctype] : (kind === 'ir' ? [v.ppm, v.strength, v.shape] : [v.ppm]));
    if (v.code || boxes.some(function (b) { return b === -1; })) return 'wrong';
    var full = kind === 'h' ? v.ppm === 1 && v.mult === 1 && v.nH === 1 : (kind === 'c' ? v.ppm === 1 && v.ctype === 1 : (kind === 'ir' ? v.ppm === 1 && v.strength === 1 && v.shape === 1 : v.ppm === 1));
    return full ? 'ok' : 'partial';
  }

  function tableCounts(kind) {
    var c = { ok: 0, wrong: 0, partial: 0, pending: 0, filled: 0 };
    state.readings[kind].forEach(function (r, i) { var st = rowState(kind, i); if (st !== 'empty') { c.filled++; c[st]++; } });
    return c;
  }

  var MIN_REASON = 15;       // an explanation shorter than this is not counted as written
  var TABLES = [['h', 'Table 1'], ['c', 'Table 2'], ['ir', 'Table 3'], ['mf', 'Table 4']];

  function retentionOk() {
    var finished = tic && tic.upTo >= tic.values.length;
    return M.checkRetention(state.msFields.rt, finished ? M.ticApex(tic.values, tic.step) : null).ok === true;
  }

  function updateReportStatus() {
    var todo = [], st = state.structure, f = structureCheck();
    if (formula && M.checkUnsaturation(state.dou, formula).ok !== true) todo.push('the degrees of unsaturation (part 2)');
    ['1H', '13C', 'DEPT135'].forEach(function (k) {
      var d = state.data[k], name = expInfo(k).name;
      if (!d) todo.push('a ' + name + ' spectrum (part 3)');
      else if (!d.proc.ft || !d.proc.ref) todo.push('processing and referencing the ' + name + ' spectrum (part 3)');
    });
    TABLES.forEach(function (t) {
      var c = tableCounts(t[0]), left = c.wrong + c.partial;
      if (!c.filled) todo.push(t[1]);
      else if (left) todo.push(t[1] + ' (' + left + (left === 1 ? ' row' : ' rows') + ' still marked or unfinished)');
    });
    var hs = M.hydrogenSum(state.readings.h, formula);
    if (formula && hs && hs.any && Math.abs(hs.sum - hs.formula) > 1e-9) todo.push('Table 1’s H column, which adds up to ' + fmt(hs.sum) + ', not ' + hs.formula);
    if (!state.ir || !state.ir.sample) todo.push('an IR spectrum of your unknown (part 1, the IR tab)');
    else if (!state.ir.background) todo.push('an IR spectrum recorded after a background');
    else if (!irRecorded()) todo.push('an IR spectrum with the clamp down on your solid');
    if (!state.gc) todo.push('a GC-MS run (part 1, the GC-MS tab)');
    else if (!state.ms) todo.push('the mass spectrum of your compound (part 6)');
    if (!retentionOk()) todo.push('the retention time (part 6)');
    if ((verdicts.mm || {}).ppm !== 1) todo.push('the molecular ion (part 6)');
    if ((verdicts.mb || {}).ppm !== 1) todo.push('the base peak (part 6)');
    if (!f && !String(st.condensed || '').trim()) todo.push('your structure (part 7)');
    else if (f && !f.fine) todo.push('a structure with your unknown’s formula (part 7)');
    if (!String(st.name || '').trim()) todo.push('the name of your structure');
    if (['formula', 'ir', 'ms', 'nmr'].some(function (k) { return String(st.why[k] || '').trim().length < MIN_REASON; })) todo.push('how the evidence fits your structure (part 7)');
    if (!String(state.name || '').trim()) todo.push('your name');
    var text;
    if (!todo.length) text = 'Everything is filled in. Print or save the report as a PDF.';
    else if (todo.length <= 5) text = 'Still to do: ' + todo.join('; ') + '.';
    else text = 'Still to do: ' + todo.slice(0, 5).join('; ') + '; and ' + (todo.length - 5) + ' more.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    var tables = TABLES.map(function (t) { var c = tableCounts(t[0]); return t[1] + ': ' + c.ok + ' of ' + c.filled + (c.filled === 1 ? ' row' : ' rows') + ' right in full'; });
    function yes(ok) { return ok ? 'right' : 'not right'; }
    $('print-checks').textContent = 'Checked by the lab page for unknown ' + state.code + ': degrees of unsaturation ' + yes(formula && M.checkUnsaturation(state.dou, formula).ok === true) +
      '; ' + tables.join('; ') + '; retention time ' + yes(retentionOk()) + '; molecular ion ' + yes((verdicts.mm || {}).ppm === 1) + '; base peak ' + yes((verdicts.mb || {}).ppm === 1) +
      '. Formula of the structure drawn: ' + (f ? (M.subscripts(f.text) + (f.same ? ', the same as the unknown’s' : ', not the unknown’s')) : 'none drawn') +
      '. The page does not check the structure, its name, the assignments or the explanations: mark them from the answer key.';
  }

  function bindReport() {
    var nameInput = $('student-name');
    nameInput.value = state.name || '';
    nameInput.addEventListener('input', function () { state.name = nameInput.value; saveState(); });
    $('print-report').addEventListener('click', function () { buildFigures(); updateReportStatus(); window.print(); });
    window.addEventListener('beforeprint', function () { buildFigures(); updateReportStatus(); });
    $('erase-all').addEventListener('click', function () { $('erase-all').hidden = true; $('erase-confirm').hidden = false; $('erase-no').focus(); });
    $('erase-no').addEventListener('click', function () { $('erase-confirm').hidden = true; $('erase-all').hidden = false; });
    $('erase-yes').addEventListener('click', function () {
      clearTimeout(saveTimer);
      state = blankState(state.code);
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* nothing was kept anyway */ }
      window.location.reload();
    });
  }

  // ---- Messages from the 3D room -------------------------------------------------------------------

  function onBenchEvent(json) {
    var msg;
    try { msg = JSON.parse(json); } catch (e) { return; }
    switch (msg.type) {
      case 'ready':
        unityAwake = true;
        configureBench();
        break;
      case 'configured':
      case 'state':
      case 'reset':
        // the lift air going on or off is heard (not when the room first reports, after a reload)
        if (msg.type !== 'configured' && state.sample && msg.state && !!state.sample.air !== !!msg.state.air) airSound(!!msg.state.air);
        state.sample = msg.state;
        if (msg.formula) formula = msg.formula;
        solid = !!msg.solid;
        state.spectro.locked = !!msg.locked;
        state.spectro.solvent = msg.solvent || '';
        if (msg.shims && msg.shims.length === 4) state.spectro.shims = msg.shims;
        lockShown.locked = !!msg.locked;
        if (msg.type === 'configured') {
          configured = true;
          var cover = $('stage-cover');
          cover.hidden = true;
          showFormula();
          showShims();
          replayRecordings();
          if (state.gc && state.gc.seed) sendBench('ReplayGc', String(state.gc.seed));
          showReadingStatus();
          scheduleCheck(0);
          sendBench('WatchLock', state.tab === 'lock' || state.tab === 'shim' ? '1' : '0');
        }
        showRoutine();
        updateNote();
        consoleStatus();
        saveState();
        break;
      case 'clicked':
        // a click on the monitor in the room opens the spectrometer software (part 3)
        if (msg.item === 'console') openSoftware(true);
        break;
      case 'blocked':
        blockedSeen = true;
        note(M.reasonText(msg.reason), 'warn');
        if (msg.what === 'lock' || msg.what === 'gain' || msg.what === 'acquire') {
          var where = msg.what === 'lock' ? 'lock-msg' : 'acquire-msg';
          $(where).textContent = M.reasonText(msg.reason);
        }
        break;
      case 'hover':
        hoverNote(msg.item ? (M.HOVER[msg.item] || null) : null);
        break;
      case 'view':
        lab.view = msg.view;
        showView(msg.view);
        if (ROUTINE_FOR_VIEW[msg.view] && ROUTINE_FOR_VIEW[msg.view] !== state.routine) showRoutineTab(ROUTINE_FOR_VIEW[msg.view], false);
        break;
      case 'locking':
        lockShown.searching = true;
        lockShown.locked = false;
        $('lock-msg').textContent = 'Searching for the deuterium signal of ' + msg.solvent + '…';
        break;
      case 'locked':
        lockShown.searching = false;
        lockShown.locked = !!msg.ok;
        $('lock-msg').textContent = msg.ok
          ? 'Locked. Now shim (Shim tab) until the lock level is as high as you can get it.'
          : 'No lock signal found for ' + msg.solvent + '. Is that the solvent your sample is in?';
        break;
      case 'lock':
        lockShown.locked = !!msg.locked;
        lockShown.searching = !!msg.searching;
        lockShown.target = msg.level;
        break;
      case 'gain':
        state.acq.gain = msg.gain;
        $('gain').value = msg.gain;
        $('acquire-msg').textContent = 'Receiver gain set to ' + msg.gain + '.';
        saveState();
        break;
      case 'acquiring':
        acquiring = msg.done < msg.of;
        $('acq-fill').style.width = Math.round(100 * msg.done / Math.max(1, msg.of)) + '%';
        $('acq-text').textContent = 'Scan ' + Math.min(msg.done + 1, msg.of) + ' of ' + msg.of;
        showAcquire();
        consoleStatus();
        break;
      case 'stopped':
        acquiring = false;
        $('acq-fill').style.width = '0%';
        $('acquire-msg').textContent = msg.reason === 'sample-out' ? 'The recording stopped: the sample left the magnet.' : 'Stopped before the first scan finished: nothing was recorded.';
        showAcquire();
        consoleStatus();
        break;
      case 'checked':
        receiveVerdicts(msg);
        break;
      case 'irbackground':
        $('ir-status').textContent = 'Background recorded. Now put your unknown on the crystal and record its spectrum.';
        break;
      case 'ir':
        receiveIr(msg);
        break;
      case 'gcstart':
        receiveGcStart(msg);
        break;
      case 'tic':
        receiveTic(msg);
        break;
      case 'ms':
        receiveMs(msg);
        break;
      case 'fid':
        acquiring = false;
        $('acq-fill').style.width = '0%';
        receiveFid(msg);
        showAcquire();
        consoleStatus();
        break;
    }
  }

  // ---- The lift air's sound -------------------------------------------------------------------------
  // When the lift air goes on, a rush of air rises in pitch and settles to a soft, steady hiss while
  // the sample floats; when it goes off, the hiss falls in pitch and dies away. It is made in the
  // browser from noise (Web Audio), so there are no sound files. The Sound button turns it off.

  var air = { ctx: null, src: null, filter: null, gain: null };

  function audioContext() {
    if (air.ctx) return air.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { air.ctx = new AC(); } catch (e) { return null; }
    return air.ctx;
  }

  /** Browsers start sound only after the visitor has clicked or typed on the page: get it ready then. */
  function readyAudio() {
    if (!state.sound) return;
    var c = audioContext();
    if (c && c.state === 'suspended') c.resume();
  }

  function airSound(on) {
    if (!state.sound) return;
    var c = audioContext();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    var t = c.currentTime;
    if (on) {
      stopAirSound(t, 0.05);
      var len = 2 * c.sampleRate, buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
      src.buffer = buf; src.loop = true;
      filter.type = 'bandpass'; filter.Q.value = 2.5;
      src.connect(filter); filter.connect(gain); gain.connect(c.destination);
      // the rush rises in pitch as the air comes up to pressure, then settles
      filter.frequency.setValueAtTime(260, t);
      filter.frequency.exponentialRampToValueAtTime(2600, t + 1.4);
      filter.frequency.exponentialRampToValueAtTime(2100, t + 2.2);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 2.2);
      src.start(t);
      air.src = src; air.filter = filter; air.gain = gain;
    } else if (air.src) {
      // the opposite: the pitch falls and the hiss dies away
      var f = air.filter, g = air.gain;
      f.frequency.cancelScheduledValues(t);
      f.frequency.setValueAtTime(Math.max(f.frequency.value, 300), t);
      f.frequency.exponentialRampToValueAtTime(180, t + 1.4);
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      air.src.stop(t + 1.6);
      air.src = null;
    }
  }

  function stopAirSound(t, fade) {
    if (!air.src) return;
    air.gain.gain.cancelScheduledValues(t);
    air.gain.gain.setValueAtTime(Math.max(air.gain.gain.value, 0.0001), t);
    air.gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    air.src.stop(t + fade + 0.02);
    air.src = null;
  }

  function bindSound() {
    var b = $('sound-toggle');
    b.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
    b.addEventListener('click', function () {
      state.sound = !state.sound;
      b.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
      if (!state.sound && air.ctx) stopAirSound(air.ctx.currentTime, 0.3);
      readyAudio();
      saveState();
    });
    document.addEventListener('pointerdown', readyAudio, { passive: true });
    document.addEventListener('keydown', readyAudio);
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.NmrLab = {
    isMock: !!standIn,
    view: 'room',
    onUnityEvent: onBenchEvent,
    attachUnity: function (instance) { unity = instance; configureBench(); },
    unityProgress: function (fraction) {
      $('progress-fill').style.width = Math.round(Math.max(0.04, fraction) * 100) + '%';
    },
    unityFailed: function (error) {
      console.error(error);
      var cover = $('stage-cover');
      cover.hidden = false;
      cover.setAttribute('data-state', 'failed');
      $('stage-status').textContent = 'The 3D lab could not start in this browser. Open this page in a current version of Chrome, Edge, Firefox or Safari on a computer.';
      document.querySelector('.progress').hidden = true;
    },
    unityBanner: function (message, type) {
      if (type === 'error') lab.unityFailed(message); else console.warn(message);
    }
  };

  $('unknown-code').textContent = state.code;
  $('dou').value = state.dou;
  $('dou').addEventListener('input', function () { state.dou = $('dou').value; checkDou(); saveState(); });
  TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { showTab(t); }); });
  bindRoutine();
  bindLock();
  bindSoftware();
  buildShims();
  bindAcquire();
  bindProcess();
  bindReadings();
  if (!state.readings || typeof state.readings !== 'object') state.readings = {};
  KINDS.forEach(function (kind) { if (!Array.isArray(state.readings[kind]) || !state.readings[kind].length) state.readings[kind] = blankRows(kind, 5); });
  if (!state.msFields || typeof state.msFields !== 'object') state.msFields = { rt: '', m: '', base: '' };
  if (!state.structure || typeof state.structure !== 'object') state.structure = blankStructure();
  if (!state.structure.mol || !Array.isArray(state.structure.mol.atoms) || !Array.isArray(state.structure.mol.bonds)) state.structure.mol = { atoms: [], bonds: [] };
  if (!state.structure.why || typeof state.structure.why !== 'object') state.structure.why = blankStructure().why;
  bindIr();
  bindGc();
  bindStructure();
  bindReport();
  bindSound();
  buildReadings();
  showFormula();
  showRoutine();
  showRoutineTab(state.routine, false);
  showTab(state.tab || 'lock');
  drawIr(); gcStatus(); drawTic(); drawMs(); checkRetention();
  buildFigures();
  updateReportStatus();
  updateNote();
  consoleStatus();
  saveState();

  // ---- Stand-in for the 3D lab, supplied by automated tests -------------------------------------

  if (standIn) {
    unity = standIn(onBenchEvent);
    onBenchEvent('{"type":"ready"}');
  }
})();
