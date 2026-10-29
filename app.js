(() => {
  'use strict';

  // --- Timing Constants from ppy/osu IntroTriangles.cs ---
  // Audio is cut to begin right at the intro start (t=0ms)
  const AUDIO_TRACK_URL = 'assets/audio.mp3';
  const SEQ_OFFSET_MS = 0.0;

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
  const DROP_SEQ_MS = 3030.0;    // Drop occurs at 3030ms in intro audio
  const FLASH_DURATION = 1000.0;

  // Beatmap timing for cYsmix - triangles (160 BPM -> 375.0ms per beat)
  const BEAT_LENGTH_MS = 375.0;
  const DROP_AUDIO_MS = DROP_SEQ_MS; // 3030.0ms

  // Reference coordinate space (1280x720)
  const REF_W = 1280;
  const REF_H = 720;
  const REF_CX = 640;
  const REF_CY = 360;
  const RATIO_720_768 = 720 / 768; // 0.9375 (osu!framework 768p -> 720p scale)

  // Warm beat glow on the sides of the main menu background
  const BEAT_GLOW_PEAK_KIAI = 0.24;
  const BEAT_GLOW_PEAK_NORMAL = 0.16;
  const BEAT_GLOW_FADE_BEATS_KIAI = 1.8;
  const BEAT_GLOW_FADE_BEATS_NORMAL = 2.4;
  const BEAT_GLOW_DECAY_EXPONENT = 1.2;

  // DOM Elements
  const stageViewport = document.getElementById('stage-viewport');
  const canvas = document.getElementById('intro-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hudBar = document.getElementById('hud-bar');
  const btnReplay = document.getElementById('btn-replay');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const hudScrubber = document.getElementById('hud-scrubber');
  const hudTime = document.getElementById('hud-time');

  // Loading Screen DOM Elements
  const loadingScreen = document.getElementById('loading-screen');
  const loadingBarFill = document.getElementById('loading-bar-fill');
  const loadingStatus = document.getElementById('loading-status');
  const loadingPercent = document.getElementById('loading-percent');

  // Main Menu DOM Elements
  const menuScreen = document.getElementById('menu-screen');
  const menuBackground = document.getElementById('menu-background');
  const menuBgImage = document.getElementById('menu-bg-image');
  const menuGlowLeft = document.getElementById('menu-glow-left');
  const menuGlowRight = document.getElementById('menu-glow-right');
  const menuLogoAnchor = document.getElementById('menu-logo-anchor');
  const menuLogoScale = document.getElementById('menu-logo-scale');
  const menuLogo = document.getElementById('menu-logo');
  const menuRipples = document.getElementById('menu-ripples');
  const menuPfp = document.getElementById('menu-pfp');
  const menuLogoDim = document.getElementById('menu-logo-dim');
  const dropFlash = document.getElementById('drop-flash');

  // Audio & Web Audio API Analyser
  const audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let timeDomainData = null;
  let isStarted = false;
  let isPlaybackRunning = false;
  let isScrubbing = false;

  // High-precision interpolated audio clock
  let lastAudioCurrentTime = 0;
  let lastPerfTime = performance.now();

  // Wall-clock fallback used when browser autoplay policy blocks audio
  let pausedPositionMs = 0;
  let fallbackClockStartMs = 0;
  let fallbackClockStartPerf = performance.now();
  let audioUnlockAttached = false;

  function initWebAudio() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
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
    if (isScrubbing) {
      return audio.currentTime * 1000.0;
    }
    if (!isPlaybackRunning) {
      return pausedPositionMs;
    }
    if (!audio.paused) {
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
    // Audio is blocked by autoplay policy: keep the intro moving on a wall clock.
    return fallbackClockStartMs + (performance.now() - fallbackClockStartPerf);
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
      // Container centered at (0, 0) of size (420, 90), with OutlineTriangle Origin = TopLeft
      const rx = nextRng();
      const ry = nextRng();
      const x = -210 + rx * 420;
      const y = -48 + ry * 96;
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
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;

  function handleResize() {
    const rect = stageViewport.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(rect.width) || window.innerWidth);
    const nextH = Math.max(1, Math.round(rect.height) || window.innerHeight);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (nextW === viewW && nextH === viewH && nextDpr === dpr && canvas.width > 0) return;

    viewW = nextW;
    viewH = nextH;
    dpr = nextDpr;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    document.documentElement.style.setProperty('--stage-scale', String(getRefScale()));
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 150));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
  }
  handleResize();

  // Portrait screens get a larger scale so the menu logo stays the focal point
  // instead of shrinking to a thin strip in the middle of the screen.
  function getRefScale() {
    if (viewH > viewW) {
      return Math.min(viewW / 700, viewH / 900);
    }
    return Math.min(viewW / REF_W, viewH / REF_H);
  }

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
    // In triangles.osz (cut audio), Kiai chorus runs 86800ms..97300ms and 98800ms..110850ms
    return (
      (audioMs >= 86800 && audioMs <= 97300) ||
      (audioMs >= 98800 && audioMs <= 110850)
    );
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

    // Only draw the frame circle contours (circle_outer and circle_inner)
    // 1. Pass 1 (InternalChildren[0]): highlight (Color4.White) where pWhite <= u
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let c = 0; c < contours.length; c++) {
      if (contours[c].name !== 'circle_outer' && contours[c].name !== 'circle_inner') continue;
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
      if (contours[c].name !== 'circle_outer' && contours[c].name !== 'circle_inner') continue;
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

  // --- Phase 4: DOM main menu (background + MenuSideFlashes + OsuLogo) ---
  function updateAudioAnalysis(audioMs) {
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
    }

    return { rms, bassEnergy };
  }

  let menuActive = false;

  function setMenuActive(active) {
    if (menuActive === active) return;
    menuActive = active;
    menuScreen.classList.toggle('is-active', active);
    menuScreen.setAttribute('aria-hidden', active ? 'false' : 'true');
    canvas.style.visibility = active ? 'hidden' : 'visible';
    if (!active) {
      isHoveringLogo = false;
      dropFlash.style.opacity = '0';
    }
  }

  function resetMenuVisuals() {
    ripples = [];
    menuRipples.replaceChildren();
    lastBeatIndex = -1;
    hoverScale = 1.0;
    clickScaleBoost = 0.0;
    isHoveringLogo = false;
  }

  function spawnLogoRipple(audioMs, maxScale, alpha) {
    const el = document.createElement('div');
    el.className = 'menu-ripple';
    menuRipples.appendChild(el);
    ripples.push({ spawnMs: audioMs, maxScale, alpha, el });
  }

  function beatGlowAlpha(ageMs, fadeMs, peak) {
    if (ageMs < 0 || ageMs >= fadeMs) return 0;
    return Math.pow(1.0 - ageMs / fadeMs, BEAT_GLOW_DECAY_EXPONENT) * peak;
  }

  function updateMenuBackground(audioMs, scale) {
    // Outro background fade-out: in video, background fades to black between 125.25s and 125.85s
    let bgAlpha = 1.0;
    if (audioMs >= 125250) {
      bgAlpha = clamp(1.0 - (audioMs - 125250) / 600.0, 0, 1);
    }
    menuBackground.style.opacity = bgAlpha.toFixed(3);

    // Subtle parallax offset on background (plus the same 1.02x overscan as before)
    const px = -smoothMouseX * 8 * scale;
    const py = -smoothMouseY * 8 * scale;
    menuBgImage.style.transform =
      `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(1.02)`;

    // MenuSideFlashes (osu.Game/Screens/Menu/MenuSideFlashes.cs)
    let leftAlpha = 0.0;
    let rightAlpha = 0.0;
    if (audioMs >= DROP_AUDIO_MS && audioMs < 123850) {
      const sinceDrop = audioMs - DROP_AUDIO_MS;
      const beatIndex = Math.floor(sinceDrop / BEAT_LENGTH_MS);
      const kiai = isKiaiTime(audioMs);

      if (kiai) {
        // Kiai: alternate sides every beat, but let each side's glow outlive the beat
        const fadeMs = BEAT_LENGTH_MS * BEAT_GLOW_FADE_BEATS_KIAI;
        const leftBeat = beatIndex % 2 === 0 ? beatIndex : beatIndex - 1;
        const rightBeat = beatIndex % 2 === 0 ? beatIndex - 1 : beatIndex;
        leftAlpha = beatGlowAlpha(sinceDrop - leftBeat * BEAT_LENGTH_MS, fadeMs, BEAT_GLOW_PEAK_KIAI);
        rightAlpha = beatGlowAlpha(sinceDrop - rightBeat * BEAT_LENGTH_MS, fadeMs, BEAT_GLOW_PEAK_KIAI);
      } else {
        // Normal: both sides flash on every 4-beat bar downbeat
        const fadeMs = BEAT_LENGTH_MS * BEAT_GLOW_FADE_BEATS_NORMAL;
        const barElapsed = sinceDrop % (BEAT_LENGTH_MS * 4);
        const pulse = beatGlowAlpha(barElapsed, fadeMs, BEAT_GLOW_PEAK_NORMAL);
        leftAlpha = pulse;
        rightAlpha = pulse;
      }
    }

    menuGlowLeft.style.opacity = leftAlpha.toFixed(3);
    menuGlowRight.style.opacity = rightAlpha.toFixed(3);
  }

  function updateMenuLogo(audioMs, dtMs, scale, audioMetrics) {
    // Outro fade/shrink at end of video
    let logoAlpha = 1.0;
    let outroScale = 1.0;
    if (audioMs >= 126950) {
      const p = clamp((audioMs - 126950) / 600.0, 0, 1);
      logoAlpha = 1.0 - easeOutQuad(p);
      outroScale = 1.0 - 0.25 * easeInQuad(p);
    }

    // Beat-synced pulse (160 BPM = 375ms per beat)
    const sinceDrop = Math.max(0, audioMs - DROP_AUDIO_MS);
    const beatIndex = Math.floor(sinceDrop / BEAT_LENGTH_MS);
    const beatTimeMs = sinceDrop % BEAT_LENGTH_MS;
    const kiai = isKiaiTime(audioMs);

    // Spawn ripple on new beat (when music is active)
    if (audioMs >= DROP_AUDIO_MS && audioMs < 123350 && beatIndex !== lastBeatIndex) {
      lastBeatIndex = beatIndex;
      if (kiai || beatIndex % 2 === 0) {
        spawnLogoRipple(audioMs, kiai ? 1.28 : 1.18, kiai ? 0.32 : 0.18);
      }
    }

    // Calculate BeatSyncedContainer scale (OnNewBeat in OsuLogo.cs)
    let beatScale = 1.0;
    if (audioMs >= DROP_AUDIO_MS && audioMs < 123650) {
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

    const totalScale = beatScale * hoverScale * (1.0 - clickScaleBoost) * outroScale;

    // Subtle cursor parallax for logo
    const offsetX = -smoothMouseX * 16 * scale;
    const offsetY = -smoothMouseY * 16 * scale;
    menuLogoAnchor.style.transform =
      `translate(-50%, -50%) translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`;
    menuLogoScale.style.transform = `scale(${totalScale.toFixed(4)})`;
    menuLogoScale.style.opacity = logoAlpha.toFixed(3);
    menuLogoDim.style.opacity = audioMs >= 125450 ? '1' : '0';

    // 1. Update Beat Ripples behind OsuLogo
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const age = audioMs - rp.spawnMs;
      if (age < 0 || age > 750) {
        rp.el.remove();
        ripples.splice(i, 1);
        continue;
      }
      const p = age / 750.0;
      const rScale = 1.0 + (rp.maxScale - 1.0) * easeOutQuad(p);
      const rAlpha = rp.alpha * (1.0 - easeOutQuad(p));
      rp.el.style.transform = `scale(${rScale.toFixed(4)})`;
      rp.el.style.opacity = rAlpha.toFixed(3);
      rp.el.style.borderWidth = `${(5.0 * scale * (1.0 - p * 0.5)).toFixed(2)}px`;
    }
  }

  // --- GameWideFlash (IntroTriangles.cs: Box White Additive, FadeOutFromOne(1000, Easing.Out)) ---
  function updateDropFlash(tSeq) {
    let alpha = 0;
    if (tSeq >= DROP_SEQ_MS && tSeq < DROP_SEQ_MS + FLASH_DURATION) {
      const p = clamp((tSeq - DROP_SEQ_MS) / FLASH_DURATION, 0, 1);
      alpha = 1.0 - easeOutQuad(p);
    }
    dropFlash.style.opacity = alpha.toFixed(4);
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

    const refScale = getRefScale();

    // Audio amplitude metrics for the menu logo pulse
    const audioMetrics = updateAudioAnalysis(audioMs);

    // Intro stays on canvas; the main menu is DOM.
    if (tSeq < DROP_SEQ_MS) {
      setMenuActive(false);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, viewW, viewH);

      drawWelcomeAndTriangles(tSeq, refScale);
      drawRulesets(tSeq, refScale);
      drawLazerLogo(tSeq, refScale);
      updateDropFlash(0);
    } else {
      setMenuActive(true);

      updateMenuBackground(audioMs, refScale);
      updateMenuLogo(audioMs, dtMs, refScale, audioMetrics);
      updateDropFlash(tSeq);
    }
  }

  // --- Playback Controls & Interaction ---
  function syncPlaybackClock(positionMs) {
    pausedPositionMs = positionMs;
    fallbackClockStartMs = positionMs;
    fallbackClockStartPerf = performance.now();
    lastAudioCurrentTime = audio.currentTime;
    lastPerfTime = performance.now();
  }

  function pausePlayback() {
    if (!isPlaybackRunning) return;
    pausedPositionMs = getExactAudioTimeMs();
    isPlaybackRunning = false;
    audio.pause();
    btnPlayPause.textContent = 'Play';
  }

  function removeAudioUnlockListeners() {
    window.removeEventListener('pointerdown', unlockAudioPlayback);
    window.removeEventListener('keydown', unlockAudioPlayback);
    audioUnlockAttached = false;
  }

  function attachAudioUnlockListeners() {
    if (audioUnlockAttached) return;
    audioUnlockAttached = true;
    window.addEventListener('pointerdown', unlockAudioPlayback, { once: true });
    window.addEventListener('keydown', unlockAudioPlayback, { once: true });
  }

  function unlockAudioPlayback() {
    removeAudioUnlockListeners();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    audio.muted = false;
    if (!isPlaybackRunning) return;

    const positionMs = getExactAudioTimeMs();
    fallbackClockStartMs = positionMs;
    fallbackClockStartPerf = performance.now();

    if (audio.paused) {
      audio.currentTime = positionMs / 1000.0;
      lastAudioCurrentTime = audio.currentTime;
      lastPerfTime = performance.now();
    }

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          btnPlayPause.textContent = 'Pause';
        })
        .catch(() => {
          // Audible playback still refused; restore muted playback so the intro keeps running.
          audio.muted = true;
          const retry = audio.play();
          if (retry !== undefined) retry.catch(() => {});
          attachAudioUnlockListeners();
        });
    }
  }

  audio.addEventListener('pause', () => {
    if (!isPlaybackRunning || audio.ended) return;
    // Browser paused the audio (e.g. after refusing an unmute): keep visuals moving.
    fallbackClockStartMs = audio.currentTime * 1000.0;
    fallbackClockStartPerf = performance.now();
  });

  audio.addEventListener('ended', () => {
    pausedPositionMs = audio.duration ? audio.duration * 1000.0 : getExactAudioTimeMs();
    isPlaybackRunning = false;
    btnPlayPause.textContent = 'Play';
  });

  async function startPlayback(startAtMs = 0) {
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    isStarted = true;
    isPlaybackRunning = true;
    resetMenuVisuals();

    audio.currentTime = startAtMs / 1000.0;
    syncPlaybackClock(startAtMs);
    btnPlayPause.textContent = 'Pause';

    // Prefer audible playback (allowed on desktop and on return visits).
    audio.muted = false;
    try {
      await audio.play();
      if (!audioCtx || audioCtx.state === 'running') {
        removeAudioUnlockListeners();
      } else {
        attachAudioUnlockListeners();
      }
      return;
    } catch (_) {
      // Browser autoplay policy blocks audible playback without a gesture.
    }

    // Start muted so the intro still plays instantly; unmute on first interaction.
    audio.muted = true;
    try {
      await audio.play();
    } catch (_) {
      // Muted playback blocked too: the wall-clock fallback drives the animation.
    }
    attachAudioUnlockListeners();
  }

  btnReplay.addEventListener('click', () => startPlayback(0));

  btnPlayPause.addEventListener('click', () => {
    if (!isStarted) {
      startPlayback(0);
      return;
    }
    if (!isPlaybackRunning) {
      startPlayback(pausedPositionMs);
      return;
    }
    pausePlayback();
  });

  hudScrubber.addEventListener('input', () => {
    isScrubbing = true;
    if (audio.duration) {
      const targetSec = (parseFloat(hudScrubber.value) / 100.0) * audio.duration;
      audio.currentTime = targetSec;
      syncPlaybackClock(targetSec * 1000.0);
      resetMenuVisuals();
    }
  });

  hudScrubber.addEventListener('change', () => {
    isScrubbing = false;
  });

  // Auto-show HUD briefly near the top-right corner (hover on desktop, tap on touch)
  let hudTimeout = null;

  function revealHud(durationMs = 2600) {
    hudBar.classList.add('visible');
    clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
      hudBar.classList.remove('visible');
    }, durationMs);
  }

  function isInHudHotspot(clientX, clientY) {
    const hotspotWidth = Math.min(420, viewW * 0.55);
    return clientY < 100 && clientX > viewW - hotspotWidth;
  }

  function updateParallax(clientX, clientY) {
    mouseX = (clientX / Math.max(1, viewW)) * 2 - 1;
    mouseY = (clientY / Math.max(1, viewH)) * 2 - 1;
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    updateParallax(e.clientX, e.clientY);
    if (isInHudHotspot(e.clientX, e.clientY)) {
      revealHud();
    }
  });

  window.addEventListener('pointerdown', (e) => {
    if (!isStarted || hudBar.contains(e.target)) return;

    if (isInHudHotspot(e.clientX, e.clientY)) {
      if (e.pointerType === 'mouse') {
        revealHud();
      } else if (hudBar.classList.contains('visible')) {
        clearTimeout(hudTimeout);
        hudBar.classList.remove('visible');
      } else {
        revealHud(4000);
      }
      return;
    }

    // Tapping anywhere else dismisses the touch HUD.
    if (e.pointerType !== 'mouse' && hudBar.classList.contains('visible')) {
      clearTimeout(hudTimeout);
      hudBar.classList.remove('visible');
    }
  });

  menuLogo.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'touch') isHoveringLogo = true;
  });

  menuLogo.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') isHoveringLogo = false;
  });

  menuLogo.addEventListener('click', () => {
    if (!isStarted || getExactAudioTimeMs() < DROP_AUDIO_MS) return;
    clickScaleBoost = 0.065;
    spawnLogoRipple(getExactAudioTimeMs(), 1.32, 0.42);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      startPlayback(0);
    } else if (e.code === 'Space') {
      e.preventDefault();
      btnPlayPause.click();
    } else if (e.code === 'KeyH') {
      hudBar.classList.toggle('visible');
    }
  });

  // --- Asset Preloader (Streams bytes to drive 0%..100% progress) ---
  async function preloadAllAssets(onProgress) {
    const assets = [
      { id: 'audio', url: AUDIO_TRACK_URL, size: 5176574, label: 'audio track' },
      { id: 'pfp', url: 'assets/pfp.jpeg', size: 3274974, label: 'avatar profile picture' },
      { id: 'bg', url: 'assets/blurred-bg.webp', size: 42522, label: 'background texture' }
    ];

    const totalBytes = assets.reduce((sum, a) => sum + a.size, 0);
    const loadedBytes = { audio: 0, pfp: 0, bg: 0 };

    function report(assetId, received, label) {
      loadedBytes[assetId] = received;
      const sum = Object.values(loadedBytes).reduce((a, b) => a + b, 0);
      onProgress(Math.min(1.0, sum / totalBytes), label);
    }

    async function fetchAssetBlob(asset) {
      try {
        const res = await fetch(asset.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const expected = +(res.headers.get('content-length') || asset.size);

        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const chunks = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            report(asset.id, received, asset.label);
          }
          report(asset.id, expected, asset.label);
          return new Blob(chunks);
        } else {
          const blob = await res.blob();
          report(asset.id, expected, asset.label);
          return blob;
        }
      } catch (err) {
        console.warn(`Preload fallback for ${asset.url}:`, err);
        report(asset.id, asset.size, asset.label);
        return null;
      }
    }

    // Download assets in parallel
    const [audioBlob, pfpBlob, bgBlob] = await Promise.all([
      fetchAssetBlob(assets[0]),
      fetchAssetBlob(assets[1]),
      fetchAssetBlob(assets[2])
    ]);

    // Setup audio source
    if (audioBlob) {
      audio.src = URL.createObjectURL(audioBlob);
    } else {
      audio.src = AUDIO_TRACK_URL;
    }

    // Decode the DOM menu images
    function loadMenuImage(img, url) {
      return new Promise((resolve) => {
        if (!img) {
          resolve();
          return;
        }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (img.decode) {
            img.decode().catch(() => {}).then(resolve);
          } else {
            resolve();
          }
        };

        img.onload = finish;
        img.onerror = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        img.src = url;
        if (img.complete && img.naturalWidth > 0) finish();
      });
    }

    const pfpUrl = pfpBlob ? URL.createObjectURL(pfpBlob) : 'assets/pfp.jpeg';
    const bgUrl = bgBlob ? URL.createObjectURL(bgBlob) : 'assets/blurred-bg.webp';
    const pfpPromise = loadMenuImage(menuPfp, pfpUrl);
    const bgPromise = loadMenuImage(menuBgImage, bgUrl);

    // Ensure audio can play through
    const audioReadyPromise = new Promise((resolve) => {
      if (audio.readyState >= 3) {
        resolve();
      } else {
        const onReady = () => {
          audio.removeEventListener('canplaythrough', onReady);
          audio.removeEventListener('loadeddata', onReady);
          resolve();
        };
        audio.addEventListener('canplaythrough', onReady, { once: true });
        audio.addEventListener('loadeddata', onReady, { once: true });
        setTimeout(resolve, 2000);
        audio.load();
      }
    });

    const fontsPromise = (document.fonts && document.fonts.ready)
      ? document.fonts.ready
      : Promise.resolve();

    await Promise.all([pfpPromise, bgPromise, audioReadyPromise, fontsPromise]);
  }

  // --- App Startup with osu!lazer Loading Screen ---
  async function startApp() {
    let targetProgress = 0;
    let currentProgress = 0;
    let currentLabel = 'loading assets...';
    let isComplete = false;

    // Smooth progress interpolation loop
    let progressAnimId = null;
    function updateProgressUI() {
      if (!isComplete || currentProgress < 0.999) {
        progressAnimId = requestAnimationFrame(updateProgressUI);
      }
      currentProgress += (targetProgress - currentProgress) * 0.14;
      if (isComplete && Math.abs(1.0 - currentProgress) < 0.005) {
        currentProgress = 1.0;
      }

      if (loadingBarFill) {
        loadingBarFill.style.width = (currentProgress * 100).toFixed(1) + '%';
      }
      if (loadingPercent) {
        loadingPercent.textContent = Math.round(currentProgress * 100) + '%';
      }
      if (loadingStatus) {
        loadingStatus.textContent = currentLabel;
      }
    }
    progressAnimId = requestAnimationFrame(updateProgressUI);

    // Preload all assets
    await preloadAllAssets((ratio, label) => {
      targetProgress = Math.max(targetProgress, ratio);
      currentLabel = label ? `loading ${label}...` : 'loading assets...';
    });

    targetProgress = 1.0;
    isComplete = true;
    currentLabel = 'ready!';

    // Wait until progress bar visually reaches 100%
    while (currentProgress < 0.99) {
      await new Promise((r) => setTimeout(r, 16));
    }
    currentProgress = 1.0;
    if (loadingBarFill) loadingBarFill.style.width = '100%';
    if (loadingPercent) loadingPercent.textContent = '100%';
    if (loadingStatus) loadingStatus.textContent = 'ready!';

    // Brief polish hold (220ms) so 100% state is perceived
    await new Promise((r) => setTimeout(r, 220));

    // Require one interaction so the browser permits unmuted audio playback.
    const touchFirst = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    currentLabel = touchFirst ? 'tap anywhere to start' : 'click anywhere to start';
    if (loadingStatus) loadingStatus.textContent = currentLabel;
    if (loadingScreen) {
      loadingScreen.classList.add('awaiting-start');
      loadingScreen.setAttribute('role', 'button');
      loadingScreen.setAttribute('tabindex', '0');
      loadingScreen.setAttribute(
        'aria-label',
        touchFirst
          ? 'Tap anywhere to start the intro'
          : 'Click anywhere or press Enter to start the intro'
      );
    }

    await new Promise((resolve) => {
      let started = false;

      function beginIntro(event) {
        if (started) return;
        if (event && event.type === 'keydown') {
          if (event.key !== 'Enter' && event.key !== ' ' && event.code !== 'Space') return;
          event.preventDefault();
        }

        started = true;
        cleanup();

        // Must run inside the gesture handler so audio can start unmuted.
        requestAnimationFrame(renderFrame);
        startPlayback(0);

        // On touch screens there is no hover, so surface the controls once after the drop.
        if (touchFirst) setTimeout(() => revealHud(2800), 4200);

        if (loadingScreen) {
          loadingScreen.classList.remove('awaiting-start');
          loadingScreen.classList.add('fade-out');
          loadingScreen.removeAttribute('role');
          loadingScreen.removeAttribute('tabindex');
          loadingScreen.setAttribute('aria-hidden', 'true');
          loadingScreen.blur();
        }

        setTimeout(() => {
          if (progressAnimId) cancelAnimationFrame(progressAnimId);
          if (loadingScreen) {
            loadingScreen.style.display = 'none';
          }
        }, 600);

        resolve();
      }

      function cleanup() {
        window.removeEventListener('click', beginIntro);
        window.removeEventListener('touchend', beginIntro);
        window.removeEventListener('keydown', beginIntro);
      }

      window.addEventListener('click', beginIntro);
      window.addEventListener('touchend', beginIntro, { passive: true });
      window.addEventListener('keydown', beginIntro);
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
})();

