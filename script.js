// ==============================================
// RACETRACKER PRO v2 - OTIMIZADO E CORRIGIDO
// ==============================================

const CFG = {
    BIN_ID: "6a068283250b1311c3512d3a",
    MASTER_KEY: "$2a$10$zfLo4xQ0.IvfaaQaJbTDle3OU9eW24NU.iN7JbK9Ph9OpF0MiuRRu",
    API: "https://api.jsonbin.io/v3/b/",
    POLL: 2500,
    GPS_MIN: 0.001,
};

// ======= ESTADO =======
const S = {
    role: null, room: null, rid: null, rname: null,
    data: null, gpsId: null, pollId: null, tickId: null,
    t0: null, paused: 0,
    lastPos: null, dist: 0, trail: [],
    maps: {}, markers: {}, lines: {},
    routePts: [],
    // voice
    mic: false, ptt: false, cont: false,
    recorder: null, stream: null, actx: null, analyser: null,
    recording: false, chunks: [], contInt: null, vizRaf: null,
    lastMsg: null, lastAud: null,
    busy: false,
};

const COLORS = ['#00d4ff','#7c3aed','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#84cc16','#f97316','#8b5cf6','#14b8a6','#e11d48','#0ea5e9','#a855f7','#22c55e'];

// ======= INIT =======
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const ls = document.getElementById('loading-screen');
        ls.classList.add('fade');
        setTimeout(() => { ls.classList.add('hidden'); show('main-menu'); }, 500);
    }, 2000);
    mkParticles();
    checkConn();
});

function mkParticles() {
    const c = document.getElementById('particles');
    for (let i = 0; i < 25; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.cssText = `left:${Math.random()*100}%;width:${2+Math.random()*2}px;height:${2+Math.random()*2}px;animation-duration:${6+Math.random()*8}s;animation-delay:${Math.random()*4}s;`;
        c.appendChild(p);
    }
}

async function checkConn() {
    const d = document.getElementById('conn-dot');
    const t = document.getElementById('conn-text');
    try {
        const r = await apiFetch('GET');
        if (r) { d.className = 'status-dot on'; t.textContent = 'Conectado'; }
        else throw 0;
    } catch {
        d.className = 'status-dot off'; t.textContent = 'Offline';
    }
}

