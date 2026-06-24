const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = "your-super-secret-admin-token"; // Change this in production!

const rooms = new Map(); // roomName -> roomData

const wss = new WebSocket.Server({ 
  server, 
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

app.post("/api/rooms", (req, res) => {
  let { room, maxPlayers = 4 } = req.body;
  if (!room) room = "room-" + Math.random().toString(36).substring(2, 10).toUpperCase();

  if (rooms.has(room)) {
    return res.status(409).json({ success: false, message: "Room already exists" });
  }

  rooms.set(room, {
    maxPlayers: parseInt(maxPlayers),
    players: new Set(),
    readyPlayers: new Set(),
    status: "waiting",
    countdownInterval: null
  });

  console.log(`📌 Room created via API: ${room}`);
  res.status(201).json({ success: true, room, maxPlayers: parseInt(maxPlayers) });
});

// ====================== HELPERS ======================
function getRoomData(room) {
  return rooms.get(room);
}

function broadcastToRoom(room, event, data = {}) {
  const roomData = getRoomData(room);
  if (!roomData) return;

  const packet = JSON.stringify({ 
    event, 
    room, 
    ...data, 
    timestamp: Date.now() 
  });

  roomData.players.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(packet);
    }
  });
}

function startCountdown(room) {
  const roomData = getRoomData(room);
  if (!roomData || roomData.status === "countdown") return;

  roomData.status = "countdown";
  let timeLeft = 5;

  broadcastToRoom(room, "countdown", { timeLeft });

  roomData.countdownInterval = setInterval(() => {
    timeLeft--;
    broadcastToRoom(room, "countdown", { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(roomData.countdownInterval);
      roomData.status = "playing";
      broadcastToRoom(room, "game-start", { message: "Game Started!" });
      console.log(`🎮 Game started in room: ${room}`);
    }
  }, 1000);
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

  ws.send(JSON.stringify({ 
    event: "connected", 
    isAdmin: ws.isAdmin 
  }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { event, room, maxPlayers, userId, message } = data;

      console.log(`📨 Received event: ${event} | Room: ${room || ws.currentRoom}`);

      // CREATE ROOM
      if (event === "create-room") {
        let newRoom = room || "room-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const maxP = parseInt(maxPlayers) || 4;

        if (rooms.has(newRoom)) {
          return ws.send(JSON.stringify({ event: "error", message: "Room already exists" }));
        }

        rooms.set(newRoom, {
          maxPlayers: maxP,
          players: new Set(),
          readyPlayers: new Set(),
          status: "waiting"
        });

        const roomData = rooms.get(newRoom);
        roomData.players.add(ws);
        ws.currentRoom = newRoom;

        ws.send(JSON.stringify({ 
          event: "room-created", 
          room: newRoom, 
          maxPlayers: maxP 
        }));

        broadcastToRoom(newRoom, "player-joined", { 
          players: 1, 
          maxPlayers: maxP 
        });
      }

      // JOIN ROOM
      else if (event === "join-room" && room) {
        const roomData = getRoomData(room);
        if (!roomData) return ws.send(JSON.stringify({ event: "error", message: "Room not found" }));
        if (roomData.players.size >= roomData.maxPlayers) {
          return ws.send(JSON.stringify({ event: "error", message: "Room is full" }));
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

      // READY / UNREADY
      else if ((event === "ready" || event === "unready") && ws.currentRoom) {
        const roomData = getRoomData(ws.currentRoom);
        if (!roomData) return;

        if (event === "ready") roomData.readyPlayers.add(ws);
        else roomData.readyPlayers.delete(ws);

        const isAllReady = roomData.readyPlayers.size === roomData.players.size && 
                          roomData.players.size >= 2;

        broadcastToRoom(ws.currentRoom, "ready-update", {
          readyCount: roomData.readyPlayers.size,
          totalPlayers: roomData.players.size,
          allReady: isAllReady
        });

        if (isAllReady && roomData.status === "waiting") {
          startCountdown(ws.currentRoom);
        }
      }

      // CHAT / GAME MESSAGES
      else if (room || ws.currentRoom) {
        const targetRoom = room || ws.currentRoom;
        const roomData = getRoomData(targetRoom);
        if (!roomData || !roomData.players.has(ws)) {
          return ws.send(JSON.stringify({ event: "error", message: "Not in this room" }));
        }

        broadcastToRoom(targetRoom, event, {
          userId: userId || (ws.isAdmin ? "ADMIN" : "Player"),
          message,
          fromAdmin: ws.isAdmin,
          payload: data.payload
        });
      }
    } catch (err) {
      console.error("Message parsing error:", err);
      ws.send(JSON.stringify({ event: "error", message: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("❌ Client disconnected");
    if (ws.currentRoom) {
      const roomData = getRoomData(ws.currentRoom);
      if (roomData) {
        roomData.players.delete(ws);
        roomData.readyPlayers.delete(ws);

        if (roomData.players.size === 0) {
          rooms.delete(ws.currentRoom);
        } else {
          broadcastToRoom(ws.currentRoom, "player-left", {
            players: roomData.players.size,
            maxPlayers: roomData.maxPlayers
          });
        }
      }
    }
  });
});

// Start Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Test connection: ws://localhost:${PORT}`);
  console.log(`🔑 Admin URL: ws://localhost:${PORT}?admin=true&token=${ADMIN_TOKEN}`);
});
