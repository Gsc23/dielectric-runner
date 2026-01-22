// ==========================================
// 1. FIREBASE SETUP
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCgE_ZUTphwarqUcOCjGEaohofZ5Cw5ntM",
    authDomain: "dielectric-runner.firebaseapp.com",
    projectId: "dielectric-runner",
    storageBucket: "dielectric-runner.firebasestorage.app",
    messagingSenderId: "442412282322",
    appId: "1:442412282322:web:aeab300f6b38df91ef180b",
    measurementId: "G-PJYH1ZWD7X"
};

let db = null;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    console.log("Conectado ao Firebase Global!");
} catch (e) {
    console.warn("Erro ao conectar Firebase:", e);
}

function loadGlobalScores() {
    if (!db) return;
    const hsDiv = document.getElementById("hsList");
    if (!hsDiv) return;
    hsDiv.innerHTML = "<div class='hs-row' style='color:#777'>LOADING GLOBAL DATA...</div>";

    // Limit to 20 for free tier safety
    db.collection("scores")
        .orderBy("score", "desc")
        .limit(20)
        .onSnapshot((snapshot) => {
            let html = "";
            let rank = 1;
            snapshot.forEach((doc) => {
                const data = doc.data();
                const safeName = escapeHtml(data.name);
                html += `
          <div class="hs-row">
            <span>#${rank}</span>
            <span>${safeName}</span>
            <span>${data.score}</span>
          </div>`;
                rank++;
            });
            hsDiv.innerHTML = html;
        }, (error) => {
            console.error("Erro leitura:", error);
            hsDiv.innerHTML = "<div class='hs-row' style='color:#f00'>DB ERROR</div>";
        });
}

