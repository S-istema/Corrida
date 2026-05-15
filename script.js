// ============================================
// RACETRACKER PRO - JAVASCRIPT COM SISTEMA DE VOZ
// ============================================

// ============ CONFIGURAÇÃO JSONBIN ============
const CONFIG = {
    BIN_ID: "6a068283250b1311c3512d3a",       
    MASTER_KEY: "$2a$10$zfLo4xQ0.IvfaaQaJbTDle3OU9eW24NU.iN7JbK9Ph9OpF0MiuRRu", 
    API_URL: "https://api.jsonbin.io/v3/b/",
    UPDATE_INTERVAL: 2000,
    GPS_INTERVAL: 1500,
};

// ============ ESTADO GLOBAL ============
let state = {
    role: null,
    roomCode: null,
    runnerId: null,
    runnerName: null,
    raceData: null,
    watchId: null,
    updateTimer: null,
    timerInterval: null,
    raceStartTime: null,
    pausedTime: 0,
    lastPosition: null,
    totalDistance: 0,
    positions: [],
    adminMap: null,
    runnerMap: null,
    routeMap: null,
    routePoints: [],
    markers: {},
    routeLine: null,
    runnerTrail: null,
    // Voice system
    micActive: false,
    pttActive: false,
    continuousMode: false,
    mediaRecorder: null,
    audioStream: null,
    audioContext: null,
    analyser: null,
    isRecording: false,
    audioChunks: [],
    lastMessageId: null,
    lastAudioId: null,
    visualizerAnimFrame: null,
};

const RUNNER_COLORS = [
    '#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6',
    '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
    '#eab308', '#3b82f6', '#d946ef', '#64748b', '#fb923c'
];

// ============ INICIALIZAÇÃO ============
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        document.getElementById('loading-screen').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        }, 500);
    }, 2200);
    createParticles();
});

function createParticles() {
    const container = document.getElementById('particles');
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (5 + Math.random() * 10) + 's';
        p.style.animationDelay = Math.random() * 5 + 's';
        p.style.width = p.style.height = (2 + Math.random() * 3) + 'px';
        container.appendChild(p);
    }
}

// ============ TOASTS ============
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="toast-icon ${icons[type]}"></i>
        <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============ MODAIS ============
function showCreateRoom() {
    document.getElementById('create-modal').classList.remove('hidden');
    setTimeout(() => initRouteMap(), 100);
}

function showJoinRoom() {
    document.getElementById('join-modal').classList.remove('hidden');
}

function closeModals() {
    document.getElementById('create-modal').classList.add('hidden');
    document.getElementById('join-modal').classList.add('hidden');
}

// ============ MAPA DE ROTA ============
function initRouteMap() {
    if (state.routeMap) { state.routeMap.invalidateSize(); return; }

    state.routeMap = L.map('route-map').setView([-23.5505, -46.6333], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
    }).addTo(state.routeMap);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            state.routeMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
        });
    }

    state.routeMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        state.routePoints.push([lat, lng]);
        const markerIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-dot" style="background: var(--primary); border-color: var(--primary);">
                     <span class="marker-label">${state.routePoints.length === 1 ? '🏁 INÍCIO' : 'P' + state.routePoints.length}</span>
                   </div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        });
        L.marker([lat, lng], { icon: markerIcon }).addTo(state.routeMap);
        if (state.routeLine) state.routeMap.removeLayer(state.routeLine);
        if (state.routePoints.length > 1) {
            state.routeLine = L.polyline(state.routePoints, {
                color: '#00d4ff', weight: 3, dashArray: '10, 10'
            }).addTo(state.routeMap);
        }
    });
}

function clearRoute() {
    state.routePoints = [];
    if (state.routeMap) {
        state.routeMap.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                state.routeMap.removeLayer(layer);
            }
        });
    }
    state.routeLine = null;
    showToast('Trajeto limpo', 'info');
}

// ============ JSONBIN API ============
async function readBin() {
    try {
        const res = await fetch(CONFIG.API_URL + CONFIG.BIN_ID + '/latest', {
            headers: { 'X-Master-Key': CONFIG.MASTER_KEY }
        });
        if (!res.ok) throw new Error('Erro ao ler bin');
        const data = await res.json();
        return data.record;
    } catch (err) {
        console.error('Read error:', err);
        return null;
    }
}