// ======= HELPERS =======
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function $(id) { return document.getElementById(id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function pad(n) { return n.toString().padStart(2, '0'); }

function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`;
}
function fmtShort(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s/60))}:${pad(s%60)}`;
}

function toast(msg, type = 'inf') {
    const ic = { ok:'fa-check-circle', err:'fa-exclamation-circle', inf:'fa-info-circle', wrn:'fa-exclamation-triangle' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fas ${ic[type]}"></i><span>${msg}</span>`;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'all .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; setTimeout(() => el.remove(), 300); }, 3000);
}

function mkCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r = 'RACE-';
    for (let i = 0; i < 6; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
}

function haversine(a, b, c, d) {
    const R = 6371, dL = (c-a)*Math.PI/180, dN = (d-b)*Math.PI/180;
    const x = Math.sin(dL/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function beep() {
    try {
        const c = new (window.AudioContext||window.webkitAudioContext)();
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.frequency.setValueAtTime(880, c.currentTime);
        o.frequency.setValueAtTime(1100, c.currentTime + .1);
        g.gain.setValueAtTime(.2, c.currentTime);
        g.gain.exponentialRampToValueAtTime(.01, c.currentTime + .3);
        o.start(); o.stop(c.currentTime + .3);
    } catch {}
}

// ======= API (com retry e debounce) =======
let lastWrite = 0;

async function apiFetch(method, body) {
    const url = CFG.API + CFG.BIN_ID + (method === 'GET' ? '/latest' : '');
    const opts = {
        method: method === 'GET' ? 'GET' : 'PUT',
        headers: { 'X-Master-Key': CFG.MASTER_KEY },
    };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetch(url, opts);
            if (!r.ok) throw new Error(r.status);
            const j = await r.json();
            return method === 'GET' ? j.record : true;
        } catch (e) {
            if (i < 2) await new Promise(r => setTimeout(r, 500 * (i + 1)));
            else { console.error('API fail:', e); return null; }
        }
    }
}

async function readData() {
    return await apiFetch('GET');
}

async function writeData(data) {
    const now = Date.now();
    if (now - lastWrite < 400) {
        await new Promise(r => setTimeout(r, 400 - (now - lastWrite)));
    }
    lastWrite = Date.now();
    return await apiFetch('PUT', data);
}

async function safeUpdate(fn) {
    if (S.busy) return false;
    S.busy = true;
    try {
        const data = await readData();
        if (!data) { S.busy = false; return false; }
        const room = data.rooms?.[S.room];
        if (!room) { S.busy = false; return false; }
        fn(data, room);
        const ok = await writeData(data);
        S.busy = false;
        return ok;
    } catch (e) {
        console.error('safeUpdate:', e);
        S.busy = false;
        return false;
    }
}

// ======= MODALS =======
function showCreateRoom() { show('create-modal'); setTimeout(initRouteMap, 150); }
function showJoinRoom() { show('join-modal'); }
function closeModals() { hide('create-modal'); hide('join-modal'); }

// ======= ROUTE MAP =======
function initRouteMap() {
    if (S.maps.route) { S.maps.route.invalidateSize(); return; }
    S.maps.route = L.map('route-map').setView([-23.55, -46.63], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(S.maps.route);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
            S.maps.route.setView([p.coords.latitude, p.coords.longitude], 15);
        }, () => {}, { timeout: 5000 });
    }

    S.maps.route.on('click', e => {
        S.routePts.push([e.latlng.lat, e.latlng.lng]);
        const n = S.routePts.length;
        const ic = L.divIcon({
            className: 'custom-marker',
            html: `<div class="mk-dot" style="background:${n===1?'#10b981':'#00d4ff'};border-color:${n===1?'#10b981':'#00d4ff'}"><span class="mk-label">${n===1?'🏁 INÍCIO':'P'+n}</span></div>`,
            iconSize: [18,18], iconAnchor: [9,9]
        });
        L.marker(e.latlng, { icon: ic }).addTo(S.maps.route);
        if (S.lines.route) S.maps.route.removeLayer(S.lines.route);
        if (n > 1) S.lines.route = L.polyline(S.routePts, { color: '#00d4ff', weight: 3, dashArray: '8,8' }).addTo(S.maps.route);
    });
}

function clearRoute() {
    S.routePts = [];
    if (S.maps.route) {
        S.maps.route.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline) S.maps.route.removeLayer(l); });
    }
    S.lines.route = null;
    toast('Trajeto limpo', 'inf');
}

// ======= CREATE ROOM =======
async function createRoom() {
    const name = $('race-name').value.trim();
    const dist = parseFloat($('race-distance').value);
    const type = $('race-type').value;
    const max = parseInt($('max-runners').value) || 20;

    if (!name) return toast('Nome obrigatório', 'err');
    if (!dist || dist <= 0) return toast('Distância inválida', 'err');

    const btn = $('create-btn');
    btn.classList.add('loading'); btn.disabled = true;

    const code = mkCode();
    const roomData = {
        name, distance: dist, type, maxRunners: max,
        route: S.routePts, status: 'waiting',
        created: Date.now(), startTime: null, pausedTime: 0,
        runners: {}, messages: [], audioData: null, audioId: null, transmitting: false,
    };

    const data = await readData() || {};
    if (!data.rooms) data.rooms = {};
    data.rooms[code] = roomData;

    const ok = await writeData(data);
    btn.classList.remove('loading'); btn.disabled = false;

    if (ok) {
        S.role = 'admin'; S.room = code; S.data = roomData;
        closeModals();
        initAdminScreen();
        toast(`Sala ${code} criada!`, 'ok');
    } else {
        toast('Erro ao criar sala', 'err');
    }
}