function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ==========================================
// 2. AUDIO ENGINE
// ==========================================
class AudioSys {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.noiseBuffer = null;
        this.nextNoteTime = 0;
        this.noteIndex = 0;
        this.mode = 'retro';
        this.tempoRetro = 0.13;
        this.tempoSpace = 2.0;
        this.tempoMenu = 3.0;
        this.scaleRetro = [110.00, 130.81, 146.83, 164.81, 196.00, 220.00];
        this.spaceNotes = [55, 65.41, 73.42, 82.41, 98, 110, 130.81];
        this.menuNotes = [220.00, 329.63, 392.00, 493.88, 587.33];
        this.droneOsc = null;
        this.droneGain = null;
        this.isPlaying = false;
    }

    setMode(m) { this.mode = m; }

    init() {
        if (this.ctx) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;

            this.ctx = new Ctx();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.4;
            this.master.connect(this.ctx.destination);

            const bufSize = this.ctx.sampleRate * 2;
            this.noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

            const delay = this.ctx.createDelay();
            delay.delayTime.value = 0.4;
            const delayFb = this.ctx.createGain();
            delayFb.gain.value = 0.4;
            const delayFilter = this.ctx.createBiquadFilter();
            delayFilter.frequency.value = 1500;

            this.master.connect(delay);
            delay.connect(delayFilter);
            delayFilter.connect(delayFb);
            delayFb.connect(delay);
            delay.connect(this.ctx.destination);

            this.delayNode = delay;
            this.delayFbNode = delayFb;
        } catch (e) { }
    }

    updateDelaySettings(active) {
        if (!this.delayNode) return;
        try {
            if (!active) {
                this.delayNode.delayTime.rampToValueAtTime(0.45, this.ctx.currentTime + 1);
                this.delayFbNode.gain.rampToValueAtTime(0.6, this.ctx.currentTime + 1);
            } else if (this.mode === 'space') {
                this.delayNode.delayTime.rampToValueAtTime(0.6, this.ctx.currentTime + 1);
                this.delayFbNode.gain.rampToValueAtTime(0.6, this.ctx.currentTime + 1);
            } else {
                this.delayNode.delayTime.rampToValueAtTime(0.25, this.ctx.currentTime + 1);
                this.delayFbNode.gain.rampToValueAtTime(0.3, this.ctx.currentTime + 1);
            }
        } catch (e) { }
    }

    updateDrone(active) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        if (!active && !this.droneOsc) {
            this.droneOsc = this.ctx.createOscillator();
            this.droneOsc.type = 'sawtooth';
            this.droneOsc.frequency.value = 55.00;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 90;
            this.droneGain = this.ctx.createGain();
            this.droneGain.gain.setValueAtTime(0, t);
            this.droneGain.gain.linearRampToValueAtTime(0.2, t + 3.0);
            this.droneOsc.connect(filter);
            filter.connect(this.droneGain);
            this.droneGain.connect(this.master);
            this.droneOsc.start(t);
        } else if (active && this.droneOsc) {
            this.droneGain.gain.cancelScheduledValues(t);
            this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
            this.droneGain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
            this.droneOsc.stop(t + 1.1);
            this.droneOsc = null;
            this.droneGain = null;
        }
    }

    resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { } }

    playBGM() {
        if (!this.ctx || !this.isPlaying) return;
        try {
            this.updateDrone(State.active);
            let currentTempo = (!State.active) ? this.tempoMenu : (this.mode === 'space' ? this.tempoSpace : this.tempoRetro);

            while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
                if (!State.active) this.triggerMenuNote(this.nextNoteTime);
                else if (this.mode === 'space') this.triggerSpaceNote(this.nextNoteTime);
                else this.triggerRetroNote(this.nextNoteTime);
                this.nextNoteTime += currentTempo;
            }
            if (this.ctx.currentTime % 2 < 0.1) this.updateDelaySettings(State.active);
        } catch (e) { }
    }

    triggerMenuNote(t) {
        const note = this.menuNotes[this.noteIndex % this.menuNotes.length];
        const octave = Math.random() > 0.6 ? 2 : 1;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = note * octave;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
        osc.connect(gain); gain.connect(this.master);
        osc.start(t); osc.stop(t + 2.5); this.noteIndex++;
    }

    triggerRetroNote(t) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const pattern = [0, 2, 3, 5, 7, 5, 3, 2, 0, 0, -3, 0, 2, 0, -3, -5];
        const idx = this.noteIndex % pattern.length;
        let noteIdx = pattern[idx];
        let freq = (noteIdx >= 0) ? this.scaleRetro[noteIdx % this.scaleRetro.length] * (1 + Math.floor(noteIdx / this.scaleRetro.length)) : this.scaleRetro[0] / 2;
        osc.frequency.value = freq;

        if (idx % 4 === 0) {
            osc.type = 'sawtooth'; gain.gain.setValueAtTime(0.15, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        } else {
            osc.type = 'square'; gain.gain.setValueAtTime(0.05, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        }
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.setValueAtTime(800, t); filter.frequency.linearRampToValueAtTime(100, t + 0.2);
        osc.connect(filter); filter.connect(gain); gain.connect(this.master);
        osc.start(t); osc.stop(t + 0.4); this.noteIndex++;
    }

    triggerSpaceNote(t) {
        const freq = this.spaceNotes[Math.floor(Math.random() * this.spaceNotes.length)];
        const octave = Math.random() > 0.7 ? 2 : 1;
        const carrier = this.ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = freq * octave;
        const modulator = this.ctx.createOscillator(); modulator.type = 'triangle'; modulator.frequency.value = freq * 2.02;
        const modGain = this.ctx.createGain(); modGain.gain.value = 100;
        modulator.connect(modGain); modGain.connect(carrier.frequency);
        const masterGain = this.ctx.createGain();
        masterGain.gain.setValueAtTime(0, t); masterGain.gain.linearRampToValueAtTime(0.2, t + 0.5); masterGain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
        carrier.connect(masterGain); masterGain.connect(this.master);
        carrier.start(t); carrier.stop(t + 3.0); modulator.start(t); modulator.stop(t + 3.0);
        this.noteIndex++;
    }

    sfxThrust() {
        if (!this.ctx) return;
        try {
            const t = this.ctx.currentTime;
            const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer;
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600;
            const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.08, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            src.connect(filter); filter.connect(gain); gain.connect(this.master);
            src.start(t); src.stop(t + 0.2);
        } catch (e) { }
    }

    sfxCrash() {
        if (!this.ctx) return;
        try {
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(10, t + 0.5);
            const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.connect(gain); gain.connect(this.master);
            osc.start(t); osc.stop(t + 0.6);
        } catch (e) { }
    }

    startMusic() {
        try {
            if (!this.ctx) this.init();
            this.isPlaying = true;
            if (this.ctx) {
                if (this.nextNoteTime < this.ctx.currentTime) this.nextNoteTime = this.ctx.currentTime + 0.1;
                this.updateDelaySettings(State.active);
            }
        } catch (e) { }
    }
}