async function updateBin(data) {
    try {
        const res = await fetch(CONFIG.API_URL + CONFIG.BIN_ID, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': CONFIG.MASTER_KEY
            },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Erro ao atualizar bin');
        return true;
    } catch (err) {
        console.error('Update error:', err);
        return false;
    }
}

// ============ GERAR CÓDIGOS ============
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'RACE-';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function generateRunnerId() {
    return 'runner_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function generateMsgId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

// ============ CRIAR SALA ============
async function createRoom() {
    const name = document.getElementById('race-name').value.trim();
    const distance = parseFloat(document.getElementById('race-distance').value);
    const type = document.getElementById('race-type').value;
    const maxRunners = parseInt(document.getElementById('max-runners').value);

    if (!name) { showToast('Digite o nome da corrida', 'error'); return; }
    if (!distance || distance <= 0) { showToast('Distância inválida', 'error'); return; }

    const roomCode = generateRoomCode();

    const raceData = {
        rooms: {
            [roomCode]: {
                name, distance, type, maxRunners,
                route: state.routePoints,
                status: 'waiting',
                createdAt: Date.now(),
                startTime: null,
                pausedTime: 0,
                runners: {},
                // Sistema de comunicação
                messages: [],
                audioData: null,
                audioId: null,
                isTransmitting: false
            }
        }
    };

    const existing = await readBin();
    if (existing && existing.rooms) {
        raceData.rooms = { ...existing.rooms, ...raceData.rooms };
    }

    const success = await updateBin(raceData);
    if (success) {
        state.role = 'admin';
        state.roomCode = roomCode;
        state.raceData = raceData.rooms[roomCode];
        closeModals();
        showAdminScreen();
        showToast(`Sala ${roomCode} criada com sucesso!`, 'success');
    } else {
        showToast('Erro ao criar sala.', 'error');
    }
}

// ============ ENTRAR NA SALA ============
async function joinRoom() {
    const code = document.getElementById('room-code').value.trim().toUpperCase();
    const name = document.getElementById('runner-name').value.trim();

    if (!code) { showToast('Digite o código da sala', 'error'); return; }
    if (!name) { showToast('Digite seu nome', 'error'); return; }

    const data = await readBin();
    if (!data || !data.rooms || !data.rooms[code]) {
        showToast('Sala não encontrada!', 'error');
        return;
    }

    const room = data.rooms[code];
    const runnerCount = Object.keys(room.runners || {}).length;
    if (runnerCount >= room.maxRunners) { showToast('Sala cheia!', 'error'); return; }
    if (room.status === 'finished') { showToast('Corrida já finalizada!', 'error'); return; }

    if (!navigator.geolocation) { showToast('GPS não suportado!', 'error'); return; }

    const runnerId = generateRunnerId();
    if (!data.rooms[code].runners) data.rooms[code].runners = {};
    data.rooms[code].runners[runnerId] = {
        name, joinedAt: Date.now(),
        lat: 0, lng: 0, speed: 0, distance: 0,
        lastUpdate: Date.now(), active: true, finished: false, finishTime: null
    };

    const success = await updateBin(data);
    if (success) {
        state.role = 'runner';
        state.roomCode = code;
        state.runnerId = runnerId;
        state.runnerName = name;
        state.raceData = data.rooms[code];
        closeModals();
        showRunnerScreen();
        startGPSTracking();
        showToast(`Bem-vindo, ${name}! 🏃`, 'success');
    } else {
        showToast('Erro ao entrar.', 'error');
    }
}

// ============ TELA ADMIN ============
function showAdminScreen() {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('admin-screen').classList.remove('hidden');

    document.getElementById('admin-room-code').textContent = state.roomCode;
    document.getElementById('info-name').textContent = state.raceData.name;
    document.getElementById('info-distance').textContent = state.raceData.distance + ' km';
    document.getElementById('info-type').textContent = {
        linear: 'Linear', circular: 'Circular', free: 'Livre'
    }[state.raceData.type];

    setTimeout(() => initAdminMap(), 100);
    startAdminUpdates();
}

function initAdminMap() {
    if (state.adminMap) return;

    state.adminMap = L.map('admin-map').setView([-23.5505, -46.6333], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
    }).addTo(state.adminMap);

    if (state.raceData.route && state.raceData.route.length > 0) {
        const routeLine = L.polyline(state.raceData.route, {
            color: '#00d4ff', weight: 4, opacity: 0.6, dashArray: '10, 10'
        }).addTo(state.adminMap);

        const startIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-dot" style="background: #10b981; border-color: #10b981;">
                     <span class="marker-label">🏁 INÍCIO</span></div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        });
        const endIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-dot" style="background: #ef4444; border-color: #ef4444;">
                     <span class="marker-label">🏁 FIM</span></div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        });

        L.marker(state.raceData.route[0], { icon: startIcon }).addTo(state.adminMap);
        if (state.raceData.route.length > 1) {
            L.marker(state.raceData.route[state.raceData.route.length - 1], { icon: endIcon }).addTo(state.adminMap);
        }
        state.adminMap.fitBounds(routeLine.getBounds().pad(0.2));
    } else {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                state.adminMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
            });
        }
    }
}

