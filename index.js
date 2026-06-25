const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = "your-super-secret-admin-token";

const rooms = new Map();

const wss = new WebSocket.Server({ server, path: "/" });

app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// HTTP Routes
app.get("/health", (req, res) => res.json({ status: "ok", rooms: rooms.size }));

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
    if (client.readyState === WebSocket.OPEN) client.send(packet);
  });
}

// ====================== WEBSOCKET ======================
wss.on("connection", (ws, req) => {
  console.log("✅ Client connected");

  // Admin check
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
      const { event, room, maxPlayers } = data;

      console.log(`📨 ${event} | Room: ${room || ws.currentRoom}`);

      // CREATE ROOM
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

        ws.send(JSON.stringify({ event: "room-created", room: newRoom, maxPlayers: maxP, players: 1 }));
        broadcastToRoom(newRoom, "player-joined", { players: 1, maxPlayers: maxP });
      }

      // JOIN ROOM - FIXED
      else if (event === "join-room" && room) {
        const roomData = rooms.get(room);
        if (!roomData) {
          return ws.send(JSON.stringify({ event: "error", message: "Room not found" }));
        }
        if (roomData.players.size >= roomData.maxPlayers) {
          return ws.send(JSON.stringify({ event: "error", message: "Room is full" }));
        }
        if (roomData.status === "playing") {
          return ws.send(JSON.stringify({ event: "error", message: "Game already started" }));
        }

        roomData.players.add(ws);
        ws.currentRoom = room;

        ws.send(JSON.stringify({ 
          event: "room-joined", 
          room, 
          players: roomData.players.size, 
          maxPlayers: roomData.maxPlayers 
        }));

        broadcastToRoom(room, "player-joined", { 
          players: roomData.players.size, 
          maxPlayers: roomData.maxPlayers 
        });
      }

      // READY
      else if (event === "ready" && ws.currentRoom) {
        const roomData = rooms.get(ws.currentRoom);
        if (!roomData) return;

        roomData.readyPlayers.add(ws);

        const isAllReady = roomData.readyPlayers.size === roomData.players.size && roomData.players.size >= 2;

        broadcastToRoom(ws.currentRoom, "ready-update", {
          readyCount: roomData.readyPlayers.size,
          totalPlayers: roomData.players.size,
          allReady: isAllReady
        });

        if (isAllReady) {
          // Start countdown
          let timeLeft = 5;
          roomData.status = "countdown";
          broadcastToRoom(ws.currentRoom, "countdown", { timeLeft });

          const interval = setInterval(() => {
            timeLeft--;
            broadcastToRoom(ws.currentRoom, "countdown", { timeLeft });

            if (timeLeft <= 0) {
              clearInterval(interval);
              roomData.status = "playing";
              broadcastToRoom(ws.currentRoom, "game-start", { message: "Game Started!" });
            }
          }, 1000);
        }
      }

      // CHAT MESSAGE
      else if (event === "chat" && (room || ws.currentRoom)) {
        const targetRoom = room || ws.currentRoom;
        const roomData = rooms.get(targetRoom);
        if (roomData && roomData.players.has(ws)) {
          broadcastToRoom(targetRoom, "chat", {
            userId: ws.isAdmin ? "ADMIN" : "Player",
            message: data.message,
            fromAdmin: ws.isAdmin
          });
        }
      }

    } catch (err) {
      console.error("Error:", err);
    }
  });

  ws.on("close", () => {
    if (ws.currentRoom) {
      const roomData = rooms.get(ws.currentRoom);
      if (roomData) {
        roomData.players.delete(ws);
        roomData.readyPlayers.delete(ws);

        if (roomData.players.size === 0) {
          rooms.delete(ws.currentRoom);
        } else {
          broadcastToRoom(ws.currentRoom, "player-left", { players: roomData.players.size });
        }
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
