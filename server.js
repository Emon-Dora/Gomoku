const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'game-data.json');
function readDB() { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); } catch { return { users: [], nextId: 1 }; } }
function writeDB(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2), 'utf-8'); }

const matchQueue = [];
const activeGames = {};
const activeMatches = {};
const challenges = [];
const onlineUsers = new Map();
const gameEmojis = {};
let matchIdCounter = 1, challengeIdCounter = 1;
const BOARD_SIZE = 15;

setInterval(() => { const n = Date.now(); for (const [id, t] of onlineUsers) if (n - t > 12000) onlineUsers.delete(id); }, 8000);
setInterval(() => { const c = Date.now() - 30000; for (const m in gameEmojis) { gameEmojis[m] = gameEmojis[m].filter(e => e.timestamp > c); if (!gameEmojis[m].length) delete gameEmojis[m]; } }, 15000);

function checkWin(board, row, col, player) {
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let c = 1;
    for (let i = 1; i < 5; i++) { const r=row+dr*i,c2=col+dc*i; if (r<0||r>=BOARD_SIZE||c2<0||c2>=BOARD_SIZE||board[r][c2]!==player) break; c++; }
    for (let i = 1; i < 5; i++) { const r=row-dr*i,c2=col-dc*i; if (r<0||r>=BOARD_SIZE||c2<0||c2>=BOARD_SIZE||board[r][c2]!==player) break; c++; }
    if (c >= 5) return true;
  }
  return false;
}

function getWinLine(board, row, col, player) {
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    const cells = [{row,col}];
    for (let i = 1; i < 5; i++) { const r=row+dr*i,c2=col+dc*i; if (r<0||r>=BOARD_SIZE||c2<0||c2>=BOARD_SIZE||board[r][c2]!==player) break; cells.push({row:r,col:c2}); }
    for (let i = 1; i < 5; i++) { const r=row-dr*i,c2=col-dc*i; if (r<0||r>=BOARD_SIZE||c2<0||c2>=BOARD_SIZE||board[r][c2]!==player) break; cells.push({row:r,col:c2}); }
    if (cells.length >= 5) return cells;
  }
  return null;
}

function endGameAndUpdateScores(game) {
  const db = readDB();
  const ps = Object.values(game.players);
  const p1 = db.users.find(u => u.id === ps[0].id), p2 = db.users.find(u => u.id === ps[1].id);
  if (!p1 || !p2) return;
  if (game.winner) {
    const w = db.users.find(u => u.id === game.winner), l = db.users.find(u => u.id === (ps[0].id === game.winner ? ps[1].id : ps[0].id));
    if (w) { w.score += 1; w.wins += 1; w.recentGames=[...(w.recentGames||[]).slice(-9),'win']; }
    if (l) { l.losses += 1; l.recentGames=[...(l.recentGames||[]).slice(-9),'loss']; }
  } else { p1.draws += 1; p2.draws += 1; p1.recentGames=[...(p1.recentGames||[]).slice(-9),'draw']; p2.recentGames=[...(p2.recentGames||[]).slice(-9),'draw']; }
  writeDB(db);
  if (game.mid && gameEmojis[game.mid]) delete gameEmojis[game.mid];
  Object.values(game.players).forEach(p => delete activeMatches[p.id]);
}

function createGame(mid, p1, p2, c1, c2) {
  return { mid, board: Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(0)), currentPlayer:1, gameOver:false, winner:null, lastMove:null, winLine:null, turnStartedAt:Date.now(),
    players: { [p1.id]:{...p1, color:c1}, [p2.id]:{...p2, color:c2} }, patterns: { [p1.id]: p1.pattern||'default', [p2.id]: p2.pattern||'default' } };
}

const TURN_TIMEOUT = 30000;
setInterval(() => {
  const now = Date.now();
  for (const mid in activeGames) {
    const g = activeGames[mid];
    if (g.gameOver) continue;
    if (now - g.turnStartedAt <= TURN_TIMEOUT) continue;
    const loserId = Object.keys(g.players).find(id => {
      const p = g.players[id];
      return (p.color==='black'&&g.currentPlayer===1)||(p.color==='white'&&g.currentPlayer===2);
    });
    if (!loserId) continue;
    g.gameOver=true; g.winner=parseInt(Object.keys(g.players).find(id=>parseInt(id)!==parseInt(loserId))); g.winLine=[];
    endGameAndUpdateScores(g);
  }
}, 3000);

