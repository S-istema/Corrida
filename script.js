// =============================================
// RACETRACKER PRO v3 - ULTRA PROFISSIONAL
// Persistência + Rotas Reais + Zero Reload
// =============================================

const CFG = {
    BIN: "6a068283250b1311c3512d3a",
    KEY: "$2a$10$zfLo4xQ0.IvfaaQaJbTDle3OU9eW24NU.iN7JbK9Ph9OpF0MiuRRu",
    API: "https://api.jsonbin.io/v3/b/",
    POLL: 2500,
    GPS_NOISE: 0.003,
    OSRM: "https://router.project-osrm.org/route/v1/foot/",
};

// ========== STORAGE PERSISTENTE ==========
const Store = {
    save(key, val) { try { localStorage.setItem('rt_' + key, JSON.stringify(val)); } catch {} },
    load(key) { try { return JSON.parse(localStorage.getItem('rt_' + key)); } catch { return null; } },
    clear() { Object.keys(localStorage).filter(k => k.startsWith('rt_')).forEach(k => localStorage.removeItem(k)); }
};

// ========== ESTADO ==========
const S = {
    role: null, room: null, rid: null, rname: null, data: null,
    gpsId: null, pollId: null, tickId: null, t0: null, paused: 0,
    lastPos: null, dist: 0, trail: [], speeds: [],
    maps: {}, markers: {}, lines: {},
    routePts: [], routeCoords: [], routeDist: 0,
    mic: false, ptt: false, cont: false,
    recorder: null, stream: null, actx: null, analyser: null,
    recording: false, chunks: [], contInt: null, vizRaf: null,
    lastMsg: null, lastAud: null, busy: false, lastWrite: 0,
    restored: false,
};

const COLORS = ['#00d4ff','#7c3aed','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#84cc16','#f97316','#8b5cf6','#14b8a6','#e11d48'];

// ========== UTILS ==========
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
const pad = n => n.toString().padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`;
}
function fmtShort(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s/60))}:${pad(s%60)}`;
}
function haversine(a, b, c, d) {
    const R = 6371, dL = (c - a) * Math.PI / 180, dN = (d - b) * Math.PI / 180;
    const x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dN / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function beep(freq = 880, dur = .2) {
    try {
        const c = new AudioContext(), o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.frequency.setValueAtTime(freq, c.currentTime);
        g.gain.setValueAtTime(.15, c.currentTime);
        g.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
        o.start(); o.stop(c.currentTime + dur);
    } catch {}
}

function toast(msg, type = 'in') {
    const ic = { ok: 'fa-check-circle', er: 'fa-times-circle', in: 'fa-info-circle', wn: 'fa-exclamation-triangle' };
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

// ========== VIEW MANAGER (SPA) ==========
const V = {
    current: null,
    history: [],

    go(name, skipHistory) {
        if (this.current === name) return;

        // Cleanup anterior
        if (this.current) {
            const prev = $('v-' + this.current);
            if (prev) { prev.classList.add('fade-out'); setTimeout(() => { prev.classList.add('hidden'); prev.classList.remove('fade-out'); }, 200); }
            if (!skipHistory && this.current !== 'loading') this.history.push(this.current);
        }

        this.current = name;
        setTimeout(() => {
            const el = $('v-' + name);
            if (el) { el.classList.remove('hidden'); el.classList.add('fade-in'); setTimeout(() => el.classList.remove('fade-in'), 300); }

            // Init hooks
            if (name === 'menu') this.initMenu();
            if (name === 'create') Route.init();
            if (name === 'admin') Admin.init();
            if (name === 'runner') Runner.init();
        }, this.current ? 200 : 0);
    },

    back() {
        const prev = this.history.pop();
        if (prev) this.go(prev, true);
        else this.go('menu', true);
    },

    initMenu() {
        BG.init();
        API.check();
    }
};

// Prevenir reload/saída durante corrida
window.addEventListener('beforeunload', e => {
    if (S.role) {
        Store.save('session', { role: S.role, room: S.room, rid: S.rid, rname: S.rname, dist: S.dist, trail: S.trail.slice(-50) });
        e.preventDefault();
        e.returnValue = 'Corrida em andamento! Tem certeza?';
    }
});

// Restaurar sessão
window.addEventListener('popstate', e => { e.preventDefault(); });
window.addEventListener('hashchange', e => { e.preventDefault(); });

// ========== BACKGROUND CANVAS ==========
const BG = {
    ctx: null, w: 0, h: 0, pts: [],
    init() {
        const c = $('bg-canvas');
        if (!c) return;
        this.ctx = c.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.pts = Array.from({ length: 40 }, () => ({
            x: Math.random() * this.w, y: Math.random() * this.h,
            vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
            r: Math.random() * 2 + 1
        }));
        this.draw();
    },
    resize() {
        const c = $('bg-canvas');
        if (!c) return;
        this.w = c.width = c.offsetWidth;
        this.h = c.height = c.offsetHeight;
    },
    draw() {
        if (!this.ctx || V.current !== 'menu') return;
        requestAnimationFrame(() => this.draw());
        this.ctx.clearRect(0, 0, this.w, this.h);
        this.pts.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > this.w) p.vx *= -1;
            if (p.y < 0 || p.y > this.h) p.vy *= -1;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(0,212,255,.15)';
            this.ctx.fill();
        });
        // Lines
        for (let i = 0; i < this.pts.length; i++) {
            for (let j = i + 1; j < this.pts.length; j++) {
                const d = Math.hypot(this.pts[i].x - this.pts[j].x, this.pts[i].y - this.pts[j].y);
                if (d < 120) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.pts[i].x, this.pts[i].y);
                    this.ctx.lineTo(this.pts[j].x, this.pts[j].y);
                    this.ctx.strokeStyle = `rgba(0,212,255,${.06 * (1 - d / 120)})`;
                    this.ctx.stroke();
                }
            }
        }
    }
};