// ==========================================
// 3. GAME ENGINE
// ==========================================
const Audio = new AudioSys();
const btnRetro = document.getElementById('btnAudioRetro');
const btnSpace = document.getElementById('btnAudioSpace');

if (btnRetro && btnSpace) {
    btnRetro.addEventListener('click', () => { Audio.setMode('retro'); btnRetro.classList.add('active'); btnSpace.classList.remove('active'); });
    btnSpace.addEventListener('click', () => { Audio.setMode('space'); btnSpace.classList.add('active'); btnRetro.classList.remove('active'); });
}

window.addEventListener('click', () => {
    if (!Audio.ctx) { try { Audio.init(); Audio.resume(); Audio.startMusic(); } catch (e) { console.warn('Audio start failed', e); } }
}, { once: true });
window.addEventListener('touchstart', () => {
    if (!Audio.ctx) { try { Audio.init(); Audio.resume(); Audio.startMusic(); } catch (e) { console.warn('Audio start failed', e); } }
}, { once: true });

const CFG = {
    W: 1200, H: 800, GRAVITY: 0, THRUST: 600, DRAG: 2.0, SCROLL_V0: 150, SCROLL_ACCEL: 8,
    SEG_LEN: 300, WALL_GAP: 500, K_COULOMB: 80, K_LIKE_BASE: 15.0, DIELECTRIC_MULT: 1.0,
    DIST_SCALE: 100, ISO_ANGLE: 0.6, FOV: 600
};

const State = {
    active: false, paused: false, over: false, time: 0, score: 0, distance: 0, speed: CFG.SCROLL_V0,
    player: { y: 0, vy: 0, q: 1 }, trail: [], segments: [], particles: [], forces: { topC: 0, topP: 0, botC: 0, botP: 0 }
};

const canvas = document.getElementById("c");
const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
let bounds = { w: 0, h: 0 };
// compute anchor X (player horizontal position) based on viewport to avoid clipping on narrow/wide screens
function getAnchorX() {
    return Math.max(120, Math.floor(bounds.w * 0.18));
}
let _resizeTimeout = null;
function resize() {
    if (!canvas || !ctx) return;
    // debounce resize events
    if (_resizeTimeout) clearTimeout(_resizeTimeout);
    _resizeTimeout = setTimeout(() => {
        // Prefer visualViewport when available (better for mobile browsers with dynamic UI)
        const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const w = Math.max(1, Math.floor(vw)); const h = Math.max(1, Math.floor(vh));
        bounds.w = w; bounds.h = h;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        // scale drawing operations to CSS pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }, 50);
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

const Input = { up: false, down: false };
window.addEventListener('keydown', e => {
    if (e.code === 'Space') handleSpace();
    if (e.code === 'ArrowUp' || e.code === 'KeyW') Input.up = true;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') Input.down = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') Input.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') Input.down = false;
});

const uiScore = document.getElementById('uiScore');
const uiSpeed = document.getElementById('uiSpeed');
const uiField = document.getElementById('uiField');
const sliderPol = document.getElementById('sliderPol');
const valPol = document.getElementById('valPol');
const overlayStart = document.getElementById('overlayStart');
const overlayGO = document.getElementById('overlayGO');
const overlayInfo = document.getElementById('overlayInfo');
const btnStart = document.getElementById('btnStart');
const btnRetry = document.getElementById('btnRetry');
const btnNewPilot = document.getElementById('btnNewPilot');
const btnInfo = document.getElementById('btnInfo');
const btnCloseInfo = document.getElementById('btnCloseInfo');
const pNameInput = document.getElementById('pName');
const touchUp = document.getElementById('touchUp');
const touchDown = document.getElementById('touchDown');

// NAME FILTER: No Spaces, Lowercase
if (pNameInput) {
    pNameInput.addEventListener('input', function (e) {
        let val = e.target.value;
        val = val.toLowerCase();
        val = val.replace(/\s/g, '');
        e.target.value = val;
    });
}

if (sliderPol) {
    sliderPol.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) / 100;
        CFG.DIELECTRIC_MULT = val;
        if (valPol) valPol.innerText = val.toFixed(2);
    });
}

if (btnInfo && overlayInfo) btnInfo.addEventListener('click', () => {
    overlayInfo.classList.remove('hidden');
    if (State.active) { State.active = false; State.paused = true; }
});
if (btnCloseInfo && overlayInfo) btnCloseInfo.addEventListener('click', () => {
    overlayInfo.classList.add('hidden');
    if (State.paused) { State.active = true; State.paused = false; }
});

