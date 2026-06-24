const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const rooms = new Map();

app.get("/", (req, res) => {
res.json({
status: "running",
websocket: true
});
});

app.get("/health", (req, res) => {
res.json({
status: "healthy",
clients: wss.clients.size,
rooms: rooms.size,
uptime: process.uptime()
});
});

const wss = new WebSocket.Server({ server });

function send(ws, data) {
if (ws.readyState === WebSocket.OPEN) {
ws.send(JSON.stringify(data));
}
}

function joinRoom(ws, room) {
if (!rooms.has(room)) {
rooms.set(room, new Set());
}

rooms.get(room).add(ws);
ws.rooms.add(room);
}

function leaveRoom(ws, room) {
const clients = rooms.get(room);

if (!clients) return;

clients.delete(ws);
ws.rooms.delete(room);

if (clients.size === 0) {
rooms.delete(room);
}
}

function broadcast(room, data, exclude = null) {
const clients = rooms.get(room);

if (!clients) return;

const packet = JSON.stringify(data);

for (const client of clients) {
if (
client !== exclude &&
client.readyState === WebSocket.OPEN
) {
client.send(packet);
}
}
}

wss.on("connection", (ws) => {
ws.rooms = new Set();

send(ws, {
event: "connected",
message: "Connected successfully",
payload: null
});

ws.on("message", (raw) => {
try {
const data = JSON.parse(raw.toString());

```
  const {
    event,
    room,
    userId,
    message,
    payload
  } = data;

  switch (event) {
    case "join-room":
      joinRoom(ws, room);

      send(ws, {
        event: "room-joined",
        message: `Joined ${room}`,
        payload: { room }
      });

      broadcast(
        room,
        {
          event: "user-joined",
          message: `${userId} joined`,
          payload: {
            room,
            userId
          }
        },
        ws
      );
      break;

    case "leave-room":
      leaveRoom(ws, room);

      send(ws, {
        event: "room-left",
        message: `Left ${room}`,
        payload: { room }
      });
      break;

    default:
      broadcast(room, {
        event,
        room,
        userId,
        message: message || null,
        payload: payload || null,
        timestamp: Date.now()
      });
  }
} catch {
  send(ws, {
    event: "error",
    message: "Invalid JSON",
    payload: null
  });
}
```

});

ws.on("close", () => {
for (const room of ws.rooms) {
leaveRoom(ws, room);
}
});
});

server.listen(PORT, () => {
console.log(`Server listening on port ${PORT}`);
});