// ======= JOIN ROOM =======
async function joinRoom() {
    const code = $('room-code').value.trim().toUpperCase();
    const name = $('runner-name').value.trim();

    if (!code) return toast('Código obrigatório', 'err');
    if (!name) return toast('Nome obrigatório', 'err');
    if (!navigator.geolocation) return toast('GPS não disponível', 'err');

    const btn = $('join-btn');
    btn.classList.add('loading'); btn.disabled = true;

    const data = await readData();
    btn.classList.remove('loading'); btn.disabled = false;

    if (!data?.rooms?.[code]) return toast('Sala não encontrada', 'err');

    const room = data.rooms[code];
    if (room.status === 'finished') return toast('Corrida já finalizada', 'err');
    if (Object.keys(room.runners || {}).length >= room.maxRunners) return toast('Sala cheia', 'err');

    const rid = 'r_' + uid();
    if (!room.runners) room.runners = {};
    room.runners[rid] = {
        name, joined: Date.now(),
        lat: 0, lng: 0, speed: 0, distance: 0,
        lastUpdate: Date.now(), active: true, finished: false,
    };

    const ok = await writeData(data);
    if (ok) {
        S.role = 'runner'; S.room = code; S.rid = rid; S.rname = name; S.data = room;
        closeModals();
        initRunnerScreen();
        toast(`Bem-vindo, ${name}! 🏃`, 'ok');
    } else {
        toast('Erro ao entrar', 'err');
    }
}

// ======= ADMIN SCREEN =======
function initAdminScreen() {
    hide('main-menu'); show('admin-screen');

    $('admin-room-code').textContent = S.room;
    $('info-name').textContent = S.data.name;
    $('info-dist').textContent = S.data.distance + ' km';
    $('info-type').textContent = { linear: 'Linear', circular: 'Circular', free: 'Livre' }[S.data.type];

    setTimeout(initAdminMap, 150);
    startPolling();
}

function initAdminMap() {
    if (S.maps.admin) return;
    S.maps.admin = L.map('admin-map').setView([-23.55, -46.63], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(S.maps.admin);

    if (S.data.route?.length) {
        const line = L.polyline(S.data.route, { color: '#00d4ff', weight: 4, opacity: .5, dashArray: '10,10' }).addTo(S.maps.admin);

        const mkIc = (c, txt) => L.divIcon({
            className: 'custom-marker',
            html: `<div class="mk-dot" style="background:${c};border-color:${c}"><span class="mk-label">${txt}</span></div>`,
            iconSize: [18,18], iconAnchor: [9,9]
        });

        L.marker(S.data.route[0], { icon: mkIc('#10b981', '🏁 INÍCIO') }).addTo(S.maps.admin);
        if (S.data.route.length > 1) {
            L.marker(S.data.route[S.data.route.length - 1], { icon: mkIc('#ef4444', '🏁 FIM') }).addTo(S.maps.admin);
        }
        S.maps.admin.fitBounds(line.getBounds().pad(0.2));
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
            S.maps.admin.setView([p.coords.latitude, p.coords.longitude], 15);
        }, () => {}, { timeout: 5000 });
    }
}

// ======= POLLING =======
function startPolling() {
    S.pollId = setInterval(async () => {
        const data = await readData();
        if (!data?.rooms?.[S.room]) return;
        S.data = data.rooms[S.room];

        if (S.role === 'admin') updateAdmin();
        else updateRunner();
    }, CFG.POLL);
}

function updateAdmin() {
    const runners = S.data.runners || {};
    const n = Object.keys(runners).length;
    $('info-count').textContent = `${n}/${S.data.maxRunners}`;

    // Ranking
    const el = $('ranking');
    if (!n) { el.innerHTML = '<div class="empty"><i class="fas fa-users"></i><p>Aguardando...</p></div>'; return; }

    const sorted = Object.entries(runners).sort((a, b) => (b[1].distance||0) - (a[1].distance||0));
    el.innerHTML = sorted.map(([id, r], i) => {
        const cls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
        const dot = (Date.now() - (r.lastUpdate||0)) < 10000 ? 'on' : 'off';
        return `<div class="rank ${cls}">
            <div class="rank-pos">${i+1}</div>
            <div class="rank-info"><div class="rank-name">${r.name}</div>
            <div class="rank-meta"><span>🏃${(r.speed||0).toFixed(1)}</span><span>📏${(r.distance||0).toFixed(2)}km</span></div></div>
            <div class="rank-dot ${dot}"></div></div>`;
    }).join('');

    // Markers
    sorted.forEach(([id, r], i) => {
        if (!r.lat || !r.lng) return;
        const c = COLORS[i % COLORS.length];
        const ic = L.divIcon({
            className: 'custom-marker',
            html: `<div class="mk-dot" style="background:${c};border-color:${c}"><span class="mk-label">${r.name}</span></div>`,
            iconSize: [18,18], iconAnchor: [9,9]
        });
        if (S.markers[id]) { S.markers[id].setLatLng([r.lat, r.lng]).setIcon(ic); }
        else { S.markers[id] = L.marker([r.lat, r.lng], { icon: ic }).addTo(S.maps.admin); }
    });
}