if (pNameInput) {
    const saved = localStorage.getItem("ion_runner_name");
    pNameInput.placeholder = "guest";
    pNameInput.value = saved || "";
}

function handleSpace() {
    if (!overlayInfo.classList.contains('hidden')) return;
    // SPACE ONLY RESTARTS GAME
    if (State.over) resetGame();
}

if (btnStart) btnStart.addEventListener('click', startGame);
if (btnRetry) btnRetry.addEventListener('click', resetGame);
if (btnNewPilot) btnNewPilot.addEventListener('click', goToMenu);

// Touch controls for mobile: hold top area to go UP, bottom area to go DOWN
if (touchUp && touchDown) {
    const prevent = (e) => { e.preventDefault(); };
    touchUp.addEventListener('touchstart', (e) => { prevent(e); Input.up = true; });
    touchUp.addEventListener('touchend', (e) => { prevent(e); Input.up = false; });
    touchUp.addEventListener('touchcancel', (e) => { prevent(e); Input.up = false; });

    touchDown.addEventListener('touchstart', (e) => { prevent(e); Input.down = true; });
    touchDown.addEventListener('touchend', (e) => { prevent(e); Input.down = false; });
    touchDown.addEventListener('touchcancel', (e) => { prevent(e); Input.down = false; });

    // mouse compatibility
    touchUp.addEventListener('mousedown', () => { Input.up = true; });
    window.addEventListener('mouseup', () => { Input.up = false; Input.down = false; });
    touchDown.addEventListener('mousedown', () => { Input.down = true; });
}

function startGame() {
    if (pNameInput) {
        const v = (pNameInput.value || "").trim();
        if (v.length > 0) localStorage.setItem("ion_runner_name", v);
        else localStorage.setItem("ion_runner_name", "guest");
    }
    try { if (!Audio.ctx) Audio.init(); Audio.resume(); Audio.startMusic(); } catch (e) { }
    if (overlayStart) overlayStart.classList.add('hidden');
    resetPhysics();
    State.active = true; State.over = false; State.paused = false;
    // Show mobile hint explaining touch & hold controls
    showMobileHint("Jogo iniciado — em dispositivos móveis: toque e segure na tela para controlar.");
}

function resetGame() {
    if (overlayGO) overlayGO.classList.add('hidden');
    resetPhysics();
    State.active = true; State.over = false;
    try { Audio.startMusic(); } catch (e) { }
    showMobileHint("Reiniciado — em dispositivos móveis: toque e segure na tela para controlar.");
}

function goToMenu() {
    if (overlayGO) overlayGO.classList.add('hidden');
    if (overlayStart) overlayStart.classList.remove('hidden');
    if (pNameInput) { pNameInput.value = ""; try { pNameInput.focus(); } catch (e) { } }

    State.active = false;
    State.paused = false;
    State.over = false;
}

function resetPhysics() {
    State.time = 0; State.score = 0; State.distance = 0; State.speed = CFG.SCROLL_V0;
    State.player.y = 0; State.player.vy = 0;
    State.segments = []; State.particles = []; State.trail = [];
    State.forces = { topC: 0, topP: 0, botC: 0, botP: 0 };
    for (let i = 0; i < 10; i++) addSegment(i * CFG.SEG_LEN);
}

function addSegment(x) {
    const isSafe = x < 600;
    const progression = Math.floor(State.distance / 3000);
    const qMax = Math.min(30, 10 + progression * 2);
    const getMag = () => Math.floor(Math.random() * (qMax - 1)) + 1;
    let qTop = isSafe ? 0 : (Math.random() > 0.5 ? 1 : -1) * getMag();
    let qBot = isSafe ? 0 : (Math.random() > 0.5 ? 1 : -1) * getMag();
    if (Math.random() < 0.25 && !isSafe) qTop = Math.abs(qTop) * 1.5;
    State.segments.push({ x: x, w: CFG.SEG_LEN, qTop, qBot });
}

