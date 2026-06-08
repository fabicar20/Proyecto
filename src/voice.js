import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

const SERVER_URL = 'http://192.168.1.39:3000';
const socket = io(SERVER_URL);

let device, producerTransport, consumerTransport;
let audioProducer, videoProducer;
let myName = '';
let isTeacher = false;
let classModeActive = false;
let handRaised = false;
let myComprehension = null;
let activePoll = null;
let myPollAnswer = null;
const participants = new Map();

// ─  DOM ─────────────────────────────
const lobbyScreen        = document.getElementById('lobby-screen');
const meetScreen         = document.getElementById('meet-screen');
const nameInput          = document.getElementById('name-input');
const roomNameInput      = document.getElementById('room-name-input');
const joinBtn            = document.getElementById('join-btn');
const lobbyError         = document.getElementById('lobby-error');
const grid               = document.getElementById('participants-grid');
const muteBtn            = document.getElementById('btn-mute');
const camBtn             = document.getElementById('btn-cam');
const leaveBtn           = document.getElementById('btn-leave');
const chatBtn            = document.getElementById('btn-chat');
const participantsBtn    = document.getElementById('btn-participants');
const participantCount   = document.getElementById('participant-count');
const myNameDisplay      = document.getElementById('my-name-display');
const roomStatus         = document.getElementById('room-status');
const roomNameDisplay    = document.getElementById('room-name-display');
const chatPanel          = document.getElementById('chat-panel');
const participantsPanel  = document.getElementById('participants-panel');
const turnsPanel         = document.getElementById('turns-panel');
const comprehensionPanel = document.getElementById('comprehension-panel');
const pollPanel          = document.getElementById('poll-panel');
const chatMessages       = document.getElementById('chat-messages');
const chatInput          = document.getElementById('chat-input');
const chatSendBtn        = document.getElementById('chat-send');
const chatBadge          = document.getElementById('chat-badge');
const participantsList   = document.getElementById('participants-list');
const turnsList          = document.getElementById('turns-list');
const btnClassMode       = document.getElementById('btn-class-mode');
const btnRaiseHand       = document.getElementById('btn-raise-hand');
const btnTurns           = document.getElementById('btn-turns');
const btnMuteAll         = document.getElementById('btn-mute-all');
const btnComprehension   = document.getElementById('btn-comprehension');
const btnPoll            = document.getElementById('btn-poll');
const classModeBanner    = document.getElementById('class-mode-banner');
const wordGrantedToast   = document.getElementById('word-granted-toast');
const floatingEmojis     = document.getElementById('floating-emojis');
const reactionsBtn       = document.getElementById('btn-reactions');
const reactionsMenu      = document.getElementById('reactions-menu');
const roleStudentBtn     = document.getElementById('role-student');
const roleTeacherBtn     = document.getElementById('role-teacher');
const compGreenCount     = document.getElementById('comp-green-count');
const compYellowCount    = document.getElementById('comp-yellow-count');
const compRedCount       = document.getElementById('comp-red-count');
const comprehensionList  = document.getElementById('comprehension-list');
const compClearBtn       = document.getElementById('comp-clear');
const pollTeacherTools   = document.getElementById('poll-teacher-tools');
const pollQuestion       = document.getElementById('poll-question');
const pollActive         = document.getElementById('poll-active');

// ── SELECTOR DE ROL ───────────────────────────────────────────────────
roleStudentBtn.addEventListener('click', () => {
  isTeacher = false;
  roleStudentBtn.classList.add('active');
  roleTeacherBtn.classList.remove('active');
});
roleTeacherBtn.addEventListener('click', () => {
  isTeacher = true;
  roleTeacherBtn.classList.add('active');
  roleStudentBtn.classList.remove('active');
});

// ── LOBBY ─────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  clearLobbyError();
  if (!name) {
    nameInput.classList.add('shake');
    showLobbyError('Debes escribir tu nombre.');
    setTimeout(() => nameInput.classList.remove('shake'), 500);
    return;
  }
  myName = name;
  await enterRoom();
});
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

function showLobbyError(message) {
  lobbyError.textContent = message;
  lobbyError.classList.remove('hidden');
}

function clearLobbyError() {
  lobbyError.textContent = '';
  lobbyError.classList.add('hidden');
}