// ======= RACE CONTROLS =======
async function startRace() {
    const ok = await safeUpdate((data, room) => {
        if (!Object.keys(room.runners || {}).length) throw 'empty';
        room.status = 'running';
        room.startTime = Date.now();
        room.messages.push({ id: uid(), text: '🏁 LARGADA! BOA CORRIDA!', ts: Date.now() });
    });

    if (ok) {
        S.t0 = Date.now();
        hide('btn-start'); show('btn-pause'); show('btn-finish');
        $('status-badge').textContent = '🟢 EM ANDAMENTO';
        $('status-badge').className = 'status-badge go';
        startTick();
        toast('🏁 LARGADA!', 'ok');
    } else {
        toast('Sem corredores na sala', 'wrn');
    }
}

async function pauseRace() {
    await safeUpdate((data, room) => {
        room.status = 'paused';
        room.pausedAt = Date.now();
    });
    hide('btn-pause'); show('btn-resume');
    clearInterval(S.tickId);
    $('status-badge').textContent = '⏸ PAUSADA';
    $('status-badge').className = 'status-badge';
    toast('Pausada', 'wrn');
}

async function resumeRace() {
    await safeUpdate((data, room) => {
        room.pausedTime = (room.pausedTime || 0) + (Date.now() - (room.pausedAt || Date.now()));
        room.status = 'running';
        delete room.pausedAt;
    });
    hide('btn-resume'); show('btn-pause');
    const d = await readData();
    if (d?.rooms?.[S.room]) { S.data = d.rooms[S.room]; S.paused = S.data.pausedTime || 0; }
    startTick();
    $('status-badge').textContent = '🟢 EM ANDAMENTO';
    $('status-badge').className = 'status-badge go';
    toast('Retomada', 'ok');
}

async function finishRace() {
    if (!confirm('Finalizar a corrida?')) return;
    await safeUpdate((data, room) => { room.status = 'finished'; room.finishedAt = Date.now(); });
    clearInterval(S.tickId); clearInterval(S.pollId);
    stopVoice();
    $('status-badge').textContent = '🏁 FINALIZADA';
    $('status-badge').className = 'status-badge end';
    toast('Finalizada!', 'ok');
    const d = await readData();
    if (d?.rooms?.[S.room]) S.data = d.rooms[S.room];
    setTimeout(showResults, 1200);
}

async function endRace() {
    if (!confirm('Encerrar e excluir a sala?')) return;
    clearInterval(S.tickId); clearInterval(S.pollId); stopVoice();
    const data = await readData();
    if (data?.rooms?.[S.room]) { delete data.rooms[S.room]; await writeData(data); }
    goHome();
    toast('Sala encerrada', 'inf');
}

function copyCode() {
    navigator.clipboard?.writeText(S.room).then(() => toast('Copiado!', 'ok')).catch(() => toast('Erro', 'err'));
}

function startTick() {
    if (!S.t0) { S.t0 = S.data.startTime; S.paused = S.data.pausedTime || 0; }
    clearInterval(S.tickId);
    S.tickId = setInterval(() => {
        $('race-timer').textContent = fmtTime(Date.now() - S.t0 - S.paused);
    }, 200);
}

