const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'game-data.json');

const matchQueue = [];
const activeGames = {};
const activeMatches = {};
const challenges = [];
let matchIdCounter = 1;
let challengeIdCounter = 1;

const BOARD_SIZE = 15;

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { users: [], nextId: 1 };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function checkWin(board, row, col, player) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

function getWinLine(board, row, col, player) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [{ row, col }];
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break;
      cells.push({ row: r, col: c });
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break;
      cells.push({ row: r, col: c });
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

function endGameAndUpdateScores(game) {
  const db = readDB();
  const pList = Object.values(game.players);
  const p1 = db.users.find(u => u.id === pList[0].id);
  const p2 = db.users.find(u => u.id === pList[1].id);
  if (!p1 || !p2) return;

  if (game.winner) {
    const winUser = db.users.find(u => u.id === game.winner);
    const loseUser = db.users.find(u => u.id === (pList[0].id === game.winner ? pList[1].id : pList[0].id));
    if (winUser) { winUser.score += 10; winUser.wins += 1; }
    if (loseUser) { loseUser.score += 1; loseUser.losses += 1; }
  } else {
    p1.score += 5; p1.draws += 1;
    p2.score += 5; p2.draws += 1;
  }
  writeDB(db);

  pList.forEach(p => delete activeMatches[p.id]);
}

// ============ AUTH ============
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  const db = readDB();
  let user = db.users.find(u => u.username === username);

  if (user) {
    if (!bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: '密码错误' });
  } else {
    const hp = bcrypt.hashSync(password, 10);
    user = { id: db.nextId++, username, password: hp, nickname: username, score: 0, wins: 0, losses: 0, draws: 0, friends: [], created_at: new Date().toISOString() };
    db.users.push(user);
    writeDB(db);
  }
  const { password: _, ...safe } = user;
  res.json({ ...safe, friends: safe.friends || [] });
});

// ============ SEARCH ============
app.get('/api/users/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const db = readDB();
  const results = db.users.filter(u => u.username.toLowerCase().includes(q))
    .slice(0, 10).map(u => ({ id: u.id, username: u.username, nickname: u.nickname, score: u.score }));
  res.json(results);
});

// ============ FRIENDS ============
app.get('/api/friends', (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.status(400).json({ error: '缺少 userId' });
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const friends = db.users.filter(u => (user.friends || []).includes(u.id))
    .map(u => ({ id: u.id, username: u.username, nickname: u.nickname, score: u.score }));
  res.json(friends);
});

app.post('/api/friends/add', (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId || !friendId) return res.status(400).json({ error: '缺少参数' });
  if (userId === friendId) return res.status(400).json({ error: '不能添加自己为好友' });

  const db = readDB();
  const u1 = db.users.find(u => u.id === userId);
  const u2 = db.users.find(u => u.id === friendId);
  if (!u1 || !u2) return res.status(404).json({ error: '用户不存在' });
  if (!u1.friends) u1.friends = [];
  if (!u2.friends) u2.friends = [];
  if (u1.friends.includes(friendId)) return res.status(400).json({ error: '已经是好友' });

  u1.friends.push(friendId);
  u2.friends.push(userId);
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/friends/:userId/:friendId', (req, res) => {
  const uid = parseInt(req.params.userId), fid = parseInt(req.params.friendId);
  const db = readDB();
  const u1 = db.users.find(u => u.id === uid);
  const u2 = db.users.find(u => u.id === fid);
  if (u1) u1.friends = (u1.friends || []).filter(f => f !== fid);
  if (u2) u2.friends = (u2.friends || []).filter(f => f !== uid);
  writeDB(db);
  res.json({ success: true });
});