// ========== API ==========
const API = {
    async req(method, body) {
        const url = CFG.API + CFG.BIN + (method === 'GET' ? '/latest' : '');
        const opts = { method: method === 'GET' ? 'GET' : 'PUT', headers: { 'X-Master-Key': CFG.KEY } };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }

        for (let i = 0; i < 3; i++) {
            try {
                const r = await fetch(url, opts);
                if (!r.ok) throw r.status;
                const j = await r.json();
                return method === 'GET' ? j.record : true;
            } catch (e) {
                if (i < 2) await new Promise(r => setTimeout(r, 400 * (i + 1)));
                else return null;
            }
        }
    },
    async read() { return await this.req('GET'); },
    async write(data) {
        const now = Date.now();
        if (now - S.lastWrite < 350) await new Promise(r => setTimeout(r, 350 - (now - S.lastWrite)));
        S.lastWrite = Date.now();
        return await this.req('PUT', data);
    },
    async update(fn) {
        if (S.busy) return false;
        S.busy = true;
        try {
            const data = await this.read();
            if (!data?.rooms?.[S.room]) { S.busy = false; return false; }
            fn(data, data.rooms[S.room]);
            const ok = await this.write(data);
            S.busy = false;
            return ok;
        } catch (e) { S.busy = false; return false; }
    },
    async check() {
        const d = $('dot'), l = $('conn-label');
        try {
            const r = await this.read();
            if (r) { d.className = 'dot on'; l.textContent = 'Online'; return true; }
            throw 0;
        } catch { d.className = 'dot off'; l.textContent = 'Offline'; return false; }
    }
};