// ======= 🎙️ VOICE SYSTEM =======
async function initMic() {
    try {
        S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        S.actx = new (window.AudioContext || window.webkitAudioContext)();
        S.analyser = S.actx.createAnalyser();
        S.analyser.fftSize = 128;
        S.actx.createMediaStreamSource(S.stream).connect(S.analyser);
        return true;
    } catch (e) {
        toast('Mic: ' + e.message, 'err');
        return false;
    }
}

async function toggleMic() {
    const btn = $('mic-btn'), st = $('voice-status');
    if (!S.mic) {
        if (!(await initMic())) return;
        S.mic = true;
        btn.classList.add('on');
        st.innerHTML = '<i class="fas fa-microphone"></i><span>Mic ativo</span>';
        st.className = 'voice-status on';
        if (S.cont) startContRec();
        toast('🎙️ Mic ativado', 'ok');
    } else {
        stopVoice();
        S.mic = false;
        btn.classList.remove('on');
        st.innerHTML = '<i class="fas fa-microphone-slash"></i><span>Mic desligado</span>';
        st.className = 'voice-status';
    }
}

function toggleContinuous() {
    S.cont = $('continuous-mode').checked;
    const p = $('ptt-btn');
    if (S.cont) { p.style.opacity = '.4'; p.style.pointerEvents = 'none'; if (S.mic) startContRec(); }
    else { p.style.opacity = '1'; p.style.pointerEvents = 'auto'; stopRec(); }
}

function pttStart(e) { if (e) e.preventDefault(); if (!S.mic || S.cont) return; $('ptt-btn').classList.add('on'); startRec(); }
function pttStop(e) { if (e) e.preventDefault(); if (!S.mic || S.cont) return; $('ptt-btn').classList.remove('on'); stopRec(); }

function startRec() {
    if (!S.stream || S.recording) return;
    S.recording = true; S.chunks = [];

    try {
        S.recorder = new MediaRecorder(S.stream, { mimeType: 'audio/webm;codecs=opus' });
    } catch {
        S.recorder = new MediaRecorder(S.stream);
    }

    S.recorder.ondataavailable = e => { if (e.data.size > 0) S.chunks.push(e.data); };
    S.recorder.onstop = () => { if (S.chunks.length) sendAudio(new Blob(S.chunks, { type: 'audio/webm' })); };
    S.recorder.start(300);

    drawViz();
    setTx(true);

    $('voice-status').innerHTML = '<i class="fas fa-circle" style="color:var(--err)"></i><span>🔴 Transmitindo...</span>';
    $('voice-status').className = 'voice-status rec';
}

function stopRec() {
    if (!S.recording) return;
    S.recording = false;
    if (S.recorder?.state !== 'inactive') S.recorder?.stop();
    cancelAnimationFrame(S.vizRaf);
    clearCanvas();
    setTx(false);

    if (S.mic) {
        $('voice-status').innerHTML = '<i class="fas fa-microphone"></i><span>Mic ativo</span>';
        $('voice-status').className = 'voice-status on';
    }
}

function startContRec() {
    startRec();
    S.contInt = setInterval(() => {
        if (S.recording && S.recorder?.state === 'recording') {
            S.recorder.stop();
            setTimeout(() => { if (S.mic && S.cont) startRec(); }, 100);
        }
    }, 3000);
}

function stopVoice() {
    stopRec();
    clearInterval(S.contInt);
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
    if (S.actx) { S.actx.close().catch(()=>{}); S.actx = null; S.analyser = null; }
}

function drawViz() {
    if (!S.analyser) return;
    const canvas = $('viz-canvas');
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(S.analyser.frequencyBinCount);

    function frame() {
        S.vizRaf = requestAnimationFrame(frame);
        S.analyser.getByteFrequencyData(buf);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const bars = 24, w = canvas.width / bars, gap = 2;

        for (let i = 0; i < bars; i++) {
            const idx = Math.floor(i * buf.length / bars);
            const v = buf[idx] / 255;
            const h = Math.max(2, v * canvas.height);

            let color = '#00d4ff';
            if (v > .7) color = '#ef4444';
            else if (v > .4) color = '#f59e0b';

            ctx.fillStyle = color;
            ctx.fillRect(i * w + gap, canvas.height - h, w - gap * 2, h);
        }
    }
    frame();
}

