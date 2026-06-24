const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;   // Important: Use Render's PORT

const rooms = new Map();
const wss = new WebSocket.Server({ 
  server,
  path: '/'   // Explicit path
});

// CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

app.options('*', cors());

// Health check (important for Render)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    rooms: rooms.size,
    connections: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.json({ status: "running", websocket: true });
});

// WebSocket Server
wss.on("connection", (ws) => {
  console.log("✅ Client connected");
  ws.rooms = new Set();

  ws.send(JSON.stringify({ 
    event: "connected", 
    message: "Connected successfully" 
  }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { event, room, userId, message, payload } = data;

      if (event === "join-room" && room) {
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        if (!ws.rooms) ws.rooms = new Set();
        ws.rooms.add(room);

        ws.send(JSON.stringify({ event: "room-joined", payload: { room } }));
        // Broadcast to others
        const clients = rooms.get(room);
        clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              event: "user-joined",
              payload: { userId, room }
            }));
          }
        });
      } 
      else if (event === "leave-room" && room) {
        // leave logic...
      } 
      else if (room) {
        // broadcast
        const clients = rooms.get(room);
        if (clients) {
          const packet = JSON.stringify({ event, room, userId, message, payload, timestamp: Date.now() });
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(packet);
            }
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (ws.rooms) {
      ws.rooms.forEach(r => {
        if (rooms.has(r)) rooms.get(r).delete(ws);
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {   // Bind to 0.0.0.0
  console.log(`🚀 Server running on port ${PORT}`);
});
