/*
 * Exam 1 Unknown: the board for drawing a structure (part 7).
 * A small skeletal-structure editor: bonds, atoms, rings and charges. It knows only how the atoms
 * drawn are joined, never what the unknown is. It works out the formula of what is drawn (each
 * atom takes the hydrogens its usual valence leaves room for), so the page can say whether that
 * agrees with the unknown's formula, and it draws the structure again as SVG for the report.
 * The chemistry half loads in Node for tests.
 *
 * A drawing is { atoms: [{ x, y, el, charge }], bonds: [{ a, b, order }] }, in the board's own
 * units (720 by 360; a bond is 40 long).
 */
(function (root) {
  'use strict';

  var BOND = 40, WIDTH = 720, HEIGHT = 360;
  var ELEMENTS = ['C', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I'];

  // ---- The chemistry of a drawing ------------------------------------------------------------------

  function empty() { return { atoms: [], bonds: [] }; }

  /** The valences an atom may have, lowest first. A charged atom: N+ 4, O+ 3, O- 1, N- 2, C+ and C- 3. */
  function valences(el, charge) {
    charge = charge || 0;
    switch (el) {
      case 'C': return [4 - Math.abs(charge)];
      case 'N': return [3 + charge];
      case 'O': return [2 + charge];
      case 'S': return charge ? [2 + charge] : [2, 4, 6];
      default: return [1 + charge];          // the halogens
    }
  }

  function bondSum(mol, i) {
    var sum = 0;
    mol.bonds.forEach(function (b) { if (b.a === i || b.b === i) sum += b.order; });
    return sum;
  }

  function degree(mol, i) {
    var n = 0;
    mol.bonds.forEach(function (b) { if (b.a === i || b.b === i) n++; });
    return n;
  }

  function neighbours(mol, i) {
    var out = [];
    mol.bonds.forEach(function (b) { if (b.a === i) out.push(b.b); else if (b.b === i) out.push(b.a); });
    return out;
  }

  /** How many hydrogens an atom carries, and whether it has more bonds than it can take. */
  function hydrogens(mol, i) {
    var a = mol.atoms[i], used = bondSum(mol, i), vs = valences(a.el, a.charge);
    for (var k = 0; k < vs.length; k++) if (vs[k] >= used) return { h: vs[k] - used, over: false };
    return { h: 0, over: true };
  }

  /** How many separate pieces a drawing is in. */
  function pieces(mol) {
    var n = mol.atoms.length, seen = new Array(n), count = 0;
    for (var s = 0; s < n; s++) {
      if (seen[s]) continue;
      count++;
      var stack = [s];
      seen[s] = true;
      while (stack.length) {
        var i = stack.pop();
        neighbours(mol, i).forEach(function (j) { if (!seen[j]) { seen[j] = true; stack.push(j); } });
      }
    }
    return count;
  }

  /** The formula of a drawing: counts of each element (with H), Hill order text, overall charge, atoms with too many bonds. */
  function formula(mol) {
    var counts = {}, charge = 0, over = [];
    mol.atoms.forEach(function (a, i) {
      var h = hydrogens(mol, i);
      counts[a.el] = (counts[a.el] || 0) + 1;
      if (h.h) counts.H = (counts.H || 0) + h.h;
      if (h.over) over.push(i);
      charge += a.charge || 0;
    });
    var order = Object.keys(counts).sort(function (p, q) {
      function rank(e) { return e === 'C' ? 0 : (e === 'H' ? 1 : 2); }
      return rank(p) - rank(q) || (p < q ? -1 : p > q ? 1 : 0);
    });
    if (!counts.C) order.sort();          // with no carbon, Hill order is plain alphabetical
    var text = order.map(function (e) { return e + (counts[e] > 1 ? counts[e] : ''); }).join('');
    return { counts: counts, text: text, charge: charge, over: over, pieces: pieces(mol), atoms: mol.atoms.length };
  }

  /** The shortest ring that runs through a bond (the atoms in order), or null. */
  function ringThrough(mol, bond) {
    var start = bond.a, goal = bond.b, prev = {}, queue = [start], k;
    prev[start] = -1;
    while (queue.length) {
      var i = queue.shift();
      if (i === goal) break;
      var ns = neighbours(mol, i);
      for (k = 0; k < ns.length; k++) {
        var j = ns[k];
        if (i === start && j === goal) continue;      // not along the bond itself
        if (prev[j] === undefined) { prev[j] = i; queue.push(j); }
      }
    }
    if (prev[goal] === undefined) return null;
    var path = [];
    for (var at = goal; at !== -1; at = prev[at]) path.push(at);
    return path.length <= 8 ? path : null;
  }

  // ---- Changing a drawing ---------------------------------------------------------------------------

  function copy(mol) { return JSON.parse(JSON.stringify(mol)); }

  function atomNear(mol, x, y, within) {
    var best = -1, bd = within;
    mol.atoms.forEach(function (a, i) { var d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  function bondBetween(mol, i, j) {
    for (var k = 0; k < mol.bonds.length; k++) {
      var b = mol.bonds[k];
      if ((b.a === i && b.b === j) || (b.a === j && b.b === i)) return k;
    }
    return -1;
  }

  /** An atom at (x, y): the one already there, or a new one. */
  function atomAt(mol, x, y, el) {
    var i = atomNear(mol, x, y, BOND * 0.3);
    if (i >= 0) return i;
    mol.atoms.push({ x: x, y: y, el: el || 'C', charge: 0 });
    return mol.atoms.length - 1;
  }

  function join(mol, i, j, order) {
    if (i === j) return;
    var k = bondBetween(mol, i, j);
    if (k < 0) mol.bonds.push({ a: i, b: j, order: order || 1 });
  }

  /** Takes atoms out, renumbering the bonds. */
  function removeAtoms(mol, list) {
    var gone = {};
    list.forEach(function (i) { gone[i] = true; });
    var map = [], atoms = [];
    mol.atoms.forEach(function (a, i) { if (gone[i]) map.push(-1); else { map.push(atoms.length); atoms.push(a); } });
    mol.bonds = mol.bonds.filter(function (b) { return !gone[b.a] && !gone[b.b]; })
      .map(function (b) { return { a: map[b.a], b: map[b.b], order: b.order }; });
    mol.atoms = atoms;
  }

  /** Carbons left on their own after something was rubbed out go too. */
  function dropLoneCarbons(mol) {
    var lone = [];
    mol.atoms.forEach(function (a, i) { if (a.el === 'C' && !a.charge && degree(mol, i) === 0) lone.push(i); });
    if (lone.length) removeAtoms(mol, lone);
  }

  function unit(x, y) { var l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
  function rotate(v, deg) { var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; }

  /** The direction for a new bond from an atom: a zigzag along a chain, away from the bonds already there. */
  function freeDirection(mol, i) {
    var a = mol.atoms[i], ns = neighbours(mol, i), d;
    if (!ns.length) d = rotate({ x: 1, y: 0 }, -30);
    else if (ns.length === 1) {
      var n = mol.atoms[ns[0]], back = unit(n.x - a.x, n.y - a.y);
      var c1 = rotate(back, 120), c2 = rotate(back, -120);
      // trans to the atom before the neighbour, so a chain zigzags
      var before = neighbours(mol, ns[0]).filter(function (k) { return k !== i; })[0];
      if (before !== undefined) {
        var m = mol.atoms[before];
        var side = function (p) { return (a.x - n.x) * (p.y - n.y) - (a.y - n.y) * (p.x - n.x); };
        var sm = side(m), s1 = side({ x: a.x + c1.x, y: a.y + c1.y });
        d = (sm * s1 < 0) ? c1 : c2;
      } else d = c1.y < c2.y ? c1 : c2;      // upward first
    } else {
      var sx = 0, sy = 0;
      ns.forEach(function (k) { var u = unit(mol.atoms[k].x - a.x, mol.atoms[k].y - a.y); sx += u.x; sy += u.y; });
      d = Math.hypot(sx, sy) < 0.2 ? rotate(unit(mol.atoms[ns[0]].x - a.x, mol.atoms[ns[0]].y - a.y), 90) : unit(-sx, -sy);
    }
    // turn aside from anything already in the way
    for (var turn = 0; turn < 12; turn++) {
      var t = rotate(d, (turn % 2 ? 1 : -1) * Math.ceil(turn / 2) * 30);
      if (atomNear(mol, a.x + t.x * BOND, a.y + t.y * BOND, BOND * 0.5) < 0) return t;
    }
    return d;
  }

  /** A bond drawn from an atom toward a point, at a whole multiple of 30 degrees and the usual length. */
  function snapped(from, x, y) {
    var ang = Math.atan2(y - from.y, x - from.x), step = Math.PI / 6;
    ang = Math.round(ang / step) * step;
    return { x: from.x + Math.cos(ang) * BOND, y: from.y + Math.sin(ang) * BOND };
  }

  var RINGS = { benzene: 6, ring6: 6, ring5: 5, ring3: 3 };

  /** Puts in a ring: on its own at a point, hung from an atom by a new bond, or sharing a bond. */
  function addRing(mol, kind, hit, x, y) {
    var n = RINGS[kind], R = BOND / (2 * Math.sin(Math.PI / n)), apothem = BOND / (2 * Math.tan(Math.PI / n));
    var verts = [], centre, i, k;
    if (hit && hit.bond >= 0) {
      var b = mol.bonds[hit.bond], A = mol.atoms[b.a], B = mol.atoms[b.b];
      var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, nrm = unit(-(B.y - A.y), B.x - A.x);
      // on the side with less in the way: the nearer the other atoms are to a side's middle, the more they count
      var crowd = function (s) {
        var c = 0, px = mx + s * nrm.x * apothem, py = my + s * nrm.y * apothem;
        mol.atoms.forEach(function (p, k) { if (k !== b.a && k !== b.b) c += 1 / (1 + Math.hypot(p.x - px, p.y - py)); });
        return c;
      };
      var s = crowd(1) <= crowd(-1) ? 1 : -1;
      centre = { x: mx + s * nrm.x * apothem, y: my + s * nrm.y * apothem };
      var a0 = Math.atan2(A.y - centre.y, A.x - centre.x), a1 = Math.atan2(B.y - centre.y, B.x - centre.x);
      var dir = Math.sin(a1 - a0) > 0 ? 1 : -1;
      verts = [b.a, b.b];
      for (k = 2; k < n; k++) {
        var ang = a0 + dir * k * 2 * Math.PI / n;
        verts.push(atomAt(mol, centre.x + R * Math.cos(ang), centre.y + R * Math.sin(ang)));
      }
    } else if (hit && hit.atom >= 0 && degree(mol, hit.atom) > 0) {
      var from = mol.atoms[hit.atom], d = freeDirection(mol, hit.atom);
      var j = atomAt(mol, from.x + d.x * BOND, from.y + d.y * BOND);
      join(mol, hit.atom, j, 1);
      var J = mol.atoms[j];
      centre = { x: J.x + d.x * R, y: J.y + d.y * R };
      var start = Math.atan2(J.y - centre.y, J.x - centre.x);
      verts = [j];
      for (k = 1; k < n; k++) verts.push(atomAt(mol, centre.x + R * Math.cos(start + k * 2 * Math.PI / n), centre.y + R * Math.sin(start + k * 2 * Math.PI / n)));
    } else {
      if (hit && hit.atom >= 0) { var P = mol.atoms[hit.atom]; centre = { x: P.x, y: P.y + R }; }
      else centre = { x: x, y: y };
      for (k = 0; k < n; k++) {
        var an = -Math.PI / 2 + k * 2 * Math.PI / n;
        verts.push(atomAt(mol, centre.x + R * Math.cos(an), centre.y + R * Math.sin(an)));
      }
    }
    // the ring's bonds; a benzene ring's alternate single and double
    var double = true;
    if (hit && hit.bond >= 0) double = mol.bonds[hit.bond].order !== 2;
    for (i = 0; i < n; i++) {
      var p = verts[i], q = verts[(i + 1) % n];
      if (hit && hit.bond >= 0 && i === 0) continue;          // the shared bond is there already
      if (bondBetween(mol, p, q) >= 0) { double = !double; continue; }
      join(mol, p, q, kind === 'benzene' && double ? 2 : 1);
      double = !double;
    }
  }

  // ---- Drawing it as SVG -----------------------------------------------------------------------------

  var INK = '#17211e', RED = '#ab2a1c';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function line(x1, y1, x2, y2, extra) {
    return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"' + (extra || '') + '/>';
  }

  /** Whether an atom shows its symbol: anything but a plain carbon with bonds. */
  function labelled(mol, i, h) {
    var a = mol.atoms[i];
    return a.el !== 'C' || !degree(mol, i) || (a.charge || 0) !== 0 || h.over;
  }

  /** The SVG for a drawing (no outer element): bonds, then labels on white. `hover` marks what the pointer is on. */
  function body(mol, hover) {
    var out = [], i;
    var info = mol.atoms.map(function (a, k) { return hydrogens(mol, k); });
    var shown = mol.atoms.map(function (a, k) { return labelled(mol, k, info[k]); });
    if (hover && hover.bond >= 0 && mol.bonds[hover.bond]) {
      var hb = mol.bonds[hover.bond], A0 = mol.atoms[hb.a], B0 = mol.atoms[hb.b];
      out.push(line(A0.x, A0.y, B0.x, B0.y, ' class="hl" stroke="rgba(28,76,154,0.22)" stroke-width="12" stroke-linecap="round"'));
    }
    if (hover && hover.atom >= 0 && mol.atoms[hover.atom]) {
      var ha = mol.atoms[hover.atom];
      out.push('<circle class="hl" cx="' + ha.x.toFixed(1) + '" cy="' + ha.y.toFixed(1) + '" r="12" fill="rgba(28,76,154,0.22)"/>');
    }
    out.push('<g stroke="' + INK + '" stroke-width="2" stroke-linecap="round">');
    mol.bonds.forEach(function (b) {
      var A = mol.atoms[b.a], B = mol.atoms[b.b];
      // a bond stops short of a symbol
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      var ca = shown[b.a] ? 9 : 0, cb = shown[b.b] ? 9 : 0;
      var x1 = A.x + ux * ca, y1 = A.y + uy * ca, x2 = B.x - ux * cb, y2 = B.y - uy * cb;
      var nx = -uy, ny = ux;
      if (b.order === 1) { out.push(line(x1, y1, x2, y2)); return; }
      if (b.order === 3) {
        out.push(line(x1, y1, x2, y2));
        out.push(line(x1 + nx * 4.5, y1 + ny * 4.5, x2 + nx * 4.5, y2 + ny * 4.5));
        out.push(line(x1 - nx * 4.5, y1 - ny * 4.5, x2 - nx * 4.5, y2 - ny * 4.5));
        return;
      }
      // a double bond: the second line inside a ring, or toward the side the rest of the molecule is on
      var side = 0, ring = ringThrough(mol, b);
      if (ring) {
        var cx = 0, cy = 0;
        ring.forEach(function (k) { cx += mol.atoms[k].x; cy += mol.atoms[k].y; });
        cx /= ring.length; cy /= ring.length;
        side = (cx - A.x) * nx + (cy - A.y) * ny > 0 ? 1 : -1;
      } else if (degree(mol, b.a) > 1 && degree(mol, b.b) > 1) {
        var sum = 0;
        neighbours(mol, b.a).concat(neighbours(mol, b.b)).forEach(function (k) {
          if (k === b.a || k === b.b) return;
          sum += (mol.atoms[k].x - A.x) * nx + (mol.atoms[k].y - A.y) * ny;
        });
        side = sum > 1 ? 1 : (sum < -1 ? -1 : 0);
      }
      if (side === 0) {
        out.push(line(x1 + nx * 3, y1 + ny * 3, x2 + nx * 3, y2 + ny * 3));
        out.push(line(x1 - nx * 3, y1 - ny * 3, x2 - nx * 3, y2 - ny * 3));
      } else {
        out.push(line(x1, y1, x2, y2));
        var o = 6 * side, trimA = shown[b.a] ? 0 : len * 0.14, trimB = shown[b.b] ? 0 : len * 0.14;
        out.push(line(x1 + ux * trimA + nx * o, y1 + uy * trimA + ny * o, x2 - ux * trimB + nx * o, y2 - uy * trimB + ny * o));
      }
    });
    out.push('</g>');
    // the symbols, with their hydrogens and charges
    for (i = 0; i < mol.atoms.length; i++) {
      if (!shown[i]) continue;
      var a = mol.atoms[i], h = info[i], col = h.over ? RED : INK;
      var hText = h.h ? 'H' : '', hSub = h.h > 1 ? String(h.h) : '';
      var charge = a.charge > 0 ? '+' : (a.charge < 0 ? '−' : '');
      // hydrogens go on the side away from the bonds
      var ns = neighbours(mol, i), lean = 0;
      ns.forEach(function (k) { lean += mol.atoms[k].x - a.x; });
      var left = hText && ns.length > 0 && lean > 1;
      var wEl = a.el.length * 9.6, wH = hText ? 9.6 + (hSub ? 6 : 0) : 0, wC = charge ? 7 : 0;
      var x0 = left ? a.x - wEl / 2 - wH : a.x - wEl / 2, total = wEl + wH + wC;
      out.push('<rect x="' + (x0 - 2).toFixed(1) + '" y="' + (a.y - 10).toFixed(1) + '" width="' + (total + 4).toFixed(1) + '" height="20" fill="#ffffff"/>');
      // each piece on its own baseline: a lowered count, a raised charge
      var base = a.y + 6;
      var seg = function (text, lift, size) { return '<tspan y="' + (base + lift).toFixed(1) + '"' + (size ? ' font-size="' + size + '"' : '') + '>' + esc(text) + '</tspan>'; };
      var hPart = hText ? seg('H', 0) + (hSub ? seg(hSub, 4, 12) : '') : '';
      var t = '<text x="' + x0.toFixed(1) + '" y="' + base.toFixed(1) + '" fill="' + col + '" font-size="17" font-family="system-ui, sans-serif">';
      t += left ? hPart + seg(a.el, 0) : seg(a.el, 0) + hPart;
      if (charge) t += seg(charge, -8, 13);
      t += '</text>';
      out.push(t);
      if (h.over) out.push('<circle cx="' + a.x.toFixed(1) + '" cy="' + a.y.toFixed(1) + '" r="14" fill="none" stroke="' + RED + '" stroke-width="1.5"/>');
    }
    return out.join('');
  }

  /** A drawing as a whole SVG, cropped to what is drawn (for the report). */
  function svgMarkup(mol, maxWidth) {
    if (!mol.atoms.length) return '';
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    mol.atoms.forEach(function (a) { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y); });
    var pad = 28, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
    var shown = Math.min(maxWidth || 420, w * 1.1);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [x0 - pad, y0 - pad, w, h].map(function (v) { return v.toFixed(1); }).join(' ') +
      '" width="' + shown.toFixed(0) + '" height="' + (shown * h / w).toFixed(0) + '" role="img" aria-label="The structure">' + body(mol, null) + '</svg>';
  }

  // ---- The board: the pointer and the tools --------------------------------------------------------------

  /**
   * Makes the board in an <svg> element. Tools: "bond" (the default), an element ("N", "O"…),
   * a ring ("benzene", "ring6", "ring5", "ring3"), "charge" and "erase".
   * options.onChange(mol) is called after every change.
   */
  function Board(svg, options) {
    options = options || {};
    var mol = empty(), tool = 'bond', undo = [], press = null, hover = null, ghost = null;
    svg.setAttribute('viewBox', '0 0 ' + WIDTH + ' ' + HEIGHT);

    function render() {
      var html = body(mol, press ? null : hover);
      if (ghost) html += line(ghost.x1, ghost.y1, ghost.x2, ghost.y2, ' stroke="rgba(28,76,154,0.7)" stroke-width="2" stroke-dasharray="5 4"');
      if (!mol.atoms.length) html += '<text class="board-hint" x="' + WIDTH / 2 + '" y="' + HEIGHT / 2 + '" text-anchor="middle" fill="#8d9994" font-size="16" font-family="system-ui, sans-serif">Click to start: each click adds a bond. Drag from an atom to aim one.</text>';
      svg.innerHTML = html;
    }

    function changed(fn) {
      undo.push(copy(mol));
      if (undo.length > 60) undo.shift();
      fn();
      render();
      if (options.onChange) options.onChange(copy(mol));
    }

    function point(e) {
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var m = svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      var p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }

    /** A distance on the screen (CSS pixels) in the board's units, so that a finger on a small phone screen still hits. */
    function reach(px, least) {
      var m = svg.getScreenCTM(), k = m ? Math.abs(m.a) : 1;
      return Math.max(least, px / (k || 1));
    }

    function hitTest(p) {
      var at = atomNear(mol, p.x, p.y, reach(14, 13));
      if (at >= 0) return { atom: at, bond: -1 };
      var best = -1, bd = reach(9, 8);
      mol.bonds.forEach(function (b, k) {
        var A = mol.atoms[b.a], B = mol.atoms[b.b], dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / l2));
        var d = Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy));
        if (d < bd) { bd = d; best = k; }
      });
      return { atom: -1, bond: best };
    }

    function isElement(t) { return ELEMENTS.indexOf(t) >= 0; }

    function click(p, hit) {
      if (RINGS[tool]) { changed(function () { addRing(mol, tool, hit, p.x, p.y); }); return; }
      if (tool === 'erase') {
        if (hit.atom >= 0) changed(function () { removeAtoms(mol, [hit.atom]); dropLoneCarbons(mol); });
        else if (hit.bond >= 0) changed(function () { mol.bonds.splice(hit.bond, 1); dropLoneCarbons(mol); });
        return;
      }
      if (tool === 'charge') {
        if (hit.atom >= 0) changed(function () { var a = mol.atoms[hit.atom]; a.charge = a.charge === 0 ? 1 : (a.charge === 1 ? -1 : 0); });
        return;
      }
      if (isElement(tool)) {
        if (hit.atom >= 0) changed(function () { mol.atoms[hit.atom].el = tool; });
        else if (hit.bond < 0) changed(function () { atomAt(mol, p.x, p.y, tool); });
        return;
      }
      // the bond tool
      if (hit.bond >= 0) changed(function () { var b = mol.bonds[hit.bond]; b.order = b.order % 3 + 1; });
      else if (hit.atom >= 0) changed(function () {
        var a = mol.atoms[hit.atom], d = freeDirection(mol, hit.atom);
        join(mol, hit.atom, atomAt(mol, a.x + d.x * BOND, a.y + d.y * BOND), 1);
      });
      else changed(function () {
        var i = atomAt(mol, p.x, p.y), d = rotate({ x: 1, y: 0 }, -30);
        join(mol, i, atomAt(mol, p.x + d.x * BOND, p.y + d.y * BOND), 1);
      });
    }

    /** Where a bond drawn by dragging would end: on an atom the pointer is over, or the usual length away. */
    function dragEnd(fromAtom, fromPoint, p) {
      var over = atomNear(mol, p.x, p.y, reach(14, 14));
      if (over >= 0 && over !== fromAtom) return { atom: over, x: mol.atoms[over].x, y: mol.atoms[over].y };
      var s = snapped(fromPoint, p.x, p.y);
      return { atom: -1, x: s.x, y: s.y };
    }

    function canDrag() { return tool === 'bond' || isElement(tool); }

    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var p = point(e);
      press = { p: p, hit: hitTest(p), moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      var p = point(e);
      if (!press) {
        var h = hitTest(p);
        if (!hover || h.atom !== hover.atom || h.bond !== hover.bond) { hover = h; render(); }
        return;
      }
      if (Math.hypot(p.x - press.p.x, p.y - press.p.y) > reach(6, 6) && canDrag() && press.hit.bond < 0) {
        press.moved = true;
        var from = press.hit.atom >= 0 ? mol.atoms[press.hit.atom] : press.p;
        var end = dragEnd(press.hit.atom, from, p);
        ghost = { x1: from.x, y1: from.y, x2: end.x, y2: end.y };
        render();
      }
    });
    svg.addEventListener('pointerup', function (e) {
      if (!press) return;
      var p = point(e), pr = press;
      press = null;
      ghost = null;
      if (pr.moved) {
        changed(function () {
          var fromAtom = pr.hit.atom >= 0 ? pr.hit.atom : atomAt(mol, pr.p.x, pr.p.y);
          var end = dragEnd(fromAtom, mol.atoms[fromAtom], p);
          var to = end.atom >= 0 ? end.atom : atomAt(mol, end.x, end.y, isElement(tool) ? tool : 'C');
          var k = bondBetween(mol, fromAtom, to);
          if (k >= 0) mol.bonds[k].order = mol.bonds[k].order % 3 + 1;
          else join(mol, fromAtom, to, 1);
        });
      } else click(pr.p, pr.hit);
      hover = hitTest(p);
      render();
    });
    svg.addEventListener('pointerleave', function () { if (!press) { hover = null; render(); } });
    svg.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); api.undo(); }
    });

    var api = {
      setTool: function (t) { tool = t; ghost = null; render(); },
      tool: function () { return tool; },
      undo: function () {
        if (!undo.length) return;
        mol = undo.pop();
        render();
        if (options.onChange) options.onChange(copy(mol));
      },
      clear: function () { if (mol.atoms.length) changed(function () { mol = empty(); }); },
      load: function (m) {
        mol = m && Array.isArray(m.atoms) && Array.isArray(m.bonds) ? copy(m) : empty();
        undo = [];
        render();
      },
      mol: function () { return copy(mol); },
      canUndo: function () { return undo.length > 0; }
    };
    render();
    return api;
  }

  var api = {
    BOND: BOND, ELEMENTS: ELEMENTS, empty: empty, valences: valences, hydrogens: hydrogens, formula: formula,
    pieces: pieces, ringThrough: ringThrough, addRing: addRing, atomAt: atomAt, join: join, freeDirection: freeDirection,
    removeAtoms: removeAtoms, svgMarkup: svgMarkup, Board: Board
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NmrDraw = api;
})(typeof window !== 'undefined' ? window : globalThis);