// ── ENTRAR A LA SALA ──────────────────────────────────────────────────
async function enterRoom() {
  joinBtn.disabled = true;
  joinBtn.textContent = 'Conectando...';

  const customRoomName = roomNameInput?.value.trim();
  const roomId = customRoomName?.toLowerCase() || 'sala-principal';

  socket.emit('join', { name: myName, isTeacher, roomId }, async ({ error, users, roomName, classMode, turnQueue, comprehension, activePoll: roomPoll }) => {
    if (error) {
      showLobbyError(error);
      joinBtn.disabled = false;
      joinBtn.textContent = 'Unirse a la sala';
      return;
    }

    roomNameDisplay.textContent = roomName || 'Sala principal';
    classModeActive = classMode;
    applyClassMode(classMode, turnQueue);
    renderComprehension(comprehension);
    setActivePoll(roomPoll);

    socket.emit('getRtpCapabilities', async ({ rtpCapabilities }) => {
      try {
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        lobbyScreen.classList.add('hidden');
        meetScreen.classList.remove('hidden');
        myNameDisplay.textContent = myName;

        if (isTeacher) {
          btnClassMode.classList.remove('hidden');
          btnMuteAll.classList.remove('hidden');
          pollTeacherTools.classList.remove('hidden');
        } else {
          btnRaiseHand.classList.remove('hidden');
        }

       addParticipantTile('me', myName, true, isTeacher);
       await createReceiverTransport();
       await startMedia();

       socket.emit('getExistingProducers', ({ producerIds }) => {
         producerIds.forEach(({ producerId, socketId, name, kind }) => {
           if (!document.getElementById(`tile-${socketId}`)) addParticipantTile(socketId, name, false, false);
           subscribeToProducer(producerId, socketId, kind);
          });
          updateCount();
          updateParticipantsList();
        });

      } catch (err) {
        console.error(err);
        joinBtn.disabled = false;
        joinBtn.textContent = 'Unirse a la sala';
        showLobbyError('No se pudo entrar a la sala. Revisa la conexión e intenta de nuevo.');
      }
    });
  });
}

// ── CAPTURAR CÁMARA Y MICRÓFONO ───────────────────────────────────────
async function startMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480, facingMode: 'user' } });
    const myVideo = document.getElementById('video-me');
    if (myVideo) { myVideo.srcObject = stream; myVideo.muted = true; myVideo.style.display = 'block'; }
    const myAvatar = document.getElementById('avatar-me');
    if (myAvatar) myAvatar.style.display = 'none';
    await createSendTransport(stream);
    roomStatus.textContent = '🎙️ Transmitiendo';
  } catch (err) {
    console.error('Error cámara/mic:', err);
    roomStatus.textContent = '⚠️ Sin cámara/micrófono';
  }
}

// ── TRANSPORTE EMISOR ─────────────────────────────────────────────────
// ── TRANSPORTE EMISOR ─────────────────────────────────────────────────
// ── TRANSPORTE EMISOR ─────────────────────────────────────────────────
async function createSendTransport(stream) {
  return new Promise((resolve) => {
    socket.emit('createWebRtcTransport', { sender: true }, async ({ params }) => {
      if (params?.error) return resolve();
      producerTransport = device.createSendTransport(params);
      producerTransport.on('connect', ({ dtlsParameters }, cb) => {
        socket.emit('transport-connect', { dtlsParameters, sender: true });
        cb();
      });
      producerTransport.on('produce', (parameters, cb, eb) => {
        socket.emit('transport-produce', { kind: parameters.kind, rtpParameters: parameters.rtpParameters }, ({ id, error }) => {
          if (error) return eb(error);
          cb({ id });
        });
      });
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) audioProducer = await producerTransport.produce({ track: audioTrack });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoProducer = await producerTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: 500000 }],
        codecOptions: { videoGoogleStartBitrate: 1000 }
      });
      resolve();
    });
  });
}

// ── TRANSPORTE RECEPTOR ───────────────────────────────────────────────
async function createReceiverTransport() {
  return new Promise(resolve => {
    socket.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
      if (params?.error) return resolve();
      consumerTransport = device.createRecvTransport(params);
      consumerTransport.on('connect', ({ dtlsParameters }, cb) => { socket.emit('transport-connect', { dtlsParameters, sender: false }); cb(); });
      resolve();
    });
  });
}