function clearCanvas() {
    const c = $('viz-canvas');
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

async function sendAudio(blob) {
    const reader = new FileReader();
    reader.onloadend = async () => {
        await safeUpdate((data, room) => {
            room.audioData = reader.result;
            room.audioId = 'a_' + uid();
            room.transmitting = true;
            room.audioTs = Date.now();
        });
    };
    reader.readAsDataURL(blob);
}

async function setTx(on) {
    await safeUpdate((data, room) => { room.transmitting = on; });
}

// ======= MESSAGES =======
async function sendMsg(text) {
    const ok = await safeUpdate((data, room) => {
        if (!room.messages) room.messages = [];
        room.messages.push({ id: uid(), text, ts: Date.now() });
        if (room.messages.length > 15) room.messages = room.messages.slice(-15);
    });
    if (ok) toast(`📢 "${text}"`, 'ok');
}

function sendCustom() {
    const v = $('custom-input').value.trim();
    if (!v) return toast('Digite algo', 'wrn');
    sendMsg('📢 ' + v);
    $('custom-input').value = '';
}

// ======= RUNNER SCREEN =======
function initRunnerScreen() {
    hide('main-menu'); show('runner-screen');
    $('r-name-nav').textContent = S.rname;
    setTimeout(initRunnerMap, 150);
    startGPS();
    startPolling();
}

function initRunnerMap() {
    if (S.maps.runner) return;
    S.maps.runner = L.map('runner-map').setView([-23.55, -46.63], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(S.maps.runner);
    if (S.data.route?.length > 1) {
        L.polyline(S.data.route, { color: '#00d4ff', weight: 3, opacity: .4, dashArray: '8,8' }).addTo(S.maps.runner);
    }
}

function startGPS() {
    S.gpsId = navigator.geolocation.watchPosition(
        pos => {
            const { latitude: lat, longitude: lng, speed: sp } = pos.coords;
            if (S.lastPos) {
                const d = haversine(S.lastPos.lat, S.lastPos.lng, lat, lng);
                if (d > CFG.GPS_MIN) { S.dist += d; S.trail.push([lat, lng]); }
            } else { S.trail.push([lat, lng]); }

            S.lastPos = { lat, lng };
            const speed = sp ? sp * 3.6 : 0;

            $('s-speed').textContent = speed.toFixed(1);
            $('s-dist').textContent = S.dist.toFixed(2);

            if (S.maps.runner) {
                S.maps.runner.setView([lat, lng]);
                const ic = L.divIcon({
                    className: 'custom-marker',
                    html: '<div class="mk-dot" style="background:#00d4ff;border-color:#00d4ff"><span class="mk-label">Você</span></div>',
                    iconSize: [18,18], iconAnchor: [9,9]
                });
                if (S.markers.me) S.markers.me.setLatLng([lat, lng]).setIcon(ic);
                else S.markers.me = L.marker([lat, lng], { icon: ic }).addTo(S.maps.runner);

                if (S.trail.length > 1) {
                    if (S.lines.trail) S.maps.runner.removeLayer(S.lines.trail);
                    S.lines.trail = L.polyline(S.trail, { color: '#00d4ff', weight: 3, opacity: .7 }).addTo(S.maps.runner);
                }
            }

            // Enviar posição (debounced pelo safeUpdate)
            safeUpdate((data, room) => {
                const r = room.runners?.[S.rid];
                if (!r) return;
                r.lat = lat; r.lng = lng; r.speed = speed;
                r.distance = S.dist; r.lastUpdate = Date.now(); r.active = true;
            });
        },
        e => toast('GPS: ' + e.message, 'err'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
}

function updateRunner() {
    const room = S.data;
    const st = $('race-st');

    if (room.status === 'running') {
        st.className = 'race-st go';
        st.innerHTML = '<i class="fas fa-flag-checkered"></i> CORRIDA EM ANDAMENTO!';
        $('s-time').textContent = fmtShort(Date.now() - room.startTime - (room.pausedTime || 0));
    } else if (room.status === 'waiting') {
        st.className = 'race-st';
        st.innerHTML = '<i class="fas fa-hourglass-half"></i> Aguardando largada...';
    } else if (room.status === 'paused') {
        st.className = 'race-st';
        st.innerHTML = '<i class="fas fa-pause-circle"></i> Pausada';
    } else if (room.status === 'finished') {
        st.className = 'race-st done';
        st.innerHTML = '<i class="fas fa-trophy"></i> Finalizada!';
        clearInterval(S.pollId);
        if (S.gpsId) navigator.geolocation.clearWatch(S.gpsId);
        setTimeout(showResults, 1500);
        return;
    }

    // Posição
    const sorted = Object.entries(room.runners || {}).sort((a, b) => (b[1].distance||0) - (a[1].distance||0));
    const idx = sorted.findIndex(([id]) => id === S.rid);
    $('s-pos').textContent = idx >= 0 ? `${idx+1}º` : '-';

    // Áudio
    if (room.audioId && room.audioId !== S.lastAud && room.audioData) {
        S.lastAud = room.audioId;
        const a = $('audio-out');
        a.src = room.audioData;
        a.play().catch(() => {});
    }

    // Transmitting indicator
    const ab = $('audio-bar');
    if (room.transmitting) ab.classList.remove('hidden');
    else ab.classList.add('hidden');

    // Messages
    if (room.messages?.length) {
        const last = room.messages[room.messages.length - 1];
        if (last.id !== S.lastMsg) {
            S.lastMsg = last.id;
            showBanner(last.text);
        }
    }
}

function showBanner(text) {
    $('msg-text').textContent = text;
    $('msg-banner').classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
    beep();
    setTimeout(() => $('msg-banner').classList.add('hidden'), 7000);
}

function closeBanner() { $('msg-banner').classList.add('hidden'); }

// ======= RESULTS =======
function showResults() {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    show('result-screen');

    const runners = S.data.runners || {};
    const sorted = Object.entries(runners).sort((a, b) => (b[1].distance||0) - (a[1].distance||0));

    // Podium
    const podOrder = [1, 0, 2]; // silver, gold, bronze display order
    const podCls = ['silver', 'gold', 'bronze'];
    const podEmoji = ['🥈', '🥇', '🥉'];

    $('podium').innerHTML = podOrder.map(i => {
        const r = sorted[i];
        if (!r) return '';
        return `<div class="pod"><div class="pod-name">${r[1].name}</div><div class="pod-bar ${podCls[i]}">${podEmoji[i]}</div><div class="pod-km">${(r[1].distance||0).toFixed(2)} km</div></div>`;
    }).join('');

    // Full list
    $('results-list').innerHTML = sorted.map(([, r], i) => {
        const cls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
        return `<div class="rank ${cls}"><div class="rank-pos">${i+1}</div><div class="rank-info"><div class="rank-name">${r.name}</div><div class="rank-meta"><span>📏${(r.distance||0).toFixed(2)}km</span><span>🏃${(r.speed||0).toFixed(1)}km/h</span></div></div></div>`;
    }).join('');
}

// ======= HOME =======
function goHome() {
    clearInterval(S.pollId); clearInterval(S.tickId);
    if (S.gpsId) navigator.geolocation.clearWatch(S.gpsId);
    stopVoice();

    Object.keys(S.markers).forEach(k => delete S.markers[k]);
    S.maps = {}; S.lines = {}; S.routePts = [];
    S.dist = 0; S.trail = []; S.lastPos = null; S.paused = 0; S.t0 = null;
    S.mic = false; S.lastMsg = null; S.lastAud = null; S.busy = false;

    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    show('main-menu');

    show('btn-start'); hide('btn-pause'); hide('btn-resume'); hide('btn-finish');
    $('race-timer').textContent = '00:00:00';
    $('status-badge').textContent = '⏳ AGUARDANDO';
    $('status-badge').className = 'status-badge';

    const mb = $('mic-btn');
    if (mb) mb.classList.remove('on');

    checkConn();
}