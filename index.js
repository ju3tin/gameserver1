const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Admin secret - CHANGE THIS IN PRODUCTION!
const ADMIN_TOKEN = "your-super-secret-admin-token";

// room -> Set of WebSocket clients
const rooms = new Map();

const wss = new WebSocket.Server({
  server,
  path: "/"
});

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ====================== HTTP ROUTES ======================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rooms: rooms.size,
    connections: wss.clients.size,
    uptime: process.uptime()
  });
});

app.get("/", (req, res) => {
  res.json({ status: "running", websocket: true });
});

// GET all rooms
app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomName, clients]) => ({
    room: roomName,
    players: clients.size
  }));

  res.json({
    success: true,
    totalRooms: roomList.length,
    rooms: roomList
  });
});

// POST: Create a new room via API
app.post("/api/rooms", (req, res) => {
  const { room, createdBy } = req.body;
  let newRoom = room;

  // Auto-generate room name if not provided
  if (!newRoom) {
    newRoom = "room-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  // Check if room already exists
  if (rooms.has(newRoom)) {
    return res.status(409).json({
      success: false,
      message: "Room already exists",
      room: newRoom
    });
  }

  // Create the room (even if no one is connected yet)
  rooms.set(newRoom, new Set());

  console.log(`📌 Room created via API: ${newRoom} (by ${createdBy || 'API'})`);

  res.status(201).json({
    success: true,
    message: "Room created successfully",
    room: newRoom,
    players: 0
  });
});

// Protected admin rooms list
app.get("/api/admin/rooms", (req, res) => {
  const token = req.query.token || req.headers.authorization?.split(" ")[1];

  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  const roomList = Array.from(rooms.entries()).map(([roomName, clients]) => ({
    room: roomName,
    players: clients.size
  }));

  res.json({
    success: true,
    totalRooms: roomList.length,
    rooms: roomList
  });
});

// ====================== HELPERS ======================
function broadcastPlayerCount(room) {
  const clients = rooms.get(room);
  if (!clients) return;

  const msg = JSON.stringify({
    event: "player-count",
    room,
    count: clients.size
  });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

// ====================== WEBSOCKET ======================
wss.on("connection", (ws, req) => {
  console.log("✅ Client connected");

  // Admin Authentication
  const url = new URL(req.url, `http://${req.headers.host}`);
  const isAdminParam = url.searchParams.get("admin") === "true";
  const token = url.searchParams.get("token");

  ws.isAdmin = isAdminParam && token === ADMIN_TOKEN;
  ws.rooms = new Set();

  ws.send(JSON.stringify({
    event: "connected",
    message: "Connected successfully",
    isAdmin: ws.isAdmin
  }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { event, room, userId, message, payload } = data;

      // ---------------- CREATE ROOM (WebSocket) ----------------
      if (event === "create-room") {
        let newRoom = room;

        if (!newRoom) {
          newRoom = "room-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        }

        if (!rooms.has(newRoom)) {
          rooms.set(newRoom, new Set());
        }

        rooms.get(newRoom).add(ws);
        ws.rooms.add(newRoom);

        ws.send(JSON.stringify({
          event: "room-created",
          room: newRoom,
          isAdmin: ws.isAdmin
        }));

        broadcastPlayerCount(newRoom);
      }

      // ---------------- JOIN ROOM ----------------
      else if ((event === "join-room" || event === "admin:join-room") && room) {
        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }

        rooms.get(room).add(ws);
        ws.rooms.add(room);

        ws.send(JSON.stringify({
          event: ws.isAdmin ? "admin:room-joined" : "room-joined",
          room
        }));

        broadcastPlayerCount(room);
      }

      // ---------------- LEAVE ROOM ----------------
      else if (event === "leave-room" && room) {
        const clients = rooms.get(room);
        if (clients) {
          clients.delete(ws);
          ws.rooms.delete(room);

          if (clients.size === 0) {
            rooms.delete(room);
          } else {
            broadcastPlayerCount(room);
          }
        }
      }

      // ---------------- ADMIN: GET ALL ROOMS ----------------
      else if (event === "admin:get-rooms" && ws.isAdmin) {
        const roomList = Array.from(rooms.entries()).map(([roomName, clients]) => ({
          room: roomName,
          players: clients.size
        }));

        ws.send(JSON.stringify({
          event: "admin:rooms-list",
          total: roomList.length,
          rooms: roomList
        }));
      }

      // ---------------- BROADCAST MESSAGE ----------------
      else if (room) {
        if (!ws.isAdmin && !ws.rooms.has(room)) {
          ws.send(JSON.stringify({ event: "error", message: "You are not in this room" }));
          return;
        }

        const clients = rooms.get(room);
        if (!clients) return;

        const packet = JSON.stringify({
          event,
          room,
          userId,
          message,
          payload,
          timestamp: Date.now(),
          fromAdmin: ws.isAdmin
        });

        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(packet);
          }
        });
      }
    } catch (err) {
      console.error("Message error:", err);
      ws.send(JSON.stringify({ event: "error", message: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("❌ Client disconnected");
    ws.rooms.forEach(room => {
      const clients = rooms.get(room);
      if (!clients) return;
      clients.delete(ws);
      if (clients.size === 0) {
        rooms.delete(room);
      } else {
        broadcastPlayerCount(room);
      }
    });
  });
});

// Start Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🔗 Admin URL: ws://localhost:${PORT}?admin=true&token=${ADMIN_TOKEN}`);
});
