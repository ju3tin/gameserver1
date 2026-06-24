const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const rooms = new Map();
const wss = new WebSocket.Server({ server });

// CORS Setup
app.use(cors({
  origin: [
    "https://motionplay.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
    "*"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options('*', cors());

// Routes
app.get("/", (req, res) => {
  res.json({ status: "running", websocket: true });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    rooms: rooms.size,
    connections: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

// WebSocket Logic
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function joinRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  if (!ws.rooms) ws.rooms = new Set();
  ws.rooms.add(room);
}

function leaveRoom(ws, room) {
  if (!rooms.has(room)) return;
  const clients = rooms.get(room);
  clients.delete(ws);
  if (ws.rooms) ws.rooms.delete(room);
  if (clients.size === 0) rooms.delete(room);
}

function broadcast(room, data, exclude) {
  const clients = rooms.get(room);
  if (!clients) return;
  const packet = JSON.stringify(data);
  clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(packet);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("Client connected");
  ws.rooms = new Set();

  send(ws, { event: "connected", message: "Connected successfully" });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { event, room, userId, message, payload } = data;

      if (event === "join-room" && room) {
        joinRoom(ws, room);
        send(ws, { event: "room-joined", message: "Joined room", payload: { room } });
        broadcast(room, { event: "user-joined", message: "User joined room", payload: { room, userId } }, ws);
        return;
      }

      if (event === "leave-room" && room) {
        leaveRoom(ws, room);
        send(ws, { event: "room-left", message: "Left room", payload: { room } });
        return;
      }

      if (room) {
        broadcast(room, {
          event,
          room,
          userId: userId || null,
          message: message || null,
          payload: payload || null,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(error);
      send(ws, { event: "error", message: "Invalid JSON" });
    }
  });

  ws.on("close", () => {
    if (ws.rooms) {
      ws.rooms.forEach(room => leaveRoom(ws, room));
    }
    console.log("Client disconnected");
  });

  ws.on("error", (error) => console.error(error));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
