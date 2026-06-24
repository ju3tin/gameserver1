const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// room -> Set of clients
const rooms = new Map();

const wss = new WebSocket.Server({
  server,
  path: "/"
});

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// health check
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


// -------------------- HELPERS --------------------

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


// -------------------- WEBSOCKET --------------------

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

      // ---------------- CREATE GAME ----------------
      if (event === "create-game" && room) {
        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }

        rooms.get(room).add(ws);
        ws.rooms.add(room);

        ws.send(JSON.stringify({
          event: "game-created",
          room
        }));

        broadcastPlayerCount(room);
      }


      // ---------------- JOIN GAME ----------------
      else if (event === "join-room" && room) {
        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }

        rooms.get(room).add(ws);
        ws.rooms.add(room);

        ws.send(JSON.stringify({
          event: "room-joined",
          room
        }));

        broadcastPlayerCount(room);
      }


      // ---------------- LEAVE GAME ----------------
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


      // ---------------- ROOM MESSAGES ----------------
      else if (room) {
        // security: must be in room
        if (!ws.rooms.has(room)) {
          ws.send(JSON.stringify({
            event: "error",
            message: "You are not in this room"
          }));
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
          timestamp: Date.now()
        });

        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(packet);
          }
        });
      }

    } catch (err) {
      console.error("Message error:", err);
    }
  });


  // ---------------- CLEANUP ON DISCONNECT ----------------
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


// -------------------- START SERVER --------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