function update(dt) {
    State.time += dt; State.speed += CFG.SCROLL_ACCEL * dt; State.distance += State.speed * dt;
    State.score = Math.floor(State.distance / 10);

    const lastSeg = State.segments[State.segments.length - 1];
    if (lastSeg.x < State.distance + bounds.w + 500) addSegment(lastSeg.x + CFG.SEG_LEN);
    if (State.segments[0].x + CFG.SEG_LEN < State.distance - 1000) State.segments.shift();

    const p = State.player;
    const currSeg = State.segments.find(s => s.x <= State.distance + 200 && s.x + CFG.SEG_LEN > State.distance + 200) || State.segments[0];

    let thrust = 0;
    if (Input.up) thrust -= CFG.THRUST;
    if (Input.down) thrust += CFG.THRUST;

    const distScale = CFG.DIST_SCALE;
    const dTop = (p.y - (-CFG.WALL_GAP / 2));
    const dBot = ((CFG.WALL_GAP / 2) - p.y);
    const dtS = Math.max(5, dTop) / distScale;
    const dbS = Math.max(5, dBot) / distScale;

    const K_LIKE = CFG.K_LIKE_BASE * CFG.DIELECTRIC_MULT;

    const F_Top_C = (CFG.K_COULOMB * currSeg.qTop) / (dtS * dtS);
    const F_Top_P = (K_LIKE * currSeg.qTop * currSeg.qTop) / (dtS * dtS * dtS);
    const F_Top = F_Top_C - F_Top_P;

    const F_Bot_C = (CFG.K_COULOMB * currSeg.qBot) / (dbS * dbS);
    const F_Bot_P = (K_LIKE * currSeg.qBot * currSeg.qBot) / (dbS * dbS * dbS);
    const F_Bot_Net = -((CFG.K_COULOMB * currSeg.qBot) / (dbS * dbS)) + F_Bot_P;

    const totalAy = CFG.GRAVITY + thrust + F_Top + F_Bot_Net;

    State.forces.topC = Math.abs(F_Top_C); State.forces.topP = Math.abs(F_Top_P);
    State.forces.botC = Math.abs(F_Bot_C); State.forces.botP = Math.abs(F_Bot_P);

    p.vy += totalAy * dt;
    p.vy *= Math.exp(-CFG.DRAG * dt);
    p.y += p.vy * dt;

    State.trail.push({ x: State.distance + getAnchorX(), y: p.y });
    if (State.trail.length > 100) State.trail.shift();

    if (Input.up || Input.down) {
        if (Math.random() < 0.6) {
            const exhaustDir = Input.up ? 1 : -1;
            State.particles.push({
                x: State.distance + getAnchorX(), y: p.y, vx: -State.speed - Math.random() * 50,
                vy: exhaustDir * (100 + Math.random() * 100), life: 0.8, color: Input.up ? '#0ff' : '#f0f'
            });
            Audio.sfxThrust();
        }
    }

    for (let i = State.particles.length - 1; i >= 0; i--) {
        let pt = State.particles[i]; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt * 2.5;
        if (pt.life <= 0) State.particles.splice(i, 1);
    }

    if (p.y < -CFG.WALL_GAP / 2 + 20 || p.y > CFG.WALL_GAP / 2 - 20) gameOver();

    if (uiScore) uiScore.innerText = State.score;
    if (uiSpeed) uiSpeed.innerText = Math.floor(State.speed);
    const netF = (F_Top + F_Bot_Net);
    if (uiField) {
        uiField.innerText = netF.toFixed(0);
        uiField.style.color = Math.abs(netF) > 1000 ? '#ff0055' : '#00f3ff';
    }
}

function gameOver() {
    State.active = false; State.over = true;
    Audio.sfxCrash();

    const finalScore = State.score;
    // Determine pilot name: prefer input value, else stored name, else 'guest'
    const pilotName = (pNameInput && pNameInput.value && pNameInput.value.trim().length > 0)
        ? pNameInput.value.trim()
        : (localStorage.getItem("ion_runner_name") || "guest");

    if (overlayGO) overlayGO.classList.remove('hidden');
    // show last run score in the overlay
    showLastScore(finalScore);
    try { loadGlobalScores(); } catch (e) { console.warn('Could not load global scores', e); }

    if (db && finalScore > 0) {
        db.collection("scores").add({
            name: pilotName,
            score: finalScore,
            date: firebase.firestore.FieldValue.serverTimestamp()
        })
            .then(() => { console.log("Pontuação salva!"); })
            .catch((error) => {
                // Log técnico no console para debug
                console.error("Database Write Error:", error);

                alert("Error: Score submission failed.");

                // Volta ao menu para tentar novamente
                goToMenu();
            });
    }
}