// ========== ROUTE BUILDER (OSRM) ==========
const Route = {
    map: null, markers: [], line: null,

    init() {
        if (this.map) { this.map.invalidateSize(); return; }
        this.map = L.map('create-map', { zoomControl: true }).setView([-23.55, -46.63], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(this.map);

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(p => {
                this.map.setView([p.coords.latitude, p.coords.longitude], 15);
            }, () => {}, { timeout: 5000 });
        }

        this.map.on('click', e => this.addPoint(e.latlng.lat, e.latlng.lng));
    },

    addPoint(lat, lng) {
        S.routePts.push([lat, lng]);
        const n = S.routePts.length;
        const color = n === 1 ? '#10b981' : '#00d4ff';
        const label = n === 1 ? '🏁 INÍCIO' : n === S.routePts.length ? '📍 P' + n : '📍 P' + n;

        const ic = L.divIcon({
            className: 'custom-marker',
            html: `<div class="mk" style="background:${color};border-color:${color}"><span class="mk-lbl">${label}</span></div>`,
            iconSize: [16, 16], iconAnchor: [8, 8]
        });
        const marker = L.marker([lat, lng], { icon: ic, draggable: true }).addTo(this.map);
        marker._ptIndex = n - 1;
        marker.on('dragend', e => {
            const pos = e.target.getLatLng();
            S.routePts[e.target._ptIndex] = [pos.lat, pos.lng];
            this.calcRoute();
        });
        this.markers.push(marker);
        this.calcRoute();
    },

    async calcRoute() {
        const type = $('f-type').value;
        if (S.routePts.length < 2) {
            S.routeDist = 0;
            $('route-dist').textContent = '0.00 km';
            $('route-info').classList.add('hidden');
            if (this.line) { this.map.removeLayer(this.line); this.line = null; }
            return;
        }

        let pts = [...S.routePts];
        if (type === 'circular' && pts.length >= 2) pts.push(pts[0]);

        if (type === 'free') {
            // Linha reta
            if (this.line) this.map.removeLayer(this.line);
            this.line = L.polyline(pts, { color: '#00d4ff', weight: 4, opacity: .8 }).addTo(this.map);
            let d = 0;
            for (let i = 1; i < pts.length; i++) d += haversine(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]);
            S.routeDist = d;
            S.routeCoords = pts;
            this.updateInfo(d, pts.length);
        } else {
            // OSRM - rota real por estradas
            try {
                const coords = pts.map(p => `${p[1]},${p[0]}`).join(';');
                const url = `${CFG.OSRM}${coords}?overview=full&geometries=geojson&steps=false`;
                const res = await fetch(url);
                const json = await res.json();

                if (json.code === 'Ok' && json.routes.length) {
                    const route = json.routes[0];
                    const geom = route.geometry.coordinates.map(c => [c[1], c[0]]);

                    if (this.line) this.map.removeLayer(this.line);
                    this.line = L.polyline(geom, { color: '#00d4ff', weight: 4, opacity: .8, smoothFactor: 1 }).addTo(this.map);

                    S.routeDist = route.distance / 1000;
                    S.routeCoords = geom;
                    this.map.fitBounds(this.line.getBounds().pad(0.1));
                    this.updateInfo(S.routeDist, pts.length);
                } else {
                    toast('Rota não encontrada, usando linha reta', 'wn');
                    this.fallbackLine(pts);
                }
            } catch (e) {
                console.warn('OSRM error:', e);
                toast('Calculando rota direta...', 'wn');
                this.fallbackLine(pts);
            }
        }
    },

    fallbackLine(pts) {
        if (this.line) this.map.removeLayer(this.line);
        this.line = L.polyline(pts, { color: '#f59e0b', weight: 3, dashArray: '8,6' }).addTo(this.map);
        let d = 0;
        for (let i = 1; i < pts.length; i++) d += haversine(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]);
        S.routeDist = d;
        S.routeCoords = pts;
        this.updateInfo(d, pts.length);
    },

    updateInfo(dist, pts) {
        $('route-dist').textContent = dist.toFixed(2) + ' km';
        $('ri-dist').textContent = dist.toFixed(2) + ' km';
        $('ri-time').textContent = Math.ceil(dist / 8 * 60) + ' min';
        $('ri-pts').textContent = pts;
        $('route-info').classList.remove('hidden');
    },

    undo() {
        if (!S.routePts.length) return;
        S.routePts.pop();
        const m = this.markers.pop();
        if (m) this.map.removeLayer(m);
        this.calcRoute();
    },

    clear() {
        S.routePts = [];
        S.routeCoords = [];
        S.routeDist = 0;
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];
        if (this.line) { this.map.removeLayer(this.line); this.line = null; }
        $('route-dist').textContent = '0.00 km';
        $('route-info').classList.add('hidden');
        toast('Trajeto limpo', 'in');
    },

    myLocation() {
        if (!navigator.geolocation) return toast('GPS indisponível', 'er');
        navigator.geolocation.getCurrentPosition(p => {
            this.map.setView([p.coords.latitude, p.coords.longitude], 16);
            toast('Localização encontrada', 'ok');
        }, () => toast('Não foi possível obter posição', 'er'), { timeout: 5000 });
    }
};

