import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as mediasoup from 'mediasoup';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'dist')));

let worker, router;

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: {} }
];

// ── MÚLTIPLES SALAS ───────────────────────────────────────────────────
// Cada sala tiene su propio estado independiente
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      users: new Map(),
      roomName: roomId,
      classMode: false,
      turnQueue: [],
      comprehension: new Map(),
      activePoll: null,
    });
    console.log(`🏠 Sala creada: "${roomId}"`);
  }
  return rooms.get(roomId);
}

function deleteRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.users.size === 0) {
    rooms.delete(roomId);
    console.log(`🗑️ Sala eliminada (vacía): "${roomId}"`);
  }
}

function emitTurnQueueToTeacher(room) {
  for (const [id, u] of room.users.entries()) {
    if (u.isTeacher) {
      io.to(id).emit('turn-queue-updated', { turnQueue: room.turnQueue });
    }
  }
}

function getComprehensionState(room) {
  const counts = { green: 0, yellow: 0, red: 0 };
  const responses = [];
  for (const [socketId, status] of room.comprehension.entries()) {
    const user = room.users.get(socketId);
    if (!user || !counts[status] && counts[status] !== 0) continue;
    counts[status]++;
    responses.push({ socketId, name: user.name, status });
  }
  return { counts, responses };
}

function getPollResults(poll) {
  if (!poll) return null;
  const totals = Object.fromEntries(poll.options.map(option => [option.id, 0]));
  const responses = [];
  for (const response of poll.responses.values()) {
    if (totals[response.optionId] !== undefined) totals[response.optionId]++;
    responses.push(response);
  }
  return {
    id: poll.id,
    question: poll.question,
    type: poll.type,
    options: poll.options,
    totals,
    responses,
    totalResponses: responses.length,
  };
}

function getPollOptions(type) {
  if (type === 'abcd') {
    return [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ];
  }
  if (type === 'understanding') {
    return [
      { id: 'understood', label: 'Entendi' },
      { id: 'doubt', label: 'Tengo dudas' },
      { id: 'lost', label: 'No entendi' },
    ];
  }
  return [
    { id: 'yes', label: 'Si' },
    { id: 'no', label: 'No' },
  ];
}

function normalizeUserName(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ── MEDIASOUP ─────────────────────────────────────────────────────────
async function startMediasoup() {
  worker = await mediasoup.createWorker({ rtcMinPort: 2000, rtcMaxPort: 2100 });
  worker.on('died', () => { console.error('Worker murió'); process.exit(1); });
  router = await worker.createRouter({ mediaCodecs });
  console.log('🚀 MeetCauca servidor listo — soporte multisala activo');
}
startMediasoup();

async function createWebRtcTransport() {
  return await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: '192.168.1.39' }],
    enableUdp: true, enableTcp: true, preferUdp: true,
  });
}