// ── SUSCRIBIRSE A UN PRODUCER ─────────────────────────────────────────
async function subscribeToProducer(producerId, socketId, kind) {
  console.log(`[subscribe] intentando consumir producerId=${producerId} socketId=${socketId} kind=${kind}`);
  if (!consumerTransport) {
    console.error('[subscribe] ERROR: consumerTransport es null');
    return;
  }
  socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, async ({ params, error }) => {
    if (error) {
      console.error('[subscribe] ERROR del servidor:', error);
      return;
    }
    console.log(`[subscribe] consumiendo kind=${params.kind}`);
    const consumer = await consumerTransport.consume(params);
    socket.emit(`consumer-resume-${consumer.id}`);
    if (consumer.kind === 'audio') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.srcObject = new MediaStream([consumer.track]);
      document.body.appendChild(audioEl);
      if (participants.has(socketId)) participants.get(socketId).audioEl = audioEl;
    } else if (consumer.kind === 'video') {
      const videoEl = document.getElementById(`video-${socketId}`);
      console.log(`[subscribe] buscando video-${socketId}:`, videoEl);
      if (videoEl) {
        videoEl.srcObject = new MediaStream([consumer.track]);
        videoEl.play().catch(e => console.error('[subscribe] error play:', e));
        videoEl.style.display = 'block';
        const avatar = document.getElementById(`avatar-${socketId}`);
        if (avatar) avatar.style.display = 'none';
      }
    }
  });
}

// ── TILES ─────────────────────────────────────────────────────────────
function addParticipantTile(socketId, name, isMe, teacher) {
  if (document.getElementById(`tile-${socketId}`)) return;
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['#534AB7','#0F6E56','#993C1D','#2C5F8A','#7B3F9E','#C85A1A'];
  const color = colors[Math.abs(hashCode(name)) % colors.length];
  const tile = document.createElement('div');
  tile.className = 'participant-tile';
  tile.id = `tile-${socketId}`;
  tile.innerHTML = `
    <video id="video-${socketId}" autoplay playsinline ${isMe ? 'muted' : ''} style="display:none"></video>
    <div class="tile-avatar" id="avatar-${socketId}" style="background:${color}">${initials}</div>
    <div class="tile-name-bar">
      <span class="tile-name">${name}</span>
      ${isMe ? '<span class="you-badge">Tú</span>' : ''}
      ${teacher ? '<span class="teacher-badge">👨‍🏫 Profesor</span>' : ''}
      <span class="mic-icon" id="mic-${socketId}">🎙️</span>
    </div>
    <div class="speaking-ring" id="ring-${socketId}"></div>
    <div class="tile-reaction" id="reaction-${socketId}"></div>
  `;
  grid.appendChild(tile);
  if (!isMe) participants.set(socketId, { name, isTeacher: teacher, audioEl: null });
  updateCount();
  updateParticipantsList();
}

function removeParticipantTile(socketId) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (tile) tile.remove();
  const p = participants.get(socketId);
  if (p?.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); }
  participants.delete(socketId);
  updateCount();
  updateParticipantsList();
}