// ========== ROOM ==========
const Room = {
    async create() {
        const name = $('f-name').value.trim();
        const type = $('f-type').value;
        const max = parseInt($('f-max').value) || 30;

        if (!name) return toast('Nome obrigatório', 'er');
        if (S.routePts.length < 2) return toast('Defina pelo menos 2 pontos no mapa', 'er');

        const btn = $('btn-create');
        btn.classList.add('busy'); btn.disabled = true;

        const code = mkCode();
        const room = {
            name, distance: Math.round(S.routeDist * 100) / 100, type, max,
            route: S.routePts, routeCoords: S.routeCoords,
            status: 'waiting', created: Date.now(), startTime: null, pausedTime: 0,
            runners: {}, messages: [], audioData: null, audioId: null, tx: false,
        };

        const data = await API.read() || {};
        if (!data.rooms) data.rooms = {};
        data.rooms[code] = room;

        const ok = await API.write(data);
        btn.classList.remove('busy'); btn.disabled = false;

        if (ok) {
            S.role = 'admin'; S.room = code; S.data = room;
            Store.save('session', { role: 'admin', room: code });
            V.go('admin');
            toast(`Sala ${code} criada!`, 'ok');
            beep(1200, .15);
        } else toast('Erro ao criar', 'er');
    },

    async join() {
        const code = $('f-code').value.trim().toUpperCase();
        const name = $('f-runner').value.trim();
        if (!code) return toast('Código obrigatório', 'er');
        if (!name) return toast('Nome obrigatório', 'er');
        if (!navigator.geolocation) return toast('GPS necessário', 'er');

        const btn = $('btn-join');
        btn.classList.add('busy'); btn.disabled = true;

        const data = await API.read();
        btn.classList.remove('busy'); btn.disabled = false;

        if (!data?.rooms?.[code]) return toast('Sala não encontrada', 'er');
        const room = data.rooms[code];
        if (room.status === 'finished') return toast('Corrida finalizada', 'er');
        if (Object.keys(room.runners || {}).length >= room.max) return toast('Sala cheia', 'er');

        const rid = 'r_' + uid();
        room.runners[rid] = { name, joined: Date.now(), lat: 0, lng: 0, speed: 0, distance: 0, lastUpdate: Date.now(), active: true };

        const ok = await API.write(data);
        if (ok) {
            S.role = 'runner'; S.room = code; S.rid = rid; S.rname = name; S.data = room;
            Store.save('session', { role: 'runner', room: code, rid, rname: name });
            V.go('runner');
            toast(`Bem-vindo, ${name}!`, 'ok');
            beep(800, .1);
        } else toast('Erro ao entrar', 'er');
    },

    copyCode() {
        navigator.clipboard?.writeText(S.room).then(() => toast('Código copiado!', 'ok')).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = S.room; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            toast('Copiado!', 'ok');
        });
    },

    share() {
        if (navigator.share) {
            navigator.share({ title: 'RaceTracker Pro', text: `Entre na corrida! Código: ${S.room}`, url: window.location.href });
        } else this.copyCode();
    },

    async end() {
        if (!confirm('Encerrar a sala permanentemente?')) return;
        clearAll();
        const data = await API.read();
        if (data?.rooms?.[S.room]) { delete data.rooms[S.room]; await API.write(data); }
        Store.clear();
        resetState();
        V.go('menu');
        toast('Sala encerrada', 'in');
    }
};

