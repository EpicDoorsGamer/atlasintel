/* ==========================================================================
   Hands — webcam hand-gesture control (Google MediaPipe Hand Landmarker).
   Runs entirely in the browser: the video never leaves the device.
   Loaded only when the visitor switches HANDS on and allows the camera.

     open hand + move      -> rotate the globe
     pinch + move up/down  -> zoom
     point + hold still    -> select what's under the cursor
     fist (hold)           -> close the dossier
   ========================================================================== */
window.Hands = (() => {
  'use strict';
  const VERSION = '0.10.21';
  const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const DWELL_MS = 900, FIST_MS = 900, COOLDOWN_MS = 1500, IDLE_MS = 4000;

  const panel = document.getElementById('handPanel');
  const video = document.getElementById('hpVideo');
  const canvas = document.getElementById('hpCanvas');
  const g = canvas.getContext('2d');
  const modeEl = document.getElementById('hpMode');
  const cursor = document.getElementById('handCursor');

  let landmarker = null, stream = null, running = false, raf = 0, cb = {};
  let lastVideoTime = -1;
  // gesture state
  let gesture = 'none', candidate = 'none', candidateFrames = 0;
  let prevPalm = null, prevPinchY = null, cur = null;
  let dwell = null, fistSince = 0, coolUntil = 0, lastSeen = 0, idleFired = true;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toScreen = p => ({ x: (1 - p.x) * innerWidth, y: p.y * innerHeight }); // mirror like a selfie

  function setMode(text) { modeEl.textContent = text; }

  async function loadModel() {
    setMode('LOADING MODEL');
    const { FilesetResolver, HandLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const opts = delegate => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); // no WebGL2: slower but works
    }
  }

  async function start(callbacks) {
    if (running) return;
    cb = callbacks || {};
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('THIS BROWSER HAS NO CAMERA ACCESS');
    panel.hidden = false;
    setMode('REQUESTING CAMERA');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) {
      panel.hidden = true;
      throw new Error(e.name === 'NotAllowedError' ? 'CAMERA PERMISSION DENIED' : 'NO CAMERA FOUND');
    }
    video.srcObject = stream;
    await video.play();
    try {
      if (!landmarker) await loadModel();
    } catch (e) {
      stop();
      throw new Error('HAND MODEL FAILED TO LOAD');
    }
    running = true;
    setMode('SHOW YOUR HAND');
    cb.onStateChange?.();
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    panel.hidden = true;
    cursor.classList.remove('on');
    gesture = 'none';
    cb.onStateChange?.();
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    let res;
    try { res = landmarker.detectForVideo(video, performance.now()); } catch { return; }
    const lm = res.landmarks?.[0];
    draw(lm);
    interpret(lm);
  }

  function draw(lm) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    const W = canvas.width, H = canvas.height;
    g.strokeStyle = 'rgba(0, 229, 255, 0.9)';
    g.lineWidth = 2;
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 6;
    g.beginPath();
    for (const [a, b] of CONNECTIONS) {
      g.moveTo(lm[a].x * W, lm[a].y * H);
      g.lineTo(lm[b].x * W, lm[b].y * H);
    }
    g.stroke();
    g.fillStyle = '#ffb300';
    for (const p of lm) { g.beginPath(); g.arc(p.x * W, p.y * H, 2.5, 0, Math.PI * 2); g.fill(); }
  }

  function classify(lm) {
    const size = dist(lm[0], lm[9]) || 1e-3;
    // a finger counts as extended when its tip is clearly further from the wrist than its middle joint
    const ext = tip => dist(lm[0], lm[tip]) > dist(lm[0], lm[tip - 2]) * 1.1;
    const fingers = [8, 12, 16, 20].map(ext);
    const n = fingers.filter(Boolean).length;
    if (dist(lm[4], lm[8]) / size < 0.32) return 'pinch'; // thumb tip touching index tip
    if (fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]) return 'point';
    if (n >= 4) return 'open';
    if (n === 0) return 'fist';
    return 'idle';
  }

  function interpret(lm) {
    const now = performance.now();
    if (!lm) {
      cursor.classList.remove('on');
      prevPalm = prevPinchY = null;
      dwell = null;
      candidate = gesture = 'none';
      setMode('NO HAND');
      if (!idleFired && now - lastSeen > IDLE_MS) { idleFired = true; cb.idle?.(); }
      return;
    }
    lastSeen = now;
    idleFired = false;

    // debounce: a gesture must hold for 3 frames before it takes over
    const raw = classify(lm);
    if (raw === candidate) candidateFrames++;
    else { candidate = raw; candidateFrames = 1; }
    if (candidateFrames >= 3 && candidate !== gesture) {
      gesture = candidate;
      prevPalm = prevPinchY = null;
      dwell = null;
      fistSince = gesture === 'fist' ? now : 0;
    }

    const palmRaw = [0, 5, 9, 13, 17].reduce((acc, i) => ({ x: acc.x + lm[i].x / 5, y: acc.y + lm[i].y / 5 }), { x: 0, y: 0 });
    const palm = toScreen(palmRaw);

    if (gesture !== 'point') cursor.classList.remove('on');

    if (gesture === 'open') {
      setMode('ROTATE');
      if (prevPalm) {
        const dx = palm.x - prevPalm.x, dy = palm.y - prevPalm.y;
        if (Math.hypot(dx, dy) > 1.5) cb.rotate?.(dx, dy);
      }
      prevPalm = { x: prevPalm ? prevPalm.x + (palm.x - prevPalm.x) * 0.6 : palm.x, y: prevPalm ? prevPalm.y + (palm.y - prevPalm.y) * 0.6 : palm.y };
    } else if (gesture === 'pinch') {
      setMode('ZOOM');
      const y = palm.y;
      if (prevPinchY != null && Math.abs(y - prevPinchY) > 1) cb.zoom?.(y - prevPinchY);
      prevPinchY = prevPinchY == null ? y : prevPinchY + (y - prevPinchY) * 0.6;
    } else if (gesture === 'point') {
      const tip = toScreen(lm[8]);
      cur = cur && cursor.classList.contains('on') ? { x: cur.x + (tip.x - cur.x) * 0.35, y: cur.y + (tip.y - cur.y) * 0.35 } : tip;
      cursor.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
      cursor.classList.add('on');
      if (now < coolUntil) { setMode('SELECTED'); cursor.style.setProperty('--p', '100%'); return; }
      if (!dwell || Math.hypot(cur.x - dwell.x, cur.y - dwell.y) > 28) dwell = { x: cur.x, y: cur.y, t: now };
      const p = Math.min(1, (now - dwell.t) / DWELL_MS);
      cursor.style.setProperty('--p', (p * 100).toFixed(0) + '%');
      setMode(p < 1 ? 'POINT · HOLD TO SELECT' : 'SELECT');
      if (p >= 1) {
        coolUntil = now + COOLDOWN_MS;
        dwell = null;
        cursor.classList.add('fire');
        setTimeout(() => cursor.classList.remove('fire'), 400);
        cb.select?.(cur.x, cur.y);
      }
    } else if (gesture === 'fist') {
      const p = Math.min(1, (now - fistSince) / FIST_MS);
      setMode(p < 1 ? 'FIST · HOLD TO CLOSE' : 'CLOSED');
      if (p >= 1 && now > coolUntil) { coolUntil = now + COOLDOWN_MS; cb.close?.(); }
    } else {
      setMode('TRACKING');
    }
  }

  document.getElementById('hpClose').addEventListener('click', () => stop());

  return { start, stop, get active() { return running; } };
})();
