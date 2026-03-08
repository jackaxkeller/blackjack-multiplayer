const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, 'public')));

const lobbies = new Map();

function cleanName(name) {
  return String(name || 'Player').trim().replace(/\s+/g, ' ').slice(0, 18) || 'Player';
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function uniqueCode() {
  let tries = 0;
  let code = makeCode();
  while (lobbies.has(code) && tries < 1000) {
    code = makeCode();
    tries += 1;
  }
  return code;
}

function serializeMembers(lobby) {
  return Array.from(lobby.members.values())
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ id, name, joinedAt }) => ({ id, name, joinedAt }));
}

function seatsForLobby(lobby) {
  const members = serializeMembers(lobby);
  const seatMap = {};
  const host = members.find((m) => m.id === lobby.hostId);
  if (host) seatMap.player = host.id;
  const guests = members.filter((m) => m.id !== lobby.hostId).slice(0, 3);
  guests.forEach((member, index) => {
    seatMap[`bot${index}`] = member.id;
  });
  return seatMap;
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToLobby(lobby, payload, exceptPlayerId = null) {
  for (const member of lobby.members.values()) {
    if (member.id === exceptPlayerId) continue;
    send(member.ws, payload);
  }
}

function membershipPayload(lobby) {
  return {
    type: 'membership',
    code: lobby.code,
    hostId: lobby.hostId,
    members: serializeMembers(lobby),
    seats: seatsForLobby(lobby),
  };
}

function removeMember(ws, { notify = true } = {}) {
  const { lobbyCode, playerId, isHost } = ws;
  if (!lobbyCode || !playerId) return;

  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return;

  lobby.members.delete(playerId);

  if (isHost) {
    broadcastToLobby(lobby, {
      type: 'lobby-closed',
      message: 'The host left, so the lobby evaporated.'
    });
    for (const member of lobby.members.values()) {
      member.ws.lobbyCode = null;
      member.ws.playerId = null;
      member.ws.isHost = false;
    }
    lobbies.delete(lobbyCode);
    return;
  }

  const host = lobby.members.get(lobby.hostId);
  if (host && notify) {
    send(host.ws, { type: 'leave', from: playerId });
  }

  const payload = membershipPayload(lobby);
  broadcastToLobby(lobby, payload);

  ws.lobbyCode = null;
  ws.playerId = null;
  ws.isHost = false;

  if (lobby.members.size === 0) {
    lobbies.delete(lobbyCode);
  }
}

wss.on('connection', (ws) => {
  ws.lobbyCode = null;
  ws.playerId = null;
  ws.isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Bad JSON payload.' });
      return;
    }

    if (msg.type === 'create-lobby') {
      if (ws.lobbyCode) removeMember(ws, { notify: false });

      const code = uniqueCode();
      const playerId = String(msg.from || '').slice(0, 64);
      if (!playerId) {
        send(ws, { type: 'error', message: 'Missing player id.' });
        return;
      }

      const lobby = {
        code,
        hostId: playerId,
        createdAt: Date.now(),
        members: new Map(),
      };

      const member = {
        id: playerId,
        name: cleanName(msg.name),
        joinedAt: Number(msg.joinedAt) || Date.now(),
        ws,
      };

      lobby.members.set(member.id, member);
      lobbies.set(code, lobby);

      ws.lobbyCode = code;
      ws.playerId = member.id;
      ws.isHost = true;

      send(ws, {
        type: 'lobby-created',
        code,
        hostId: lobby.hostId,
        members: serializeMembers(lobby),
        seats: seatsForLobby(lobby),
      });
      return;
    }

    if (msg.type === 'join-lobby') {
      if (ws.lobbyCode) removeMember(ws, { notify: false });

      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const lobby = lobbies.get(code);
      if (!lobby) {
        send(ws, { type: 'error', message: 'Lobby code not found.' });
        return;
      }
      if (serializeMembers(lobby).length >= 4) {
        send(ws, { type: 'error', message: 'That lobby is full.' });
        return;
      }

      const playerId = String(msg.from || '').slice(0, 64);
      if (!playerId) {
        send(ws, { type: 'error', message: 'Missing player id.' });
        return;
      }
      if (lobby.members.has(playerId)) {
        send(ws, { type: 'error', message: 'Player id already exists in this lobby.' });
        return;
      }

      const member = {
        id: playerId,
        name: cleanName(msg.name),
        joinedAt: Number(msg.joinedAt) || Date.now(),
        ws,
      };

      lobby.members.set(member.id, member);
      ws.lobbyCode = code;
      ws.playerId = member.id;
      ws.isHost = false;

      send(ws, {
        type: 'join-accepted',
        code,
        hostId: lobby.hostId,
        members: serializeMembers(lobby),
        seats: seatsForLobby(lobby),
      });

      const host = lobby.members.get(lobby.hostId);
      if (host) {
        send(host.ws, {
          type: 'join-request',
          from: member.id,
          name: member.name,
          joinedAt: member.joinedAt,
        });
      }

      const payload = membershipPayload(lobby);
      broadcastToLobby(lobby, payload);
      return;
    }

    if (msg.type === 'leave-lobby') {
      removeMember(ws);
      return;
    }

    if (!ws.lobbyCode || !ws.playerId) {
      send(ws, { type: 'error', message: 'You are not in a lobby.' });
      return;
    }

    const lobby = lobbies.get(ws.lobbyCode);
    if (!lobby) {
      send(ws, { type: 'error', message: 'Lobby no longer exists.' });
      ws.lobbyCode = null;
      ws.playerId = null;
      ws.isHost = false;
      return;
    }

    if (msg.type === 'state' || msg.type === 'action') {
      broadcastToLobby(lobby, msg, ws.playerId);
      return;
    }
  });

  ws.on('close', () => {
    removeMember(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Arcade Blackjack Royale server running on http://localhost:${PORT}`);
});