function updateCount() {
  const total = grid.querySelectorAll('.participant-tile').length;
  participantCount.textContent = `${total} participante${total !== 1 ? 's' : ''}`;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

// ── PANEL DE PARTICIPANTES ────────────────────────────────────────────
function updateParticipantsList() {
  participantsList.innerHTML = '';
  // Me
  const meDiv = document.createElement('div');
  meDiv.className = 'participant-item';
  meDiv.innerHTML = `<span>${myName} ${isTeacher ? '👨‍🏫' : '🎓'}</span><span class="you-badge">Tú</span>`;
  participantsList.appendChild(meDiv);
  // Others
  for (const [id, p] of participants.entries()) {
    const div = document.createElement('div');
    div.className = 'participant-item';
    div.innerHTML = `<span>${p.name} ${p.isTeacher ? '👨‍🏫' : '🎓'}</span>`;
    participantsList.appendChild(div);
  }
}

// ── CONTROLES ─────────────────────────────────────────────────────────
let muted = false;
muteBtn.addEventListener('click', () => {
  if (!audioProducer) return;
  muted = !muted;
  muted ? audioProducer.pause() : audioProducer.resume();
  muteBtn.classList.toggle('active', muted);
  muteBtn.querySelector('.btn-icon').textContent = muted ? '🔇' : '🎙️';
  muteBtn.querySelector('.btn-label').textContent = muted ? 'Activar mic' : 'Silenciar';
  document.getElementById('mic-me').textContent = muted ? '🔇' : '🎙️';
});

let camOff = false;
camBtn.addEventListener('click', () => {
  if (!videoProducer) return;
  camOff = !camOff;
  camOff ? videoProducer.pause() : videoProducer.resume();
  camBtn.classList.toggle('active', camOff);
  camBtn.querySelector('.btn-icon').textContent = camOff ? '📷' : '📹';
  camBtn.querySelector('.btn-label').textContent = camOff ? 'Activar cam' : 'Apagar cam';
  const myVideo = document.getElementById('video-me');
  const myAvatar = document.getElementById('avatar-me');
  if (myVideo) myVideo.style.display = camOff ? 'none' : 'block';
  if (myAvatar) myAvatar.style.display = camOff ? 'flex' : 'none';
});

leaveBtn.addEventListener('click', () => { socket.disconnect(); location.reload(); });

// ── PANELES LATERALES ─────────────────────────────────────────────────
function closeAllPanels() {
  chatPanel.classList.add('hidden');
  participantsPanel.classList.add('hidden');
  turnsPanel.classList.add('hidden');
  comprehensionPanel.classList.add('hidden');
  pollPanel.classList.add('hidden');
}

let chatOpen = false;
let unreadCount = 0;

chatBtn.addEventListener('click', () => {
  chatOpen = !chatOpen;
  if (chatOpen) { closeAllPanels(); chatPanel.classList.remove('hidden'); unreadCount = 0; chatBadge.style.display = 'none'; chatInput.focus(); chatMessages.scrollTop = chatMessages.scrollHeight; }
  else { chatPanel.classList.add('hidden'); }
});

participantsBtn.addEventListener('click', () => {
  const open = !participantsPanel.classList.contains('hidden');
  closeAllPanels();
  if (!open) { participantsPanel.classList.remove('hidden'); updateParticipantsList(); }
});

btnTurns.addEventListener('click', () => {
  const open = !turnsPanel.classList.contains('hidden');
  closeAllPanels();
  if (!open) turnsPanel.classList.remove('hidden');
});

btnComprehension.addEventListener('click', () => {
  const open = !comprehensionPanel.classList.contains('hidden');
  closeAllPanels();
  if (!open) comprehensionPanel.classList.remove('hidden');
});

btnPoll.addEventListener('click', () => {
  const open = !pollPanel.classList.contains('hidden');
  closeAllPanels();
  if (!open) pollPanel.classList.remove('hidden');
});

// ── CHAT ──────────────────────────────────────────────────────────────
function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { text });
  chatInput.value = '';
}
chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