// AUTH
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Ã¨Â¯Â·Ã¨Â¾ÂÃ¥ÂÂ¥Ã¨Â´Â¦Ã¥ÂÂ·Ã¥ÂÂÃ¥Â¯ÂÃ§Â Â' });
    const db = readDB();
    let u = db.users.find(x => x.username === username);
    if (u) {
      if (!u.password || !bcrypt.compareSync(password, u.password)) return res.status(401).json({ error: 'Ã¥Â¯ÂÃ§Â ÂÃ©ÂÂÃ¨Â¯Â¯' });
      const { password:_, ...s } = u;
      onlineUsers.set(u.id, Date.now());
      return res.json({ ...s, friends: s.friends||[] });
    }
    const hp = bcrypt.hashSync(password, 10);
    const nu = { id:db.nextId++, username, password:hp, nickname:username, score:0, wins:0, losses:0, draws:0, recentGames:[], friends:[], created_at:new Date().toISOString() };
    db.users.push(nu); writeDB(db);
    onlineUsers.set(nu.id, Date.now());
    const { password:_, ...s } = nu;
    res.json({ ...s, friends: [] });
  } catch(e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Ã§ÂÂ»Ã¥Â½ÂÃ¥Â¤Â±Ã¨Â´Â¥' });
  }
});

app.post('/api/ping', (req, res) => {
  const { userId } = req.body;
  if (userId) onlineUsers.set(userId, Date.now());
  res.json({ success: true });
});

app.get('/api/users/online', (req, res) => {
  const n = Date.now();
  res.json([...onlineUsers.entries()].filter(([_,t]) => n-t<8000).map(([id]) => id));
});

app.get('/api/users/search', (req, res) => {
  const q = (req.query.q||'').trim().toLowerCase();
  if (!q) return res.json([]);
  const db = readDB();
  const n = Date.now();
  res.json(db.users.filter(u => u.username.toLowerCase().includes(q)).slice(0,10).map(u => ({ id:u.id, username:u.username, nickname:u.nickname, score:u.score, online: onlineUsers.has(u.id)&&n-onlineUsers.get(u.id)<8000 })));
});