// ========== ADMIN ==========
const Admin = {
    init() {
        $('a-code').textContent = S.room;
        $('p-name').textContent = S.data.name;
        $('p-dist').textContent = S.data.distance + ' km';
        $('p-type').textContent = { road: 'Estrada', free: 'Livre', circular: 'Circular' }[S.data.type] || S.data.type;
        setTimeout(() => this.initMap(), 150);
        this.startPoll();
    },

    initMap() {
        if (S.maps.admin) { S.maps.admin.invalidateSize(); return; }
        S.maps.admin = L.map('admin-map', { zoomControl: true }).setView([-23.55, -46.63], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(S.maps.admin);

        const coords = S.data.routeCoords?.length ? S.data.routeCoords : S.data.route;
        if (coords?.length > 1) {
            const line = L.polyline(coords, { color: '#00d4ff', weight: 4, opacity: .5 }).addTo(S.maps.admin);
            const mkIc = (c, t) => L.divIcon({ className: 'custom-marker', html: `<div class="mk" style="background:${c};border-color:${c}"><span class="mk-lbl">${t}</span></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
            L.marker(S.data.route[0], { icon: mkIc('#10b981', '🏁 INÍCIO') }).addTo(S.maps.admin);
            L.marker(S.data.route[S.data.route.length - 1], { icon: mkIc('#ef4444', '🏁 FIM') }).addTo(S.maps.admin);
            S.maps.admin.fitBounds(line.getBounds().pad(0.15));
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(p => S.maps.admin.setView([p.coords.latitude, p.coords.longitude], 15), () => {}, { timeout: 5000 });
        }
    },

    startPoll() {
        S.pollId = setInterval(async () => {
            const d = await API.read();
            if (!d?.rooms?.[S.room]) return;
            S.data = d.rooms[S.room];
            this.render();
        }, CFG.POLL);
    },

    render() {
        const runners = S.data.runners || {};
        const entries = Object.entries(runners);
        const n = entries.length;
        $('p-count').textContent = `${n}/${S.data.max}`;
        $('hud-runners').textContent = n;

        const sorted = entries.sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));

        // Stats
        let totalDist = 0, totalSpeed = 0, activeCount = 0;
        sorted.forEach(([, r]) => {
            totalDist += r.distance || 0;
            if (r.speed > 0) { totalSpeed += r.speed; activeCount++; }
        });
        $('hud-dist').textContent = totalDist.toFixed(1);
        $('hud-avg').textContent = activeCount ? (totalSpeed / activeCount).toFixed(1) : '0';

        // Ranking
        const rk = $('ranking');
        if (!n) { rk.innerHTML = '<div class="empty-rank"><i class="fas fa-satellite-dish"></i><p>Aguardando atletas...</p></div>'; return; }
        rk.innerHTML = sorted.map(([id, r], i) => {
            const cls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
            const alive = (Date.now() - (r.lastUpdate || 0)) < 12000;
            return `<div class="rk ${cls}"><div class="rk-pos">${i + 1}</div><div class="rk-info"><div class="rk-name">${r.name}</div><div class="rk-meta"><span>🏃 ${(r.speed || 0).toFixed(1)}</span><span>📏 ${(r.distance || 0).toFixed(2)}km</span></div></div><div class="rk-dot ${alive ? 'on' : 'off'}"></div></div>`;
        }).join('');

        // Markers
        sorted.forEach(([id, r], i) => {
            if (!r.lat || !r.lng) return;
            const c = COLORS[i % COLORS.length];
            const ic = L.divIcon({ className: 'custom-marker', html: `<div class="mk" style="background:${c};border-color:${c}"><span class="mk-lbl">${r.name}</span></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
            if (S.markers[id]) S.markers[id].setLatLng([r.lat, r.lng]).setIcon(ic);
            else S.markers[id] = L.marker([r.lat, r.lng], { icon: ic }).addTo(S.maps.admin);
        });
    }
};

// ========== RACE CONTROLS ==========
const Race = {
    async start() {
        const ok = await API.update((d, r) => {
            if (!Object.keys(r.runners || {}).length) throw 'empty';
            r.status = 'running'; r.startTime = Date.now();
            r.messages.push({ id: uid(), text: '🏁 LARGADA! BOA CORRIDA!', ts: Date.now() });
        });
        if (!ok) return toast('Adicione atletas primeiro', 'wn');

        S.t0 = Date.now(); S.paused = 0;
        $('c-start').classList.add('hidden');
        $('c-pause').classList.remove('hidden');
        $('c-finish').classList.remove('hidden');
        $('hud-status').innerHTML = '<span class="hud-dot"></span>EM ANDAMENTO';
        $('hud-status').className = 'hud-status go';
        this.tick();
        toast('🏁 LARGADA!', 'ok');
        beep(1000, .3);
    },

    async pause() {
        await API.update((d, r) => { r.status = 'paused'; r.pausedAt = Date.now(); });
        $('c-pause').classList.add('hidden'); $('c-resume').classList.remove('hidden');
        clearInterval(S.tickId);
        $('hud-status').innerHTML = '<span class="hud-dot"></span>PAUSADA';
        $('hud-status').className = 'hud-status';
        toast('⏸ Pausada', 'wn');
    },

    async resume() {
        await API.update((d, r) => {
            r.pausedTime = (r.pausedTime || 0) + (Date.now() - (r.pausedAt || Date.now()));
            r.status = 'running'; delete r.pausedAt;
        });
        $('c-resume').classList.add('hidden'); $('c-pause').classList.remove('hidden');
        const d = await API.read();
        if (d?.rooms?.[S.room]) { S.data = d.rooms[S.room]; S.paused = S.data.pausedTime || 0; }
        this.tick();
        $('hud-status').innerHTML = '<span class="hud-dot"></span>EM ANDAMENTO';
        $('hud-status').className = 'hud-status go';
        toast('▶ Retomada', 'ok');
    },

    async finish() {
        if (!confirm('Finalizar a corrida?')) return;
        await API.update((d, r) => { r.status = 'finished'; r.finishedAt = Date.now(); });
        clearAll();
        const d = await API.read();
        if (d?.rooms?.[S.room]) S.data = d.rooms[S.room];
        $('hud-status').innerHTML = '<span class="hud-dot"></span>FINALIZADA';
        $('hud-status').className = 'hud-status end';
        toast('🏁 Finalizada!', 'ok');
        beep(600, .4);
        setTimeout(() => Results.show(), 1200);
    },

    tick() {
        if (!S.t0) { S.t0 = S.data.startTime; S.paused = S.data.pausedTime || 0; }
        clearInterval(S.tickId);
        S.tickId = setInterval(() => { $('hud-timer').textContent = fmtTime(Date.now() - S.t0 - S.paused); }, 200);
    }
};

// ========== VOICE ==========
const Voice = {
    async initMic() {
        try {
            S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            S.actx = new (window.AudioContext || window.webkitAudioContext)();
            S.analyser = S.actx.createAnalyser(); S.analyser.fftSize = 128;
            S.actx.createMediaStreamSource(S.stream).connect(S.analyser);
            return true;
        } catch (e) { toast('Mic: ' + e.message, 'er'); return false; }
    },

    async toggle() {
        if (!S.mic) {
            if (!(await this.initMic())) return;
            S.mic = true; $('vp-mic').classList.add('on');
            $('vp-status').innerHTML = '<i class="fas fa-microphone"></i> Mic ativo'; $('vp-status').className = 'vp-status on';
            if (S.cont) this.startCont();
            toast('🎙️ Mic ativo', 'ok');
        } else {
            this.stopAll(); S.mic = false; $('vp-mic').classList.remove('on');
            $('vp-status').innerHTML = '<i class="fas fa-microphone-slash"></i> Mic desligado'; $('vp-status').className = 'vp-status';
        }
    },

    toggleCont() {
        S.cont = $('vp-cont').checked;
        const p = $('vp-ptt');
        if (S.cont) { p.style.opacity = '.4'; p.style.pointerEvents = 'none'; if (S.mic) this.startCont(); }
        else { p.style.opacity = '1'; p.style.pointerEvents = 'auto'; this.stopRec(); }
    },

    pttOn(e) { if (e) e.preventDefault(); if (!S.mic || S.cont) return; $('vp-ptt').classList.add('on'); this.startRec(); },
    pttOff(e) { if (e) e.preventDefault(); if (!S.mic || S.cont) return; $('vp-ptt').classList.remove('on'); this.stopRec(); },

    startRec() {
        if (!S.stream || S.recording) return;
        S.recording = true; S.chunks = [];
        try { S.recorder = new MediaRecorder(S.stream, { mimeType: 'audio/webm;codecs=opus' }); }
        catch { try { S.recorder = new MediaRecorder(S.stream); } catch { S.recording = false; return; } }
        S.recorder.ondataavailable = e => { if (e.data.size > 0) S.chunks.push(e.data); };
        S.recorder.onstop = () => { if (S.chunks.length) this.sendAudio(new Blob(S.chunks, { type: 'audio/webm' })); };
        S.recorder.start(300);
        this.drawViz();
        API.update((d, r) => { r.tx = true; });
        $('vp-status').innerHTML = '<i class="fas fa-circle" style="color:var(--err)"></i> Transmitindo...'; $('vp-status').className = 'vp-status rec';
    },

    stopRec() {
        if (!S.recording) return;
        S.recording = false;
        if (S.recorder?.state !== 'inactive') try { S.recorder.stop(); } catch {}
        cancelAnimationFrame(S.vizRaf);
        const c = $('vp-viz'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        API.update((d, r) => { r.tx = false; });
        if (S.mic) { $('vp-status').innerHTML = '<i class="fas fa-microphone"></i> Mic ativo'; $('vp-status').className = 'vp-status on'; }
    },

    startCont() {
        this.startRec();
        S.contInt = setInterval(() => {
            if (S.recording && S.recorder?.state === 'recording') {
                S.recorder.stop();
                setTimeout(() => { if (S.mic && S.cont) this.startRec(); }, 80);
            }
        }, 3000);
    },

    stopAll() {
        this.stopRec(); clearInterval(S.contInt);
        if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
        if (S.actx) { S.actx.close().catch(() => {}); S.actx = null; S.analyser = null; }
    },

    drawViz() {
        if (!S.analyser) return;
        const canvas = $('vp-viz'), ctx = canvas.getContext('2d');
        const buf = new Uint8Array(S.analyser.frequencyBinCount);
        const draw = () => {
            S.vizRaf = requestAnimationFrame(draw);
            S.analyser.getByteFrequencyData(buf);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const bars = 28, w = canvas.width / bars;
            for (let i = 0; i < bars; i++) {
                const v = buf[Math.floor(i * buf.length / bars)] / 255;
                const h = Math.max(2, v * canvas.height);
                ctx.fillStyle = v > .7 ? '#ef4444' : v > .4 ? '#f59e0b' : '#00d4ff';
                ctx.fillRect(i * w + 1, canvas.height - h, w - 2, h);
            }
        };
        draw();
    },

    async sendAudio(blob) {
        const reader = new FileReader();
        reader.onloadend = () => API.update((d, r) => { r.audioData = reader.result; r.audioId = 'a_' + uid(); r.tx = true; r.audioTs = Date.now(); });
        reader.readAsDataURL(blob);
    }
};

// ========== MESSAGES ==========
const Msg = {
    async quick(text) {
        const ok = await API.update((d, r) => {
            if (!r.messages) r.messages = [];
            r.messages.push({ id: uid(), text, ts: Date.now() });
            if (r.messages.length > 20) r.messages = r.messages.slice(-20);
        });
        if (ok) { toast(`📢 Enviado`, 'ok'); beep(600, .1); }
    },
    send() {
        const v = $('qm-input').value.trim();
        if (!v) return;
        this.quick('📢 ' + v);
        $('qm-input').value = '';
    }
};

// ========== RUNNER ==========
const Runner = {
    init() {
        $('rn-name').textContent = S.rname || 'Atleta';
        setTimeout(() => this.initMap(), 150);
        this.startGPS();
        this.startPoll();
    },

    initMap() {
        if (S.maps.runner) { S.maps.runner.invalidateSize(); return; }
        S.maps.runner = L.map('runner-map', { zoomControl: false }).setView([-23.55, -46.63], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(S.maps.runner);

        const coords = S.data.routeCoords?.length ? S.data.routeCoords : S.data.route;
        if (coords?.length > 1) {
            L.polyline(coords, { color: '#00d4ff', weight: 3, opacity: .35 }).addTo(S.maps.runner);
        }
    },

    startGPS() {
        S.gpsId = navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, speed: sp } = pos.coords;
            if (S.lastPos) {
                const d = haversine(S.lastPos.lat, S.lastPos.lng, lat, lng);
                if (d > CFG.GPS_NOISE) { S.dist += d; S.trail.push([lat, lng]); }
            } else { S.trail.push([lat, lng]); }

            S.lastPos = { lat, lng };
            const speed = sp ? clamp(sp * 3.6, 0, 50) : 0;

            $('rs-speed').textContent = speed.toFixed(1);
            $('rs-dist').textContent = S.dist.toFixed(2);

            if (S.maps.runner) {
                S.maps.runner.setView([lat, lng]);
                const ic = L.divIcon({ className: 'custom-marker', html: '<div class="mk" style="background:#00d4ff;border-color:#00d4ff"><span class="mk-lbl">Você</span></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
                if (S.markers.me) S.markers.me.setLatLng([lat, lng]);
                else S.markers.me = L.marker([lat, lng], { icon: ic }).addTo(S.maps.runner);

                if (S.trail.length > 1) {
                    if (S.lines.trail) S.maps.runner.removeLayer(S.lines.trail);
                    S.lines.trail = L.polyline(S.trail, { color: '#00d4ff', weight: 3, opacity: .7 }).addTo(S.maps.runner);
                }
            }

            API.update((d, r) => {
                const me = r.runners?.[S.rid];
                if (!me) return;
                me.lat = lat; me.lng = lng; me.speed = speed;
                me.distance = S.dist; me.lastUpdate = Date.now(); me.active = true;
            });
        }, e => toast('GPS: ' + e.message, 'er'), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    },

    startPoll() {
        S.pollId = setInterval(async () => {
            const d = await API.read();
            if (!d?.rooms?.[S.room]) return;
            S.data = d.rooms[S.room];
            this.render();
        }, CFG.POLL);
    },

    render() {
        const room = S.data, st = $('rn-status');
        if (room.status === 'running') {
            st.className = 'rn-status go'; st.innerHTML = '<i class="fas fa-flag-checkered"></i> EM ANDAMENTO!';
            $('rs-time').textContent = fmtShort(Date.now() - room.startTime - (room.pausedTime || 0));
        } else if (room.status === 'waiting') { st.className = 'rn-status'; st.innerHTML = '<i class="fas fa-hourglass-half"></i> Aguardando largada...'; }
        else if (room.status === 'paused') { st.className = 'rn-status'; st.innerHTML = '<i class="fas fa-pause-circle"></i> Pausada'; }
        else if (room.status === 'finished') {
            st.className = 'rn-status end'; st.innerHTML = '<i class="fas fa-trophy"></i> Finalizada!';
            clearInterval(S.pollId); if (S.gpsId) navigator.geolocation.clearWatch(S.gpsId);
            setTimeout(() => Results.show(), 1500); return;
        }

        // Position
        const sorted = Object.entries(room.runners || {}).sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));
        const idx = sorted.findIndex(([id]) => id === S.rid);
        $('rs-pos').textContent = idx >= 0 ? `${idx + 1}º` : '-';

        // Audio
        if (room.audioId && room.audioId !== S.lastAud && room.audioData) {
            S.lastAud = room.audioId;
            const a = $('aud-out'); a.src = room.audioData; a.play().catch(() => {});
        }
        $('rn-audio').classList.toggle('hidden', !room.tx);

        // Messages
        if (room.messages?.length) {
            const last = room.messages[room.messages.length - 1];
            if (last.id !== S.lastMsg) {
                S.lastMsg = last.id;
                $('rn-msg-text').textContent = last.text;
                $('rn-banner').classList.remove('hidden');
                if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
                beep(880, .15);
                setTimeout(() => $('rn-banner').classList.add('hidden'), 7000);
            }
        }
    }
};

// ========== RESULTS ==========
const Results = {
    show() {
        const runners = S.data.runners || {};
        const sorted = Object.entries(runners).sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));

        $('res-name').textContent = S.data.name;
        const podOrder = [1, 0, 2], podCls = ['silver', 'gold', 'bronze'], podE = ['🥈', '🥇', '🥉'];
        $('res-podium').innerHTML = podOrder.map(i => {
            const r = sorted[i]; if (!r) return '';
            return `<div class="rpod"><div class="rpod-name">${r[1].name}</div><div class="rpod-bar ${podCls[i]}">${podE[i]}</div><div class="rpod-km">${(r[1].distance || 0).toFixed(2)} km</div></div>`;
        }).join('');

        $('res-list').innerHTML = sorted.map(([, r], i) => {
            const cls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
            return `<div class="rk ${cls}"><div class="rk-pos">${i + 1}</div><div class="rk-info"><div class="rk-name">${r.name}</div><div class="rk-meta"><span>📏 ${(r.distance || 0).toFixed(2)}km</span><span>🏃 ${(r.speed || 0).toFixed(1)}km/h</span></div></div></div>`;
        }).join('');

        Store.clear();
        clearAll();
        V.go('results');
    }
};