// ============ ATUALIZAÇÕES ADMIN ============
function startAdminUpdates() {
    state.updateTimer = setInterval(async () => {
        const data = await readBin();
        if (!data || !data.rooms || !data.rooms[state.roomCode]) return;
        state.raceData = data.rooms[state.roomCode];
        updateAdminUI();
        updateRunnerMarkers();
    }, CONFIG.UPDATE_INTERVAL);
}

function updateAdminUI() {
    const runners = state.raceData.runners || {};
    const count = Object.keys(runners).length;
    document.getElementById('info-runners').textContent = count + '/' + state.raceData.maxRunners;

    const rankingList = document.getElementById('ranking-list');
    if (count === 0) {
        rankingList.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>Aguardando corredores...</p></div>`;
        return;
    }

    const sorted = Object.entries(runners).sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));

    let html = '';
    sorted.forEach(([id, runner], index) => {
        const topClass = index === 0 ? 'top-1' : index === 1 ? 'top-2' : index === 2 ? 'top-3' : '';
        const statusClass = runner.active ? 'active' : 'inactive';
        html += `
            <div class="rank-item ${topClass}">
                <div class="rank-position">${index + 1}</div>
                <div class="rank-info">
                    <div class="rank-name">${runner.name}</div>
                    <div class="rank-stats">
                        <span>🏃 ${(runner.speed || 0).toFixed(1)} km/h</span>
                        <span>📏 ${(runner.distance || 0).toFixed(2)} km</span>
                    </div>
                </div>
                <div class="rank-status-dot ${statusClass}"></div>
            </div>`;
    });
    rankingList.innerHTML = html;
}

function updateRunnerMarkers() {
    const runners = state.raceData.runners || {};
    Object.entries(runners).forEach(([id, runner], index) => {
        if (!runner.lat || !runner.lng) return;
        const color = RUNNER_COLORS[index % RUNNER_COLORS.length];
        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-dot" style="background: ${color}; border-color: ${color};">
                     <span class="marker-label">${runner.name}</span></div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        });

        if (state.markers[id]) {
            state.markers[id].setLatLng([runner.lat, runner.lng]);
            state.markers[id].setIcon(icon);
        } else {
            state.markers[id] = L.marker([runner.lat, runner.lng], { icon }).addTo(state.adminMap);
        }
    });
}

// ============ 🎙️ SISTEMA DE VOZ DO ADMIN ============

async function initAudioSystem() {
    try {
        state.audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });

        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;

        const source = state.audioContext.createMediaStreamSource(state.audioStream);
        source.connect(state.analyser);

        showToast('🎙️ Microfone ativado!', 'success');
        return true;
    } catch (err) {
        console.error('Erro ao acessar microfone:', err);
        showToast('Erro ao acessar microfone: ' + err.message, 'error');
        return false;
    }
}

function toggleVoiceMode() {
    state.continuousMode = document.getElementById('voice-mode').checked;
    const pttBtn = document.getElementById('ptt-btn');

    if (state.continuousMode) {
        pttBtn.innerHTML = '<i class="fas fa-broadcast-tower"></i><span>Modo contínuo ativo</span>';
        pttBtn.disabled = true;
        pttBtn.style.opacity = '0.5';
    } else {
        pttBtn.innerHTML = '<i class="fas fa-walkie-talkie"></i><span>Pressione para falar</span>';
        pttBtn.disabled = false;
        pttBtn.style.opacity = '1';
    }
}

async function toggleMicrophone() {
    const micBtn = document.getElementById('mic-toggle');
    const voiceStatus = document.getElementById('voice-status');

    if (!state.micActive) {
        const success = await initAudioSystem();
        if (!success) return;

        state.micActive = true;
        micBtn.classList.add('active');
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceStatus.innerHTML = '<i class="fas fa-microphone"></i><span>Microfone ativo - pronto</span>';
        voiceStatus.className = 'voice-status active';

        if (state.continuousMode) {
            startContinuousRecording();
        }
    } else {
        stopAllRecording();
        if (state.audioStream) {
            state.audioStream.getTracks().forEach(track => track.stop());
        }
        state.micActive = false;
        micBtn.classList.remove('active');
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceStatus.innerHTML = '<i class="fas fa-microphone-slash"></i><span>Microfone desligado</span>';
        voiceStatus.className = 'voice-status';

        document.getElementById('voice-visualizer').classList.remove('active');
        cancelAnimationFrame(state.visualizerAnimFrame);
        setTransmittingStatus(false);
    }
}

function startPTT() {
    if (!state.micActive || state.continuousMode) return;

    const pttBtn = document.getElementById('ptt-btn');
    pttBtn.classList.add('active');
    pttBtn.innerHTML = '<i class="fas fa-satellite-dish"></i><span>🔴 Transmitindo...</span>';

    startRecording();
}

function stopPTT() {
    if (!state.micActive || state.continuousMode) return;

    const pttBtn = document.getElementById('ptt-btn');
    pttBtn.classList.remove('active');
    pttBtn.innerHTML = '<i class="fas fa-walkie-talkie"></i><span>Pressione para falar</span>';

    stopRecording();
}

async function startRecording() {
    if (!state.audioStream || state.isRecording) return;

    state.isRecording = true;
    state.audioChunks = [];

    state.mediaRecorder = new MediaRecorder(state.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
    });

    state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            state.audioChunks.push(e.data);
        }
    };

    state.mediaRecorder.onstop = async () => {
        if (state.audioChunks.length > 0) {
            const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
            await sendAudioToRunners(audioBlob);
        }
    };

    state.mediaRecorder.start(500); // Chunks a cada 500ms

    // Visualizador
    document.getElementById('voice-visualizer').classList.add('active');
    startVisualizer();
    setTransmittingStatus(true);

    const voiceStatus = document.getElementById('voice-status');
    voiceStatus.innerHTML = '<i class="fas fa-circle" style="color: var(--danger);"></i><span>🔴 Gravando e transmitindo...</span>';
    voiceStatus.className = 'voice-status recording';
}

function stopRecording() {
    if (!state.isRecording || !state.mediaRecorder) return;

    state.isRecording = false;

    if (state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }

    document.getElementById('voice-visualizer').classList.remove('active');
    cancelAnimationFrame(state.visualizerAnimFrame);
    setTransmittingStatus(false);

    const voiceStatus = document.getElementById('voice-status');
    voiceStatus.innerHTML = '<i class="fas fa-microphone"></i><span>Microfone ativo - pronto</span>';
    voiceStatus.className = 'voice-status active';
}

function startContinuousRecording() {
    startRecording();

    // Reinicia a gravação periodicamente para enviar chunks
    state.continuousInterval = setInterval(() => {
        if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
            setTimeout(() => {
                if (state.micActive && state.continuousMode) {
                    startRecording();
                }
            }, 100);
        }
    }, 3000); // Envia áudio a cada 3 segundos
}

function stopAllRecording() {
    stopRecording();
    if (state.continuousInterval) {
        clearInterval(state.continuousInterval);
        state.continuousInterval = null;
    }
}

// Visualizador de áudio
function startVisualizer() {
    if (!state.analyser) return;

    const bars = document.querySelectorAll('.voice-bar');
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function animate() {
        state.visualizerAnimFrame = requestAnimationFrame(animate);
        state.analyser.getByteFrequencyData(dataArray);

        bars.forEach((bar, i) => {
            const index = Math.floor(i * bufferLength / bars.length);
            const value = dataArray[index];
            const height = Math.max(3, (value / 255) * 35);
            bar.style.height = height + 'px';

            // Cor dinâmica baseada na intensidade
            const intensity = value / 255;
            if (intensity > 0.7) {
                bar.style.background = '#ef4444';
            } else if (intensity > 0.4) {
                bar.style.background = '#f59e0b';
            } else {
                bar.style.background = '#00d4ff';
            }
        });
    }
    animate();
}

// Enviar áudio como base64 via JSONBin
async function sendAudioToRunners(audioBlob) {
    try {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            const audioId = 'audio_' + Date.now();

            const data = await readBin();
            if (!data || !data.rooms || !data.rooms[state.roomCode]) return;

            data.rooms[state.roomCode].audioData = base64Audio;
            data.rooms[state.roomCode].audioId = audioId;
            data.rooms[state.roomCode].isTransmitting = true;
            data.rooms[state.roomCode].audioTimestamp = Date.now();

            await updateBin(data);
        };
        reader.readAsDataURL(audioBlob);
    } catch (err) {
        console.error('Erro ao enviar áudio:', err);
    }
}

async function setTransmittingStatus(isTransmitting) {
    try {
        const data = await readBin();
        if (!data || !data.rooms || !data.rooms[state.roomCode]) return;
        data.rooms[state.roomCode].isTransmitting = isTransmitting;
        await updateBin(data);
    } catch (err) {
        console.error('Erro ao atualizar status:', err);
    }
}

// ============ 📨 MENSAGENS DE TEXTO ============

async function sendQuickMessage(message) {
    const msgId = generateMsgId();

    const data = await readBin();
    if (!data || !data.rooms || !data.rooms[state.roomCode]) return;

    if (!data.rooms[state.roomCode].messages) {
        data.rooms[state.roomCode].messages = [];
    }

    // Manter apenas as últimas 10 mensagens
    const messages = data.rooms[state.roomCode].messages;
    messages.push({
        id: msgId,
        text: message,
        timestamp: Date.now(),
        type: 'quick'
    });

    if (messages.length > 10) {
        data.rooms[state.roomCode].messages = messages.slice(-10);
    }

    const success = await updateBin(data);
    if (success) {
        showToast(`📢 Mensagem enviada: "${message}"`, 'success');
    }
}

async function sendCustomMessage() {
    const input = document.getElementById('custom-msg-input');
    const message = input.value.trim();

    if (!message) {
        showToast('Digite uma mensagem', 'warning');
        return;
    }

    await sendQuickMessage('📢 ' + message);
    input.value = '';
}

// ============ CONTROLES DA CORRIDA ============
async function startRace() {
    const data = await readBin();
    if (!data || !data.rooms[state.roomCode]) return;

    const runners = data.rooms[state.roomCode].runners || {};
    if (Object.keys(runners).length === 0) {
        showToast('Nenhum corredor na sala!', 'warning');
        return;
    }

    data.rooms[state.roomCode].status = 'running';
    data.rooms[state.roomCode].startTime = Date.now();

    const success = await updateBin(data);
    if (success) {
        state.raceData = data.rooms[state.roomCode];
        state.raceStartTime = data.rooms[state.roomCode].startTime;

        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('pause-btn').classList.remove('hidden');
        document.getElementById('finish-btn').classList.remove('hidden');

        const badge = document.getElementById('race-status-badge');
        badge.innerHTML = '<span class="pulse-dot"></span> EM ANDAMENTO';
        badge.className = 'race-status-badge running';

        startTimer();
        showToast('🏁 LARGADA DADA!', 'success');

        // Enviar mensagem automática de largada
        sendQuickMessage('🏁 A CORRIDA COMEÇOU! BOA SORTE A TODOS!');
    }
}

async function pauseRace() {
    const data = await readBin();
    if (!data || !data.rooms[state.roomCode]) return;

    data.rooms[state.roomCode].status = 'paused';
    data.rooms[state.roomCode].pausedAt = Date.now();
    await updateBin(data);

    document.getElementById('pause-btn').classList.add('hidden');
    document.getElementById('resume-btn').classList.remove('hidden');
    clearInterval(state.timerInterval);

    const badge = document.getElementById('race-status-badge');
    badge.innerHTML = '<span class="pulse-dot"></span> PAUSADA';
    badge.className = 'race-status-badge';

    showToast('⏸ Corrida pausada', 'warning');
}

async function resumeRace() {
    const data = await readBin();
    if (!data || !data.rooms[state.roomCode]) return;

    const pauseDuration = Date.now() - (data.rooms[state.roomCode].pausedAt || Date.now());
    data.rooms[state.roomCode].pausedTime = (data.rooms[state.roomCode].pausedTime || 0) + pauseDuration;
    data.rooms[state.roomCode].status = 'running';
    delete data.rooms[state.roomCode].pausedAt;

    await updateBin(data);

    document.getElementById('resume-btn').classList.add('hidden');
    document.getElementById('pause-btn').classList.remove('hidden');
    state.pausedTime = data.rooms[state.roomCode].pausedTime;
    startTimer();

    const badge = document.getElementById('race-status-badge');
    badge.innerHTML = '<span class="pulse-dot"></span> EM ANDAMENTO';
    badge.className = 'race-status-badge running';

    showToast('▶ Corrida retomada', 'success');
}

async function finishRace() {
    if (!confirm('Deseja realmente finalizar a corrida?')) return;

    const data = await readBin();
    if (!data || !data.rooms[state.roomCode]) return;

    data.rooms[state.roomCode].status = 'finished';
    data.rooms[state.roomCode].finishedAt = Date.now();
    await updateBin(data);

    clearInterval(state.timerInterval);
    clearInterval(state.updateTimer);
    stopAllRecording();

    state.raceData = data.rooms[state.roomCode];

    const badge = document.getElementById('race-status-badge');
    badge.innerHTML = '🏁 FINALIZADA';
    badge.className = 'race-status-badge finished';

    showToast('🏁 Corrida finalizada!', 'success');
    setTimeout(() => showResults(), 1500);
}

async function endRace() {
    if (!confirm('Encerrar e excluir a sala?')) return;

    clearInterval(state.timerInterval);
    clearInterval(state.updateTimer);
    stopAllRecording();

    const data = await readBin();
    if (data && data.rooms && data.rooms[state.roomCode]) {
        delete data.rooms[state.roomCode];
        await updateBin(data);
    }

    backToMenu();
    showToast('Sala encerrada', 'info');
}

function copyRoomCode() {
    navigator.clipboard.writeText(state.roomCode)
        .then(() => showToast('Código copiado!', 'success'))
        .catch(() => showToast('Erro ao copiar', 'error'));
}

// ============ TIMER ============
function startTimer() {
    state.timerInterval = setInterval(() => {
        const elapsed = Date.now() - state.raceStartTime - (state.pausedTime || 0);
        document.getElementById('race-timer').textContent = formatTime(elapsed);
    }, 100);
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatTimeShort(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${pad(m)}:${pad(s)}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

// ============ TELA DO CORREDOR ============
function showRunnerScreen() {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('runner-screen').classList.remove('hidden');
    document.getElementById('runner-display-name').textContent = state.runnerName;

    setTimeout(() => initRunnerMap(), 100);
    startRunnerUpdates();
}

function initRunnerMap() {
    if (state.runnerMap) return;

    state.runnerMap = L.map('runner-map').setView([-23.5505, -46.6333], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
    }).addTo(state.runnerMap);

    if (state.raceData.route && state.raceData.route.length > 1) {
        L.polyline(state.raceData.route, {
            color: '#00d4ff', weight: 3, opacity: 0.5, dashArray: '8, 8'
        }).addTo(state.runnerMap);
    }
}

// ============ GPS ============
function startGPSTracking() {
    if (!navigator.geolocation) return;

    state.watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, speed: gpsSpeed } = position.coords;

            if (state.lastPosition) {
                const dist = haversine(state.lastPosition.lat, state.lastPosition.lng, latitude, longitude);
                if (dist > 0.002) {
                    state.totalDistance += dist;
                    state.positions.push([latitude, longitude]);
                }
            } else {
                state.positions.push([latitude, longitude]);
            }

            state.lastPosition = { lat: latitude, lng: longitude };
            const speed = gpsSpeed ? (gpsSpeed * 3.6) : 0;

            document.getElementById('stat-speed').textContent = speed.toFixed(1);
            document.getElementById('stat-distance').textContent = state.totalDistance.toFixed(2);

            if (state.runnerMap) {
                state.runnerMap.setView([latitude, longitude], state.runnerMap.getZoom());

                if (state.markers.self) {
                    state.markers.self.setLatLng([latitude, longitude]);
                } else {
                    const icon = L.divIcon({
                        className: 'custom-marker',
                        html: `<div class="marker-dot" style="background: #00d4ff; border-color: #00d4ff;">
                                 <span class="marker-label">Você</span></div>`,
                        iconSize: [20, 20], iconAnchor: [10, 10]
                    });
                    state.markers.self = L.marker([latitude, longitude], { icon }).addTo(state.runnerMap);
                }

                if (state.positions.length > 1) {
                    if (state.runnerTrail) state.runnerMap.removeLayer(state.runnerTrail);
                    state.runnerTrail = L.polyline(state.positions, {
                        color: '#00d4ff', weight: 3, opacity: 0.7
                    }).addTo(state.runnerMap);
                }
            }

            sendPosition(latitude, longitude, speed);
        },
        (error) => {
            console.error('GPS Error:', error);
            showToast('Erro GPS: ' + error.message, 'error');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

async function sendPosition(lat, lng, speed) {
    const data = await readBin();
    if (!data || !data.rooms || !data.rooms[state.roomCode]) return;

    const runner = data.rooms[state.roomCode].runners[state.runnerId];
    if (!runner) return;

    runner.lat = lat;
    runner.lng = lng;
    runner.speed = speed;
    runner.distance = state.totalDistance;
    runner.lastUpdate = Date.now();
    runner.active = true;

    await updateBin(data);
}

// ============ ATUALIZAÇÕES DO CORREDOR (COM ÁUDIO E MENSAGENS) ============
function startRunnerUpdates() {
    state.updateTimer = setInterval(async () => {
        const data = await readBin();
        if (!data || !data.rooms || !data.rooms[state.roomCode]) return;

        const room = data.rooms[state.roomCode];
        state.raceData = room;

        // Status da corrida
        const statusEl = document.getElementById('runner-race-status');
        if (room.status === 'running') {
            statusEl.className = 'runner-status active';
            statusEl.innerHTML = '<div class="status-icon"><i class="fas fa-flag-checkered"></i></div><span>CORRIDA EM ANDAMENTO!</span>';
            const elapsed = Date.now() - room.startTime - (room.pausedTime || 0);
            document.getElementById('stat-time').textContent = formatTimeShort(elapsed);
        } else if (room.status === 'waiting') {
            statusEl.className = 'runner-status';
            statusEl.innerHTML = '<div class="status-icon"><i class="fas fa-hourglass-half"></i></div><span>Aguardando largada...</span>';
        } else if (room.status === 'paused') {
            statusEl.className = 'runner-status';
            statusEl.innerHTML = '<div class="status-icon"><i class="fas fa-pause-circle"></i></div><span>Corrida pausada</span>';
        } else if (room.status === 'finished') {
            statusEl.className = 'runner-status finished-status';
            statusEl.innerHTML = '<div class="status-icon"><i class="fas fa-trophy"></i></div><span>Corrida finalizada!</span>';
            clearInterval(state.updateTimer);
            if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
            setTimeout(() => showResults(), 2000);
        }

        // Posição no ranking
        const runners = room.runners || {};
        const sorted = Object.entries(runners).sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));
        const myIndex = sorted.findIndex(([id]) => id === state.runnerId);
        document.getElementById('stat-position').textContent = myIndex >= 0 ? `${myIndex + 1}º` : '-';

        // ===== RECEBER ÁUDIO DO ADMIN =====
        if (room.audioId && room.audioId !== state.lastAudioId && room.audioData) {
            state.lastAudioId = room.audioId;
            playAdminAudio(room.audioData);
        }

        // Indicador de transmissão
        const audioIndicator = document.getElementById('audio-indicator');
        if (room.isTransmitting) {
            audioIndicator.classList.remove('hidden');
        } else {
            audioIndicator.classList.add('hidden');
        }

        // ===== RECEBER MENSAGENS DO ADMIN =====
        if (room.messages && room.messages.length > 0) {
            const lastMsg = room.messages[room.messages.length - 1];
            if (lastMsg.id !== state.lastMessageId) {
                state.lastMessageId = lastMsg.id;
                showAdminMessage(lastMsg.text);
            }
        }

    }, CONFIG.UPDATE_INTERVAL);
}

// Tocar áudio do admin no dispositivo do corredor
function playAdminAudio(base64Audio) {
    try {
        const audioPlayer = document.getElementById('audio-player');
        audioPlayer.src = base64Audio;
        audioPlayer.volume = 1.0;
        audioPlayer.play().catch(err => {
            console.log('Autoplay bloqueado, tentando com interação...');
        });
    } catch (err) {
        console.error('Erro ao tocar áudio:', err);
    }
}

// Mostrar mensagem do admin no banner do corredor
function showAdminMessage(text) {
    const banner = document.getElementById('admin-message-banner');
    const msgText = document.getElementById('admin-msg-text');

    msgText.textContent = text;
    banner.classList.remove('hidden');

    // Vibrar dispositivo se suportado
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }

    // Tocar som de notificação
    playNotificationSound();

    // Auto-fechar após 8 segundos
    setTimeout(() => {
        banner.classList.add('hidden');
    }, 8000);
}

function closeAdminMessage() {
    document.getElementById('admin-message-banner').classList.add('hidden');
}

function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
        // Silenciar erros de áudio
    }
}

// ============ RESULTADOS ============
function showResults() {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('result-screen').classList.remove('hidden');

    const runners = state.raceData.runners || {};
    const sorted = Object.entries(runners).sort((a, b) => (b[1].distance || 0) - (a[1].distance || 0));

    const podium = document.getElementById('podium');
    const podiumData = [
        { place: 2, class: 'silver', emoji: '🥈' },
        { place: 1, class: 'gold', emoji: '🥇' },
        { place: 3, class: 'bronze', emoji: '🥉' }
    ];

    let podiumHtml = '';
    podiumData.forEach(p => {
        const runner = sorted[p.place - 1];
        if (runner) {
            const [, r] = runner;
            podiumHtml += `
                <div class="podium-place">
                    <div class="podium-name">${r.name}</div>
                    <div class="podium-block ${p.class}">${p.emoji}</div>
                    <div class="podium-time">${(r.distance || 0).toFixed(2)} km</div>
                </div>`;
        }
    });
    podium.innerHTML = podiumHtml;

    const fullResults = document.getElementById('full-results');
    let resultsHtml = '';
    sorted.forEach(([id, runner], index) => {
        const topClass = index === 0 ? 'top-1' : index === 1 ? 'top-2' : index === 2 ? 'top-3' : '';
        resultsHtml += `
            <div class="rank-item ${topClass}">
                <div class="rank-position">${index + 1}</div>
                <div class="rank-info">
                    <div class="rank-name">${runner.name}</div>
                    <div class="rank-stats">
                        <span>📏 ${(runner.distance || 0).toFixed(2)} km</span>
                        <span>🏃 ${(runner.speed || 0).toFixed(1)} km/h</span>
                    </div>
                </div>
            </div>`;
    });
    fullResults.innerHTML = resultsHtml;
}

// ============ UTILITÁRIOS ============
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

function backToMenu() {
    clearInterval(state.updateTimer);
    clearInterval(state.timerInterval);
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    stopAllRecording();
    if (state.audioStream) {
        state.audioStream.getTracks().forEach(t => t.stop());
    }

    Object.keys(state.markers).forEach(k => delete state.markers[k]);
    state.adminMap = null;
    state.runnerMap = null;
    state.routeMap = null;
    state.routePoints = [];
    state.totalDistance = 0;
    state.positions = [];
    state.lastPosition = null;
    state.pausedTime = 0;
    state.micActive = false;
    state.lastMessageId = null;
    state.lastAudioId = null;

    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('main-menu').classList.remove('hidden');

    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('pause-btn').classList.add('hidden');
    document.getElementById('resume-btn').classList.add('hidden');
    document.getElementById('finish-btn').classList.add('hidden');
    document.getElementById('race-timer').textContent = '00:00:00';
}