// FRIENDS
app.get('/api/friends', (req, res) => {
  const uid = parseInt(req.query.userId);
  const db = readDB();
  const u = db.users.find(x => x.id === uid);
  if (!u) return res.status(404).json({ error: 'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  const n = Date.now();
  res.json(db.users.filter(x => (u.friends||[]).includes(x.id)).map(x => ({ id:x.id, username:x.username, nickname:x.nickname, score:x.score, online: onlineUsers.has(x.id)&&n-onlineUsers.get(x.id)<8000 })));
});

app.post('/api/friends/add', (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId||!friendId||userId===friendId) return res.status(400).json({ error: 'Ã¥ÂÂÃ¦ÂÂ°Ã¦ÂÂ Ã¦ÂÂ' });
  const db = readDB();
  const u=db.users.find(x=>x.id===userId), f=db.users.find(x=>x.id===friendId);
  if (!u||!f) return res.status(404).json({ error: 'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  if ((u.friends||[]).includes(friendId)) return res.status(400).json({ error: 'Ã¥Â·Â²Ã§Â»ÂÃ¦ÂÂ¯Ã¥Â¥Â½Ã¥ÂÂ' });
  u.friends=[...(u.friends||[]), friendId]; f.friends=[...(f.friends||[]), userId];
  writeDB(db); res.json({ success: true });
});

app.delete('/api/friends/:userId/:friendId', (req, res) => {
  const db = readDB();
  [req.params.userId,req.params.friendId].forEach(id => { const u=db.users.find(x=>x.id===parseInt(id)); if(u) u.friends=(u.friends||[]).filter(f=>f!==parseInt(req.params.friendId===id?req.params.userId:req.params.friendId)); });
  writeDB(db); res.json({ success: true });
});

// MATCHMAKING
function recentWR(u) { const g=(u.recentGames||[]).filter(x=>x); return g.length ? g.filter(r=>r==='win').length/g.length : 0; }
app.post('/api/match/join', (req, res) => {
  const { userId, pattern } = req.body;
  if (!userId) return res.status(400).json({ error: 'Ã§Â¼ÂºÃ¥Â°Â userId' });
  if (activeMatches[userId]) return res.json({ status:'matched', ...activeMatches[userId] });
  if (matchQueue.some(e=>e.userId===userId)) return res.json({ status:'waiting' });
  const db = readDB(); const u = db.users.find(x=>x.id===userId);
  if (!u) return res.status(404).json({ error: 'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  if (matchQueue.length > 0) {
    const myWr=recentWR(u);
    let bi=0, bd=Math.abs(recentWR(matchQueue[0])-myWr);
    for (let i=1;i<matchQueue.length;i++) { const d=Math.abs(recentWR(matchQueue[i])-myWr); if (d<bd) { bd=d; bi=i; } }
    const opp = matchQueue.splice(bi,1)[0];
    const ca=Math.random()<0.5?'black':'white', cb=ca==='black'?'white':'black';
    const mid=matchIdCounter++;
    const game = createGame(mid, { id:userId, username:u.username, score:u.score, pattern:pattern||'default', wins:u.wins||0, losses:u.losses||0, draws:u.draws||0, recentGames:u.recentGames||[] }, { id:opp.userId, username:opp.username, score:opp.score, pattern:opp.pattern||'default', wins:opp.wins, losses:opp.losses, draws:opp.draws, recentGames:opp.recentGames||[] }, ca, cb);
    activeGames[mid]=game;
    const md1={ matchId:mid, opponent:{id:opp.userId,username:opp.username,score:opp.score,wins:opp.wins,losses:opp.losses,draws:opp.draws,recentGames:opp.recentGames||[]}, color:ca, myOppPattern:opp.pattern||'default' };
    activeMatches[userId]=md1;
    activeMatches[opp.userId]={ matchId:mid, opponent:{id:userId,username:u.username,score:u.score,wins:u.wins,losses:u.losses,draws:u.draws,recentGames:u.recentGames||[]}, color:cb, myOppPattern:pattern||'default' };
    return res.json({ status:'matched', ...md1 });
  }
  matchQueue.push({ userId, username:u.username, score:u.score, pattern:pattern||'default', wins:u.wins||0, losses:u.losses||0, draws:u.draws||0, recentGames:u.recentGames||[] });
  res.json({ status:'waiting' });
});

app.post('/api/match/leave', (req, res) => {
  const idx = matchQueue.findIndex(e=>e.userId===req.body.userId);
  if (idx>=0) matchQueue.splice(idx,1);
  res.json({ success:true });
});

app.get('/api/match/status', (req, res) => {
  const uid=parseInt(req.query.userId);
  if (!uid) return res.json({ status:'none' });
  if (activeMatches[uid]) return res.json({ status:'matched', ...activeMatches[uid] });
  res.json({ status:matchQueue.some(e=>e.userId===uid)?'waiting':'none' });
});

// CHALLENGES
app.post('/api/challenge/send', (req, res) => {
  const { fromUserId, toUserId, pattern } = req.body;
  if (!fromUserId||!toUserId) return res.status(400).json({ error: 'Ã§Â¼ÂºÃ¥Â°ÂÃ¥ÂÂÃ¦ÂÂ°' });
  if (fromUserId===toUserId) return res.status(400).json({ error: 'Ã¤Â¸ÂÃ¨ÂÂ½Ã¦ÂÂÃ¦ÂÂÃ¨ÂÂªÃ¥Â·Â±' });
  const db=readDB(); const from=db.users.find(u=>u.id===fromUserId), to=db.users.find(u=>u.id===toUserId);
  if (!from||!to) return res.status(404).json({ error:'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  if (challenges.some(c=>c.fromUserId===fromUserId&&c.toUserId===toUserId&&c.status==='pending'))
    return res.status(400).json({ error:'Ã¥Â·Â²Ã¦ÂÂÃ¥Â¾ÂÃ¥Â¤ÂÃ§ÂÂÃ§ÂÂÃ¦ÂÂÃ¦ÂÂ' });
  if (challenges.some(c=>c.fromUserId===toUserId&&c.toUserId===fromUserId&&c.status==='pending'))
    return res.status(400).json({ error:'Ã¥Â¯Â¹Ã¦ÂÂ¹Ã¥Â·Â²Ã¥ÂÂÃ¤Â½Â Ã¥ÂÂÃ¨ÂµÂ·Ã¦ÂÂÃ¦ÂÂ' });
  const c={ id:challengeIdCounter++, fromUserId, fromUsername:from.username, fromScore:from.score, toUserId, toUsername:to.username, status:'pending', pattern:pattern||'default', createdAt:Date.now() };
  challenges.push(c); res.json({ challengeId:c.id });
});

app.get('/api/challenges/sent', (req, res) => {
  const uid=parseInt(req.query.userId);
  res.json(challenges.filter(c=>c.fromUserId===uid&&c.status==='pending').map(c=>({ id:c.id, toUserId:c.toUserId, toUsername:c.toUsername, status:c.status })));
});

app.post('/api/challenge/respond', (req, res) => {
  const { challengeId, accept, pattern } = req.body;
  const c = challenges.find(c=>c.id===challengeId&&c.status==='pending');
  if (!c) return res.status(404).json({ error:'Ã¦ÂÂÃ¦ÂÂÃ¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨Ã¦ÂÂÃ¥Â·Â²Ã¥Â¤ÂÃ§ÂÂ' });
  if (!accept) { c.status='declined'; return res.json({ success:true }); }
  c.status='accepted';
  const db=readDB(); const from=db.users.find(u=>u.id===c.fromUserId), to=db.users.find(u=>u.id===c.toUserId);
  if (!from||!to) return res.status(404).json({ error:'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  const ca=Math.random()<0.5?'black':'white', cb=ca==='black'?'white':'black';
  const mid=matchIdCounter++;
  const game=createGame(mid, { id:c.toUserId, username:to.username, score:to.score, pattern:pattern||'default', wins:to.wins, losses:to.losses, draws:to.draws, recentGames:to.recentGames||[] }, { id:c.fromUserId, username:from.username, score:from.score, pattern:c.pattern||'default', wins:from.wins, losses:from.losses, draws:from.draws, recentGames:from.recentGames||[] }, ca, cb);
  activeGames[mid]=game;
  activeMatches[c.fromUserId]={ matchId:mid, opponent:{id:c.toUserId,username:to.username,score:to.score,wins:to.wins,losses:to.losses,draws:to.draws,recentGames:to.recentGames||[]}, color:cb, myOppPattern:pattern||'default' };
  activeMatches[c.toUserId]={ matchId:mid, opponent:{id:c.fromUserId,username:from.username,score:from.score,wins:from.wins,losses:from.losses,draws:from.draws,recentGames:from.recentGames||[]}, color:ca, myOppPattern:c.pattern||'default' };
  res.json({ status:'matched', ...activeMatches[c.toUserId] });
});

app.get('/api/challenges', (req, res) => {
  const uid=parseInt(req.query.userId);
  res.json(challenges.filter(c=>c.toUserId===uid&&c.status==='pending').map(c=>({ id:c.id, fromUserId:c.fromUserId, fromUsername:c.fromUsername, fromScore:c.fromScore })));
});

// GAME
app.post('/api/game/move', (req, res) => {
  const { matchId, userId, row, col } = req.body;
  const g = activeGames[matchId];
  if (!g) return res.status(404).json({ error: 'Ã¦Â¸Â¸Ã¦ÂÂÃ¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  const p = g.players[userId]; if (!p) return res.status(403).json({ error:'Ã¦ÂÂ Ã¦ÂÂÃ©ÂÂ' });
  if (g.gameOver) return res.status(400).json({ error:'Ã¦Â¸Â¸Ã¦ÂÂÃ¥Â·Â²Ã§Â»ÂÃ¦ÂÂ' });
  const pv = p.color==='black'?1:2;
  if (g.currentPlayer!==pv) return res.status(400).json({ error:'Ã¨Â¿ÂÃ¦Â²Â¡Ã¨Â½Â®Ã¥ÂÂ°Ã¤Â½Â ' });
  if (row<0||row>=BOARD_SIZE||col<0||col>=BOARD_SIZE||g.board[row][col]!==0) return res.status(400).json({ error:'Ã¦ÂÂ Ã¦ÂÂÃ¤Â½ÂÃ§Â½Â®' });
  g.board[row][col]=pv; g.lastMove={row,col};
  if (checkWin(g.board,row,col,pv)) { g.gameOver=true; g.winner=userId; g.winLine=getWinLine(g.board,row,col,pv); endGameAndUpdateScores(g); return res.json({success:true,gameOver:true,winner:userId}); }
  if (g.board.every(r=>r.every(c=>c!==0))) { g.gameOver=true; g.winner=null; endGameAndUpdateScores(g); return res.json({success:true,gameOver:true,winner:null}); }
  g.currentPlayer=pv===1?2:1; g.turnStartedAt=Date.now();
  res.json({success:true,gameOver:false});
});

app.get('/api/game/state', (req, res) => {
  const mid=parseInt(req.query.matchId), uid=parseInt(req.query.userId);
  if (!mid||!uid) return res.status(400).json({ error:'Ã§Â¼ÂºÃ¥Â°ÂÃ¥ÂÂÃ¦ÂÂ°' });
  const g=activeGames[mid]; if (!g) return res.status(404).json({ error:'Ã¦Â¸Â¸Ã¦ÂÂÃ¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  const p=g.players[uid]; if (!p) return res.status(403).json({ error:'Ã¦ÂÂ Ã¦ÂÂÃ©ÂÂ' });
  const opp=Object.values(g.players).find(x=>x.id!==uid)||null;
  res.json({ board:g.board, currentPlayer:g.currentPlayer, gameOver:g.gameOver, winner:g.winner, myColor:p.color, myPattern:g.patterns[uid], opponentPattern:opp?g.patterns[opp.id]:'default', opponent:opp, lastMove:g.lastMove, winLine:g.winLine, turnRemaining:Math.max(0,TURN_TIMEOUT-(Date.now()-g.turnStartedAt)) });
});

app.post('/api/game/resign', (req, res) => {
  const { matchId, userId } = req.body;
  const g=activeGames[matchId]; if (!g||g.gameOver) return res.status(400).json({ error:'Ã¦Â¸Â¸Ã¦ÂÂÃ¥Â·Â²Ã§Â»ÂÃ¦ÂÂ' });
  if (!g.players[userId]) return res.status(403).json({ error:'Ã¦ÂÂ Ã¦ÂÂÃ©ÂÂ' });
  g.gameOver=true; g.winner=parseInt(Object.keys(g.players).find(id=>parseInt(id)!==userId));
  g.winLine=[]; endGameAndUpdateScores(g);
  res.json({success:true,gameOver:true,winner:g.winner});
});

// EMOJI
app.post('/api/game/emoji', (req, res) => {
  const { matchId, userId, emoji } = req.body;
  if (!matchId||!userId||!emoji) return res.status(400).json({ error:'Ã§Â¼ÂºÃ¥Â°ÂÃ¥ÂÂÃ¦ÂÂ°' });
  if (!gameEmojis[matchId]) gameEmojis[matchId]=[];
  gameEmojis[matchId].push({ userId, emoji, timestamp:Date.now() });
  res.json({ success:true });
});

app.get('/api/game/emojis', (req, res) => {
  const mid=parseInt(req.query.matchId), since=parseInt(req.query.since)||0;
  if (!gameEmojis[mid]) return res.json([]);
  res.json(gameEmojis[mid].filter(e=>e.timestamp>since));
});

// LEADERBOARD
app.get('/api/leaderboard', (req, res) => {
  const db = readDB();
  res.json([...db.users].sort((a,b)=>recentWR(b)-recentWR(a)).slice(0,10).map(u=>{
    const g=(u.recentGames||[]).filter(x=>x); const wr=g.length?Math.round(g.filter(r=>r==='win').length/g.length*100):0;
    return { username:u.username, nickname:u.nickname, score:u.score, wins:u.wins, losses:u.losses, draws:u.draws, winRate:wr };
  }));
});

app.get('/api/user/:id', (req, res) => {
  const db=readDB(); const u=db.users.find(x=>x.id===parseInt(req.params.id));
  if (!u) return res.status(404).json({ error:'Ã§ÂÂ¨Ã¦ÂÂ·Ã¤Â¸ÂÃ¥Â­ÂÃ¥ÂÂ¨' });
  const {password:_, ...s}=u; res.json({...s, friends:s.friends||[]});
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ã¦ÂÂÃ¥ÂÂ¡Ã¥ÂÂ¨Ã¥ÂÂÃ©ÂÂ¨Ã©ÂÂÃ¨Â¯Â¯' });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
