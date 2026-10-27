(() => {
  'use strict';

  // --- Timing Constants from ppy/osu IntroTriangles.cs ---
  const AUDIO_TRACK_URL = 'New osu!lazer intro _ cYsmix - triangles.mp3';

  // In the recording, TrianglesIntroSequence t=0 is locked to 7150.0ms of the audio file
  const SEQ_OFFSET_MS = 7150.0;
  const DISCLAIMER_START_MS = 4150.0;
  const DISCLAIMER_FADE_IN_MS = 250.0;
  const DISCLAIMER_END_MS = 6800.0;
  const DISCLAIMER_FADE_OUT_MS = 250.0;

  const TEXT_1 = 200.0;          // "wel"
  const TEXT_2 = 400.0;          // "welcome"
  const TEXT_3 = 700.0;          // "welcome to"
  const TEXT_4 = 900.0;          // "welcome to osu!"
  const TEXT_GLITCH = 1060.0;    // GlitchingTriangles start
  const RULESETS_1 = 1450.0;     // Scale 1, Spacing 200, rulesetsScale -> 0.8 (1000ms)
  const RULESETS_2 = 1650.0;     // Scale 2, Spacing 30
  const RULESETS_3 = 1850.0;     // Scale 4, Spacing 10, rulesetsScale -> 1.3 (1000ms)
  const LOGO_1 = 2080.0;         // LazerLogo start
  const LOGO_SCALE_DURATION = 920.0;
  const LOGO_2 = LOGO_1 + LOGO_SCALE_DURATION; // 3000.0ms (Flash + OsuLogo arrival at ~3030ms)
  const DROP_SEQ_MS = 3030.0;    // Exact 60fps frame 191 (10180ms in audio)
  const FLASH_DURATION = 1000.0;

  // Beatmap timing for cYsmix - triangles (160 BPM -> 375.0ms per beat)
  const BEAT_LENGTH_MS = 375.0;
  const DROP_AUDIO_MS = SEQ_OFFSET_MS + DROP_SEQ_MS; // 10180.0ms

  // Reference coordinate space (1280x720)
  const REF_W = 1280;
  const REF_H = 720;
  const REF_CX = 640;
  const REF_CY = 360;
  const RATIO_720_768 = 720 / 768; // 0.9375 (osu!framework 768p -> 720p scale)

  // DOM Elements
  const canvas = document.getElementById('intro-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const startOverlay = document.getElementById('start-overlay');
  const btnStartIntro = document.getElementById('btn-start-intro');
  const btnStartFull = document.getElementById('btn-start-full');
  const hudBar = document.getElementById('hud-bar');
  const btnReplayIntro = document.getElementById('btn-replay-intro');
  const btnReplayFull = document.getElementById('btn-replay-full');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const hudScrubber = document.getElementById('hud-scrubber');
  const hudTime = document.getElementById('hud-time');

  // Load Clean Background Texture (extracted 1:1 from video without watermark)
  const bgImage = new Image();
  let bgLoaded = false;
  bgImage.onload = () => {
    bgLoaded = true;
  };
  bgImage.src = 'assets/bg.png';

  // Audio & Web Audio API Analyser
  const audio = new Audio();
  audio.src = AUDIO_TRACK_URL;
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let timeDomainData = null;
  let isStarted = false;
  let isScrubbing = false;

  // High-precision interpolated audio clock
  let lastAudioCurrentTime = 0;
  let lastPerfTime = performance.now();

  function initWebAudio() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeDomainData = new Uint8Array(analyser.fftSize);
  }

  function getExactAudioTimeMs() {
    if (audio.paused || isScrubbing) {
      return audio.currentTime * 1000.0;
    }
    const rawTime = audio.currentTime;
    const now = performance.now();
    if (rawTime !== lastAudioCurrentTime) {
      lastAudioCurrentTime = rawTime;
      lastPerfTime = now;
      return rawTime * 1000.0;
    }
    const delta = Math.min(35.0, now - lastPerfTime);
    return rawTime * 1000.0 + delta;
  }

  // --- Easing Functions (osu!framework math) ---
  function easeInQuad(t) {
    return t * t;
  }
  function easeOutQuad(t) {
    return t * (2 - t);
  }
  function easeInQuint(t) {
    return t * t * t * t * t;
  }
  function easeOutQuint(t) {
    const u = 1 - t;
    return 1 - u * u * u * u * u;
  }
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // --- Deterministic GlitchingTriangles Schedule (t_seq in [1060, 1450], every 22ms) ---
  // Matches IntroTriangles.cs: GlitchingTriangles spawns OutlineTriangle every 22ms, FadeOutFromOne(120)
  const glitchTriangles = [];
  {
    let seed = 20190913;
    const nextRng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let t = TEXT_GLITCH; t < RULESETS_1; t += 22.0) {
      const outlineOnly = nextRng() >= 0.5;
      const size = (nextRng() + 0.2) * 80.0 * RATIO_720_768;
      // Container centered at (640, 360) of size (420, 85), with OutlineTriangle Origin = TopLeft
      const rx = nextRng();
      const ry = nextRng();
      const x = REF_CX - 195 + rx * 390;
      const y = REF_CY - 54 + ry * 90;
      glitchTriangles.push({
        spawnTime: t,
        outlineOnly,
        size,
        x,
        y
      });
    }
  }

  // --- Internal Rising Triangles inside OsuLogo Pink Circle ---
  const LOGO_INNER_R = 194.0;
  const LOGO_OUTER_R = 215.5;
  const logoTriangles = [];
  const NUM_LOGO_TRIANGLES = 28;
  {
    let seed = 133742;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < NUM_LOGO_TRIANGLES; i++) {
      logoTriangles.push({
        x: (rng() * 2 - 1) * LOGO_INNER_R * 0.95,
        y: (rng() * 2 - 1) * LOGO_INNER_R * 1.1,
        size: 46 + rng() * 95,
        shade: rng(), // 0 = darker pink, 1 = lighter pink
        alpha: 0.16 + rng() * 0.26,
        speed: 0.025 + rng() * 0.035
      });
    }
  }

  // --- LogoVisualisation State (osu.Game/Screens/Menu/LogoVisualisation.cs) ---
  // 200 bars per visualiser, repeated 5 times around 360 deg, rotating by 5 indices every 20ms
  const BARS_PER_VISUALISER = 200;
  const VISUALISER_ROUNDS = 5;
  const TOTAL_BARS = BARS_PER_VISUALISER * VISUALISER_ROUNDS; // 1000 radial positions
  const barAmplitudes = new Float32Array(BARS_PER_VISUALISER);
  let lastVisUpdateMs = 0;
  let visIndexOffset = 0;

  // --- Beat Ripples & Cursor State ---
  let ripples = [];
  let lastBeatIndex = -1;
  let mouseX = 0; // normalized [-1, 1]
  let mouseY = 0;
  let smoothMouseX = 0;
  let smoothMouseY = 0;
  let isHoveringLogo = false;
  let hoverScale = 1.0;
  let clickScaleBoost = 0.0;

  // --- Resize Handling ---
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  function handleResize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
  }
  window.addEventListener('resize', handleResize);
  handleResize();

  // --- Pre-build Path2D for the Solid osu! Wordmark from window.OSU_LOGO_DATA ---
  let wordmarkPath = null;
  function getWordmarkPath() {
    if (wordmarkPath || !window.OSU_LOGO_DATA) return wordmarkPath;
    const p = new Path2D();
    // Contours 0..5 are: excl_bar, o_outer, s, u, o_inner, excl_dot
    for (let c = 0; c < 6; c++) {
      const pts = window.OSU_LOGO_DATA.contours[c].points;
      if (!pts || !pts.length) continue;
      p.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        p.lineTo(pts[i][0], pts[i][1]);
      }
      p.closePath();
    }
    wordmarkPath = p;
    return wordmarkPath;
  }

  // --- Helper: Check if Audio Time is in Kiai Mode (cYsmix - triangles) ---
  function isKiaiTime(audioMs) {
    // In triangles.osz, Kiai chorus runs 94000ms..104500ms and 106000ms..118000ms (plus early mini-kiai 22000..33500)
    return (
      (audioMs >= 93950 && audioMs <= 104450) ||
      (audioMs >= 105950 && audioMs <= 118000)
    );
  }

  // --- Phase 0: Draw Disclaimer Screen (4150ms .. 7050ms) ---
  function drawDisclaimer(audioMs, scale) {
    if (audioMs < DISCLAIMER_START_MS || audioMs > DISCLAIMER_END_MS + DISCLAIMER_FADE_OUT_MS) {
      return;
    }
    let alpha = 1.0;
    if (audioMs < DISCLAIMER_START_MS + DISCLAIMER_FADE_IN_MS) {
      alpha = clamp((audioMs - DISCLAIMER_START_MS) / DISCLAIMER_FADE_IN_MS, 0, 1);
    } else if (audioMs > DISCLAIMER_END_MS) {
      alpha = clamp(1.0 - (audioMs - DISCLAIMER_END_MS) / DISCLAIMER_FADE_OUT_MS, 0, 1);
    }
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(scale, scale);

    // Warning triangle at (0, -78)
    const triY = -78;
    const triH = 26;
    const triW = 30;
    ctx.fillStyle = '#f5d142';
    ctx.beginPath();
    ctx.moveTo(0, triY - triH / 2);
    ctx.lineTo(triW / 2, triY + triH / 2);
    ctx.lineTo(-triW / 2, triY + triH / 2);
    ctx.closePath();
    ctx.fill();

    // Exclamation mark inside warning triangle
    ctx.fillStyle = '#000000';
    ctx.fillRect(-1.5, triY - 4, 3, 9);
    ctx.fillRect(-1.5, triY + 7, 3, 3);

    // Text lines
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "This is an early development build"
    ctx.font = '300 23px "Torus", "Quicksand", sans-serif';
    const part1 = 'This is an ';
    const part2 = 'early development build';
    const w1 = ctx.measureText(part1).width;
    ctx.font = '700 23px "Torus", "Quicksand", sans-serif';
    const w2 = ctx.measureText(part2).width;
    const totalW = w1 + w2;

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = '300 23px "Torus", "Quicksand", sans-serif';
    ctx.fillText(part1, -totalW / 2, -31);
    ctx.font = '700 23px "Torus", "Quicksand", sans-serif';
    ctx.fillText(part2, -totalW / 2 + w1, -31);

    ctx.textAlign = 'center';
    ctx.font = '400 15.5px "Torus", "Quicksand", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText('Things may not work as expected', 0, -4);

    ctx.font = '400 11.5px "Torus", "Quicksand", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Detailed bug reports are welcomed via github issues.', 0, 26);

    // "Visit discord.gg/ppy to help out or follow progress!"
    const d1 = 'Visit ';
    const d2 = 'discord.gg/ppy';
    const d3 = ' to help out or follow progress!';
    const dw1 = ctx.measureText(d1).width;
    const dw2 = ctx.measureText(d2).width;
    const dw3 = ctx.measureText(d3).width;
    const dTotal = dw1 + dw2 + dw3;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(d1, -dTotal / 2, 42);
    ctx.fillStyle = '#58b4f5';
    ctx.fillText(d2, -dTotal / 2 + dw1, 42);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(d3, -dTotal / 2 + dw1 + dw2, 42);

    // "Thank you for supporting osu! ♥"
    ctx.textAlign = 'center';
    ctx.font = '600 11.5px "Torus", "Quicksand", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Thank you for supporting osu! ', -6, 80);
    ctx.fillStyle = '#e866a0';
    ctx.fillText('♥', 82, 80);

    ctx.restore();
  }

  // --- Phase 1: welcomeText + GlitchingTriangles (t_seq in [200, 1450]) ---
  function drawWelcomeAndTriangles(tSeq, scale) {
    if (tSeq < TEXT_1 || tSeq >= RULESETS_1) return;

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(scale, scale);

    // 1. GlitchingTriangles (behind welcomeText, as InternalChildren[0] in IntroTriangles.cs)
    if (tSeq >= TEXT_GLITCH && tSeq < RULESETS_1) {
      const hFactor = Math.sqrt(3) / 2;
      for (let i = 0; i < glitchTriangles.length; i++) {
        const gt = glitchTriangles[i];
        const age = tSeq - gt.spawnTime;
        if (age < 0 || age >= 120.0) continue;
        // triangle.FadeOutFromOne(120) -> linear fade from 1.0 to 0.0 over 120ms
        const alpha = clamp(1.0 - age / 120.0, 0, 1);
        const sz = gt.size;
        const th = sz * hFactor;
        const cx = gt.x + sz / 2;
        const cy = gt.y + th / 2;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx, cy - th / 2);
        ctx.lineTo(cx + sz / 2, cy + th / 2);
        ctx.lineTo(cx - sz / 2, cy + th / 2);
        ctx.closePath();

        if (gt.outlineOnly) {
          // OutlineTriangle: outer triangle minus inner triangle of size (sz - 5)
          const innerSz = Math.max(2, sz - 5.0 * RATIO_720_768);
          const innerTh = innerSz * hFactor;
          // Sub-path in opposite winding for evenodd cutout
          ctx.moveTo(cx, cy - innerTh / 2);
          ctx.lineTo(cx - innerSz / 2, cy + innerTh / 2);
          ctx.lineTo(cx + innerSz / 2, cy + innerTh / 2);
          ctx.closePath();
          ctx.fill('evenodd');
        } else {
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. welcomeText ("wel" -> "welcome" -> "welcome to" -> "welcome to osu!")
    let str = 'wel';
    if (tSeq >= TEXT_4) {
      str = 'welcome to osu!';
    } else if (tSeq >= TEXT_3) {
      str = 'welcome to';
    } else if (tSeq >= TEXT_2) {
      str = 'welcome';
    }

    // Spacing expansion matching measured pixel widths:
    // f_013 ("wel"): 62px, f_020 ("welcome"): 160px, f_028 ("welcome to"): 211px,
    // f_033 ("welcome to osu!" at 933ms): 305px, f_036 (at 1033ms): 317px
    let extraTracking = 6.2;
    if (tSeq >= TEXT_4) {
      extraTracking = 6.2 + ((tSeq - TEXT_4) / 5000.0) * 45.0 * RATIO_720_768;
    }

    ctx.font = '300 28px "Torus", "Quicksand", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Measure individual characters + tracking to center accurately at (0, -3)
    const chars = Array.from(str);
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const totalTextW =
      widths.reduce((acc, w) => acc + w, 0) + Math.max(0, chars.length - 1) * extraTracking;

    let curX = -totalTextW / 2;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], curX, -3);
      curX += widths[i] + extraTracking;
    }

    ctx.restore();
  }

  // --- Phase 2: RulesetFlow (t_seq in [1450, 2080]) ---
  function drawRulesetIcon(typeIndex, x, y, radius) {
    ctx.save();
    ctx.translate(x, y);

    // Outer white ring: outer radius = 1.0 * R, inner radius = 0.83 * R
    const rRingMid = radius * 0.915;
    const ringThickness = radius * 0.17;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = ringThickness;
    ctx.beginPath();
    ctx.arc(0, 0, rRingMid, 0, Math.PI * 2);
    ctx.stroke();

    if (typeIndex === 0) {
      // 1. osu!standard: solid inner circle of radius 0.631 * R
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.631, 0, Math.PI * 2);
      ctx.fill();
    } else if (typeIndex === 1) {
      // 2. osu!taiko: inner ring (outer 0.631, inner 0.468) + center vertical bar (w = 0.162 * R)
      const innerMid = radius * 0.5495;
      const innerThick = radius * 0.163;
      ctx.lineWidth = innerThick;
      ctx.beginPath();
      ctx.arc(0, 0, innerMid, 0, Math.PI * 2);
      ctx.stroke();

      const barW = radius * 0.162;
      const barH = radius * 1.1;
      ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    } else if (typeIndex === 2) {
      // 3. osu!catch: 3 small solid circles (radius 0.145 * R)
      const dotR = radius * 0.145;
      const dots = [
        [-0.135 * radius, -0.324 * radius],
        [-0.135 * radius, 0.324 * radius],
        [0.243 * radius, 0.0]
      ];
      for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (typeIndex === 3) {
      // 4. osu!mania: 3 vertical rounded pill bars (width 0.18 * R)
      const barW = radius * 0.18;
      const bars = [
        [-0.35 * radius, 0.64 * radius],
        [0.0, 1.262 * radius],
        [0.35 * radius, 0.64 * radius]
      ];
      for (const [bx, bh] of bars) {
        ctx.beginPath();
        ctx.roundRect(bx - barW / 2, -bh / 2, barW, bh, barW / 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawRulesets(tSeq, scale) {
    if (tSeq < RULESETS_1 || tSeq >= LOGO_1) return;

    // Determine rulesets Scale, Spacing, and rulesetsScale container scale
    let flowScale = 1.0;
    let spacing = 200.0;
    if (tSeq >= RULESETS_3) {
      flowScale = 4.0;
      spacing = 10.0;
    } else if (tSeq >= RULESETS_2) {
      flowScale = 2.0;
      spacing = 30.0;
    }

    // rulesetsScale container:
    // At 1450ms: ScaleTo(0.8f, 1000) -> linearly from 1.0 to 0.8
    // At 1850ms (where it reached 0.92): ScaleTo(1.3f, 1000) -> linearly from 0.92 to 1.3
    let containerScale = 1.0;
    if (tSeq < RULESETS_3) {
      const p = clamp((tSeq - RULESETS_1) / 1000.0, 0, 1);
      containerScale = 1.0 + (0.8 - 1.0) * p;
    } else {
      const valAt1850 = 1.0 + (0.8 - 1.0) * ((RULESETS_3 - RULESETS_1) / 1000.0); // 0.92
      const p = clamp((tSeq - RULESETS_3) / 1000.0, 0, 1);
      containerScale = valAt1850 + (1.3 - valAt1850) * p;
    }

    const baseIconSize = 30.0 * RATIO_720_768; // 28.125px in 720p
    const effectiveScale = flowScale * containerScale;
    const iconDiameter = baseIconSize * effectiveScale;
    const iconRadius = iconDiameter / 2;
    const stepX = (baseIconSize + spacing * RATIO_720_768) * effectiveScale;

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(scale, scale);

    for (let i = 0; i < 4; i++) {
      const ix = (i - 1.5) * stepX;
      drawRulesetIcon(i, ix, 0, iconRadius);
    }

    ctx.restore();
  }

  // --- Phase 3: LazerLogo Outline Animation (t_seq in [2080, 3030]) ---
  function drawLazerLogo(tSeq, scale) {
    if (tSeq < LOGO_1 || tSeq >= DROP_SEQ_MS || !window.OSU_LOGO_DATA) return;

    const u = clamp((tSeq - LOGO_1) / LOGO_SCALE_DURATION, 0, 1);

    // Matching flyte curve from IntroTriangles.cs:
    // logoContainerSecondary: ScaleTo(1.2f).Then().ScaleTo(1.0f, 920, Easing.InQuad)
    // lazerLogo: ScaleTo(1.2f).Then().Delay(920 * 0.7f).ScaleTo(0.4f, 920 * 0.3f, Easing.InQuint)
    const s1 = 1.2 - 0.2 * easeInQuad(u);
    const s2 = u <= 0.7 ? 1.2 : 1.2 - 0.8 * easeInQuint((u - 0.7) / 0.3);
    const relScale = 3.0 * (s1 / 1.2) * (s2 / 1.2);

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(scale * relScale, scale * relScale);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Stroke width in resting OsuLogo coordinates (~2.2px, so 6.6px at 3.0x scale)
    ctx.lineWidth = 2.2;

    const contours = window.OSU_LOGO_DATA.contours;

    // 1. Pass 1 (InternalChildren[0]): highlight (Color4.White) where pWhite <= u
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let c = 0; c < contours.length; c++) {
      const { points, pWhite, pGray } = contours[c];
      const n = points.length;
      for (let i = 0; i < n; i++) {
        // Draw segment if highlight has arrived and background hasn't completely covered both endpoints
        if (pWhite[i] <= u && pGray[i] > u - 0.02) {
          const p1 = points[i];
          const p2 = points[(i + 1) % n];
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
        }
      }
    }
    ctx.stroke();

    // 2. Pass 2 (InternalChildren[1]): background (OsuColour.Gray(0.6f) = #999999) on top where pGray <= u
    ctx.strokeStyle = '#999999';
    ctx.beginPath();
    for (let c = 0; c < contours.length; c++) {
      const { points, pGray } = contours[c];
      const n = points.length;
      for (let i = 0; i < n; i++) {
        if (pGray[i] <= u) {
          const p1 = points[i];
          const p2 = points[(i + 1) % n];
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
        }
      }
    }
    ctx.stroke();

    ctx.restore();
  }

  // --- Phase 4: Main Menu State (Background + MenuSideFlashes + OsuLogo + Visualizer + Flash) ---
  function updateAudioAnalysis(audioMs, dtMs) {
    let rms = 0;
    let bassEnergy = 0;

    if (analyser && !audio.paused && audioMs >= DROP_AUDIO_MS) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeDomainData);

      // Compute RMS from time domain
      let sumSq = 0;
      for (let i = 0; i < timeDomainData.length; i++) {
        const v = (timeDomainData[i] - 128) / 128.0;
        sumSq += v * v;
      }
      rms = Math.sqrt(sumSq / timeDomainData.length);

      // Compute bass energy (first 16 bins)
      let bassSum = 0;
      for (let i = 1; i <= 16; i++) {
        bassSum += freqData[i] / 255.0;
      }
      bassEnergy = bassSum / 16.0;

      // Update LogoVisualisation 200 frequency bars every 20ms (50Hz) with index_change = 5
      if (Math.abs(audioMs - lastVisUpdateMs) >= 20.0) {
        lastVisUpdateMs = audioMs;
        visIndexOffset = (visIndexOffset + 5) % BARS_PER_VISUALISER;
        const kiaiBoost = isKiaiTime(audioMs) ? 1.35 : 1.0;

        for (let i = 0; i < BARS_PER_VISUALISER; i++) {
          const targetIdx = (i + visIndexOffset) % BARS_PER_VISUALISER;
          // Map bar 0..199 across frequency bins 1..180 with perceptual weighting
          const binIdx = 1 + Math.floor((i / BARS_PER_VISUALISER) * 160);
          const rawVal = (freqData[binIdx] / 255.0) * kiaiBoost;
          const shaped = Math.pow(rawVal, 1.35);
          if (shaped > barAmplitudes[targetIdx]) {
            barAmplitudes[targetIdx] = shaped;
          }
        }
      }
    }

    // Temporal decay of visualizer bars (decay_per_milisecond = 0.0024 in LogoVisualisation.cs)
    const decay = Math.max(0, dtMs) * 0.0024;
    for (let i = 0; i < BARS_PER_VISUALISER; i++) {
      barAmplitudes[i] = Math.max(0, barAmplitudes[i] - decay);
    }

    return { rms, bassEnergy };
  }

  function drawBackgroundAndSideFlashes(audioMs, scale) {
    // Outro background fade-out: in video, background fades to black between 132.4s and 133.0s
    let bgAlpha = 1.0;
    if (audioMs >= 132400) {
      bgAlpha = clamp(1.0 - (audioMs - 132400) / 600.0, 0, 1);
    }
    if (bgAlpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = bgAlpha;

    // Subtle parallax offset on background
    const px = -smoothMouseX * 8 * scale;
    const py = -smoothMouseY * 8 * scale;

    if (bgLoaded) {
      // Cover viewport while preserving 16:9 aspect ratio with slight 1.02x overscan for parallax
      const coverScale = Math.max(viewW / REF_W, viewH / REF_H) * 1.02;
      const drawW = REF_W * coverScale;
      const drawH = REF_H * coverScale;
      ctx.drawImage(
        bgImage,
        (viewW - drawW) / 2 + px,
        (viewH - drawH) / 2 + py,
        drawW,
        drawH
      );
    }

    // MenuSideFlashes (osu.Game/Screens/Menu/MenuSideFlashes.cs)
    if (audioMs >= DROP_AUDIO_MS && audioMs < 131000) {
      const sinceDrop = audioMs - DROP_AUDIO_MS;
      const beatIndex = Math.floor(sinceDrop / BEAT_LENGTH_MS);
      const beatPhase = (sinceDrop % BEAT_LENGTH_MS) / BEAT_LENGTH_MS; // 0..1 within current beat
      const kiai = isKiaiTime(audioMs);

      let leftAlpha = 0.0;
      let rightAlpha = 0.0;

      if (kiai) {
        // Kiai: alternate left (even beat) and right (odd beat) on every beat
        const pulse = Math.pow(1.0 - beatPhase, 1.8) * 0.42;
        if (beatIndex % 2 === 0) {
          leftAlpha = pulse;
        } else {
          rightAlpha = pulse;
        }
      } else {
        // Normal: both sides flash on every 4-beat bar downbeat
        const barPhase = (sinceDrop % (BEAT_LENGTH_MS * 4)) / (BEAT_LENGTH_MS * 1.6);
        if (barPhase < 1.0) {
          const pulse = Math.pow(1.0 - barPhase, 1.8) * 0.32;
          leftAlpha = pulse;
          rightAlpha = pulse;
        }
      }

      const flashW = Math.max(240, viewW * 0.25);
      ctx.globalCompositeOperation = 'lighter';

      if (leftAlpha > 0.005) {
        const gradL = ctx.createLinearGradient(0, 0, flashW, 0);
        gradL.addColorStop(0, `rgba(45, 160, 245, ${leftAlpha.toFixed(3)})`);
        gradL.addColorStop(1, 'rgba(45, 160, 245, 0)');
        ctx.fillStyle = gradL;
        ctx.fillRect(0, 0, flashW, viewH);
      }

      if (rightAlpha > 0.005) {
        const gradR = ctx.createLinearGradient(viewW, 0, viewW - flashW, 0);
        gradR.addColorStop(0, `rgba(45, 160, 245, ${rightAlpha.toFixed(3)})`);
        gradR.addColorStop(1, 'rgba(45, 160, 245, 0)');
        ctx.fillStyle = gradR;
        ctx.fillRect(viewW - flashW, 0, flashW, viewH);
      }
    }

    ctx.restore();
  }

  function drawOsuLogo(audioMs, dtMs, scale, audioMetrics) {
    // Outro fade/shrink at end of video (133.0s..134.8s)
    let logoAlpha = 1.0;
    let outroScale = 1.0;
    if (audioMs >= 132600) {
      // Between 132.6s and 134.0s logo dims to ~0.72 brightness, then shrinks & fades out at 134.1s..134.8s
      if (audioMs >= 134100) {
        const p = clamp((audioMs - 134100) / 600.0, 0, 1);
        logoAlpha = 1.0 - easeOutQuad(p);
        outroScale = 1.0 - 0.25 * easeInQuad(p);
      }
    }
    if (logoAlpha <= 0.001) return;

    // Beat-synced pulse (160 BPM = 375ms per beat)
    const sinceDrop = Math.max(0, audioMs - DROP_AUDIO_MS);
    const beatIndex = Math.floor(sinceDrop / BEAT_LENGTH_MS);
    const beatTimeMs = sinceDrop % BEAT_LENGTH_MS;
    const kiai = isKiaiTime(audioMs);

    // Spawn ripple on new beat (when music is active)
    if (audioMs >= DROP_AUDIO_MS && audioMs < 130500) {
      if (beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;
        if (kiai || beatIndex % 2 === 0) {
          ripples.push({
            spawnMs: audioMs,
            maxScale: kiai ? 1.28 : 1.18,
            alpha: kiai ? 0.32 : 0.18
          });
        }
      }
    }

    // Calculate BeatSyncedContainer scale (OnNewBeat in OsuLogo.cs)
    let beatScale = 1.0;
    if (audioMs >= DROP_AUDIO_MS && audioMs < 130800) {
      const ampBoost = kiai ? 0.055 : 0.036;
      const attackMs = BEAT_LENGTH_MS * 0.14;
      if (beatTimeMs < attackMs) {
        beatScale = 1.0 + ampBoost * easeOutQuad(beatTimeMs / attackMs);
      } else {
        const decayP = (beatTimeMs - attackMs) / (BEAT_LENGTH_MS - attackMs);
        beatScale = 1.0 + ampBoost * (1.0 - easeOutQuint(decayP));
      }
      // Subtle real-time bass amplitude modulation (logoAmplitudeContainer)
      beatScale += audioMetrics.bassEnergy * 0.022;
    }

    // Smooth hover & click scale
    const targetHover = isHoveringLogo ? 1.055 : 1.0;
    hoverScale += (targetHover - hoverScale) * Math.min(1, dtMs * 0.015);
    clickScaleBoost *= Math.pow(0.99, dtMs);

    const totalLogoScale = scale * beatScale * hoverScale * (1.0 - clickScaleBoost) * outroScale;

    // Subtle cursor parallax for logo
    const logoX = viewW / 2 - smoothMouseX * 16 * scale;
    const logoY = viewH / 2 - smoothMouseY * 16 * scale;

    ctx.save();
    ctx.translate(logoX, logoY);
    ctx.scale(totalLogoScale, totalLogoScale);
    ctx.globalAlpha = logoAlpha;

    // 1. Draw Beat Ripples behind OsuLogo
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const age = audioMs - rp.spawnMs;
      if (age < 0 || age > 750) {
        ripples.splice(i, 1);
        continue;
      }
      const p = age / 750.0;
      const rScale = 1.0 + (rp.maxScale - 1.0) * easeOutQuad(p);
      const rAlpha = rp.alpha * (1.0 - easeOutQuad(p)) * logoAlpha;
      ctx.save();
      ctx.globalAlpha = rAlpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5.0 * (1.0 - p * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, LOGO_OUTER_R * rScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw LogoVisualisation (200 bars * 5 rounds around perimeter at r = 214px)
    if (audioMs >= DROP_AUDIO_MS && audioMs < 132500) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
      const maxBarLen = kiai ? 135.0 : 88.0;
      const barWidth = ((2 * Math.PI * LOGO_OUTER_R) / TOTAL_BARS) * 1.75;

      for (let round = 0; round < VISUALISER_ROUNDS; round++) {
        for (let b = 0; b < BARS_PER_VISUALISER; b++) {
          const amp = barAmplitudes[b];
          if (amp <= 0.008) continue;
          const barLen = amp * maxBarLen;
          const angle = ((round * BARS_PER_VISUALISER + b) / TOTAL_BARS) * Math.PI * 2;
          ctx.save();
          ctx.rotate(angle);
          ctx.fillRect(LOGO_OUTER_R - 2, -barWidth / 2, barLen, barWidth);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 3. Outer Shadow behind White Cookie Ring
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 28;
    ctx.fillStyle = audioMs >= 132600 ? '#bdbdbd' : '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, LOGO_OUTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Inner Pink Circle + Clipped Rising Triangles
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, LOGO_INNER_R, 0, Math.PI * 2);
    ctx.clip();

    // Base pink fill (dims slightly at 132.6s when track ends, matching end_021.png)
    const isDimmedOutro = audioMs >= 132600;
    ctx.fillStyle = isDimmedOutro ? '#a84c78' : '#e866a0';
    ctx.fillRect(-LOGO_INNER_R, -LOGO_INNER_R, LOGO_INNER_R * 2, LOGO_INNER_R * 2);

    // Update and draw rising equilateral triangles inside the pink circle
    const speedMult =
      1.0 +
      (audioMs >= DROP_AUDIO_MS && audioMs < 130800
        ? audioMetrics.bassEnergy * 3.8 + (kiai ? 1.4 : 0.4)
        : 0.0);
    const stepDt = clamp(dtMs, 0, 50);
    const hFactor = Math.sqrt(3) / 2;

    for (let i = 0; i < logoTriangles.length; i++) {
      const tr = logoTriangles[i];
      if (!audio.paused) {
        tr.y -= tr.speed * speedMult * stepDt;
        const h = tr.size * hFactor;
        if (tr.y + h / 2 < -LOGO_INNER_R - 10) {
          tr.y = LOGO_INNER_R + h / 2 + 10;
        }
      }
      const h = tr.size * hFactor;
      // Blend between darker and lighter pink triangles just like osu!lazer OsuLogo
      if (tr.shade > 0.5) {
        ctx.fillStyle = isDimmedOutro
          ? `rgba(210, 110, 158, ${(tr.alpha * 0.85).toFixed(3)})`
          : `rgba(255, 148, 194, ${tr.alpha.toFixed(3)})`;
      } else {
        ctx.fillStyle = isDimmedOutro
          ? `rgba(130, 52, 88, ${(tr.alpha * 0.9).toFixed(3)})`
          : `rgba(198, 66, 126, ${tr.alpha.toFixed(3)})`;
      }
      ctx.beginPath();
      ctx.moveTo(tr.x, tr.y - h / 2);
      ctx.lineTo(tr.x + tr.size / 2, tr.y + h / 2);
      ctx.lineTo(tr.x - tr.size / 2, tr.y + h / 2);
      ctx.closePath();
      ctx.fill();
    }

    // Subtle inner edge shadow ring inside the pink circle
    const innerGrad = ctx.createRadialGradient(
      0,
      0,
      LOGO_INNER_R * 0.82,
      0,
      0,
      LOGO_INNER_R
    );
    innerGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = innerGrad;
    ctx.fillRect(-LOGO_INNER_R, -LOGO_INNER_R, LOGO_INNER_R * 2, LOGO_INNER_R * 2);

    ctx.restore();

    // 5. White osu! Wordmark (using our sub-pixel Marching Squares contours)
    const wp = getWordmarkPath();
    if (wp) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = isDimmedOutro ? '#e2dce0' : '#ffffff';
      ctx.fill(wp, 'evenodd');
      ctx.restore();
    }

    ctx.restore();
  }

  // --- GameWideFlash (IntroTriangles.cs: Box White Additive, FadeOutFromOne(1000, Easing.Out)) ---
  function drawGameWideFlash(tSeq) {
    if (tSeq < DROP_SEQ_MS || tSeq >= DROP_SEQ_MS + FLASH_DURATION) return;
    const p = clamp((tSeq - DROP_SEQ_MS) / FLASH_DURATION, 0, 1);
    const alpha = 1.0 - easeOutQuad(p);
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(4)})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }

  // --- Main Render Loop ---
  let prevFrameTime = performance.now();

  function renderFrame(now) {
    requestAnimationFrame(renderFrame);

    const dtMs = Math.min(50, Math.max(0, now - prevFrameTime));
    prevFrameTime = now;

    // Smooth cursor parallax interpolation
    smoothMouseX += (mouseX - smoothMouseX) * Math.min(1, dtMs * 0.012);
    smoothMouseY += (mouseY - smoothMouseY) * Math.min(1, dtMs * 0.012);

    const audioMs = getExactAudioTimeMs();
    const tSeq = audioMs - SEQ_OFFSET_MS;

    // Update HUD timecode & scrubber
    if (!isScrubbing && audio.duration) {
      hudScrubber.value = ((audioMs / 1000.0 / audio.duration) * 100).toFixed(2);
    }
    const mins = Math.floor(audioMs / 60000);
    const secs = ((audioMs % 60000) / 1000).toFixed(2).padStart(5, '0');
    hudTime.textContent = `${mins}:${secs}`;

    // Scale from 1280x720 reference coordinate space to current viewport
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewW, viewH);

    const refScale = Math.min(viewW / REF_W, viewH / REF_H);

    // Update FFT visualizer & amplitude metrics
    const audioMetrics = updateAudioAnalysis(audioMs, dtMs);

    // Render active phase(s)
    if (audioMs < SEQ_OFFSET_MS) {
      drawDisclaimer(audioMs, refScale);
    } else if (tSeq < DROP_SEQ_MS) {
      drawWelcomeAndTriangles(tSeq, refScale);
      drawRulesets(tSeq, refScale);
      drawLazerLogo(tSeq, refScale);
    } else {
      drawBackgroundAndSideFlashes(audioMs, refScale);
      drawOsuLogo(audioMs, dtMs, refScale, audioMetrics);
      drawGameWideFlash(tSeq);
    }
  }

  // --- Playback Controls & Interaction ---
  function startPlayback(startAtMs) {
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    isStarted = true;
    startOverlay.classList.add('hidden');
    ripples = [];
    lastBeatIndex = -1;
    barAmplitudes.fill(0);

    audio.currentTime = startAtMs / 1000.0;
    lastAudioCurrentTime = audio.currentTime;
    lastPerfTime = performance.now();
    audio.play().then(() => {
      btnPlayPause.textContent = 'Pause';
    }).catch(() => {
      // Fallback if autoplay blocked
      startOverlay.classList.remove('hidden');
    });
  }

  btnStartIntro.addEventListener('click', (e) => {
    e.stopPropagation();
    // Start right at the TrianglesIntroSequence (7.12s -> 30ms lead-in before t_seq=0)
    startPlayback(7120.0);
  });

  btnStartFull.addEventListener('click', (e) => {
    e.stopPropagation();
    // Start at the Disclaimer screen (4.10s)
    startPlayback(4100.0);
  });

  startOverlay.addEventListener('click', () => {
    startPlayback(7120.0);
  });

  btnReplayIntro.addEventListener('click', () => startPlayback(7120.0));
  btnReplayFull.addEventListener('click', () => startPlayback(4100.0));

  btnPlayPause.addEventListener('click', () => {
    if (!isStarted) {
      startPlayback(7120.0);
      return;
    }
    if (audio.paused) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      audio.play();
      lastAudioCurrentTime = audio.currentTime;
      lastPerfTime = performance.now();
      btnPlayPause.textContent = 'Pause';
    } else {
      audio.pause();
      btnPlayPause.textContent = 'Play';
    }
  });

  hudScrubber.addEventListener('input', () => {
    isScrubbing = true;
    if (audio.duration) {
      const targetSec = (parseFloat(hudScrubber.value) / 100.0) * audio.duration;
      audio.currentTime = targetSec;
      lastAudioCurrentTime = targetSec;
      lastPerfTime = performance.now();
      ripples = [];
      lastBeatIndex = -1;
    }
  });

  hudScrubber.addEventListener('change', () => {
    isScrubbing = false;
  });

  // Auto-show HUD briefly when cursor moves near top-right corner
  let hudTimeout = null;
  window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / Math.max(1, viewW)) * 2 - 1;
    mouseY = (e.clientY / Math.max(1, viewH)) * 2 - 1;

    // Check if hovering OsuLogo
    const refScale = Math.min(viewW / REF_W, viewH / REF_H);
    const dx = e.clientX - viewW / 2;
    const dy = e.clientY - viewH / 2;
    isHoveringLogo = Math.hypot(dx, dy) <= LOGO_OUTER_R * refScale;
    canvas.style.cursor =
      isStarted && getExactAudioTimeMs() >= DROP_AUDIO_MS && isHoveringLogo
        ? 'pointer'
        : 'default';

    if (e.clientY < 85 && e.clientX > viewW - 420) {
      hudBar.classList.add('visible');
      clearTimeout(hudTimeout);
      hudTimeout = setTimeout(() => {
        hudBar.classList.remove('visible');
      }, 2600);
    }
  });

  canvas.addEventListener('mousedown', () => {
    if (isStarted && getExactAudioTimeMs() >= DROP_AUDIO_MS && isHoveringLogo) {
      clickScaleBoost = 0.065;
      ripples.push({
        spawnMs: getExactAudioTimeMs(),
        maxScale: 1.32,
        alpha: 0.42
      });
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!isStarted) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        startPlayback(7120.0);
      }
      return;
    }
    if (e.code === 'KeyR') {
      startPlayback(7120.0);
    } else if (e.code === 'KeyD') {
      startPlayback(4100.0);
    } else if (e.code === 'Space') {
      e.preventDefault();
      btnPlayPause.click();
    } else if (e.code === 'KeyH') {
      hudBar.classList.toggle('visible');
    }
  });

  // Attempt immediate autoplay if browser permits
  window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(renderFrame);
    audio.currentTime = 7.12;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          initWebAudio();
          isStarted = true;
          startOverlay.classList.add('hidden');
          lastAudioCurrentTime = audio.currentTime;
          lastPerfTime = performance.now();
        })
        .catch(() => {
          // Browser requires user interaction before playing unmuted audio
          audio.pause();
          audio.currentTime = 7.12;
        });
    }
  });
})();

