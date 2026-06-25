const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;   // ← Important for Render

const ADMIN_TOKEN = "your-super-secret-admin-token";

const rooms = new Map();

const wss = new WebSocket.Server({ 
  server,           // ← Attach to the same HTTP server
  path: "/" 
});

app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ====================== HTTP ROUTES ======================
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    rooms: rooms.size,
    connections: wss.clients.size 
  });
});

app.get("/api/rooms", (req, res) => {
  const list = Array.from(rooms.entries()).map(([name, data]) => ({
    room: name,
    players: data.players.size,
    maxPlayers: data.maxPlayers,
    status: data.status
  }));
  res.json({ success: true, rooms: list });
});

// ====================== HELPERS ======================
function broadcastToRoom(room, event, data = {}) {
  const roomData = rooms.get(room);
  if (!roomData) return;

  const packet = JSON.stringify({ event, room, ...data, timestamp: Date.now() });

  roomData.players.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(packet);
    }
  });
}

// ====================== WEBSOCKET ======================
wss.on("connection", (ws, req) => {
  console.log("✅ New client connected");

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    ws.isAdmin = url.searchParams.get("admin") === "true" && 
                 url.searchParams.get("token") === ADMIN_TOKEN;
  } catch (e) {
    ws.isAdmin = false;
  }

  ws.currentRoom = null;

  ws.send(JSON.stringify({ event: "connected", isAdmin: ws.isAdmin }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      console.log(`📨 Event: ${data.event} | Room: ${data.room || ws.currentRoom}`);

      const { event, room, maxPlayers } = data;

      if (event === "create-room") {
        let newRoom = room || "room-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const maxP = parseInt(maxPlayers) || 4;

        if (rooms.has(newRoom)) {
          return ws.send(JSON.stringify({ event: "error", message: "Room already exists" }));
        }

        rooms.set(newRoom, {
          maxPlayers: maxP,
          players: new Set([ws]),
          readyPlayers: new Set(),
          status: "waiting"
        });

        ws.currentRoom = newRoom;

        ws.send(JSON.stringify({ event: "room-created", room: newRoom, maxPlayers: maxP }));
        broadcastToRoom(newRoom, "player-joined", { players: 1, maxPlayers: maxP });
      } 
      // ... (keep the rest of your events: join-room, ready, chat, etc.)
      else if (event === "join-room" && room) {
        // ... your existing join logic
      }
      // Add other events similarly

    } catch (err) {
      console.error("Message error:", err);
    }
  });

  ws.on("close", () => {
    console.log("❌ Client disconnected");
    // cleanup logic...
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🔗 WebSocket ready at wss://your-render-url.onrender.com`);
});
