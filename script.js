/**
 * script.js — EngineLab application glue.
 * Wires cars.js (data) + physics.js (EngineSim) + audio.js (EngineAudio) to
 * the DOM: car selection, keyboard/scroll input, the animated tachometer,
 * telemetry readouts, and the bonus drive modes (launch control, dyno pull,
 * environments, custom sound pack upload).
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------
  const ANGLE_MIN = -130; // degrees, needle position at 0 rpm
  const ANGLE_MAX = 130;  // degrees, needle position at gauge max
  const RPM_LED_COUNT = 24;

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let currentCar = CARS[0];
  const sim = new EngineSim(currentCar);
  const audio = new EngineAudio();

  const input = {
    wHeld: false,
    sHeld: false,
    cHeld: false,
    spaceHeld: false,
    scrollThrottle: 0
  };

  let needle = { value: 0, vel: 0 }; // degrees, RPM needle
  let speedNeedle = { value: 0, vel: 0 }; // degrees, speed needle
  let gaugeMaxSpeed = 280;
  let lastTime = performance.now();
  let dynoActive = false;
  let dynoSamples = [];
  let dynoTimer = 0;
  let launchArmed = false;
  let launchEngaged = false;
  let gaugeMaxRpm = 1000;
  let prevGear = sim.gear;
  let prevStalled = false;

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const el = {
    app: $("app"),
    carList: $("carList"),
    carBlurb: $("carBlurb"),
    specGrid: $("specGrid"),
    tachFace: $("tachFace"),
    needleCanvas: $("needleCanvas"),
    speedoFace: $("speedoFace"),
    speedoNeedleCanvas: $("speedoNeedleCanvas"),
    topSpeedHint: $("topSpeedHint"),
    rpmReadout: $("rpmReadout"),
    gearBadge: $("gearBadge"),
    speedReadout: $("speedReadout"),
    odoReadout: $("odoReadout"),
    stallBanner: $("stallBanner"),
    rpmBar: $("rpmBar"),
    redlineHint: $("redlineHint"),
    throttleVal: $("throttleVal"),
    brakeVal: $("brakeVal"),
    clutchVal: $("clutchVal"),
    throttleFill: $("throttleFill"),
    brakeFill: $("brakeFill"),
    clutchFill: $("clutchFill"),
    teleMaxRpm: $("teleMaxRpm"),
    teleMaxSpeed: $("teleMaxSpeed"),
    teleShifts: $("teleShifts"),
    teleGearRatio: $("teleGearRatio"),
    launchBtn: $("launchBtn"),
    dynoBtn: $("dynoBtn"),
    dynoCard: $("dynoCard"),
    dynoStatus: $("dynoStatus"),
    dynoCanvas: $("dynoCanvas"),
    dynoPeakPower: $("dynoPeakPower"),
    dynoPeakRpm: $("dynoPeakRpm"),
    envSelect: $("envSelect"),
    envStreaks: $("envStreaks"),
    speedBlur: $("speedBlur"),
    gaugeCard: $("gaugeCard"),
    flameFx: $("flameFx"),
    soundUpload: $("soundUpload"),
    uploadStatus: $("uploadStatus"),
    startOverlay: $("startOverlay"),
    startBtn: $("startBtn"),
    muteBtn: $("muteBtn"),
    volumeSlider: $("volumeSlider"),
    audioModeToggle: $("audioModeToggle"),
    resetBtn: $("resetBtn"),
    toastStack: $("toastStack")
  };

  const needleCtx = el.needleCanvas.getContext("2d");
  const speedoNeedleCtx = el.speedoNeedleCanvas.getContext("2d");

  // ---------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function deg2rad(d) { return (d * Math.PI) / 180; }

  function toast(message) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = message;
    el.toastStack.appendChild(t);
    setTimeout(() => t.remove(), 1450);
  }

  // ---------------------------------------------------------------
  // Car list / specs UI
  // ---------------------------------------------------------------
  function buildCarList() {
    el.carList.innerHTML = "";
    CARS.forEach(car => {
      const row = document.createElement("button");
      row.className = "car-row" + (car.id === currentCar.id ? " active" : "");
      row.style.setProperty("--row-accent", car.accent);
      row.dataset.id = car.id;
      row.innerHTML = `
        <span class="swatch"></span>
        <span class="meta">
          <span class="name">${car.make} ${car.model}</span>
          <span class="sub">${car.chassis} · ${car.hp} HP</span>
        </span>`;
      row.addEventListener("click", () => selectCar(car.id));
      el.carList.appendChild(row);
    });
  }

  function selectCar(id) {
    const car = getCarById(id);
    currentCar = car;
    document.documentElement.style.setProperty("--car-accent", car.accent);
    document.documentElement.style.setProperty("--car-accent-dim", hexToRgba(car.accent, 0.18));
    [...el.carList.children].forEach(row => {
      row.classList.toggle("active", row.dataset.id === id);
    });
    sim.setCar(car);
    audio.loadCar(car);
    buildSpecPanel(car);
    buildTachFace(car);
    buildSpeedoFace(car);
    buildRpmBar(car);
    el.redlineHint.textContent = `redline ${car.redline.toLocaleString()}`;
    dynoSamples = [];
    drawDynoChart();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildSpecPanel(car) {
    el.carBlurb.textContent = car.blurb;
    const items = [
      { v: `${car.hp}`, l: "Horsepower" },
      { v: `${car.torqueNm}`, l: "Torque (Nm)" },
      { v: `${car.redline.toLocaleString()}`, l: "Redline RPM" },
      { v: `${car.weightKg}`, l: "Weight (kg)" },
      { v: car.drivetrain, l: "Drivetrain" },
      { v: car.aspiration === "turbo" ? "Turbo" : "NA", l: "Aspiration" }
    ];
    el.specGrid.innerHTML = items
      .map(i => `<div class="spec-item"><div class="v">${i.v}</div><div class="l">${i.l}</div></div>`)
      .join("");
  }

  // ---------------------------------------------------------------
  // Tachometer face (SVG, static per car) + RPM LED bar
  // ---------------------------------------------------------------
  function buildTachFace(car) {
    gaugeMaxRpm = Math.ceil(car.limiter / 1000) * 1000;
    const cx = 200, cy = 200, rOuter = 178, rTick = 160, rTickMinor = 168, rLabel = 138;
    const sweep = ANGLE_MAX - ANGLE_MIN;
    const steps = gaugeMaxRpm / 1000;

    let svg = `
      <defs>
        <radialGradient id="faceGrad" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stop-color="#1c1f26"/>
          <stop offset="100%" stop-color="#0c0d10"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#faceGrad)" stroke="#2a2e36" stroke-width="2"/>
    `;

    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const angle = ANGLE_MIN + frac * sweep;
      const rad = deg2rad(angle - 90);
      const isRed = i * 1000 >= car.redline;
      const x1 = cx + rTick * Math.cos(rad);
      const y1 = cy + rTick * Math.sin(rad);
      const x2 = cx + rOuter * 0.96 * Math.cos(rad);
      const y2 = cy + rOuter * 0.96 * Math.sin(rad);
      svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${isRed ? "#ff4747" : "#9aa1ab"}" stroke-width="3" stroke-linecap="round"/>`;

      const lx = cx + rLabel * Math.cos(rad);
      const ly = cy + rLabel * Math.sin(rad);
      svg += `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="middle" font-family="Rajdhani" font-weight="700" font-size="15" fill="${isRed ? "#ff6b6b" : "#cfd3d8"}">${i}</text>`;

      if (i < steps) {
        for (let m = 1; m < 4; m++) {
          const mfrac = (i + m * 0.25) / steps;
          const mangle = ANGLE_MIN + mfrac * sweep;
          const mrad = deg2rad(mangle - 90);
          const mx1 = cx + rTickMinor * Math.cos(mrad);
          const my1 = cy + rTickMinor * Math.sin(mrad);
          const mx2 = cx + rOuter * 0.94 * Math.cos(mrad);
          const my2 = cy + rOuter * 0.94 * Math.sin(mrad);
          svg += `<line x1="${mx1.toFixed(1)}" y1="${my1.toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${my2.toFixed(1)}" stroke="#3a3f48" stroke-width="1.5"/>`;
        }
      }
    }

    const redFrac = car.redline / gaugeMaxRpm;
    const a0 = ANGLE_MIN + redFrac * sweep;
    const a1 = ANGLE_MAX;
    const arcPath = describeArc(cx, cy, rOuter - 6, a0, a1);
    svg += `<path d="${arcPath}" fill="none" stroke="#ff4747" stroke-width="5" stroke-linecap="round" opacity="0.85"/>`;

    svg += `<text x="${cx}" y="${cy + 92}" text-anchor="middle" font-family="Inter" font-size="10" letter-spacing="2" fill="#5e6470">RPM × 1000</text>`;

    el.tachFace.innerHTML = svg;
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  }
  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = deg2rad(angleDeg - 90);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function buildSpeedoFace(car) {
    gaugeMaxSpeed = Math.ceil((car.topSpeedKmh || 280) / 40) * 40;
    const cx = 160, cy = 160, rOuter = 142, rTick = 128, rTickMinor = 134, rLabel = 110;
    const sweep = ANGLE_MAX - ANGLE_MIN;
    const majorStep = gaugeMaxSpeed <= 240 ? 20 : 40;
    const steps = gaugeMaxSpeed / majorStep;

    let svg = `
      <defs>
        <radialGradient id="speedoFaceGrad" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stop-color="#1c1f26"/>
          <stop offset="100%" stop-color="#0c0d10"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#speedoFaceGrad)" stroke="#2a2e36" stroke-width="2"/>
    `;

    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const angle = ANGLE_MIN + frac * sweep;
      const rad = deg2rad(angle - 90);
      const x1 = cx + rTick * Math.cos(rad);
      const y1 = cy + rTick * Math.sin(rad);
      const x2 = cx + rOuter * 0.95 * Math.cos(rad);
      const y2 = cy + rOuter * 0.95 * Math.sin(rad);
      svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9aa1ab" stroke-width="2.5" stroke-linecap="round"/>`;

      const lx = cx + rLabel * Math.cos(rad);
      const ly = cy + rLabel * Math.sin(rad);
      svg += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-family="Rajdhani" font-weight="700" font-size="12" fill="#cfd3d8">${i * majorStep}</text>`;

      if (i < steps) {
        const minorTicks = majorStep === 20 ? 1 : 3;
        for (let m = 1; m <= minorTicks; m++) {
          const mfrac = (i + m / (minorTicks + 1)) / steps;
          const mangle = ANGLE_MIN + mfrac * sweep;
          const mrad = deg2rad(mangle - 90);
          const mx1 = cx + rTickMinor * Math.cos(mrad);
          const my1 = cy + rTickMinor * Math.sin(mrad);
          const mx2 = cx + rOuter * 0.92 * Math.cos(mrad);
          const my2 = cy + rOuter * 0.92 * Math.sin(mrad);
          svg += `<line x1="${mx1.toFixed(1)}" y1="${my1.toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${my2.toFixed(1)}" stroke="#3a3f48" stroke-width="1.2"/>`;
        }
      }
    }

    svg += `<text x="${cx}" y="${cy + 70}" text-anchor="middle" font-family="Inter" font-size="9" letter-spacing="1.5" fill="#5e6470">KM/H</text>`;

    el.speedoFace.innerHTML = svg;
    el.topSpeedHint.textContent = `top ~${car.topSpeedKmh} km/h`;
  }

  function updateSpeedNeedle(dt, speedKmh) {
    const sweep = ANGLE_MAX - ANGLE_MIN;
    const frac = clamp(speedKmh / gaugeMaxSpeed, 0, 1.05);
    const targetAngle = ANGLE_MIN + frac * sweep;
    const k = 180, c = 22;
    const force = (targetAngle - speedNeedle.value) * k - speedNeedle.vel * c;
    speedNeedle.vel += force * dt;
    speedNeedle.value += speedNeedle.vel * dt;
  }

  function drawSpeedNeedle() {
    const ctx = speedoNeedleCtx;
    ctx.clearRect(0, 0, 320, 320);
    const cx = 160, cy = 160;
    const rad = deg2rad(speedNeedle.value - 90);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad + Math.PI / 2);
    const needleColor = "#e8ebee"; // neutral, distinct from the accent-colored RPM needle

    ctx.shadowColor = needleColor;
    ctx.shadowBlur = 8;
    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.moveTo(-3, 11);
    ctx.lineTo(3, 11);
    ctx.lineTo(1.6, -118);
    ctx.lineTo(-1.6, -118);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.fillStyle = "#0c0d10";
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = needleColor;
    ctx.stroke();
  }

  function buildRpmBar() {
    el.rpmBar.innerHTML = "";
    for (let i = 0; i < RPM_LED_COUNT; i++) {
      const led = document.createElement("div");
      led.className = "rpm-led";
      el.rpmBar.appendChild(led);
    }
  }

  function updateRpmBar(rpmFrac) {
    const lit = Math.round(rpmFrac * RPM_LED_COUNT);
    [...el.rpmBar.children].forEach((led, i) => {
      const on = i < lit;
      led.classList.toggle("on", on);
      const t = i / RPM_LED_COUNT;
      const color = t < 0.6 ? "#4dff91" : t < 0.85 ? "#ffd24d" : "#ff4747";
      led.style.setProperty("--led-color", color);
    });
  }

  // ---------------------------------------------------------------
  // Needle (spring-damper physics for analog overshoot + limiter bounce)
  // ---------------------------------------------------------------
  function updateNeedle(dt, rpmFrac, limiterActive) {
    const sweep = ANGLE_MAX - ANGLE_MIN;
    let targetAngle = ANGLE_MIN + clamp(rpmFrac, 0, 1.05) * sweep;
    if (limiterActive) {
      targetAngle += Math.sin(performance.now() * 0.045) * 2.5;
    }
    const k = 220;
    const c = 21;
    const force = (targetAngle - needle.value) * k - needle.vel * c;
    needle.vel += force * dt;
    needle.value += needle.vel * dt;
  }

  function drawNeedle() {
    const ctx = needleCtx;
    ctx.clearRect(0, 0, 400, 400);
    const cx = 200, cy = 200;
    const rad = deg2rad(needle.value - 90);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad + Math.PI / 2);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--car-accent").trim() || "#6fb7ff";

    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-4, 14);
    ctx.lineTo(4, 14);
    ctx.lineTo(2.2, -150);
    ctx.lineTo(-2.2, -150);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.fillStyle = "#0c0d10";
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }

  // ---------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------
  function bindInput() {
    window.addEventListener("keydown", e => {
      if (e.repeat) {
        if (e.code === "Space") e.preventDefault();
        return;
      }
      switch (e.code) {
        case "KeyW": input.wHeld = true; break;
        case "KeyS": input.sHeld = true; break;
        case "KeyC": input.cHeld = true; break;
        case "Space": input.spaceHeld = true; e.preventDefault(); break;
        case "ArrowUp":
          e.preventDefault();
          sim.shiftUp();
          toast(sim.gear === 0 ? "Neutral" : `Shift Up — Gear ${sim.gear}`);
          break;
        case "ArrowDown":
          e.preventDefault();
          sim.shiftDown();
          toast(sim.gear === 0 ? "Neutral" : `Shift Down — Gear ${sim.gear}`);
          break;
        case "KeyR": resetVehicle(); break;
        default: return;
      }
    });
    window.addEventListener("keyup", e => {
      switch (e.code) {
        case "KeyW": input.wHeld = false; break;
        case "KeyS": input.sHeld = false; break;
        case "KeyC": input.cHeld = false; break;
        case "Space": input.spaceHeld = false; break;
        default: return;
      }
    });

    window.addEventListener(
      "wheel",
      e => {
        if (el.startOverlay && !el.startOverlay.classList.contains("hidden")) return;
        const delta = clamp(-e.deltaY, -100, 100) / 100;
        input.scrollThrottle = clamp(input.scrollThrottle + delta * 0.06, 0, 1);
      },
      { passive: true }
    );

    el.gearBadge.addEventListener("click", () => {
      sim.gear === 0 ? sim.shiftUp() : sim.setNeutral();
      toast(sim.gear === 0 ? "Neutral" : `Gear ${sim.gear}`);
    });

    el.resetBtn.addEventListener("click", resetVehicle);
  }

  function resetVehicle() {
    sim.reset();
    input.scrollThrottle = 0;
    launchArmed = false;
    launchEngaged = false;
    el.launchBtn.classList.remove("active");
    toast("Vehicle Reset");
  }

  function gatherInputs() {
    let throttle = Math.max(input.wHeld ? 1 : 0, input.scrollThrottle);
    let clutch = input.cHeld ? 1 : 0;
    let brake = input.sHeld ? 1 : 0;
    let gearOverrideNeutral = false;

    if (input.spaceHeld) {
      throttle = 1;
      gearOverrideNeutral = true;
    }

    if (launchArmed && sim.gear === 1) {
      if (input.cHeld && throttle > 0.85 && !launchEngaged) {
        const launchTarget = sim.car.idle + (sim.car.redline - sim.car.idle) * 0.62;
        throttle = sim.rpm > launchTarget ? 0.12 : 1;
        clutch = 1;
      } else if (!input.cHeld && sim.clutch > 0.3) {
        launchEngaged = true;
        throttle = 1;
      }
      if (launchEngaged && sim.speedKmh > 8) {
        launchEngaged = false;
        launchArmed = false;
        el.launchBtn.classList.remove("active");
      }
    }

    if (dynoActive) {
      throttle = 1;
      clutch = 0;
      brake = 0;
      gearOverrideNeutral = true;
    }

    return { throttle, brake, clutch, gearOverrideNeutral };
  }

  // ---------------------------------------------------------------
  // Drive modes: launch control + dyno
  // ---------------------------------------------------------------
  function bindModes() {
    el.launchBtn.addEventListener("click", () => {
      if (dynoActive) return;
      launchArmed = !launchArmed;
      launchEngaged = false;
      el.launchBtn.classList.toggle("active", launchArmed);
      toast(launchArmed ? "Launch Control Armed" : "Launch Control Off");
      if (launchArmed && sim.gear !== 1) {
        sim.gear = 1;
      }
    });

    el.dynoBtn.addEventListener("click", () => {
      if (launchArmed) return;
      startDyno();
    });
  }

  function startDyno() {
    dynoActive = true;
    dynoSamples = [];
    dynoTimer = 0;
    sim.setNeutral();
    sim.rpm = sim.car.idle;
    el.dynoCard.style.display = "block";
    el.dynoStatus.textContent = "running…";
    el.dynoBtn.classList.add("active");
    toast("Dyno Run Started");
  }

  function updateDyno(dt, snap) {
    if (!dynoActive) return;
    dynoTimer += dt;
    const omega = (snap.rpm * 2 * Math.PI) / 60;
    const torque = sim.car.torqueNm * sim._torqueFactor(snap.rpmFrac);
    const powerKw = (torque * omega) / 1000;
    const powerHp = powerKw * 1.341;
    dynoSamples.push({ rpm: snap.rpm, hp: powerHp });

    if (snap.rpm >= sim.car.limiter - 50 || dynoTimer > 8) {
      dynoActive = false;
      el.dynoStatus.textContent = "complete";
      el.dynoBtn.classList.remove("active");
      toast("Dyno Run Complete");
      drawDynoChart();
    }
  }

  function drawDynoChart() {
    const canvas = el.dynoCanvas;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (dynoSamples.length < 2) {
      el.dynoPeakPower.textContent = "Peak: —";
      el.dynoPeakRpm.textContent = "@ — RPM";
      return;
    }
    const maxRpm = sim.car.limiter;
    const maxHp = Math.max(...dynoSamples.map(s => s.hp)) * 1.1;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--car-accent").trim() || "#6fb7ff";

    ctx.strokeStyle = "#21242b";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = accent;
    dynoSamples.forEach((s, i) => {
      const x = (s.rpm / maxRpm) * w;
      const y = h - (s.hp / maxHp) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = hexToRgba(accent, 0.12);
    ctx.fill();

    let peak = dynoSamples[0];
    dynoSamples.forEach(s => { if (s.hp > peak.hp) peak = s; });
    el.dynoPeakPower.textContent = `Peak: ${peak.hp.toFixed(0)} hp`;
    el.dynoPeakRpm.textContent = `@ ${Math.round(peak.rpm).toLocaleString()} RPM`;
  }

  // ---------------------------------------------------------------
  // Environment switching
  // ---------------------------------------------------------------
  function bindEnvironment() {
    el.envSelect.addEventListener("click", e => {
      const btn = e.target.closest("button[data-env]");
      if (!btn) return;
      [...el.envSelect.children].forEach(b => b.classList.toggle("active", b === btn));
      el.app.className = `env-${btn.dataset.env}`;
      el.envStreaks.classList.toggle("active", btn.dataset.env !== "garage");
      renderStreaks(btn.dataset.env);
    });
  }

  function renderStreaks(env) {
    el.envStreaks.innerHTML = "";
    if (env === "garage") return;
    const count = env === "racetrack" ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "streak";
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDuration = `${0.5 + Math.random() * 0.6}s`;
      s.style.animationDelay = `${Math.random() * 1.2}s`;
      s.style.opacity = (0.2 + Math.random() * 0.5).toFixed(2);
      el.envStreaks.appendChild(s);
    }
  }

  // ---------------------------------------------------------------
  // Audio mode / volume / mute / custom sample
  // ---------------------------------------------------------------
  function bindAudioControls() {
    el.audioModeToggle.addEventListener("click", e => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      [...el.audioModeToggle.children].forEach(b => b.classList.toggle("active", b === btn));
      audio.setMode(btn.dataset.mode);
    });

    el.volumeSlider.addEventListener("input", () => {
      audio.setVolume(el.volumeSlider.value / 100);
    });

    el.muteBtn.addEventListener("click", () => {
      audio.setMuted(!audio.muted);
      el.muteBtn.style.color = audio.muted ? "var(--danger)" : "";
    });

    el.soundUpload.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      el.uploadStatus.textContent = "Decoding…";
      try {
        const buf = await file.arrayBuffer();
        await audio.init();
        const audioBuffer = await audio.ctx.decodeAudioData(buf);
        audio.loadCustomSample(audioBuffer);
        el.uploadStatus.textContent = `Blending in: ${file.name}`;
      } catch (err) {
        el.uploadStatus.textContent = "Could not decode that file.";
      }
    });
  }

  // ---------------------------------------------------------------
  // Start overlay
  // ---------------------------------------------------------------
  function bindStart() {
    el.startBtn.addEventListener("click", async () => {
      await audio.init();
      audio.loadCar(currentCar);
      el.startOverlay.classList.add("hidden");
      lastTime = performance.now();
      requestAnimationFrame(loop);
    });
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    const rawInputs = gatherInputs();

    let snap;
    if (rawInputs.gearOverrideNeutral) {
      const savedGear = sim.gear;
      sim.gear = 0;
      snap = sim.update(dt, rawInputs);
      if (!dynoActive) sim.gear = savedGear;
    } else {
      snap = sim.update(dt, rawInputs);
    }

    audio.update(snap);
    updateDyno(dt, snap);
    updateNeedle(dt, snap.rpmFrac, snap.limiterActive);
    drawNeedle();
    updateSpeedNeedle(dt, snap.speedKmh);
    drawSpeedNeedle();
    renderUI(snap);

    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------
  // UI render (DOM updates each frame)
  // ---------------------------------------------------------------
  function renderUI(snap) {
    el.rpmReadout.textContent = Math.round(snap.rpm).toLocaleString();
    el.speedReadout.textContent = Math.round(snap.speedKmh).toLocaleString();
    el.odoReadout.textContent = `${(snap.odometerM / 1000).toFixed(2)} km`;
    el.gearBadge.textContent = snap.gear === 0 ? "N" : snap.gear;

    updateRpmBar(Math.min(1, snap.rpm / gaugeMaxRpm));

    el.throttleVal.textContent = `${Math.round(snap.throttle * 100)}%`;
    el.brakeVal.textContent = `${Math.round(snap.brake * 100)}%`;
    el.clutchVal.textContent = `${Math.round(snap.clutch * 100)}%`;
    el.throttleFill.style.width = `${snap.throttle * 100}%`;
    el.brakeFill.style.width = `${snap.brake * 100}%`;
    el.clutchFill.style.width = `${snap.clutch * 100}%`;

    el.teleMaxRpm.textContent = Math.round(snap.maxRpmSeen).toLocaleString();
    el.teleMaxSpeed.textContent = `${Math.round(snap.maxSpeedSeen)} km/h`;
    el.teleShifts.textContent = snap.totalShifts;
    el.teleGearRatio.textContent = snap.gear === 0 ? "—" : sim.car.gears[snap.gear - 1].toFixed(2);

    el.gaugeCard.classList.toggle("limiter", snap.limiterActive);
    el.stallBanner.classList.toggle("show", !snap.running);

    const blurAmt = clamp((snap.speedKmh - 140) / 180, 0, 0.55);
    el.speedBlur.style.setProperty("--blur-amt", blurAmt.toFixed(2));
    el.speedBlur.classList.toggle("show", blurAmt > 0.02);

    if (snap.gear !== prevGear) {
      el.gearBadge.classList.add("flash");
      setTimeout(() => el.gearBadge.classList.remove("flash"), 150);
      prevGear = snap.gear;
    }

    if (snap.backfire) {
      el.flameFx.classList.remove("pop");
      void el.flameFx.offsetWidth;
      el.flameFx.classList.add("pop");
    }

    if (!snap.running && !prevStalled) {
      toast("Engine Stalled");
    }
    prevStalled = !snap.running;
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  function init() {
    document.documentElement.style.setProperty("--car-accent", currentCar.accent);
    document.documentElement.style.setProperty("--car-accent-dim", hexToRgba(currentCar.accent, 0.18));
    buildCarList();
    buildSpecPanel(currentCar);
    buildTachFace(currentCar);
    buildSpeedoFace(currentCar);
    buildRpmBar();
    el.redlineHint.textContent = `redline ${currentCar.redline.toLocaleString()}`;
    bindInput();
    bindModes();
    bindEnvironment();
    bindAudioControls();
    bindStart();
    needle.value = ANGLE_MIN;
    speedNeedle.value = ANGLE_MIN;
  }

  init();
})();
