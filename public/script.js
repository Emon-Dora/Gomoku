const BOARD_SIZE = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
const CELL_SIZE = 40, MARGIN = 30;
const CANVAS_SIZE = MARGIN * 2 + (BOARD_SIZE - 1) * CELL_SIZE;

const $ = id => document.getElementById(id);

const state = {
  user: null, matchId: null, opponent: null, myColor: null,
  isPlaying: false, isMatching: false, gameOverShown: false,
  waitingForChallenge: null, waitingTargetName: '',
  gameState: null,
  board: null
};

let matchPollTimer = null, gamePollTimer = null, challengePollTimer = null, challengeSentTimer = null;

const canvas = $('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

initBoardLocal();

// ============ API ============
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function apiLogin(u, p) { return api('/api/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) }); }
function apiSearch(q) { return api('/api/users/search?q=' + encodeURIComponent(q)); }
function apiAddFriend(uid, fid) { return api('/api/friends/add', { method: 'POST', body: JSON.stringify({ userId: uid, friendId: fid }) }); }
function apiRemoveFriend(uid, fid) { return api(`/api/friends/${uid}/${fid}`, { method: 'DELETE' }); }
function apiGetFriends(uid) { return api('/api/friends?userId=' + uid); }
function apiJoinMatch(uid) { return api('/api/match/join', { method: 'POST', body: JSON.stringify({ userId: uid }) }); }
function apiLeaveMatch(uid) { return api('/api/match/leave', { method: 'POST', body: JSON.stringify({ userId: uid }) }); }
function apiMatchStatus(uid) { return api('/api/match/status?userId=' + uid); }
function apiSendChallenge(fuid, tuid) { return api('/api/challenge/send', { method: 'POST', body: JSON.stringify({ fromUserId: fuid, toUserId: tuid }) }); }
function apiRespondChallenge(cid, accept) { return api('/api/challenge/respond', { method: 'POST', body: JSON.stringify({ challengeId: cid, accept }) }); }
function apiGetChallenges(uid) { return api('/api/challenges?userId=' + uid); }
function apiSentChallenges(uid) { return api('/api/challenges/sent?userId=' + uid); }
function apiCancelChallenge(cid) { return api('/api/challenge/cancel', { method: 'POST', body: JSON.stringify({ challengeId: cid }) }); }
function apiGameMove(mid, uid, row, col) { return api('/api/game/move', { method: 'POST', body: JSON.stringify({ matchId: mid, userId: uid, row, col }) }); }
function apiGameState(mid, uid) { return api(`/api/game/state?matchId=${mid}&userId=${uid}`); }
function apiResign(mid, uid) { return api('/api/game/resign', { method: 'POST', body: JSON.stringify({ matchId: mid, userId: uid }) }); }
function apiLeaderboard() { return api('/api/leaderboard'); }

// ============ SCREENS ============
function showScreen(name) {
  $('loginScreen').style.display = name === 'loginScreen' ? 'flex' : 'none';
  $('lobbyScreen').style.display = name === 'lobbyScreen' ? 'flex' : 'none';
  $('gameScreen').style.display = name === 'gameScreen' ? 'flex' : 'none';
}

// ============ LOGIN ============
$('loginBtn').addEventListener('click', handleLogin);
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

async function handleLogin() {
  const u = $('loginUsername').value.trim(), p = $('loginPassword').value.trim();
  if (!u || !p) { $('loginError').textContent = '请输入账号和密码'; return; }
  $('loginError').textContent = '';
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = '登录中...';
  try {
    state.user = await apiLogin(u, p);
    $('loginError').textContent = '';
    enterLobby();
  } catch (e) {
    $('loginError').textContent = e.message;
  }
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = '登录 / 注册';
}

// ============ LOBBY ============
function enterLobby() {
  showScreen('lobbyScreen');
  refreshLobby();
  startChallengePolling();
}

function refreshLobby() {
  if (!state.user) return;
  $('lobbyUsername').textContent = state.user.username;
  $('lobbyScore').textContent = state.user.score + '分';
  $('lobbyWins').textContent = state.user.wins;
  $('lobbyLosses').textContent = state.user.losses;
  $('lobbyDraws').textContent = state.user.draws;
  refreshFriends();
  refreshLeaderboardLobby();
}

// ============ MATCHMAKING ============
$('matchBtn').addEventListener('click', toggleMatch);

async function toggleMatch() {
  if (state.isMatching) {
    try { await apiLeaveMatch(state.user.id); } catch {}
    stopMatchPolling();
    state.isMatching = false;
    $('matchBtn').textContent = '🎮 匹配对战';
    $('matchBtn').className = 'match-btn';
    $('matchInfo').textContent = '';
    return;
  }
  if (state.isPlaying) return;
  state.isMatching = true;
  $('matchBtn').textContent = '⏳ 取消匹配';
  $('matchBtn').className = 'match-btn matching';
  $('matchInfo').textContent = '正在寻找对手...';
  try {
    const result = await apiJoinMatch(state.user.id);
    if (result.status === 'matched') {
      state.isMatching = false;
      $('matchBtn').textContent = '🎮 匹配对战';
      $('matchBtn').className = 'match-btn';
      $('matchInfo').textContent = '';
      startGame(result.matchId, result.opponent, result.color);
    } else {
      startMatchPolling();
    }
  } catch (e) {
    state.isMatching = false;
    $('matchBtn').textContent = '🎮 匹配对战';
    $('matchBtn').className = 'match-btn';
    $('matchInfo').textContent = '匹配失败: ' + e.message;
  }
}

function startMatchPolling() {
  stopMatchPolling();
  matchPollTimer = setInterval(async () => {
    try {
      const result = await apiMatchStatus(state.user.id);
      if (result.status === 'matched') {
        stopMatchPolling();
        state.isMatching = false;
        $('matchBtn').textContent = '🎮 匹配对战';
        $('matchBtn').className = 'match-btn';
        $('matchInfo').textContent = '';
        startGame(result.matchId, result.opponent, result.color);
      }
    } catch {}
  }, 2000);
}

function stopMatchPolling() {
  if (matchPollTimer) { clearInterval(matchPollTimer); matchPollTimer = null; }
}

// ============ SEARCH ============
$('searchBtn').addEventListener('click', handleSearch);
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

async function handleSearch() {
  const q = $('searchInput').value.trim();
  const container = $('searchResults');
  if (!q) { container.innerHTML = ''; return; }
  try {
    const results = await apiSearch(q);
    container.innerHTML = results
      .filter(r => r.id !== state.user.id)
      .map(r => `
        <div class="search-result-item">
          <span class="sr-name">${esc(r.username)}</span>
          <span class="sr-score">${r.score}分</span>
          <button class="small-btn btn-add" onclick="addFriend(${r.id})">＋好友</button>
          <button class="small-btn btn-challenge" onclick="sendChallenge(${r.id},'${esc(r.username)}')">挑战</button>
        </div>`).join('') || '<p class="empty-hint">未找到玩家</p>';
  } catch { container.innerHTML = '<p class="empty-hint">搜索失败</p>'; }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function addFriend(fid) {
  try {
    await apiAddFriend(state.user.id, fid);
    refreshFriends();
    $('searchResults').innerHTML = '';
  } catch (e) { alert(e.message); }
}

async function sendChallenge(tuid, tname) {
  try {
    const res = await apiSendChallenge(state.user.id, tuid);
    state.waitingForChallenge = res.challengeId;
    state.waitingTargetName = tname || '对手';
    updateMatchAreaForChallenge();
    startChallengeSentPolling();
    $('searchResults').innerHTML = '';
  } catch (e) { alert(e.message); }
}

function updateMatchAreaForChallenge() {
  if (state.waitingForChallenge) {
    $('matchBtn').disabled = true;
    $('matchBtn').textContent = '⏳ 等待回应';
    $('matchBtn').className = 'match-btn matching';
    $('matchInfo').innerHTML = `等待 ${esc(state.waitingTargetName)} 接受挑战... <button class="small-btn btn-decline" onclick="cancelSentChallenge()">取消</button>`;
  }
}

function clearMatchAreaForChallenge() {
  state.waitingForChallenge = null;
  state.waitingTargetName = '';
  $('matchBtn').disabled = false;
  $('matchBtn').textContent = '🎮 匹配对战';
  $('matchBtn').className = 'match-btn';
  $('matchInfo').innerHTML = '';
}

async function cancelSentChallenge() {
  if (state.waitingForChallenge) {
    try { await apiCancelChallenge(state.waitingForChallenge); } catch {}
  }
  stopChallengeSentPolling();
  clearMatchAreaForChallenge();
}

function startChallengeSentPolling() {
  stopChallengeSentPolling();
  challengeSentTimer = setInterval(pollSentChallenges, 2000);
  pollSentChallenges();
}

function stopChallengeSentPolling() {
  if (challengeSentTimer) { clearInterval(challengeSentTimer); challengeSentTimer = null; }
}

async function pollSentChallenges() {
  if (!state.user || !state.waitingForChallenge) return;
  try {
    const [sentList, matchStat] = await Promise.all([
      apiSentChallenges(state.user.id),
      apiMatchStatus(state.user.id)
    ]);
    if (matchStat.status === 'matched') {
      stopChallengeSentPolling(); stopChallengePolling();
      clearMatchAreaForChallenge();
      startGame(matchStat.matchId, matchStat.opponent, matchStat.color);
      return;
    }
    if (!sentList.some(c => c.id === state.waitingForChallenge)) {
      stopChallengeSentPolling();
      clearMatchAreaForChallenge();
      $('matchInfo').textContent = '挑战已被拒绝或已取消';
    }
  } catch {}
}

// ============ FRIENDS ============
async function refreshFriends() {
  try {
    const friends = await apiGetFriends(state.user.id);
    $('friendsList').innerHTML = friends.length
      ? friends.map(f => `
        <div class="friend-item">
          <span class="fr-name">${esc(f.username)}</span>
          <span class="fr-score">${f.score}分</span>
          <button class="small-btn btn-invite" onclick="sendChallenge(${f.id},'${esc(f.username)}')">邀请</button>
          <button class="small-btn btn-remove" onclick="removeFriend(${f.id})">✕</button>
        </div>`).join('')
      : '<p class="empty-hint">暂无好友</p>';
  } catch {}
}

async function removeFriend(fid) {
  try {
    await apiRemoveFriend(state.user.id, fid);
    refreshFriends();
  } catch {}
}

// ============ CHALLENGES ============
function startChallengePolling() {
  stopChallengePolling();
  challengePollTimer = setInterval(refreshChallenges, 3000);
  refreshChallenges();
}

function stopChallengePolling() {
  if (challengePollTimer) { clearInterval(challengePollTimer); challengePollTimer = null; }
}

async function refreshChallenges() {
  if (!state.user || state.isPlaying) return;
  try {
    const list = await apiGetChallenges(state.user.id);
    $('challengesList').innerHTML = list.length
      ? list.map(c => `
        <div class="challenge-item">
          <span style="flex:1">${esc(c.fromUsername)} (${c.fromScore}分) 发起了挑战</span>
          <button class="small-btn btn-accept" onclick="acceptChallenge(${c.id})">接受</button>
          <button class="small-btn btn-decline" onclick="declineChallenge(${c.id})">拒绝</button>
        </div>`).join('')
      : '<p class="empty-hint">暂无挑战</p>';
  } catch {}
}

async function acceptChallenge(cid) {
  try {
    const result = await apiRespondChallenge(cid, true);
    if (result.status === 'matched') {
      stopChallengePolling();
      startGame(result.matchId, result.opponent, result.color);
    }
  } catch (e) { alert(e.message); }
}

async function declineChallenge(cid) {
  try { await apiRespondChallenge(cid, false); refreshChallenges(); }
  catch {}
}

// ============ GAME ============
function startGame(matchId, opponent, color) {
  state.matchId = matchId;
  state.opponent = opponent;
  state.myColor = color;
  state.isPlaying = true;
  state.gameState = null;
  state.gameOverShown = false;
  state.waitingForChallenge = null;
  stopChallengeSentPolling();
  clearMatchAreaForChallenge();
  initBoardLocal();

  showScreen('gameScreen');
  $('gameMyName').textContent = state.user.username;
  $('gameMyScore').textContent = state.user.score + '分';
  $('gameOpponentName').textContent = opponent.username;
  $('gameOpponentScore').textContent = opponent.score + '分';
  $('gameResultOverlay').style.display = 'none';

  updateGameTurnUI(null);
  renderBoard();
  startGamePolling();
}

function initBoardLocal() {
  state.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function updateGameTurnUI(gs) {
  const el = $('gameTurnIndicator');
  if (!gs || gs.gameOver) {
    if (gs && gs.gameOver) {
      if (gs.winner === state.user.id) el.textContent = '🎉 你赢了！';
      else if (gs.winner === null) el.textContent = '🤝 平局';
      else el.textContent = '😞 你输了';
    } else {
      el.textContent = '等待中...';
    }
    return;
  }
  const myTurn = (state.myColor === 'black' && gs.currentPlayer === 1) ||
                 (state.myColor === 'white' && gs.currentPlayer === 2);
  el.textContent = myTurn ? '👆 轮到你了' : '⏳ 等待对手落子...';
}

function startGamePolling() {
  stopGamePolling();
  gamePollTimer = setInterval(pollGameState, 1000);
  pollGameState();
}

function stopGamePolling() {
  if (gamePollTimer) { clearInterval(gamePollTimer); gamePollTimer = null; }
}

async function pollGameState() {
  if (!state.matchId || !state.user) return;
  try {
    const gs = await apiGameState(state.matchId, state.user.id);
    state.gameState = gs;
    state.board = gs.board.map(r => [...r]);
    renderBoard();
    updateGameTurnUI(gs);

    if (gs.gameOver && !state.gameOverShown) {
      state.gameOverShown = true;
      showGameResult(gs);
    }
  } catch {
    stopGamePolling();
    if (!state.gameOverShown) {
      state.gameOverShown = true;
      $('gameResultOverlay').style.display = 'flex';
      $('resultTitle').textContent = '连接中断';
    }
  }
}

async function showGameResult(gs) {
  $('gameResultOverlay').style.display = 'flex';
  if (gs.winner === state.user.id) $('resultTitle').textContent = '🎉 你赢了！';
  else if (gs.winner === null) $('resultTitle').textContent = '🤝 平局';
  else $('resultTitle').textContent = '😞 你输了';

  // Refresh user data
  try {
    const fresh = await api('/api/user/' + state.user.id);
    state.user = fresh;
    $('gameMyScore').textContent = fresh.score + '分';
  } catch {}
}

$('backToLobbyBtn').addEventListener('click', () => {
  state.isPlaying = false;
  state.matchId = null;
  state.opponent = null;
  $('gameResultOverlay').style.display = 'none';
  stopGamePolling();
  enterLobby();
});

$('resignBtn').addEventListener('click', async () => {
  if (!state.matchId || state.gameState?.gameOver) return;
  if (!confirm('确定认输吗？')) return;
  try {
    await apiResign(state.matchId, state.user.id);
  } catch {}
});

// ============ BOARD CLICK ============
canvas.addEventListener('click', async (e) => {
  if (!state.isPlaying || !state.gameState || state.gameState.gameOver) return;
  const myTurn = (state.myColor === 'black' && state.gameState.currentPlayer === 1) ||
                 (state.myColor === 'white' && state.gameState.currentPlayer === 2);
  if (!myTurn) return;

  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
  const col = Math.round((x - MARGIN) / CELL_SIZE);
  const row = Math.round((y - MARGIN) / CELL_SIZE);
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
  if (state.board[row][col] !== EMPTY) return;

  try {
    const result = await apiGameMove(state.matchId, state.user.id, row, col);
    // Server will update state, next poll will pick up changes
    // Optimistic: update local board immediately
    const pv = state.myColor === 'black' ? 1 : 2;
    state.board[row][col] = pv;
    state.gameState.currentPlayer = pv === 1 ? 2 : 1;
    if (result.gameOver) {
      state.gameState.gameOver = true;
      state.gameState.winner = result.winner;
    }
    renderBoard();
    updateGameTurnUI(state.gameState);
    if (result.gameOver && !state.gameOverShown) {
      state.gameOverShown = true;
      showGameResult(state.gameState);
    }
  } catch (e) {
    // Poll will correct state
  }
});

// ============ RENDER ============
function renderBoard() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = '#c8a26b';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.strokeStyle = '#5a3e2b';
  ctx.lineWidth = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = MARGIN + i * CELL_SIZE;
    ctx.beginPath(); ctx.moveTo(MARGIN, p); ctx.lineTo(MARGIN + (BOARD_SIZE-1)*CELL_SIZE, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, MARGIN); ctx.lineTo(p, MARGIN + (BOARD_SIZE-1)*CELL_SIZE); ctx.stroke();
  }

  ctx.fillStyle = '#5a3e2b';
  [[3,3],[3,11],[7,7],[11,3],[11,11]].forEach(([r,c]) => {
    ctx.beginPath(); ctx.arc(MARGIN + c*CELL_SIZE, MARGIN + r*CELL_SIZE, 4, 0, Math.PI*2); ctx.fill();
  });

  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (state.board[r][c] !== EMPTY) drawStone(r, c, state.board[r][c]);

  const gs = state.gameState;
  if (gs && gs.winLine) {
    gs.winLine.forEach(cell => {
      ctx.beginPath();
      ctx.arc(MARGIN + cell.col*CELL_SIZE, MARGIN + cell.row*CELL_SIZE, 17, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255, 50, 50, 0.25)'; ctx.fill();
    });
  }

  if (gs && gs.lastMove && !gs.gameOver) {
    const { row, col } = gs.lastMove;
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(MARGIN + col*CELL_SIZE, MARGIN + row*CELL_SIZE, 5, 0, Math.PI*2); ctx.fill();
  }
}

function drawStone(row, col, player) {
  const x = MARGIN + col * CELL_SIZE, y = MARGIN + row * CELL_SIZE, r = CELL_SIZE/2 - 3;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  if (player === BLACK) {
    const g = ctx.createRadialGradient(x-4, y-4, 2, x, y, r);
    g.addColorStop(0, '#555'); g.addColorStop(1, '#000'); ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(x-4, y-4, 2, x, y, r);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#bbb'); ctx.fillStyle = g;
    ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4; ctx.fill(); ctx.shadowBlur = 0;
}

// ============ LEADERBOARD LOBBY ============
async function refreshLeaderboardLobby() {
  try {
    const list = await apiLeaderboard();
    $('lobbyLeaderboard').innerHTML = list.map(p =>
      `<li><span class="lb-user">${esc(p.nickname || p.username)}</span><span class="lb-pts">${p.score}分</span></li>`
    ).join('') || '<p class="empty-hint">暂无数据</p>';
  } catch {}
}

// ============ LOGOUT ============
$('lobbyLogoutBtn').addEventListener('click', () => {
  stopMatchPolling();
  stopGamePolling();
  stopChallengePolling();
  stopChallengeSentPolling();
  state.user = null;
  state.isPlaying = false;
  state.isMatching = false;
  state.waitingForChallenge = null;
  showScreen('loginScreen');
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  $('loginError').textContent = '';
});
