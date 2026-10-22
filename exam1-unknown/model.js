/*
 * Exam 1 Unknown: the page's own reckoning, kept apart from the page so that it can be tested in
 * Node. Unknown codes, the formula and its degrees of unsaturation, the plain words for each step
 * of the routine and each thing the lab refuses, and the spectrometer software's processing: the
 * Fourier transform of a recorded FID, line broadening, phasing (by hand or automatic), baseline
 * correction, referencing, peak picking and integration.
 *
 * Nothing here knows what the unknown is. The 3D lab sends the formula and the recordings; the
 * page turns recordings into spectra, as the spectrometer's own software would.
 */
(function (root) {
  'use strict';

  // ---- Unknown codes ---------------------------------------------------------------------------
  // Four characters and a check character, the same form as the other labs' codes.

  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var BASE = 31, CODE_SPACE = BASE * BASE * BASE * BASE;

  function checkChar(digits) {
    var sum = 7;
    for (var i = 0; i < digits.length; i++) sum += (i + 2) * digits[i];
    return ALPHABET[sum % BASE];
  }
  function codeFromNumber(n) {
    n = ((n % CODE_SPACE) + CODE_SPACE) % CODE_SPACE;
    var digits = [0, 0, 0, 0];
    for (var i = 3; i >= 0; i--) { digits[i] = n % BASE; n = Math.floor(n / BASE); }
    return digits.map(function (d) { return ALPHABET[d]; }).join('') + checkChar(digits);
  }
  function normalizeCode(text) { return String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function numberFromCode(text) {
    var code = normalizeCode(text);
    if (code.length !== 5) return null;
    var digits = [];
    for (var i = 0; i < 4; i++) {
      var d = ALPHABET.indexOf(code[i]);
      if (d < 0) return null;
      digits.push(d);
    }
    if (checkChar(digits) !== code[4]) return null;
    return ((digits[0] * BASE + digits[1]) * BASE + digits[2]) * BASE + digits[3];
  }
  function isCode(text) { return numberFromCode(text) !== null; }
  function randomCode() {
    var n;
    try {
      var a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      n = a[0] % CODE_SPACE;
    } catch (e) {
      n = Math.floor(Math.random() * CODE_SPACE);
    }
    return codeFromNumber(n);
  }

  // ---- The formula ---------------------------------------------------------------------------------

  function parseFormula(formula) {
    var counts = {}, re = /([A-Z][a-z]?)(\d*)/g, m;
    while ((m = re.exec(String(formula || ''))) !== null) {
      if (!m[1]) continue;
      counts[m[1]] = (counts[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
    }
    return counts;
  }

  /** Degrees of unsaturation: (2C + 2 + N - H - halogens) / 2. */
  function unsaturation(formula) {
    var c = parseFormula(formula);
    var halogens = (c.F || 0) + (c.Cl || 0) + (c.Br || 0) + (c.I || 0);
    return (2 * (c.C || 0) + 2 + (c.N || 0) - (c.H || 0) - halogens) / 2;
  }

  /** The formula as text with lowered numbers, for the page. */
  function formulaParts(formula) {
    var parts = [], re = /([A-Z][a-z]?)(\d*)/g, m;
    while ((m = re.exec(String(formula || ''))) !== null) {
      if (!m[1]) continue;
      parts.push({ symbol: m[1], count: m[2] || '' });
    }
    return parts;
  }

  /** Whether a drawing's counts of each element ({ C: 8, H: 10, O: 1 }) are the formula's. */
  function sameFormula(counts, formula) {
    var want = parseFormula(formula), keys = {}, k;
    for (k in want) keys[k] = true;
    for (k in counts) keys[k] = true;
    for (k in keys) if ((want[k] || 0) !== (counts[k] || 0)) return false;
    return Object.keys(want).length > 0;
  }

  /** A formula with its numbers lowered, as plain text: C8H10O as C₈H₁₀O. */
  function subscripts(formula) {
    return String(formula || '').replace(/\d/g, function (d) { return '₀₁₂₃₄₅₆₇₈₉'.charAt(+d); });
  }

  function readNumber(text) {
    var t = String(text == null ? '' : text).trim().replace(/−/g, '-').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return parseFloat(t);
  }

  function checkUnsaturation(text, formula) {
    var v = readNumber(text);
    if (String(text || '').trim() === '') return { ok: null, message: '' };
    if (v === null) return { ok: false, message: 'Type a whole number.' };
    var right = unsaturation(formula);
    if (Math.abs(v - right) < 1e-9) return { ok: true, message: '' };
    if (v !== Math.round(v)) return { ok: false, message: 'It comes out as a whole number for a neutral molecule. Check the formula: (2C + 2 + N − H − X) / 2.' };
    return { ok: false, message: 'Not quite. Count each atom in the formula again and use (2C + 2 + N − H − X) / 2; oxygen and sulfur do not change it.' };
  }

  // ---- The routine: plain words ------------------------------------------------------------------

  var REASONS = {
    'hands-full': 'Put down what you are holding first.',
    'nothing-held': 'Pick something up first.',
    'already-capped': 'The tube is already capped.',
    'tube-empty': 'The tube is empty: fill it from the vial first.',
    'tube-not-here': 'Your tube is not in the rack just now.',
    'other-tube': 'Use the tube you already started with.',
    'not-capped': 'Cap the tube before you pick it up.',
    'no-spinner': 'The tube is not in the spinner yet.',
    'unknown-thing': 'That cannot be picked up.',
    'vial-full': 'The vial is full.',
    'dissolve-in-vial': 'Dissolve the unknown in the vial first, then move the solution to the tube.',
    'cannot-use-here': 'That does not go there.',
    'vial-no-solvent': 'There is no solution in the vial yet: add CDCl₃ first.',
    'undissolved': 'Some of the unknown is still solid. Swirl the vial until it dissolves; solid in the tube spoils the spectrum.',
    'pipet-empty': 'The pipet is empty.',
    'capped': 'Take the cap off first. (It is already on: fill the tube before you cap it.)',
    'tube-full': 'The tube cannot take any more.',
    'holder-empty': 'There is nothing in the spinner yet.',
    'gauge-empty': 'Nothing is on the gauge.',
    'nothing-floating': 'Nothing is floating on the air at the top of the magnet.',
    'air-off-empty': 'Turn the lift air on first (LIFT on the keypad by the computer).',
    'air-off': 'The lift air is off. Turn it on first (LIFT on the keypad by the computer), or the sample would fall straight down onto the probe.',
    'standard-in-the-way': 'Take the standard sample off the air first.',
    'standard-inside': 'The standard sample is still in the magnet. Turn the lift air on to bring it up.',
    'standard-out': 'The standard sample is already out.',
    'not-on-gauge': 'Put the spinner on the depth gauge first.',
    'no-sample': 'Your sample is not in the magnet yet.',
    'busy': 'Wait for the spectrometer to finish.',
    'unknown-step': 'That step is not known.',
    'eject-first': 'Your sample is in the magnet. Turn the lift air on and take it back to the bench first.',
    'not-capped-yet': 'The tube has no cap on it.',
    'cap-before-shaking': 'Cap the tube before you shake it.',
    'd2o-in-tube': 'The D₂O goes into the NMR tube, not the vial.',
    'bad-number': 'That is not a number.',
    'crystal-not-clean': 'Something is already on the crystal. Wipe it clean first: the acetone and a tissue.',
    'clamp-down': 'Raise the clamp first.',
    'background-needs-clean': 'A background is recorded with nothing on the crystal: wipe it clean first.',
    'syringe-empty': 'The syringe is empty: draw up 1 µL from the GC vial first.',
    'take-syringe': 'Pick up the syringe first.',
    'gc-running': 'Wait for this run to finish before you inject again.',
    'gc-capped': 'The GC vial is capped: take the cap off first.',
    'gc-full': 'The GC vial already has its dichloromethane.',
    'gc-no-solvent': 'Add the dichloromethane to the GC vial first: the syringe needs a solution, not the neat unknown.',
    'gc-vial-empty': 'The GC vial is empty: a drop of your unknown and the dichloromethane go in first.',
    'gc-not-armed': 'The software is not waiting for a sample yet: set the method, then press Run This Sample (part 6, Run).',
    'gc-press-start': 'Your sample is already on the column: press Start on the GC.',
    'gc-inject-first': 'Inject your sample first, then press Start.',
    'gc-no-vacuum': 'The mass spectrometer is not pumped down yet (part 6, Status): wait for the pumps.',
    'gc-tuning': 'The EI Check is still running.',
    'gc-nothing-to-wait-for': 'The pumps have nothing to wait for: the vacuum is good.',
    'gc-nut-tight': 'The column nut is already tight.',
    'no-unknown': 'The room is still setting up your unknown.'
  };
  function reasonText(code) { return REASONS[code] || 'That cannot be done just now.'; }

  var HOVER = {
    solvent: 'CDCl₃ (deuterated chloroform): click to fill a pipet',
    pipets: 'Clean Pasteur pipets',
    caps: 'Caps for the NMR tubes',
    vial: 'Your unknown, in its vial',
    tube: 'An NMR tube',
    holder: 'The spinner, on its holder',
    gauge: 'The depth gauge',
    lift: 'LIFT: the air at the top of the magnet',
    inlet: 'The top of the magnet, where the sample goes in',
    magnet: 'The magnet: click to climb up to its top',
    console: 'The spectrometer’s computer',
    ir: 'The IR spectrometer',
    ms: 'The GC-MS',
    irvial: 'Your unknown, pure, for the IR',
    wipe: 'Acetone and tissues: click to wipe the crystal clean',
    atr: 'The IR’s crystal, in the middle of the steel plate',
    clamp: 'The clamp: click to lower it onto the crystal, or raise it',
    syringe: 'A 10 µL syringe for the GC',
    gcvial: 'The GC vial: click it with nothing in your hand to cap it or take the cap off',
    port: 'The GC’s injection port',
    gcscreen: 'The GC-MS',
    gcunknown: 'Your unknown, for the GC vial',
    dcm: 'Dichloromethane (CH₂Cl₂): click to fill a pipet',
    gcnut: 'The column nut, where the GC column enters the mass spectrometer',
    gcstart: 'Start, on the GC’s keypad'
  };

  // ---- Checking the readings: plain words for the 3D lab's verdicts -----------------------------

  var CHECK_TEXT = {
    'no-signal': 'Your compound has no signal at this shift. Read it off the processed, referenced spectrum.',
    'not-referenced': 'Close to one of your signals, but about {off} ppm out: reference the spectrum (TMS at 0.00) and read the shifts again.',
    'solvent-chcl3': 'That is the CHCl₃ left in the CDCl₃ (7.26 ppm), not your compound.',
    'water': 'That is the trace of water in the CDCl₃ (about 1.56 ppm), not your compound.',
    'tms': 'That is TMS, the reference (0.00 ppm), not your compound.',
    'hod': 'That is the HOD from the D₂O shake, not your compound.',
    'solvent-cdcl3': 'That is the CDCl₃ triplet (77.16 ppm), not your compound.',
    'duplicate': 'Row {n} already has this signal.',
    'mult-wrong': 'Look again at the splitting: zoom in, count the lines and compare their heights.',
    'mult-closer': 'Zoom in: these lines can be counted, so name the splitting more exactly than “m”.',
    'j-missing': 'Give the coupling constant: the gap between neighbouring lines, in Hz.',
    'j-wrong': 'Measure the coupling constant again: the gap between neighbouring lines in Hz (0.01 ppm is 4 Hz here).',
    'j-extra': 'A singlet has no coupling constant: leave J empty.',
    'nh-wrong': 'Check the integration: scale your integrals so they add up to the H in the formula.',
    'type-wrong': 'Look again at the DEPT-135: CH and CH₃ point up, CH₂ points down, and C with no H does not appear.',
    'bad-number': 'Type a number here.',
    // the IR
    'no-band': 'Your compound has no band here. Read the wavenumber at the bottom of a dip in your own spectrum.',
    'co2': 'That is carbon dioxide in the air (near 2350 cm⁻¹), not your compound. Record a background on the clean crystal, then your sample again, and it goes.',
    'water-vapour': 'Those sharp little lines are water vapour in the air, not your compound. Record a background on the clean crystal, then your sample again.',
    'strength-wrong': 'Look again at how deep this band is beside your deepest one: strong, medium or weak.',
    'shape-broad': 'Look again at its shape: this band spreads over a wide range of wavenumbers.',
    'shape-sharp': 'Look again at its shape: this band is narrow.',
    'duplicate-ir': 'Row {n} already has this band.',
    // the mass spectrum
    'no-peak': 'Your compound’s spectrum has no peak at this m/z. Read it off the spectrum from the top of your compound’s peak in the chromatogram.',
    'bleed': 'That ion comes from the column itself (its bleed: m/z 73, 207, 281…), not your compound. Take the spectrum from the top of your compound’s peak.',
    'not-tallest': 'That is one of your compound’s peaks, but not its tallest: the base peak is the tallest one (100%).',
    'm-plus-one': 'That is the M+1 peak (molecules with one ¹³C atom), not the molecular ion itself.',
    'm-plus-two': 'That is an M+2 isotope peak, not the molecular ion itself.',
    'm-fragment': 'That is a fragment. The molecular ion is the heaviest peak of your compound, apart from its small isotope peaks; check it against the formula.',
    'm-weak': 'Right, though the molecular ion is too weak to see here: it breaks up almost at once. The formula gives its mass.',
    'duplicate-mf': 'Row {n} already has this peak.'
  };
  function checkText(code, off, n, kind) {
    if (code === 'duplicate' && CHECK_TEXT['duplicate-' + kind]) code = 'duplicate-' + kind;
    var t = CHECK_TEXT[code];
    if (!t) return '';
    return t.replace('{off}', Math.abs(off || 0).toFixed(2)).replace('{n}', String(n));
  }
  var SPLITTINGS = ['s', 'br s', 'd', 't', 'q', 'quint', 'sext', 'sept', 'dd', 'dt', 'td', 'tt', 'tq', 'ddd', 'm'];
  var SPLITTING_NAMES = { 's': 's (singlet)', 'br s': 'br s (broad singlet)', 'd': 'd (doublet)', 't': 't (triplet)', 'q': 'q (quartet)', 'quint': 'quint (quintet)', 'sext': 'sext (sextet)', 'sept': 'sept (septet)', 'dd': 'dd', 'dt': 'dt', 'td': 'td', 'tt': 'tt', 'tq': 'tq', 'ddd': 'ddd', 'm': 'm (multiplet)' };
  var CARBON_TYPES = ['C', 'CH', 'CH2', 'CH3'];
  var CARBON_NAMES = { 'C': 'C (no H: absent)', 'CH': 'CH (up)', 'CH2': 'CH₂ (down)', 'CH3': 'CH₃ (up)' };

  /** What the H column adds up to, against the formula (null when a box holds something that is not a number). */
  function hydrogenSum(rows, formula) {
    var sum = 0, any = false;
    for (var i = 0; i < rows.length; i++) {
      var t = String(rows[i].nH || '').trim();
      if (!t) continue;
      var v = readNumber(t);
      if (v === null) return null;
      sum += v; any = true;
    }
    return { sum: sum, any: any, formula: parseFormula(formula).H || 0 };
  }

  /** What to do next, from the sample's state as the 3D lab reports it. */
  function nextStep(s, focus, info) {
    if (!s) return 'Setting up the room.';
    info = info || {};
    if (s.held === 'irdrop') return 'Click the crystal in the middle of the IR’s steel plate to put your unknown on it.';
    if (s.held === 'syringe') return 'Click the GC vial to draw up 1 µL.';
    if (s.held === 'syringefull') return 'Click the injection port on top of the GC to inject, then press Start on the GC.';
    if (s.held === 'gcdrop') return 'Click the GC vial to add your unknown to it.';
    if (s.held === 'dcm') return 'Click the GC vial to fill it with dichloromethane to its shoulder.';
    if (focus === 'ir') return irStep(s, info);
    if (focus === 'ms') return msStep(s, info);
    if (s.held === 'solvent') return 'You have a pipet of CDCl₃. Click the vial to empty it in.';
    if (s.held === 'd2o') return 'You have a drop of D₂O. Click your uncapped tube to add it.';
    if (s.held === 'pipet') return 'Click the vial to draw up the solution.';
    if (s.held === 'solution') return 'Click an NMR tube in the rack to empty the pipet into it.';
    if (s.held === 'cap') return 'Click the tube to cap it.';
    if (s.held === 'tube') return 'Click the spinner on its holder to push the tube into it.';
    if (s.held === 'spinner') return s.air ? 'Click the top of the magnet to set the sample on the air.' : 'To put the sample in the magnet, the lift air must be on: LIFT on the keypad by the computer.';
    if (s.addedMl <= 0) return 'Start by dissolving the unknown in about 0.6 mL of CDCl₃: click the CDCl₃ bottle, then the vial.';
    if (s.addedMl < 0.55 && s.tubeMl <= 0) return 'Add another pipetful of CDCl₃: about 0.6 mL in all.';
    if (!s.dissolved && s.tubeMl <= 0) return 'Swirl the vial (click it) until the unknown dissolves.';
    if (s.tubeMl <= 0) return 'Take a clean Pasteur pipet from the beaker and move the solution into an NMR tube.';
    if (!s.capped) return 'Cap the tube: a cap from the dish.';
    if (!s.inSpinner) return 'Put the capped tube in the spinner on its holder.';
    if (s.place === 'holder' && !s.gauged) return 'Set the depth: put the spinner on the depth gauge.';
    if (s.place === 'gauge') return 'Move the tube until the middle of the liquid sits on the red 0 line. Drag the tube, or use the buttons.';
    if (s.place === 'holder' || s.place === 'gauge') return 'Take the spinner to the magnet: turn the lift air on first.';
    if (s.place === 'top') return s.standard === 'top' ? 'Take the standard sample off the air.' : 'Your sample is floating on the air. Turn the lift air off to lower it into the magnet.';
    if (s.d2o && !s.capped && s.place === 'rack') return 'Cap the tube, then shake it so the D₂O mixes in.';
    if (s.d2o && !s.shaken && s.place === 'rack') return 'Shake the capped tube so the D₂O mixes in.';
    if (s.d2o && s.shaken && s.place === 'rack') return 'Now put the tube back in the spinner, set its depth again, and lower it into the magnet.';
    if (s.place === 'magnet') return s.d2o && s.shaken
      ? 'The shaken sample is in the magnet. Lock and shim again, then record a new ¹H spectrum and compare it with the first.'
      : 'Your sample is in the magnet. Go to the spectrometer below: lock, shim, then record.';
    return '';
  }

  /**
   * Which step of a list (focus "nmr", "ir" or "ms") is the one to do now, by the same reasoning as
   * nextStep: the data-done name of its row in the list beside the room, or null when none is
   * (the sample is in the magnet, the IR spectrum is recorded, the GC run is under way or done).
   */
  function nextStepKey(s, focus, info) {
    if (!s) return null;
    info = info || {};
    if (focus === 'ir') {
      if (s.held === 'irdrop') return 'ir-sample';
      if (!s.background) return s.crystal === 'clean' ? 'ir-background' : 'ir-clean';
      if (s.crystal === 'clean') return info.recorded ? null : 'ir-sample';
      if (info.solid && !s.clamp) return 'ir-clamp';
      return info.recorded ? null : 'ir-record';
    }
    if (focus === 'ms') return gcKey(s, info);
    switch (s.held) {
      case 'solvent': return 'solvent';
      case 'd2o': return 'd2o';
      case 'pipet': case 'solution': return 'tube';
      case 'cap': return s.d2o ? 'd2o' : 'capped';
      case 'tube': return 'spinner';
      case 'spinner': return s.air ? 'magnet' : 'air';
    }
    if (s.addedMl < 0.55 && s.tubeMl <= 0) return 'solvent';
    if (!s.dissolved && s.tubeMl <= 0) return 'dissolved';
    if (s.tubeMl <= 0) return 'tube';
    if (s.d2o && s.place === 'rack' && (!s.capped || !s.shaken)) return 'd2o';
    if (!s.capped) return 'capped';
    if (!s.inSpinner) return 'spinner';
    if (s.place === 'gauge' || (s.place === 'holder' && !s.gauged)) return 'depth';
    if (s.place === 'holder') return !s.air ? 'air' : (s.standard !== 'holder' ? 'standard' : 'magnet');
    if (s.place === 'top') return s.standard === 'top' ? 'standard' : 'air';
    return null;
  }

  function irStep(s, info) {
    if (!s.background) return s.crystal === 'clean'
      ? 'First record a background, with nothing on the crystal: Record the background.'
      : 'Wipe the crystal clean (the acetone and a tissue), then record a background.';
    if (s.crystal === 'clean') return info.recorded
      ? 'The crystal is clean. Record another spectrum, or go on to the GC-MS.'
      : 'Put a little of your unknown on the crystal: click its vial, then the crystal.';
    if (info.solid && !s.clamp) return 'Lower the clamp onto the crystals so that they press against the crystal.';
    if (!info.recorded) return 'Record the spectrum: Record (part 5 shows it).';
    return 'Your IR spectrum is in part 5. Wipe the crystal clean when you are done.';
  }

  /** The step of the GC-MS's list to do now (info: armed, injected, running, gc = a run is done, checked = the status was looked at). */
  function gcKey(s, info) {
    switch (s.held) {
      case 'gcdrop': return 'gc-drop';
      case 'dcm': return 'gc-solvent';
      case 'syringe': return 'gc-fill';
      case 'syringefull': return 'gc-inject';
    }
    if (info.running) return null;
    if (info.injected) return 'gc-start';
    if (!(s.gcDrops > 0)) return 'gc-drop';
    if (!s.gcSolvent) return 'gc-solvent';
    if (!s.gcCapped) return 'gc-cap';
    if (!s.gcVacuum || !info.checked) return 'gc-ready';
    if (s.gcTune !== 'pass') {
      if (s.gcTune === 'leak' && !s.gcNutTight) return 'gc-nut';
      if (s.gcTune === 'wet' && !s.gcDry) return 'gc-ready';
      return 'gc-tune';
    }
    if (!info.armed) return info.gc ? null : 'gc-arm';
    return 'gc-fill';
  }

  function msStep(s, info) {
    switch (gcKey(s, info)) {
      case 'gc-drop': return s.gcDrops > 0 ? 'Click the GC vial to add it.' : 'Put a little of your unknown in the empty GC vial: one drop of a liquid, a few crystals of a solid.';
      case 'gc-solvent': return 'Fill the GC vial with dichloromethane to its shoulder (about 1 mL).';
      case 'gc-cap': return 'Cap the GC vial, or the dichloromethane will evaporate.';
      case 'gc-ready': return !s.gcVacuum ? 'The mass spectrometer is still pumping down. Check its status (part 6) and wait for the pumps.'
        : (s.gcTune === 'wet' && !s.gcDry ? 'The EI Check found water. Wait for the pumps to pump it away (part 6, Status), then check the tune again.' : 'Check the instrument’s status (part 6, Status).');
      case 'gc-tune': return s.gcTune === 'leak' || s.gcTune === 'wet' ? 'Run the EI Check again (part 6, Tune).' : 'Check the tune: EI Check (part 6, Tune).';
      case 'gc-nut': return 'The EI Check found air in the instrument. Tighten the column nut where the transfer line enters the mass spectrometer.';
      case 'gc-arm': return 'Set the method and save it (part 6, Method), then name the file and press Run This Sample (Run).';
      case 'gc-fill': return 'Pick up the syringe and draw up 1 µL from the GC vial.';
      case 'gc-inject': return 'Inject at the port on top of the GC.';
      case 'gc-start': return 'Press Start on the GC now: the sample is sitting on the column.';
    }
    if (info.running) return 'The run is under way: watch the chromatogram grow in part 6.';
    if (info.gc) return 'Click the top of your compound’s peak in the chromatogram (part 6) to see its mass spectrum.';
    return '';
  }

  // ---- The IR and the GC-MS --------------------------------------------------------------------------

  var IR_STRENGTHS = ['s', 'm', 'w'];
  var IR_STRENGTH_NAMES = { s: 'strong', m: 'medium', w: 'weak' };
  var IR_SHAPES = ['sharp', 'broad'];
  var IR_SHAPE_NAMES = { sharp: 'sharp', broad: 'broad' };

  /** The bands of an IR spectrum (%T): the dips, as deep as `threshold` (0 to 1) of the deepest at least, that stand out from what is round them. */
  function pickBands(t, from, step, threshold) {
    var n = t.length, a = new Array(n), sm = new Array(n), max = 0, i, j;
    for (i = 0; i < n; i++) a[i] = -Math.log(Math.max(0.05, t[i]) / 100) / Math.LN10;
    for (i = 0; i < n; i++) {
      var sum = 0, count = 0;
      for (j = i - 2; j <= i + 2; j++) if (j >= 0 && j < n) { sum += a[j]; count++; }
      sm[i] = sum / count;
      if (sm[i] > max) max = sm[i];
    }
    var out = [];
    if (max <= 0) return out;
    for (i = 3; i < n - 3; i++) {
      var v = sm[i];
      if (v < threshold * max || v < 0.01) continue;      // never the noise of a flat spectrum
      if (!(v >= sm[i - 1] && v > sm[i + 1] && v >= sm[i - 2] && v >= sm[i + 2] && v >= sm[i - 3] && v >= sm[i + 3])) continue;
      // how far it stands out: the lowest point on each side before anything higher
      var minL = v, minR = v;
      for (j = i - 1; j >= 0 && j >= i - 200; j--) { if (sm[j] > v) break; if (sm[j] < minL) minL = sm[j]; }
      for (j = i + 1; j < n && j <= i + 200; j++) { if (sm[j] > v) break; if (sm[j] < minR) minR = sm[j]; }
      if (v - Math.max(minL, minR) < 0.12 * v) continue;
      out.push({ i: i, cm1: from - i * step, depth: v / max });
    }
    return out;
  }

  /**
   * The GC-MS's method (GcMs.cs in the room has the same fields): the oven holds its start for 2 min,
   * climbs at the ramp to 280 °C and holds 4 min; the filament stays off for the solvent delay.
   * GC_METHOD is the method as it should be; GC_CHOICES what each field offers.
   */
  var GC_METHOD = { inlet: 225, split: 33, start: 50, ramp: 15, scanHigh: 400, scanTime: 0.2, delay: 2 };
  var GC_FIXED = { hold: 2, end: 280, finalHold: 4, scanLow: 15 };
  var GC_CHOICES = {
    inlet: [100, 225, 350], split: [0, 10, 33, 100], start: [35, 50, 80], ramp: [5, 15, 40],
    scanHigh: [150, 400, 650], scanTime: [0.05, 0.2, 1], delay: [0, 2, 5]
  };
  function gcMethod(m) {
    var out = {};
    Object.keys(GC_METHOD).forEach(function (k) {
      var v = m && typeof m[k] === 'number' ? m[k] : GC_METHOD[k];
      out[k] = GC_CHOICES[k].indexOf(v) >= 0 ? v : GC_METHOD[k];
    });
    return out;
  }
  function gcMinutes(m) { m = gcMethod(m); return GC_FIXED.hold + (GC_FIXED.end - m.start) / m.ramp + GC_FIXED.finalHold; }
  function gcOven(m, t) { m = gcMethod(m); return t <= GC_FIXED.hold ? m.start : Math.min(GC_FIXED.end, m.start + (t - GC_FIXED.hold) * m.ramp); }
  /** The method as the page first shows it: right but for one field, which differs from student to student. */
  function gcDefaultMethod(code, mass) {
    var h = 0, s = String(code || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    var wrong = [{ split: 0 }, { delay: 0 }];
    if (mass >= 140) wrong.push({ scanHigh: 150 });
    var m = gcMethod(null), w = wrong[h % wrong.length];
    Object.keys(w).forEach(function (k) { m[k] = w[k]; });
    return m;
  }
  /** The method in one line, for the report. */
  function gcMethodLine(m) {
    m = gcMethod(m);
    return 'inlet ' + m.inlet + ' °C, ' + (m.split ? 'split ' + m.split + ':1' : 'splitless') + '; oven ' + m.start + ' °C for 2 min, '
      + m.ramp + ' °C/min to 280 °C, held 4 min; scan m/z 15–' + m.scanHigh + ', ' + m.scanTime + ' s a scan; solvent delay ' + m.delay + ' min';
  }
  /** A file or method name the instrument's software takes: letters, figures, - _ and ., no spaces. */
  function gcNameOk(name) { return /^[A-Za-z0-9_.\-]{1,40}$/.test(String(name || '')); }
  /** The nominal mass of a formula (the most common isotope of each element). */
  var NOMINAL = { C: 12, H: 1, N: 14, O: 16, S: 32, P: 31, F: 19, Cl: 35, Br: 79, I: 127, Si: 28 };
  function nominalMass(formula) {
    var c = parseFormula(formula), sum = 0;
    Object.keys(c).forEach(function (e) { sum += (NOMINAL[e] || 0) * c[e]; });
    return sum;
  }
  /** The EI Check's report as rows: [what, value, limit, within the limit]. */
  function tuneRows(r) {
    var rows = [
      ['Leak check (air in the analyser, %)', r.leakCheck, '< 10', r.leakCheck < 10],
      ['Mass error at m/z 69 (u)', r.massError, '± 0.10', Math.abs(r.massError) <= 0.10],
      ['Water, m/z 18 (% of m/z 69)', r.water / 10, '< 20', r.water / 10 < 20],
      ['Nitrogen, m/z 28 (% of m/z 69)', r.nitrogen, '< 10', r.nitrogen < 10],
      ['Oxygen, m/z 32 (% of m/z 69)', r.oxygen, '< 5', r.oxygen < 5],
      ['Electron multiplier (V)', r.multiplier, '< 2500', r.multiplier < 2500],
      ['Foreline pressure (mTorr)', r.foreline, '< 100', r.foreline < 100]
    ];
    return rows;
  }
  /** One line for the report: what the last EI Check found. */
  function tuneLine(t) {
    if (t === 'pass') return 'EI Check passed.';
    if (t === 'leak') return 'EI Check failed: air in the instrument (nitrogen and oxygen high, mass axis off).';
    if (t === 'wet') return 'EI Check failed: water high.';
    return 'No EI Check run.';
  }

  // the old fixed method, kept for runs saved before 2026-10-22
  var GC = { hold: 2, start: 35, rate: 15, end: 280, delay: 2 };
  GC.minutes = GC.hold + (GC.end - GC.start) / GC.rate;
  function ovenAt(minutes) { return minutes <= GC.hold ? GC.start : Math.min(GC.end, GC.start + (minutes - GC.hold) * GC.rate); }

  /**
   * When the chromatogram is highest (min), or null with no run: after the solvent delay, and never
   * in the first 2 min, where the solvent comes off when the delay is set too short.
   */
  function ticApex(values, step, delay) {
    var best = -Infinity, at = -1, from = Math.max(delay == null ? GC.delay : delay, 2);
    for (var i = Math.ceil(from / step - 1e-9); i < values.length; i++) if (values[i] != null && values[i] > best) { best = values[i]; at = i; }
    return at < 0 ? null : at * step;
  }

  /** The retention time the student read, against the top of their own chromatogram's peak. */
  function checkRetention(text, apex) {
    var t = String(text || '').trim();
    if (!t) return { ok: null, message: '' };
    var v = readNumber(t);
    if (v === null) return { ok: false, message: 'Type the time in minutes, as a number.' };
    if (apex === null) return { ok: null, message: 'Inject your sample first: the chromatogram will show when your compound comes off.' };
    if (Math.abs(v - apex) <= 0.05) return { ok: true, message: '' };
    return { ok: false, message: 'Read the time at the very top of your compound’s peak (to two decimals).' };
  }

  /** Mass lost from the molecular ion (as the student gave it) to make a peak, or null. */
  function massLost(mText, mzText) {
    var m = readNumber(String(mText || '')), z = readNumber(String(mzText || ''));
    if (m === null || z === null || z >= m || z <= 0) return null;
    return Math.round(m) - Math.round(z);
  }

  // ---- Processing: the Fourier transform and after --------------------------------------------------

  /** In-place radix-2 FFT (forward: e^-i). n must be a power of 2. */
  function fft(re, im) {
    var n = re.length, i, j, k;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < half; k++) {
          var a = i + k, b = a + half;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /** A recording from the 3D lab's "fid" message: points as whole numbers, real and imaginary in turn. */
  function readFid(msg) {
    var n = msg.points.length >> 1, re = new Float64Array(n), im = new Float64Array(n);
    for (var i = 0; i < n; i++) { re[i] = msg.points[2 * i] / 30000; im[i] = msg.points[2 * i + 1] / 30000; }
    return {
      experiment: msg.experiment, mhz: msg.mhz, centre: msg.centre, width: msg.width,
      scans: msg.scans, gain: msg.gain, overflow: !!msg.overflow, re: re, im: im, n: n
    };
  }

  /**
   * The spectrum of a recording: exponential line broadening `lb` (Hz), zero-filled to twice its
   * length, Fourier transformed and put in order from the low-frequency end. The first point is
   * halved, as the software does, so the baseline does not lift.
   */
  function transform(fid, lb) {
    var n = fid.n, size = 1;
    while (size < 2 * n) size <<= 1;
    var re = new Float64Array(size), im = new Float64Array(size);
    for (var i = 0; i < n; i++) {
      var w = Math.exp(-Math.PI * (lb || 0) * i / fid.width);
      re[i] = fid.re[i] * w;
      im[i] = fid.im[i] * w;
    }
    re[0] *= 0.5; im[0] *= 0.5;
    fft(re, im);
    // swap halves: index 0 is now the lowest frequency
    var h = size >> 1, sr = new Float64Array(size), si = new Float64Array(size);
    for (i = 0; i < size; i++) { var k = (i + h) % size; sr[i] = re[k]; si[i] = im[k]; }
    return { re: sr, im: si, size: size, mhz: fid.mhz, centre: fid.centre, width: fid.width, experiment: fid.experiment };
  }

  /** Where a point of the spectrum sits, in ppm, before any referencing. */
  function ppmAt(spec, i) { return spec.centre + ((i - spec.size / 2) / spec.size) * spec.width / spec.mhz; }
  function indexAt(spec, ppm) { return (ppm - spec.centre) * spec.mhz / spec.width * spec.size + spec.size / 2; }

  /** The real part after phase correction: ph0 (degrees) everywhere, ph1 (degrees) across the spectrum. */
  function phased(spec, ph0, ph1) {
    var out = new Float64Array(spec.size), d = Math.PI / 180;
    for (var i = 0; i < spec.size; i++) {
      var x = (i - spec.size / 2) / spec.size;
      var p = -(ph0 + ph1 * x) * d;
      out[i] = spec.re[i] * Math.cos(p) - spec.im[i] * Math.sin(p);
    }
    return out;
  }

  /** A robust size of the noise: the median absolute difference between neighbouring points. */
  function noiseLevel(y) {
    var diffs = [], step = Math.max(1, Math.floor(y.length / 8192));
    for (var i = step; i < y.length; i += step) diffs.push(Math.abs(y[i] - y[i - step]));
    diffs.sort(function (a, b) { return a - b; });
    return (diffs[diffs.length >> 1] || 1e-12) / 0.954;      // median |x1 - x2| = 0.954 sigma
  }

  /**
   * Finds the phase that makes the peaks pure absorption, as automatic phasing does: the phases
   * that put the most of the strong points' signal into the real part. `positive` true settles
   * the half-turn so the peaks point up (for DEPT, give `upAt`, the ppm of a peak known to point up).
   */
  function autophase(spec, upAt) {
    // Each group of peaks is found where the signal stands well clear of the noise. Summed over
    // a window round it, a peak's dispersion cancels and what is left points at its phase error.
    // A straight line through those phases, across the spectrum, gives ph0 and ph1.
    var n = spec.size, i, noise = noiseLevel(spec.re), mixed = upAt != null;
    var mag = new Float64Array(n), biggest = 0;
    for (i = 0; i < n; i++) { mag[i] = Math.hypot(spec.re[i], spec.im[i]); if (mag[i] > biggest) biggest = mag[i]; }
    // clear of the noise, and of the long wings of the tallest peaks, which in a strong spectrum
    // stand above the noise far out and would run every peak into one
    var level = Math.max(10 * noise, 0.03 * biggest);
    var groups = [], start = -1;
    for (i = 0; i < n; i++) {
      var on = mag[i] > level;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { groups.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) groups.push([start, n - 1]);
    // join groups that are close together (the lines of one multiplet)
    var joined = [];
    groups.forEach(function (g) {
      var last = joined[joined.length - 1];
      if (last && g[0] - last[1] < 40) last[1] = g[1]; else joined.push(g.slice());
    });
    var peaks = [];
    joined.forEach(function (g) {
      // the window must be centred on the peak: summed over a lopsided window, the dispersion
      // does not cancel. Its middle is where the signal is strongest (weighted by its square).
      var sw = 0, sc = 0, j;
      for (j = g[0]; j <= g[1]; j++) { var m2 = mag[j] * mag[j]; sw += m2; sc += m2 * j; }
      var c = Math.round(sc / sw), half = Math.max(c - g[0], g[1] - c) + 20;
      var a = c - half, b = c + half;
      if (a < 0 || b > n - 1) return;
      var sr = 0, si = 0;
      for (j = a; j <= b; j++) { sr += spec.re[j]; si += spec.im[j]; }
      var strength = Math.hypot(sr, si);
      if (strength > 0) peaks.push({ phi: Math.atan2(si, sr), x: (c - n / 2) / n, w: strength });
    });
    if (!peaks.length) return { ph0: 0, ph1: 0 };
    // DEPT has peaks both ways: fit twice the angles, so a peak pointing down counts the same
    var f = mixed ? 2 : 1, d = Math.PI / 180;
    function fit(p1) {
      var cr = 0, ci = 0;
      peaks.forEach(function (p) { var a = f * (p.phi - p1 * d * p.x); cr += p.w * Math.cos(a); ci += p.w * Math.sin(a); });
      return { p0: Math.atan2(ci, cr) / f / d, s: Math.hypot(cr, ci) };
    }
    var best = { s: -1, p0: 0, p1: 0 };
    for (var p1 = -180; p1 <= 180; p1 += 1) { var r = fit(p1); if (r.s > best.s) best = { s: r.s, p0: r.p0, p1: p1 }; }
    for (p1 = best.p1 - 1; p1 <= best.p1 + 1; p1 += 0.05) { var r2 = fit(p1); if (r2.s > best.s) best = { s: r2.s, p0: r2.p0, p1: p1 }; }
    var ph0 = best.p0;
    if (mixed) {
      var y = phased(spec, ph0, best.p1), at = Math.round(indexAt(spec, upAt)), w = Math.round(n * 0.002), topv = 0;
      for (i = Math.max(0, at - w); i <= Math.min(n - 1, at + w); i++) if (Math.abs(y[i]) > Math.abs(topv)) topv = y[i];
      if (topv < 0) ph0 += 180;
    }
    return { ph0: ((ph0 % 360) + 360) % 360, ph1: Math.round(best.p1 * 10) / 10 };
  }

  /**
   * Baseline correction: a smooth curve (a polynomial of order 4) fitted to the points that are
   * only noise, found by fitting again and again and leaving out whatever stands clear of it.
   */
  function baseline(y) {
    var n = y.length, step = Math.max(1, Math.floor(n / 4096)), xs = [], ys = [], i;
    for (i = 0; i < n; i += step) { xs.push(i / n - 0.5); ys.push(y[i]); }
    var use = xs.map(function () { return true; }), coef = [0, 0, 0, 0, 0], noise = noiseLevel(y);
    for (var pass = 0; pass < 6; pass++) {
      coef = polyFit(xs, ys, use, 4);
      for (i = 0; i < xs.length; i++) use[i] = Math.abs(ys[i] - polyVal(coef, xs[i])) < 3 * noise;
    }
    var out = new Float64Array(n);
    for (i = 0; i < n; i++) out[i] = y[i] - polyVal(coef, i / n - 0.5);
    return out;
  }
  function polyVal(c, x) { var v = 0; for (var k = c.length - 1; k >= 0; k--) v = v * x + c[k]; return v; }
  function polyFit(xs, ys, use, order) {
    var m = order + 1, A = [], b = [], i, j, k;
    for (i = 0; i < m; i++) { A.push(new Array(m).fill(0)); b.push(0); }
    for (k = 0; k < xs.length; k++) {
      if (!use[k]) continue;
      var p = [1];
      for (i = 1; i < 2 * m; i++) p.push(p[i - 1] * xs[k]);
      for (i = 0; i < m; i++) { b[i] += ys[k] * p[i]; for (j = 0; j < m; j++) A[i][j] += p[i + j]; }
    }
    // Gaussian elimination
    for (i = 0; i < m; i++) {
      var piv = i;
      for (j = i + 1; j < m; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var t = A[i]; A[i] = A[piv]; A[piv] = t; t = b[i]; b[i] = b[piv]; b[piv] = t;
      if (Math.abs(A[i][i]) < 1e-30) continue;
      for (j = i + 1; j < m; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < m; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var c = new Array(m).fill(0);
    for (i = m - 1; i >= 0; i--) {
      var s = b[i];
      for (k = i + 1; k < m; k++) s -= A[i][k] * c[k];
      c[i] = Math.abs(A[i][i]) < 1e-30 ? 0 : s / A[i][i];
    }
    return c;
  }

  /**
   * Peaks above `threshold` (and, when `both`, troughs below -threshold, for DEPT): each the
   * highest point of its stretch, at least `minHz` from the next. Returns indices.
   */
  function pickPeaks(spec, y, threshold, both, minHz) {
    var n = y.length, minPts = Math.max(2, Math.round((minHz || 0.6) / spec.width * spec.size)), i, k;
    // smooth a little first, so that noise riding on a peak does not make tops of its own
    var s = new Float64Array(n), w = 2;
    for (i = w; i < n - w; i++) { var sum = 0; for (k = -w; k <= w; k++) sum += y[i + k]; s[i] = sum / (2 * w + 1); }
    var cand = [];
    for (i = w + 1; i < n - w - 1; i++) {
      var v = s[i];
      if (v > threshold && v >= s[i - 1] && v > s[i + 1]) cand.push(i);
      else if (both && v < -threshold && v <= s[i - 1] && v < s[i + 1]) cand.push(i);
    }
    // neighbours count as one peak unless the dip between them is real: it must fall below 80%
    // of the lower of the two, and they must be at least minHz apart
    var out = [];
    cand.forEach(function (c) {
      var last = out[out.length - 1];
      if (last !== undefined && (s[last] > 0) === (s[c] > 0)) {
        var valley = s[c] > 0 ? Infinity : -Infinity;
        for (k = last; k <= c; k++) valley = s[c] > 0 ? Math.min(valley, s[k]) : Math.max(valley, s[k]);
        var lower = s[c] > 0 ? Math.min(s[last], s[c]) : Math.max(s[last], s[c]);
        var shallow = s[c] > 0 ? valley > 0.8 * lower : valley < 0.8 * lower;
        if (shallow || c - last < minPts) {
          if (Math.abs(s[c]) > Math.abs(s[last])) out[out.length - 1] = c;
          return;
        }
      }
      out.push(c);
    });
    // each peak at the true highest point near it
    return out.map(function (c) {
      var best = c;
      for (k = c - w; k <= c + w; k++) if (k >= 0 && k < n && Math.abs(y[k]) > Math.abs(y[best]) && (y[k] > 0) === (y[c] > 0)) best = k;
      return best;
    });
  }

  /** The area under the spectrum between two points. */
  function integrate(y, a, b) {
    var lo = Math.max(0, Math.min(a, b)), hi = Math.min(y.length - 1, Math.max(a, b)), s = 0;
    for (var i = lo; i <= hi; i++) s += y[i];
    return s;
  }

  /** The highest point near an index (within `w` points), for clicking on a peak. */
  function nearestPeak(y, i, w) {
    var best = Math.round(i);
    for (var k = Math.max(0, Math.round(i) - w); k <= Math.min(y.length - 1, Math.round(i) + w); k++)
      if (Math.abs(y[k]) > Math.abs(y[best])) best = k;
    return best;
  }

  var SOLVENTS = [
    { key: 'CDCl3', name: 'CDCl₃ (chloroform-d)' },
    { key: 'DMSO-d6', name: 'DMSO-d₆' },
    { key: 'acetone-d6', name: 'Acetone-d₆' },
    { key: 'D2O', name: 'D₂O' },
    { key: 'C6D6', name: 'C₆D₆ (benzene-d₆)' }
  ];
  var EXPERIMENTS = [
    { key: '1H', name: '¹H', lb: 0.3, scans: 16, from: 12, to: -0.5 },
    { key: '13C', name: '¹³C', lb: 1.0, scans: 256, from: 220, to: -5 },
    { key: 'DEPT135', name: 'DEPT-135', lb: 1.0, scans: 256, from: 220, to: -5 },
    // the proton spectrum again after the D2O shake: kept apart so the two can be compared
    { key: '1H-D2O', name: '¹H after D₂O', lb: 0.3, scans: 16, from: 12, to: -0.5, recorded: true }
  ];
  var SCAN_CHOICES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  /** Where each experiment's reference lines are, for "set the reference". */
  var REFERENCES = {
    '1H': [{ name: 'TMS', ppm: 0 }, { name: 'CHCl₃ in CDCl₃', ppm: 7.26 }],
    '13C': [{ name: 'TMS', ppm: 0 }, { name: 'CDCl₃ (middle line)', ppm: 77.16 }],
    'DEPT135': [{ name: 'TMS', ppm: 0 }],
    '1H-D2O': [{ name: 'TMS', ppm: 0 }, { name: 'CHCl₃ in CDCl₃', ppm: 7.26 }]
  };

  var api = {
    ALPHABET: ALPHABET, codeFromNumber: codeFromNumber, numberFromCode: numberFromCode, normalizeCode: normalizeCode, isCode: isCode, randomCode: randomCode,
    parseFormula: parseFormula, unsaturation: unsaturation, formulaParts: formulaParts, readNumber: readNumber, checkUnsaturation: checkUnsaturation,
    reasonText: reasonText, HOVER: HOVER, nextStep: nextStep, nextStepKey: nextStepKey,
    fft: fft, readFid: readFid, transform: transform, ppmAt: ppmAt, indexAt: indexAt, phased: phased, noiseLevel: noiseLevel,
    autophase: autophase, baseline: baseline, pickPeaks: pickPeaks, integrate: integrate, nearestPeak: nearestPeak,
    SOLVENTS: SOLVENTS, EXPERIMENTS: EXPERIMENTS, SCAN_CHOICES: SCAN_CHOICES, REFERENCES: REFERENCES,
    checkText: checkText, SPLITTINGS: SPLITTINGS, SPLITTING_NAMES: SPLITTING_NAMES, CARBON_TYPES: CARBON_TYPES, CARBON_NAMES: CARBON_NAMES, hydrogenSum: hydrogenSum,
    IR_STRENGTHS: IR_STRENGTHS, IR_STRENGTH_NAMES: IR_STRENGTH_NAMES, IR_SHAPES: IR_SHAPES, IR_SHAPE_NAMES: IR_SHAPE_NAMES, pickBands: pickBands,
    GC: GC, ovenAt: ovenAt, ticApex: ticApex,
    GC_METHOD: GC_METHOD, GC_CHOICES: GC_CHOICES, gcMethod: gcMethod, gcMinutes: gcMinutes, gcOven: gcOven,
    gcDefaultMethod: gcDefaultMethod, gcMethodLine: gcMethodLine, gcNameOk: gcNameOk, nominalMass: nominalMass,
    tuneRows: tuneRows, tuneLine: tuneLine, checkRetention: checkRetention, massLost: massLost,
    sameFormula: sameFormula, subscripts: subscripts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NmrLabModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
