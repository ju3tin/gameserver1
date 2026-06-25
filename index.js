const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const ADMIN_TOKEN = "your-super-secret-admin-token";

const rooms = new Map(); // gameId -> roomData

const wss = new WebSocket.Server({ server, path: "/" });

app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ====================== HTTP ======================
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/rooms", (req, res) => {
  const list = Array.from(rooms.entries()).map(([gameId, data]) => ({
    gameId,
    room: data.room,
    players: data.players.size,
    maxPlayers: data.maxPlayers,
    status: data.status
  }));
  res.json({ success: true, rooms: list });
});

// ====================== WEBSOCKET ======================
wss.on("connection", (ws, req) => {
  console.log("✅ Client connected");

  ws.userId = null;
  ws.currentGameId = null;
  ws.isAdmin = false;

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    ws.isAdmin = url.searchParams.get("admin") === "true" && 
                 url.searchParams.get("token") === ADMIN_TOKEN;
  } catch (e) {}

  ws.send(JSON.stringify({ event: "connected", isAdmin: ws.isAdmin }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const { event, gameId, room, userId, maxPlayers, message } = data;

      // Set User ID
      if (userId) ws.userId = userId;

      // CREATE ROOM / GAME
      if (event === "create-room") {
        const newGameId = gameId || "game-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const newRoom = room || newGameId;

        if (rooms.has(newGameId)) {
          return ws.send(JSON.stringify({ event: "error", message: "Game ID already exists" }));
        }

        rooms.set(newGameId, {
          gameId: newGameId,
          room: newRoom,
          maxPlayers: parseInt(maxPlayers) || 4,
          players: new Set([ws]),
          readyPlayers: new Set(),
          status: "waiting"
        });

        ws.currentGameId = newGameId;
        ws.userId = ws.userId || "Host";

        ws.send(JSON.stringify({
          event: "room-created",
          gameId: newGameId,
          room: newRoom,
          maxPlayers: parseInt(maxPlayers) || 4,
          userId: ws.userId
        }));

        broadcastToRoom(newGameId, "player-joined", {
          players: 1,
          maxPlayers: parseInt(maxPlayers) || 4,
          userId: ws.userId
        });
      }

      // JOIN GAME
      else if (event === "join-room" && gameId) {
        const gameData = rooms.get(gameId);
        if (!gameData) return ws.send(JSON.stringify({ event: "error", message: "Game not found" }));
        if (gameData.players.size >= gameData.maxPlayers) {
          return ws.send(JSON.stringify({ event: "error", message: "Game is full" }));
        }

        gameData.players.add(ws);
        ws.currentGameId = gameId;
        ws.userId = ws.userId || `Player${gameData.players.size}`;

        ws.send(JSON.stringify({
          event: "room-joined",
          gameId,
          room: gameData.room,
          players: gameData.players.size,
          maxPlayers: gameData.maxPlayers,
          userId: ws.userId
        }));

        broadcastToRoom(gameId, "player-joined", {
          players: gameData.players.size,
          maxPlayers: gameData.maxPlayers,
          userId: ws.userId
        });
      }

      // READY
      else if (event === "ready" && ws.currentGameId) {
        const gameData = rooms.get(ws.currentGameId);
        if (!gameData) return;

        gameData.readyPlayers.add(ws);

        const isAllReady = gameData.readyPlayers.size === gameData.players.size && gameData.players.size >= 2;

        broadcastToRoom(ws.currentGameId, "ready-update", {
          readyCount: gameData.readyPlayers.size,
          totalPlayers: gameData.players.size,
          allReady: isAllReady
        });

        if (isAllReady) startCountdown(ws.currentGameId);
      }

      // CHAT
      else if (event === "chat" && ws.currentGameId) {
        broadcastToRoom(ws.currentGameId, "chat", {
          userId: ws.userId || "Unknown",
          message,
          fromAdmin: ws.isAdmin
        });
      }
    } catch (err) {
      console.error(err);
    }
  });

  ws.on("close", () => {
    if (ws.currentGameId) {
      const gameData = rooms.get(ws.currentGameId);
      if (gameData) {
        gameData.players.delete(ws);
        gameData.readyPlayers.delete(ws);
        if (gameData.players.size === 0) rooms.delete(ws.currentGameId);
        else broadcastToRoom(ws.currentGameId, "player-left", { players: gameData.players.size });
      }
    }
  });
});

function broadcastToRoom(gameId, event, data = {}) {
  const gameData = rooms.get(gameId);
  if (!gameData) return;

  const packet = JSON.stringify({ event, gameId, ...data, timestamp: Date.now() });
  gameData.players.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(packet);
  });
}

function startCountdown(gameId) {
  const gameData = rooms.get(gameId);
  if (!gameData) return;

  gameData.status = "countdown";
  let timeLeft = 5;

  broadcastToRoom(gameId, "countdown", { timeLeft });

  const interval = setInterval(() => {
    timeLeft--;
    broadcastToRoom(gameId, "countdown", { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(interval);
      gameData.status = "playing";
      broadcastToRoom(gameId, "game-start", { message: "Game Started!" });
    }
  }, 1000);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
