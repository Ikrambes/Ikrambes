(function () {
  "use strict";

  var COLS = 22;
  var ROWS = 22;
  var BASE_INTERVAL = 150; // ms per tick at score 0
  var MIN_INTERVAL = 65;
  var INTERVAL_STEP = 4;
  var BEST_KEY = "snake_best_v1";
  var SETTINGS_KEY = "snake_settings_v1";

  var COLOR_PRESETS = {
    green:  { head: "#4ade80", a: "#22c55e", b: "#14532d", glow: "rgba(34,197,94,0.65)" },
    blue:   { head: "#60a5fa", a: "#3b82f6", b: "#1e3a8a", glow: "rgba(59,130,246,0.65)" },
    purple: { head: "#c084fc", a: "#a855f7", b: "#581c87", glow: "rgba(168,85,247,0.65)" },
    orange: { head: "#fb923c", a: "#ea580c", b: "#9a3412", glow: "rgba(234,88,12,0.65)" },
    pink:   { head: "#f9a8d4", a: "#ec4899", b: "#831843", glow: "rgba(236,72,153,0.65)" },
    cyan:   { head: "#67e8f9", a: "#06b6d4", b: "#164e63", glow: "rgba(6,182,212,0.65)" },
    red:    { head: "#f87171", a: "#ef4444", b: "#7f1d1d", glow: "rgba(239,68,68,0.65)" },
  };

  var FRUITS = {
    apple:      { glyph: "🍎", color: "#ef4444" },
    strawberry: { glyph: "🍓", color: "#f43f5e" },
    orange:     { glyph: "🍊", color: "#f97316" },
    cherry:     { glyph: "🍒", color: "#dc2626" },
    lemon:      { glyph: "🍋", color: "#eab308" },
    grapes:     { glyph: "🍇", color: "#7c3aed" },
  };

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var finalScoreEl = document.getElementById("final-score");
  var newBestEl = document.getElementById("new-best");
  var startOverlay = document.getElementById("start-overlay");
  var overOverlay = document.getElementById("over-overlay");
  var startBtn = document.getElementById("start-btn");
  var retryBtn = document.getElementById("retry-btn");

  var cell = 0;
  var dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    var box = canvas.getBoundingClientRect();
    var size = Math.round(box.width);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    cell = (size * dpr) / COLS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  window.addEventListener("resize", resize);

  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) {}
  }

  function pad(n) {
    n = Math.max(0, n | 0);
    var s = String(n);
    while (s.length < 4) s = "0" + s;
    return s;
  }

  var best = loadBest();
  bestEl.textContent = pad(best);

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !FRUITS[parsed.fruit]) return null;
      if (parsed.color === "custom" && typeof parsed.customHex === "string") return parsed;
      if (COLOR_PRESETS[parsed.color]) return parsed;
    } catch (e) {}
    return null;
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  var settings = loadSettings() || { color: "orange", fruit: "apple", customHex: null };

  function mixToward(hex, target, amt) {
    var c = hexToRgb(hex);
    var r = Math.round(c.r + (target - c.r) * amt);
    var g = Math.round(c.g + (target - c.g) * amt);
    var b = Math.round(c.b + (target - c.b) * amt);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function getPreset() {
    if (settings.color === "custom" && settings.customHex) {
      var hex = settings.customHex;
      return {
        head: mixToward(hex, 255, 0.35),
        a: hex,
        b: mixToward(hex, 0, 0.55),
        glow: hexToRgba(hex, 0.65),
      };
    }
    return COLOR_PRESETS[settings.color] || COLOR_PRESETS.orange;
  }

  var colorSwatches = document.querySelectorAll(".swatch");
  var fruitButtons = document.querySelectorAll(".fruit-btn");
  var customColorInput = document.getElementById("custom-color-input");

  function applySettingsUI() {
    colorSwatches.forEach(function (btn) {
      btn.classList.toggle("selected", btn.getAttribute("data-color") === settings.color);
    });
    if (customColorInput) {
      customColorInput.classList.toggle("selected", settings.color === "custom");
      if (settings.customHex) customColorInput.value = settings.customHex;
    }
    fruitButtons.forEach(function (btn) {
      btn.classList.toggle("selected", btn.getAttribute("data-fruit") === settings.fruit);
    });
  }
  applySettingsUI();

  colorSwatches.forEach(function (btn) {
    btn.addEventListener("click", function () {
      settings.color = btn.getAttribute("data-color");
      applySettingsUI();
      saveSettings();
    });
  });
  if (customColorInput) {
    customColorInput.addEventListener("input", function () {
      settings.color = "custom";
      settings.customHex = customColorInput.value;
      applySettingsUI();
      saveSettings();
    });
  }
  fruitButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      settings.fruit = btn.getAttribute("data-fruit");
      applySettingsUI();
      saveSettings();
    });
  });

  var state = "idle"; // idle | playing | over
  var paused = false;
  var snake, dir, nextDir, food, score, acc, interval, particles, lastTime;

  function cellCenter(p) {
    return { x: p.x * cell + cell / 2, y: p.y * cell + cell / 2 };
  }

  function randomEmptyCell() {
    var free = [];
    for (var x = 0; x < COLS; x++) {
      for (var y = 0; y < ROWS; y++) {
        var occupied = snake.some(function (s) { return s.x === x && s.y === y; });
        if (!occupied) free.push({ x: x, y: y });
      }
    }
    return free[(Math.random() * free.length) | 0];
  }

  function reset() {
    var cx = (COLS / 2) | 0;
    var cy = (ROWS / 2) | 0;
    snake = [
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    interval = BASE_INTERVAL;
    acc = 0;
    particles = [];
    food = randomEmptyCell();
    scoreEl.textContent = pad(score);
  }

  function spawnParticles(pos) {
    var c = cellCenter(pos);
    var n = 14;
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      var speed = 1.4 + Math.random() * 1.8;
      particles.push({
        x: c.x,
        y: c.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        r: 2 + Math.random() * 2,
        hue: Math.random() < 0.5
          ? (FRUITS[settings.fruit] || FRUITS.apple).color
          : getPreset().a,
      });
    }
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setDirection(dx, dy) {
    if (dx === -dir.x && dy === -dir.y) return; // no instant reverse
    nextDir = { x: dx, y: dy };
  }

  function step() {
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      return gameOver();
    }
    for (var i = 0; i < snake.length; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return gameOver();
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = pad(score);
      scoreEl.classList.remove("bump");
      void scoreEl.offsetWidth; // restart animation
      scoreEl.classList.add("bump");
      spawnParticles(food);
      interval = Math.max(MIN_INTERVAL, BASE_INTERVAL - Math.floor(score / 10) * INTERVAL_STEP);
      food = randomEmptyCell();
    } else {
      snake.pop();
    }
  }

  function gameOver() {
    state = "over";
    var isNew = score > best;
    if (isNew) {
      best = score;
      saveBest(best);
      bestEl.textContent = pad(best);
    }
    finalScoreEl.textContent = "Score: " + pad(score);
    newBestEl.classList.toggle("show", isNew);
    overOverlay.classList.remove("hidden");
  }

  function draw() {
    var size = canvas.width;
    ctx.clearRect(0, 0, size, size);

    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (var g = 1; g < COLS; g++) {
      ctx.beginPath();
      ctx.moveTo(g * cell, 0);
      ctx.lineTo(g * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g * cell);
      ctx.lineTo(size, g * cell);
      ctx.stroke();
    }

    // food — rendered as the player's selected fruit
    var fc = cellCenter(food);
    var fruit = FRUITS[settings.fruit] || FRUITS.apple;
    var pulse = 0.5 + Math.sin(Date.now() / 220) * 0.12;
    var r = cell * 0.34 * (1 + pulse * 0.15);
    var grad = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, r * 2.4);
    grad.addColorStop(0, hexToRgba(fruit.color, 0.55));
    grad.addColorStop(1, hexToRgba(fruit.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fc.x, fc.y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = Math.round(cell * 0.8) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fruit.glyph, fc.x, fc.y + cell * 0.02);

    // snake — rendered in the player's selected color (preset or custom picker)
    var preset = getPreset();
    var padCell = cell * 0.12;
    for (var i = snake.length - 1; i >= 0; i--) {
      var s = snake[i];
      var t = i / Math.max(1, snake.length - 1);
      var isHead = i === 0;
      var color = isHead ? preset.head : shade(preset.a, preset.b, t);
      ctx.fillStyle = color;
      if (isHead) {
        ctx.shadowColor = preset.glow;
        ctx.shadowBlur = 14 * dpr;
      } else {
        ctx.shadowBlur = 0;
      }
      roundedRect(
        s.x * cell + padCell,
        s.y * cell + padCell,
        cell - padCell * 2,
        cell - padCell * 2,
        (cell - padCell * 2) * 0.32
      );
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isHead) {
        var ex = s.x * cell + cell / 2 + dir.x * cell * 0.15;
        var ey = s.y * cell + cell / 2 + dir.y * cell * 0.15;
        var perpX = -dir.y;
        var perpY = dir.x;
        var off = cell * 0.16;
        ctx.fillStyle = "#100b07";
        [-1, 1].forEach(function (sgn) {
          ctx.beginPath();
          ctx.arc(ex + perpX * off * sgn, ey + perpY * off * sgn, cell * 0.07, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    drawParticles();

    if (state === "playing" && paused) {
      ctx.fillStyle = "rgba(11,10,9,0.55)";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#f2ece4";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = (18 * dpr) + "px monospace";
      ctx.fillText("PAUSED", size / 2, size / 2 - 10 * dpr);
      ctx.font = (11 * dpr) + "px monospace";
      ctx.fillStyle = "#a8998a";
      ctx.fillText("press P to resume", size / 2, size / 2 + 16 * dpr);
    }
  }

  function shade(c1, c2, t) {
    var a = hexToRgb(c1), b = hexToRgb(c2);
    var r = Math.round(a.r + (b.r - a.r) * t);
    var g = Math.round(a.g + (b.g - a.g) * t);
    var bl = Math.round(a.b + (b.b - a.b) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function hexToRgba(hex, a) {
    var c = hexToRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  function loop(time) {
    if (!lastTime) lastTime = time;
    var dt = time - lastTime;
    lastTime = time;

    if (state === "playing" && !paused) {
      acc += dt;
      while (acc >= interval) {
        acc -= interval;
        step();
        if (state !== "playing") break;
      }
    }
    updateParticles();
    draw();
    requestAnimationFrame(loop);
  }

  function startGame() {
    resize();
    reset();
    paused = false;
    state = "playing";
    startOverlay.classList.add("hidden");
    overOverlay.classList.add("hidden");
  }

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);

  window.addEventListener("keydown", function (e) {
    var key = e.key;
    if (state !== "playing" && (key === " " || key === "Enter")) {
      startGame();
      return;
    }
    if (state === "playing" && (key === "p" || key === "P" || key === "Escape")) {
      paused = !paused;
      return;
    }
    if (state === "playing" && paused) return;
    var map = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    };
    if (map[key]) {
      e.preventDefault();
      setDirection(map[key][0], map[key][1]);
    }
  });

  document.querySelectorAll(".dpad button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var d = btn.getAttribute("data-dir");
      if (state !== "playing") return;
      if (d === "up") setDirection(0, -1);
      if (d === "down") setDirection(0, 1);
      if (d === "left") setDirection(-1, 0);
      if (d === "right") setDirection(1, 0);
    });
  });

  var touchStart = null;
  canvas.addEventListener("touchstart", function (e) {
    var t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? 1 : -1, 0);
    } else {
      setDirection(0, dy > 0 ? 1 : -1);
    }
    touchStart = null;
  }, { passive: true });

  resize();
  reset();
  draw();
  requestAnimationFrame(loop);
})();