// ============ MATCHMAKING ============
app.post('/api/match/join', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少 userId' });

  if (activeMatches[userId]) return res.json({ status: 'matched', ...activeMatches[userId] });
  if (matchQueue.some(e => e.userId === userId)) return res.json({ status: 'waiting' });

  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (matchQueue.length > 0) {
    let bestIdx = 0, bestDiff = Math.abs(matchQueue[0].score - user.score);
    for (let i = 1; i < matchQueue.length; i++) {
      const diff = Math.abs(matchQueue[i].score - user.score);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    const opp = matchQueue.splice(bestIdx, 1)[0];
    const colorA = Math.random() < 0.5 ? 'black' : 'white';
    const colorB = colorA === 'black' ? 'white' : 'black';
    const mid = matchIdCounter++;

    const game = { board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0)), currentPlayer: 1, gameOver: false, winner: null, lastMove: null, winLine: null, players: {} };
    game.players[userId] = { id: userId, username: user.username, score: user.score, color: colorA };
    game.players[opp.userId] = { id: opp.userId, username: opp.username, score: opp.score, color: colorB };
    activeGames[mid] = game;

    const md1 = { matchId: mid, opponent: { id: opp.userId, username: opp.username, score: opp.score }, color: colorA };
    const md2 = { matchId: mid, opponent: { id: userId, username: user.username, score: user.score }, color: colorB };
    activeMatches[userId] = md1;
    activeMatches[opp.userId] = md2;
    return res.json({ status: 'matched', ...md1 });
  }

  matchQueue.push({ userId: userId, username: user.username, score: user.score });
  res.json({ status: 'waiting' });
});

app.post('/api/match/leave', (req, res) => {
  const idx = matchQueue.findIndex(e => e.userId === req.body.userId);
  if (idx >= 0) matchQueue.splice(idx, 1);
  res.json({ success: true });
});

app.get('/api/match/status', (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.json({ status: 'none' });
  if (activeMatches[userId]) return res.json({ status: 'matched', ...activeMatches[userId] });
  res.json({ status: matchQueue.some(e => e.userId === userId) ? 'waiting' : 'none' });
});

// ============ CHALLENGES ============
app.post('/api/challenge/send', (req, res) => {
  const { fromUserId, toUserId } = req.body;
  if (!fromUserId || !toUserId) return res.status(400).json({ error: '缺少参数' });
  if (fromUserId === toUserId) return res.status(400).json({ error: '不能挑战自己' });

  const db = readDB();
  const from = db.users.find(u => u.id === fromUserId);
  const to = db.users.find(u => u.id === toUserId);
  if (!from || !to) return res.status(404).json({ error: '用户不存在' });

  if (challenges.some(c => c.fromUserId === fromUserId && c.toUserId === toUserId && c.status === 'pending'))
    return res.status(400).json({ error: '已有待处理的挑战' });
  if (challenges.some(c => c.fromUserId === toUserId && c.toUserId === fromUserId && c.status === 'pending'))
    return res.status(400).json({ error: '对方已向你发起挑战' });

  const c = { id: challengeIdCounter++, fromUserId, fromUsername: from.username, fromScore: from.score, toUserId, toUsername: to.username, status: 'pending', createdAt: Date.now() };
  challenges.push(c);
  res.json({ challengeId: c.id });
});

app.get('/api/challenges/sent', (req, res) => {
  const userId = parseInt(req.query.userId);
  const sent = challenges.filter(c => c.fromUserId === userId && c.status === 'pending')
    .map(c => ({ id: c.id, toUserId: c.toUserId, toUsername: c.toUsername, status: c.status }));
  res.json(sent);
});

app.post('/api/challenge/respond', (req, res) => {
  const { challengeId, accept } = req.body;
  const c = challenges.find(c => c.id === challengeId && c.status === 'pending');
  if (!c) return res.status(404).json({ error: '挑战不存在或已处理' });

  if (accept) {
    c.status = 'accepted';
    const db = readDB();
    const from = db.users.find(u => u.id === c.fromUserId);
    const to = db.users.find(u => u.id === c.toUserId);
    if (!from || !to) return res.status(404).json({ error: '用户不存在' });

    const colorA = Math.random() < 0.5 ? 'black' : 'white';
    const colorB = colorA === 'black' ? 'white' : 'black';
    const mid = matchIdCounter++;

    const game = { board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0)), currentPlayer: 1, gameOver: false, winner: null, lastMove: null, winLine: null, players: {} };
    game.players[c.fromUserId] = { id: c.fromUserId, username: from.username, score: from.score, color: colorA };
    game.players[c.toUserId] = { id: c.toUserId, username: to.username, score: to.score, color: colorB };
    activeGames[mid] = game;

    activeMatches[c.fromUserId] = { matchId: mid, opponent: { id: c.toUserId, username: to.username, score: to.score }, color: colorA };
    activeMatches[c.toUserId] = { matchId: mid, opponent: { id: c.fromUserId, username: from.username, score: from.score }, color: colorB };
    return res.json({ status: 'matched', ...activeMatches[c.toUserId] });
  } else {
    c.status = 'declined';
    res.json({ success: true });
  }
});