// ==========================================
// 4. RENDERER
// ==========================================
function render() {
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, bounds.w, bounds.h);

    const cx = bounds.w / 2;
    const cy = bounds.h / 2;
    const anchorX = getAnchorX();

    // Grid (adaptive step for small screens)
    ctx.save();
    ctx.strokeStyle = "rgba(0, 243, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridStep = (bounds.w && bounds.w < 600) ? 120 : 100;
    const gridOff = -(State.distance % gridStep);
    for (let i = 0; i < bounds.w / gridStep + 2; i++) {
        let gx = i * gridStep + gridOff;
        ctx.moveTo(gx, 0); ctx.lineTo(gx, bounds.h);
    }
    for (let i = 0; i < bounds.h / gridStep; i++) {
        ctx.moveTo(0, i * gridStep); ctx.lineTo(bounds.w, i * gridStep);
    }
    ctx.stroke();
    ctx.restore();

    // Identify current segment
    const currentSegment = State.segments.find(s => s.x <= State.distance + 200 && s.x + CFG.SEG_LEN > State.distance + 200) || State.segments[0];

    // Walls
    const wallDepth = Math.max(36, Math.min(80, Math.floor(bounds.w * 0.05))); // scale with width
    const viewTilt = 0.4;

    if (State.segments.length > 0) {
        State.segments.forEach(s => {
            const x1 = (s.x - State.distance) + anchorX;
            const x2 = (s.x + CFG.SEG_LEN - State.distance) + anchorX;

            // dynamic culling based on viewport width to avoid hiding segments on narrow screens
            const cullPad = Math.max(200, Math.floor(bounds.w * 0.6));
            if (x2 < -cullPad || x1 > bounds.w + cullPad) return;

            const gap = Math.min(CFG.WALL_GAP, Math.max(220, Math.floor(bounds.h * 0.45)));
            const yTop = cy - gap / 2;
            const yBot = cy + gap / 2;
            const hWall = Math.max(80, Math.min(200, Math.floor(bounds.h * 0.22))); // scale for small screens

            const isActiveSegment = (s === currentSegment);

            const getC = (q) => {
                if (q === 0) return [60, 60, 70];
                if (q > 0) return [0, 243, 255];
                return [255, 0, 85];
            };

            const drawBlock = (yBase, h, q, isCeiling) => {
                let c = getC(q);
                let intensity = Math.min(1, Math.abs(q) / 10);
                let alpha = (q === 0) ? 0.8 : (0.3 + 0.7 * intensity);

                let isLCA = false;
                if (isActiveSegment && q > 0) {
                    if (isCeiling) { if (State.forces.topP > State.forces.topC) isLCA = true; }
                    else { if (State.forces.botP > State.forces.botC) isLCA = true; }
                }

                let colStr;
                if (isLCA) { colStr = "rgba(255, 255, 255, 1.0)"; alpha = 1.0; }
                else { colStr = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; }

                const offX = wallDepth;
                const offY = isCeiling ? wallDepth * viewTilt : -wallDepth * viewTilt;
                const yEdge = yBase;
                const yFar = isCeiling ? yBase - h : yBase + h;

                // Draw 3D side
                ctx.beginPath();
                ctx.moveTo(x1, yEdge);
                ctx.lineTo(x2, yEdge);
                ctx.lineTo(x2 + offX, yEdge + offY);
                ctx.lineTo(x1 + offX, yEdge + offY);
                ctx.closePath();
                if (isLCA) ctx.fillStyle = "#ccc";
                else ctx.fillStyle = `rgba(${c[0] * 0.5},${c[1] * 0.5},${c[2] * 0.5},${alpha})`;
                ctx.fill();
                ctx.strokeStyle = colStr; ctx.lineWidth = 1; ctx.stroke();

                // Draw Front Face
                ctx.beginPath();
                ctx.moveTo(x1, yEdge);
                ctx.lineTo(x2, yEdge);
                ctx.lineTo(x2, yFar);
                ctx.lineTo(x1, yFar);
                ctx.closePath();

                if (Math.abs(q) > 0) {
                    ctx.shadowBlur = isLCA ? 40 : (20 + Math.abs(q) * 2);
                    ctx.shadowColor = colStr;
                }

                if (isLCA) ctx.fillStyle = "#fff";
                else ctx.fillStyle = `rgba(${c[0] * 0.2},${c[1] * 0.2},${c[2] * 0.2}, 0.9)`;

                ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;

                if (Math.abs(q) > 0) {
                    ctx.fillStyle = isLCA ? "#000" : "#fff";
                    // Responsive font: base on wall width and screen size to avoid clipping on small devices
                    const wallW = Math.max(24, Math.abs(x2 - x1));
                    const fontSize = Math.max(10, Math.min(24, Math.floor(wallW * 0.12)));
                    ctx.font = `bold ${fontSize}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const label = (q > 0 ? "+" + q.toFixed(0) : q.toFixed(0));
                    // ensure text fits front face width
                    try { ctx.fillText(label, (x1 + x2) / 2, (yEdge + yFar) / 2, Math.max(8, wallW - 8)); } catch (e) { ctx.fillText(label, (x1 + x2) / 2, (yEdge + yFar) / 2); }
                }
            };
            drawBlock(yTop, hWall, s.qTop, true);
            drawBlock(yBot, hWall, s.qBot, false);
        });
    }

    // Trail
    if (State.trail.length > 1) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#00f3ff";
        ctx.strokeStyle = "rgba(0, 243, 255, 0.2)";
        ctx.lineWidth = 6;
        for (let i = 0; i < State.trail.length; i++) {
            const p = State.trail[i];
            const sx = (p.x - State.distance);
            const sy = cy + p.y;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.lineWidth = 3;
        for (let i = 1; i < State.trail.length; i++) {
            const p1 = State.trail[i - 1];
            const p2 = State.trail[i];
            const sx1 = (p1.x - State.distance);
            const sy1 = cy + p1.y;
            const sx2 = (p2.x - State.distance);
            const sy2 = cy + p2.y;
            const alpha = (i / State.trail.length);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            ctx.strokeStyle = `rgba(0, 243, 255, ${alpha})`;
            ctx.stroke();
        }
        ctx.restore();
    }

    // Particles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let p of State.particles) {
        const ppx = (p.x - State.distance);
        const ppy = cy + p.y;
        if (ppx < -50 || ppx > bounds.w + 50) continue;

        ctx.beginPath();
        ctx.arc(ppx, ppy, 3 * p.life, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fill();
    }
    ctx.restore();

    // PLAYER RENDER
    const px = anchorX;
    const py = cy + State.player.y;

    ctx.save();

    ctx.shadowBlur = 20;
    ctx.shadowColor = "#fff";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 40;
    ctx.shadowColor = "#00f3ff";
    ctx.strokeStyle = "#00f3ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 16 + Math.sin(Date.now() / 100) * 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+1", px, py);

    ctx.restore();
}

function loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (State.lastTime || now)) / 1000);
    State.lastTime = now;

    // If we're in menu (start/info overlay visible) and game is not active, throttle render to save CPU on mobile.
    const menuVisible = (overlayStart && !overlayStart.classList.contains('hidden')) || (overlayInfo && !overlayInfo.classList.contains('hidden'));
    if (!State.active && menuVisible) {
        const since = now - (State.menuLastRender || 0);
        if (since < 120) { requestAnimationFrame(loop); return; }
        State.menuLastRender = now;
    }

    if (State.active) update(dt);

    try { Audio.playBGM(); } catch (e) { /* fail silently */ }
    try { render(); } catch (e) { console.error('Render error', e); }
    requestAnimationFrame(loop);
}

// Initial physics setup (so menu isn't empty)
resetPhysics();
loop();

// Mobile hint helper (creates element once)
function showMobileHint(text, ms = 3800) {
    try {
        let el = document.getElementById('mobileHint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mobileHint';
            el.className = 'mobile-hint hidden';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.classList.remove('hidden');
        window.clearTimeout(el._hideTimeout);
        el._hideTimeout = window.setTimeout(() => { if (el) el.classList.add('hidden'); }, ms);
    } catch (e) { console.warn('Could not show mobile hint', e); }
}

// Show last run score in Game Over overlay
function showLastScore(score) {
    try {
        if (!overlayGO) return;
        let el = document.getElementById('lastRunScore');
        if (!el) {
            el = document.createElement('div');
            el.id = 'lastRunScore';
            el.className = 'last-score';
            // insert at top of overlayGO content (after title)
            const inner = overlayGO.querySelector('.highscores') || overlayGO.querySelector('.btn-row') || overlayGO.firstChild;
            overlayGO.insertBefore(el, inner);
        }
        el.textContent = `Score: ${score}`;
    } catch (e) { console.warn('Could not show last score', e); }
}