// ── CONEXIONES ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`👤 Conectado: ${socket.id}`);
  let currentRoomId = null;

  socket.on('join', ({ name, isTeacher, roomId }, callback) => {
    // Normalizar el roomId
    const normalizedRoomId = (roomId || 'sala-principal').trim().toLowerCase();
    const cleanName = (name || '').trim().replace(/\s+/g, ' ');

    if (!cleanName) {
      return callback({ error: 'Debes escribir tu nombre.' });
    }

    const room = getRoom(normalizedRoomId);
    const nameAlreadyExists = Array.from(room.users.values()).some(
      user => normalizeUserName(user.name) === normalizeUserName(cleanName)
    );
    if (nameAlreadyExists) {
      return callback({ error: 'Ese nombre ya está en uso en esta sala. Escribe otro nombre.' });
    }

    const teacherAlreadyExists = Array.from(room.users.values()).some(user => user.isTeacher);
    if (isTeacher && teacherAlreadyExists) {
      return callback({ error: 'Esta sala ya tiene un profesor. Ingresa como estudiante o usa otra sala.' });
    }

    currentRoomId = normalizedRoomId;
    room.users.set(socket.id, { name: cleanName, isTeacher: !!isTeacher });

    // Unirse al canal de Socket.io de esa sala
    socket.join(normalizedRoomId);

    console.log(`🙋 ${cleanName} se unió a sala "${normalizedRoomId}" ${isTeacher ? '(Profesor)' : ''}`);

    // Notificar a los demás en la misma sala
    socket.to(normalizedRoomId).emit('user-joined', {
      socketId: socket.id,
      name: cleanName,
      isTeacher: !!isTeacher
    });

    // Devolver los usuarios actuales de ESA sala
    const users = [];
    for (const [id, u] of room.users.entries()) {
      if (id !== socket.id) users.push({ socketId: id, name: u.name, isTeacher: u.isTeacher });
    }

    callback({
      users,
      roomName: room.roomName,
      classMode: room.classMode,
      turnQueue: room.turnQueue,
      comprehension: getComprehensionState(room),
      activePoll: getPollResults(room.activePoll),
    });
  });

  // ── NOMBRE DE SALA ────────────────────────────────────────────────
  socket.on('set-room-name', ({ name }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher || !name?.trim()) return;
    room.roomName = name.trim();
    io.to(currentRoomId).emit('room-name-updated', { name: room.roomName });
  });

  // ── CHAT ──────────────────────────────────────────────────────────
  socket.on('chat-message', ({ text }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user || !text?.trim()) return;
    const msg = {
      name: user.name,
      text: text.trim(),
      time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomId).emit('chat-message', msg);
  });

  // ── REACCIONES ────────────────────────────────────────────────────
  socket.on('reaction', ({ emoji }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    io.to(currentRoomId).emit('reaction', { socketId: socket.id, name: user.name, emoji });
  });

  // Encuestas rapidas y semaforo de comprension
  socket.on('set-comprehension', ({ status }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    const allowed = ['green', 'yellow', 'red'];
    if (allowed.includes(status)) {
      room.comprehension.set(socket.id, status);
    } else {
      room.comprehension.delete(socket.id);
    }
    io.to(currentRoomId).emit('comprehension-updated', getComprehensionState(room));
  });

  socket.on('start-poll', ({ question, type }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher) return;
    const cleanQuestion = (question || '').trim().slice(0, 120);
    room.activePoll = {
      id: Date.now().toString(36),
      question: cleanQuestion || 'Pregunta rapida',
      type: type || 'yesno',
      options: getPollOptions(type),
      responses: new Map(),
    };
    io.to(currentRoomId).emit('poll-started', getPollResults(room.activePoll));
  });

  socket.on('submit-poll-answer', ({ optionId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room?.activePoll) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    const option = room.activePoll.options.find(opt => opt.id === optionId);
    if (!option) return;
    room.activePoll.responses.set(socket.id, {
      socketId: socket.id,
      name: user.name,
      optionId,
    });
    io.to(currentRoomId).emit('poll-results-updated', getPollResults(room.activePoll));
  });

  socket.on('close-poll', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher || !room.activePoll) return;
    const results = getPollResults(room.activePoll);
    room.activePoll = null;
    io.to(currentRoomId).emit('poll-closed', results);
  });

  // ── MODO CLASE ────────────────────────────────────────────────────
  socket.on('toggle-class-mode', ({ enabled }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher) return;
    room.classMode = !!enabled;
    if (!enabled) room.turnQueue = [];
    io.to(currentRoomId).emit('class-mode-changed', {
      enabled: room.classMode,
      turnQueue: room.turnQueue
    });
  });

  socket.on('raise-hand', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.classMode) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    const already = room.turnQueue.find(t => t.socketId === socket.id);
    if (already) return;
    room.turnQueue.push({ socketId: socket.id, name: user.name });
    emitTurnQueueToTeacher(room);
  });

  socket.on('lower-hand', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.turnQueue = room.turnQueue.filter(t => t.socketId !== socket.id);
    emitTurnQueueToTeacher(room);
  });

  socket.on('give-word', ({ targetSocketId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher) return;
    room.turnQueue = room.turnQueue.filter(t => t.socketId !== targetSocketId);
    emitTurnQueueToTeacher(room);
    io.to(targetSocketId).emit('word-granted');
    socket.to(currentRoomId).emit('word-given-to', {
      socketId: targetSocketId,
      name: room.users.get(targetSocketId)?.name
    });
  });

  socket.on('mute-all', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user?.isTeacher) return;
    socket.to(currentRoomId).emit('force-mute');
    console.log(`🔇 ${user.name} silenció a todos en sala "${currentRoomId}"`);
  });

  // ── MEDIASOUP ─────────────────────────────────────────────────────
  socket.on('getRtpCapabilities', (callback) => {
    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  socket.on('getExistingProducers', (callback) => {
    if (!currentRoomId) return callback({ producerIds: [] });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ producerIds: [] });

    const list = [];
    for (const [id, producers] of room.producers.entries()) {
      if (id === socket.id) continue;
      const user = room.users.get(id);
      if (producers.audio) list.push({ producerId: producers.audio.id, socketId: id, name: user?.name || 'Usuario', kind: 'audio' });
      if (producers.video) list.push({ producerId: producers.video.id, socketId: id, name: user?.name || 'Usuario', kind: 'video' });
    }
    callback({ producerIds: list });
  });

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    if (!currentRoomId) return callback({ error: 'No estás en ninguna sala' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ error: 'Sala no encontrada' });
    try {
      const transport = await createWebRtcTransport();
      if (!room.transports.has(socket.id)) room.transports.set(socket.id, { sendTransport: null, recvTransport: null });
      const t = room.transports.get(socket.id);
      if (sender) t.sendTransport = transport; else t.recvTransport = transport;
      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (err) { callback({ error: err.message }); }
  });

  socket.on('transport-connect', async ({ dtlsParameters, sender }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const t = room.transports.get(socket.id);
    if (t) {
      const transport = sender ? t.sendTransport : t.recvTransport;
      if (transport) await transport.connect({ dtlsParameters });
    }
  });

  socket.on('transport-produce', async ({ kind, rtpParameters }, callback) => {
    if (!currentRoomId) return callback({ error: 'No estás en ninguna sala' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ error: 'Sala no encontrada' });
    try {
      const t = room.transports.get(socket.id);
      if (!t?.sendTransport) return callback({ error: 'No hay transporte emisor' });
      const producer = await t.sendTransport.produce({ kind, rtpParameters });
      if (!room.producers.has(socket.id)) room.producers.set(socket.id, { audio: null, video: null });
      room.producers.get(socket.id)[kind] = producer;
      const user = room.users.get(socket.id);
      socket.to(currentRoomId).emit('new-producer-available', {
        producerId: producer.id,
        socketId: socket.id,
        name: user?.name || 'Usuario',
        kind
      });
      callback({ id: producer.id });
    } catch (err) { callback({ error: err.message }); }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    if (!currentRoomId) return callback({ error: 'No estás en ninguna sala' });
    const room = rooms.get(currentRoomId);
    if (!room) return callback({ error: 'Sala no encontrada' });
    try {
      const t = room.transports.get(socket.id);
      if (!t?.recvTransport) return callback({ error: 'No hay transporte receptor' });
      if (!router.canConsume({ producerId, rtpCapabilities })) return callback({ error: 'No se puede consumir' });
      const consumer = await t.recvTransport.consume({ producerId, rtpCapabilities, paused: true });
      if (!room.consumers.has(socket.id)) room.consumers.set(socket.id, new Map());
      room.consumers.get(socket.id).set(producerId, consumer);
      socket.on(`consumer-resume-${consumer.id}`, async () => { await consumer.resume(); });
      callback({
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });
    } catch (err) { callback({ error: err.message }); }
  });

  // ── DESCONEXIÓN ───────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);

    // Limpiar cola de turnos
    const prevLen = room.turnQueue.length;
    room.turnQueue = room.turnQueue.filter(t => t.socketId !== socket.id);
    if (room.turnQueue.length !== prevLen) emitTurnQueueToTeacher(room);

    if (room.comprehension.delete(socket.id)) {
      io.to(currentRoomId).emit('comprehension-updated', getComprehensionState(room));
    }

    // Cerrar productores
    const producers = room.producers.get(socket.id);
    if (producers) {
      if (producers.audio) { producers.audio.close(); socket.to(currentRoomId).emit('producer-closed', { socketId: socket.id, kind: 'audio' }); }
      if (producers.video) { producers.video.close(); socket.to(currentRoomId).emit('producer-closed', { socketId: socket.id, kind: 'video' }); }
      room.producers.delete(socket.id);
    }

    // Notificar salida
    socket.to(currentRoomId).emit('user-left', { socketId: socket.id, name: user?.name });

    // Cerrar consumidores y transportes
    const userConsumers = room.consumers.get(socket.id);
    if (userConsumers) { for (const c of userConsumers.values()) c.close(); room.consumers.delete(socket.id); }
    const t = room.transports.get(socket.id);
    if (t) { if (t.sendTransport) t.sendTransport.close(); if (t.recvTransport) t.recvTransport.close(); room.transports.delete(socket.id); }

    room.users.delete(socket.id);
    console.log(`👋 ${user?.name || socket.id} salió de sala "${currentRoomId}"`);

    // Eliminar sala si quedó vacía
    deleteRoomIfEmpty(currentRoomId);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`✅ Puerto ${PORT} listo`));