app.get('/api/challenges', (req, res) => {
  const userId = parseInt(req.query.userId);
  const pending = challenges.filter(c => c.toUserId === userId && c.status === 'pending')
    .map(c => ({ id: c.id, fromUserId: c.fromUserId, fromUsername: c.fromUsername, fromScore: c.fromScore }));
  res.json(pending);
});

// ============ GAME ============
app.post('/api/game/move', (req, res) => {
  const { matchId, userId, row, col } = req.body;
  const game = activeGames[matchId];
  if (!game) return res.status(404).json({ error: '游戏不存在' });

  const player = game.players[userId];
  if (!player) return res.status(403).json({ error: '你不是这个游戏的玩家' });
  if (game.gameOver) return res.status(400).json({ error: '游戏已结束' });

  const pv = player.color === 'black' ? 1 : 2;
  if (game.currentPlayer !== pv) return res.status(400).json({ error: '还没轮到你' });
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return res.status(400).json({ error: '无效坐标' });
  if (game.board[row][col] !== 0) return res.status(400).json({ error: '该位置已有棋子' });

  game.board[row][col] = pv;
  game.lastMove = { row, col };

  if (checkWin(game.board, row, col, pv)) {
    game.gameOver = true;
    game.winner = userId;
    game.winLine = getWinLine(game.board, row, col, pv);
    endGameAndUpdateScores(game);
    return res.json({ success: true, gameOver: true, winner: userId });
  }

  if (game.board.every(r => r.every(c => c !== 0))) {
    game.gameOver = true;
    game.winner = null;
    endGameAndUpdateScores(game);
    return res.json({ success: true, gameOver: true, winner: null });
  }

  game.currentPlayer = pv === 1 ? 2 : 1;
  res.json({ success: true, gameOver: false });
});

app.get('/api/game/state', (req, res) => {
  const mid = parseInt(req.query.matchId), uid = parseInt(req.query.userId);
  if (!mid || !uid) return res.status(400).json({ error: '缺少参数' });

  const game = activeGames[mid];
  if (!game) return res.status(404).json({ error: '游戏不存在' });

  const player = game.players[uid];
  if (!player) return res.status(403).json({ error: '你不是这个游戏的玩家' });

  res.json({
    board: game.board, currentPlayer: game.currentPlayer, gameOver: game.gameOver,
    winner: game.winner, myColor: player.color,
    opponent: Object.values(game.players).find(p => p.id !== uid) || null,
    lastMove: game.lastMove, winLine: game.winLine
  });
});

app.post('/api/game/resign', (req, res) => {
  const { matchId, userId } = req.body;
  const game = activeGames[matchId];
  if (!game || game.gameOver) return res.status(400).json({ error: '游戏已结束' });
  if (!game.players[userId]) return res.status(403).json({ error: '你不是这个游戏的玩家' });

  game.gameOver = true;
  game.winner = parseInt(Object.keys(game.players).find(id => parseInt(id) !== userId));
  game.winLine = [];
  endGameAndUpdateScores(game);
  res.json({ success: true, gameOver: true, winner: game.winner });
});

// ============ LEADERBOARD ============
app.get('/api/leaderboard', (req, res) => {
  const db = readDB();
  const sorted = [...db.users].sort((a, b) => b.score - a.score).slice(0, 10)
    .map(u => ({ username: u.username, nickname: u.nickname, score: u.score, wins: u.wins, losses: u.losses }));
  res.json(sorted);
});

app.get('/api/user/:id', (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { password, ...safe } = user;
  res.json({ ...safe, friends: safe.friends || [] });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
