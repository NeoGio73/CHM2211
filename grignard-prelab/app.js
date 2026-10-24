// The Grignard prelab's page, session 1: shows the 3D bench, says what the bench reports (a piece
// refused and why, a joint made, the apparatus complete), and asks the bench for what is missing.
// Nothing is checked here: the joints and their rules live in Unity (LabSnap).
(function () {
  "use strict";

  var unity = null;
  var lab = window.GrignardLab = {
    isMock: false,
    events: [],          // every message from the bench, for tests
    points: null,        // the latest answer to "Where": canvas pixels from the bottom left
    pointer: null        // where the pointer last was over the canvas (client pixels)
  };

  var seedMatch = /[?&]seed=(\d+)/.exec(location.search);
  lab.seed = seedMatch ? seedMatch[1] : null;

  var note = document.getElementById("note");
  var count = document.getElementById("count");
  var hints = document.getElementById("hints");
  var canvas = document.getElementById("unity-canvas");
  var cover = document.getElementById("stage-cover");
  var waiting = [];

  function send(method, arg) {
    if (unity) unity.SendMessage("Lab", method, arg == null ? "" : String(arg));
  }
  lab.send = send;

  function say(text, kind) {
    note.textContent = text;
    note.className = "note" + (kind ? " " + kind : "");
  }

  function sayComplete() {
    say("The apparatus is complete: the flask hangs just above the hot plate, clamped at the Claisen head, with the septum and syringe on the straight arm and the drying tube on the side arm.", "done");
  }

  function sentence(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  lab.onUnityEvent = function (json) {
    var e;
    try { e = JSON.parse(json); } catch (err) { return; }
    lab.events.push(e);
    switch (e.type) {
      case "ready":
        cover.hidden = true;
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) send("Calm", "1");
        // ?seed=N gives a chosen start (which glassware still shows water), for testing
        if (lab.seed) send("StartOver", lab.seed);
        break;
      case "refused":
        say(e.reason, "refused");
        break;
      case "joined":
        // the bench says "complete" before the last piece settles: keep that note
        if (lab.complete) sayComplete();
        else if (e.held) say(sentence("the " + e.piece) + " is held in the " + e.to + ".", "");
        else say(sentence("the " + e.piece) + (e.to ? " is on the " + e.to + "." : " is in place."), "");
        break;
      case "state":
        lab.complete = e.complete;
        count.textContent = e.complete ? "All " + e.of + " joints made." : "Joints made: " + e.made + " of " + e.of;
        if (!hints.hidden) send("Missing");
        break;
      case "complete":
        lab.complete = true;
        sayComplete();
        break;
      case "broken":
        say("The apparatus has come apart.", "");
        break;
      case "missing":
        showHints(e.parts);
        break;
      case "view":
        document.querySelectorAll(".view-button").forEach(function (b) {
          b.setAttribute("aria-pressed", b.getAttribute("data-view") === e.view ? "true" : "false");
        });
        if (e.view !== "inspect" && e.view !== "oven") closeLook();
        break;
      case "where":
        lab.points = e;
        while (waiting.length) waiting.shift()(e);
        break;
      case "name":
        tagName = e.name;
        placeTag();
        break;
      case "inspect":
        showLook(e);
        break;
      case "run":
        showRun(e);
        break;
      case "stop":
        stopText.textContent = e.reason;
        stop.hidden = false;
        document.getElementById("stop-ok").focus();
        break;
    }
  };

  // ---- stage 2: looking at a piece, drying it ----

  var look = document.getElementById("look");
  var stop = document.getElementById("stop");
  var stopText = document.getElementById("stop-text");
  var debug = /[?&]debug=1/.test(location.search);
  var looking = null;

  // what can be done to the piece looked at: glass on the bench can be rinsed or put in the oven;
  // glass in the oven can be taken out; nothing else here (the page never says whether a piece is dry)
  function showLook(e) {
    looking = e;
    document.getElementById("look-name").textContent = e.label;
    var note = "";
    if (e.place === "oven") note = ": in the drying oven";
    else if (e.hot) note = ": hot from the oven";
    if (e.busy) note += (note ? ". " : ": ") + e.busy;
    document.getElementById("look-note").textContent = note;
    var bench = e.glass && e.place !== "oven" && !e.busy;
    document.getElementById("rinse").hidden = !bench;
    document.getElementById("to-oven").hidden = !bench;
    document.getElementById("take-out").hidden = !(e.glass && e.place === "oven");
    look.hidden = false;
  }

  function closeLook() {
    looking = null;
    look.hidden = true;
  }

  function showRun(e) {
    document.getElementById("clock").textContent = e.clock;
    var fast = document.getElementById("fast");
    fast.setAttribute("aria-pressed", e.fast ? "true" : "false");
    fast.textContent = e.fast ? "Back to normal speed" : "Speed up the wait";
    var list = document.getElementById("oven-items");
    list.innerHTML = "";
    e.oven.forEach(function (o) {
      var li = document.createElement("li");
      li.appendChild(document.createTextNode("the " + o.label + " "));
      var b = document.createElement("button");
      b.type = "button";
      b.className = "quiet-button";
      b.textContent = "Take out with tongs";
      b.addEventListener("click", function () { send("TakeOut", o.piece); });
      li.appendChild(b);
      list.appendChild(li);
    });
    document.getElementById("oven-list").hidden = e.oven.length === 0;
    if (debug) showDebug(e);
  }

  function showDebug(e) {
    document.getElementById("debug").hidden = false;
    var rows = document.getElementById("debug-rows");
    rows.innerHTML = "";
    e.hidden.forEach(function (h) {
      var tr = document.createElement("tr");
      [h.piece, h.water.toFixed(2), h.acetone.toFixed(2), h.tempC.toFixed(0), h.dry ? "yes" : "no", h.inOven ? "yes" : ""].forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });
      rows.appendChild(tr);
    });
    var log = document.getElementById("debug-log");
    log.innerHTML = "";
    e.log.forEach(function (l) {
      var li = document.createElement("li");
      li.textContent = l;
      log.appendChild(li);
    });
  }

  document.getElementById("rinse").addEventListener("click", function () {
    if (!looking) return;
    send("Rinse", looking.piece);
    say("You rinsed the " + looking.label + " with acetone.", "");
  });
  document.getElementById("to-oven").addEventListener("click", function () {
    if (looking) send("Oven", looking.piece);
  });
  document.getElementById("take-out").addEventListener("click", function () {
    if (looking) send("TakeOut", looking.piece);
  });
  document.getElementById("look-back").addEventListener("click", function () {
    closeLook();
    send("SetView", "bench");
  });
  document.getElementById("fast").addEventListener("click", function () {
    send("Fast", this.getAttribute("aria-pressed") === "true" ? "0" : "1");
  });
  document.getElementById("stop-ok").addEventListener("click", function () { stop.hidden = true; });

  // the parts not yet in the apparatus, by name only: where each goes is the student's to work out
  function showHints(parts) {
    hints.textContent = parts.length
      ? "Not in the apparatus yet: " + parts.join(", ") + "."
      : "Nothing: the apparatus is complete.";
    hints.hidden = false;
  }

  document.getElementById("missing").addEventListener("click", function () {
    if (!hints.hidden) { hints.hidden = true; return; }
    send("Missing");
  });
  document.getElementById("start-over").addEventListener("click", function () {
    send("StartOver", lab.seed);
    hints.hidden = true;
    closeLook();
    say("A new start: every piece is back in its place.", "");
  });
  document.querySelectorAll(".view-button").forEach(function (b) {
    b.addEventListener("click", function () { send("SetView", b.getAttribute("data-view")); });
  });

  // ---- the name of what the pointer is over: a tag beside the pointer ----

  var tag = document.getElementById("name-tag");
  var tagName = null, overCanvas = false;

  function placeTag() {
    if (!tagName || !overCanvas || !lab.pointer) { tag.hidden = true; return; }
    var r = canvas.getBoundingClientRect();
    tag.textContent = sentence(tagName);
    tag.hidden = false;
    // beside the pointer, kept inside the stage
    var x = lab.pointer[0] - r.left + 14, y = lab.pointer[1] - r.top + 16;
    x = Math.min(x, r.width - tag.offsetWidth - 6);
    y = Math.min(y, r.height - tag.offsetHeight - 6);
    tag.style.left = Math.max(6, x) + "px";
    tag.style.top = Math.max(6, y) + "px";
  }

  canvas.addEventListener("pointerenter", function () { overCanvas = true; });
  canvas.addEventListener("pointerleave", function () { overCanvas = false; placeTag(); });

  // ---- for tests that drag with the real mouse ----

  canvas.addEventListener("pointermove", function (e) { lab.pointer = [e.clientX, e.clientY]; overCanvas = true; placeTag(); });

  /** Asks the bench where everything is; resolves with the answer. */
  lab.where = function () {
    return new Promise(function (resolve) { waiting.push(resolve); send("Where"); });
  };

  /** A canvas point (pixels from the bottom left) as client pixels. */
  lab.toClient = function (p) {
    var r = canvas.getBoundingClientRect();
    return [r.left + p[0] / canvas.width * r.width, r.top + (canvas.height - p[1]) / canvas.height * r.height];
  };

  /** Where on the page to press to pick up a piece (its grip point). */
  lab.at = function (key) {
    return lab.where().then(function (w) { return lab.toClient(w.points[key]); });
  };

  /** Where to move the held pointer so that joint `mine` lands on joint `target`. */
  lab.aim = function (mine, target) {
    return lab.where().then(function (w) {
      var a = lab.toClient(w.points[mine]), b = lab.toClient(w.points[target]), p = lab.pointer;
      return [Math.round(p[0] + b[0] - a[0]), Math.round(p[1] + b[1] - a[1])];
    });
  };

  // ---- the engine ----

  lab.attachUnity = function (instance) { unity = instance; };
  lab.unityProgress = function (p) {
    document.getElementById("progress-fill").style.width = Math.round(p * 100) + "%";
  };
  lab.unityBanner = function (message, type) {
    if (type === "error") document.getElementById("stage-status").textContent = message;
  };
  lab.unityFailed = function (error) {
    document.getElementById("stage-status").textContent = "The 3D bench could not start in this browser. " + (error && error.message ? error.message : error || "");
  };
})();