socket.on('chat-message', ({ name, text, time }) => {
  const isMe = name === myName;
  const div = document.createElement('div');
  div.className = `chat-msg ${isMe ? 'chat-msg-me' : ''}`;
  div.innerHTML = `
    ${!isMe ? `<span class="chat-msg-name">${name}</span>` : ''}
    <div class="chat-bubble">${escapeHtml(text)}</div>
    <span class="chat-msg-time">${time}</span>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (!chatOpen && !isMe) { unreadCount++; chatBadge.textContent = unreadCount; chatBadge.style.display = 'flex'; }
});

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── SEMAFORO DE COMPRENSION ───────────────────────────────────────────
document.querySelectorAll('.comp-choice').forEach(btn => {
  btn.addEventListener('click', () => {
    myComprehension = btn.dataset.status;
    socket.emit('set-comprehension', { status: myComprehension });
    updateMyComprehensionButtons();
  });
});

compClearBtn.addEventListener('click', () => {
  myComprehension = null;
  socket.emit('set-comprehension', { status: null });
  updateMyComprehensionButtons();
});

function updateMyComprehensionButtons() {
  document.querySelectorAll('.comp-choice').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === myComprehension);
  });
  btnComprehension.classList.toggle('active', !!myComprehension);
}

function renderComprehension(state = { counts: {}, responses: [] }) {
  const counts = state?.counts || {};
  compGreenCount.textContent = counts.green || 0;
  compYellowCount.textContent = counts.yellow || 0;
  compRedCount.textContent = counts.red || 0;
  comprehensionList.innerHTML = '';

  const responses = state?.responses || [];
  if (responses.length === 0) {
    comprehensionList.innerHTML = '<div class="turns-empty">Todavia no hay estados de comprension</div>';
    return;
  }

  responses
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(entry => {
      const div = document.createElement('div');
      div.className = 'comp-person';
      div.innerHTML = `
        <span>${escapeHtml(entry.name)}</span>
        <span class="comp-dot ${entry.status}"></span>
      `;
      comprehensionList.appendChild(div);
    });
}

socket.on('comprehension-updated', renderComprehension);

// ── ENCUESTAS RAPIDAS ─────────────────────────────────────────────────
document.querySelectorAll('.poll-start-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isTeacher) return;
    socket.emit('start-poll', {
      question: pollQuestion.value.trim(),
      type: btn.dataset.type,
    });
  });
});

function setActivePoll(poll) {
  activePoll = poll;
  myPollAnswer = null;
  renderPoll();
}

function renderPoll() {
  if (!activePoll) {
    pollActive.innerHTML = '<div class="poll-empty">No hay encuesta activa</div>';
    btnPoll.classList.remove('active');
    return;
  }

  btnPoll.classList.add('active');
  const total = activePoll.totalResponses || 0;
  const totals = activePoll.totals || {};
  pollActive.innerHTML = `
    <div class="poll-question">${escapeHtml(activePoll.question)}</div>
    <div class="poll-options">
      ${activePoll.options.map(option => `
        <button class="poll-answer-btn ${myPollAnswer === option.id ? 'active' : ''}" data-option="${option.id}">
          ${escapeHtml(option.label)}
        </button>
      `).join('')}
    </div>
    <div class="poll-results">
      ${activePoll.options.map(option => {
        const count = totals[option.id] || 0;
        const percent = total ? Math.round((count / total) * 100) : 0;
        return `
          <div class="poll-result">
            <div class="poll-result-top">
              <span>${escapeHtml(option.label)}</span>
              <span>${count} voto${count !== 1 ? 's' : ''} - ${percent}%</span>
            </div>
            <div class="poll-bar"><div class="poll-bar-fill" style="width:${percent}%"></div></div>
          </div>
        `;
      }).join('')}
    </div>
    ${isTeacher ? '<button class="poll-close-btn" id="poll-close-btn">Cerrar encuesta</button>' : ''}
  `;

  pollActive.querySelectorAll('.poll-answer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      myPollAnswer = btn.dataset.option;
      socket.emit('submit-poll-answer', { optionId: myPollAnswer });
      renderPoll();
    });
  });

  const closeBtn = document.getElementById('poll-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => socket.emit('close-poll'));
}

socket.on('poll-started', poll => {
  setActivePoll(poll);
  appendSystemMsg(`📊 Encuesta: ${poll.question}`);
});

socket.on('poll-results-updated', poll => {
  if (!activePoll || activePoll.id !== poll.id) return;
  activePoll = poll;
  renderPoll();
});

socket.on('poll-closed', poll => {
  activePoll = null;
  myPollAnswer = null;
  renderPoll();
  appendSystemMsg(`📊 Encuesta cerrada: ${poll.question}`);
});

// ── REACCIONES ────────────────────────────────────────────────────────
reactionsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  reactionsMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => reactionsMenu.classList.add('hidden'));

document.querySelectorAll('.reaction-opt').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const emoji = btn.dataset.emoji;
    socket.emit('reaction', { emoji });
    reactionsMenu.classList.add('hidden');
  });
});

socket.on('reaction', ({ socketId, name, emoji }) => {
  // Emoji en el tile
  const tileReaction = document.getElementById(`reaction-${socketId}`);
  if (tileReaction) {
    tileReaction.textContent = emoji;
    tileReaction.classList.add('pop');
    clearTimeout(tileReaction._timeout);
    tileReaction._timeout = setTimeout(() => { tileReaction.textContent = ''; tileReaction.classList.remove('pop'); }, 2500);
  }
  // Emoji flotante
  spawnFloatingEmoji(emoji, name);
});

function spawnFloatingEmoji(emoji, name) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + '%';
  floatingEmojis.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ── MODO CLASE ────────────────────────────────────────────────────────
btnClassMode.addEventListener('click', () => {
  classModeActive = !classModeActive;
  socket.emit('toggle-class-mode', { enabled: classModeActive });
});

btnRaiseHand.addEventListener('click', () => {
  if (!classModeActive) return;
  handRaised = !handRaised;
  if (handRaised) {
    socket.emit('raise-hand');
    btnRaiseHand.classList.add('active');
    btnRaiseHand.querySelector('.btn-icon').textContent = '✋';
    btnRaiseHand.querySelector('.btn-label').textContent = 'Bajar mano';
  } else {
    socket.emit('lower-hand');
    btnRaiseHand.classList.remove('active');
    btnRaiseHand.querySelector('.btn-icon').textContent = '🙋';
    btnRaiseHand.querySelector('.btn-label').textContent = 'Pedir palabra';
  }
});

btnMuteAll.addEventListener('click', () => {
  socket.emit('mute-all');
});

function applyClassMode(enabled, turnQueue) {
  classModeActive = enabled;
  classModeBanner.classList.toggle('hidden', !enabled);
  btnClassMode.classList.toggle('active', enabled);
  btnClassMode.querySelector('.btn-label').textContent = enabled ? 'Fin Clase' : 'Modo Clase';

  if (enabled && isTeacher) {
    btnTurns.classList.remove('hidden');
  } else {
    btnTurns.classList.add('hidden');
    turnsPanel.classList.add('hidden');
    handRaised = false;
    if (!isTeacher) {
      btnRaiseHand.classList.remove('active');
      btnRaiseHand.querySelector('.btn-icon').textContent = '🙋';
      btnRaiseHand.querySelector('.btn-label').textContent = 'Pedir palabra';
    }
  }

  if (turnQueue) renderTurnQueue(turnQueue);
}

function renderTurnQueue(queue) {
  turnsList.innerHTML = '';
  if (!queue || queue.length === 0) {
    turnsList.innerHTML = '<div class="turns-empty">Nadie ha pedido la palabra</div>';
    return;
  }
  queue.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'turn-item';
    div.innerHTML = `
      <span class="turn-pos">${i + 1}</span>
      <span class="turn-name">🙋 ${entry.name}</span>
      ${isTeacher ? `<button class="give-word-btn" data-id="${entry.socketId}">✅ Dar palabra</button>` : ''}
    `;
    turnsList.appendChild(div);
  });

  if (isTeacher) {
    turnsList.querySelectorAll('.give-word-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.emit('give-word', { targetSocketId: btn.dataset.id });
      });
    });
  }
}

// ── EVENTOS MODO CLASE (servidor) ─────────────────────────────────────
socket.on('class-mode-changed', ({ enabled, turnQueue }) => {
  applyClassMode(enabled, turnQueue);
  appendSystemMsg(enabled ? '🎓 Modo Clase activado' : '🎓 Modo Clase desactivado');
});

socket.on('turn-queue-updated', ({ turnQueue }) => {
  renderTurnQueue(turnQueue);
});

socket.on('word-granted', () => {
  // Unmute automatically
  if (audioProducer && muted) {
    muted = false;
    audioProducer.resume();
    muteBtn.classList.remove('active');
    muteBtn.querySelector('.btn-icon').textContent = '🎙️';
    muteBtn.querySelector('.btn-label').textContent = 'Silenciar';
    document.getElementById('mic-me').textContent = '🎙️';
  }
  handRaised = false;
  btnRaiseHand.classList.remove('active');
  btnRaiseHand.querySelector('.btn-icon').textContent = '🙋';
  btnRaiseHand.querySelector('.btn-label').textContent = 'Pedir palabra';
  // Toast
  wordGrantedToast.classList.remove('hidden');
  setTimeout(() => wordGrantedToast.classList.add('hidden'), 4000);
});

socket.on('word-given-to', ({ name }) => {
  appendSystemMsg(`🎤 El profesor le dio la palabra a ${name}`);
});

socket.on('force-mute', () => {
  if (!audioProducer) return;
  muted = true;
  audioProducer.pause();
  muteBtn.classList.add('active');
  muteBtn.querySelector('.btn-icon').textContent = '🔇';
  muteBtn.querySelector('.btn-label').textContent = 'Activar mic';
  document.getElementById('mic-me').textContent = '🔇';
  appendSystemMsg('🔇 El profesor silenció a todos');
});

socket.on('room-name-updated', ({ name }) => {
  roomNameDisplay.textContent = name;
});

// ── EVENTOS SERVIDOR ──────────────────────────────────────────────────
socket.on('user-joined', ({ socketId, name, isTeacher: teacher }) => {
  addParticipantTile(socketId, name, false, teacher);
  appendSystemMsg(`${name} se unió a la sala`);
});

socket.on('new-producer-available', ({ producerId, socketId, name, kind }) => {
  if (!document.getElementById(`tile-${socketId}`)) addParticipantTile(socketId, name, false, false);
  subscribeToProducer(producerId, socketId, kind);
});

socket.on('producer-closed', ({ socketId, kind }) => {
  if (kind === 'video') {
    const videoEl = document.getElementById(`video-${socketId}`);
    const avatar  = document.getElementById(`avatar-${socketId}`);
    if (videoEl) { videoEl.srcObject = null; videoEl.style.display = 'none'; }
    if (avatar)  avatar.style.display = 'flex';
  }
});

socket.on('user-left', ({ socketId, name }) => {
  removeParticipantTile(socketId);
  if (name) appendSystemMsg(`${name} salió de la sala`);
});

function appendSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'chat-system';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