// ========== HELPERS ==========
function clearAll() {
    clearInterval(S.pollId); clearInterval(S.tickId); clearInterval(S.contInt);
    if (S.gpsId) navigator.geolocation.clearWatch(S.gpsId);
    Voice.stopAll();
    cancelAnimationFrame(S.vizRaf);
}

function resetState() {
    Object.keys(S.markers).forEach(k => delete S.markers[k]);
    S.maps = {}; S.lines = {}; S.routePts = []; S.routeCoords = [];
    S.dist = 0; S.trail = []; S.lastPos = null; S.paused = 0; S.t0 = null;
    S.mic = false; S.lastMsg = null; S.lastAud = null; S.busy = false;
    S.role = null; S.room = null; S.rid = null; S.rname = null;
}

// ========== BOOT ==========
async function boot() {
    // System checks
    const setCheck = (id, ok) => {
        const el = $(id);
        el.className = 'ld-check ' + (ok ? 'ok' : 'fail');
        el.innerHTML = `<i class="fas fa-${ok ? 'check-circle' : 'times-circle'}"></i> ${el.textContent.trim()}`;
    };

    // API
    let apiOk = false;
    try { const r = await API.read(); apiOk = !!r; } catch {}
    setCheck('chk-api', apiOk);

    // GPS
    let gpsOk = !!navigator.geolocation;
    setCheck('chk-gps', gpsOk);

    // Audio
    let micOk = !!(navigator.mediaDevices?.getUserMedia);
    setCheck('chk-mic', micOk);

    await new Promise(r => setTimeout(r, 800));

    // Restore session
    const session = Store.load('session');
    if (session?.role && session?.room && apiOk) {
        try {
            const data = await API.read();
            if (data?.rooms?.[session.room] && data.rooms[session.room].status !== 'finished') {
                S.role = session.role;
                S.room = session.room;
                S.rid = session.rid;
                S.rname = session.rname;
                S.data = data.rooms[session.room];
                S.dist = session.dist || 0;
                S.trail = session.trail || [];
                S.restored = true;

                // Fade loading
                $('v-loading').classList.add('hidden');
                V.go(session.role === 'admin' ? 'admin' : 'runner');
                toast('✅ Sessão restaurada!', 'ok');
                return;
            }
        } catch {}
        Store.clear();
    }

    // Normal boot
    $('v-loading').classList.add('hidden');
    V.go('menu');
}

document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 500));