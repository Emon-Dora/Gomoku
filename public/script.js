const BOARD_SIZE = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
const CELL_SIZE = 40, MARGIN = 30;
const CANVAS_SIZE = MARGIN * 2 + (BOARD_SIZE - 1) * CELL_SIZE;
const $ = id => document.getElementById(id);

const state = {
  user: null, matchId: null, opponent: null, myColor: null,
  isPlaying: false, isMatching: false, gameOverShown: false,
  waitingForChallenge: null, waitingTargetName: '',
  gameState: null, board: null,
  selectedPattern: 'default', previewCell: null
};

const PATTERNS = [
  { id: 'default', name: '默认', emoji: '⚫' },
  { id: 'star', name: '星星', emoji: '⭐' },
  { id: 'butterfly', name: '蝴蝶', emoji: '🦋' },
  { id: 'flower', name: '花朵', emoji: '🌸' },
  { id: 'leaf', name: '叶子', emoji: '🍃' },
  { id: 'cat', name: '猫头', emoji: '🐱' },
  { id: 'dog', name: '狗头', emoji: '🐶' },
];

const EMOJIS = ['😊','👍','😂','😮','😢','😡','🎉','💪'];

let matchPollTimer = null, gamePollTimer = null, challengePollTimer = null, challengeSentTimer = null, pingTimer = null, emojiPollTimer = null, friendsTimer = null;

const canvas = $('board');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const patternImages = {};
['butterfly','cat','dog','flower','leaf','star'].forEach(name => {
  const img = new Image();
  img.src = 'images/'+name+'.jpg';
  patternImages[name] = img;
});

initBoardLocal();

let lastEmojiTimestamp = 0;

// ============ API ============
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('请求失败'); }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

const apiLogin = (u,p) => api('/api/login', {method:'POST',body:JSON.stringify({username:u,password:p})});
const apiPing = uid => api('/api/ping', {method:'POST',body:JSON.stringify({userId:uid})});
const apiSearch = q => api('/api/users/search?q='+encodeURIComponent(q));
const apiAddFriend = (uid,fid) => api('/api/friends/add',{method:'POST',body:JSON.stringify({userId:uid,friendId:fid})});
const apiRemoveFriend = (uid,fid) => api(`/api/friends/${uid}/${fid}`,{method:'DELETE'});
const apiGetFriends = uid => api('/api/friends?userId='+uid);
const apiJoinMatch = (uid,pat) => api('/api/match/join',{method:'POST',body:JSON.stringify({userId:uid,pattern:pat})});
const apiLeaveMatch = uid => api('/api/match/leave',{method:'POST',body:JSON.stringify({userId:uid})});
const apiMatchStatus = uid => api('/api/match/status?userId='+uid);
const apiSendChallenge = (fuid,tuid,pat) => api('/api/challenge/send',{method:'POST',body:JSON.stringify({fromUserId:fuid,toUserId:tuid,pattern:pat})});
const apiRespondChallenge = (cid,accept,pat) => api('/api/challenge/respond',{method:'POST',body:JSON.stringify({challengeId:cid,accept,pattern:pat||'default'})});
const apiGetChallenges = uid => api('/api/challenges?userId='+uid);
const apiSentChallenges = uid => api('/api/challenges/sent?userId='+uid);
const apiCancelChallenge = cid => api('/api/challenge/cancel',{method:'POST',body:JSON.stringify({challengeId:cid})});
const apiGameMove = (mid,uid,r,c) => api('/api/game/move',{method:'POST',body:JSON.stringify({matchId:mid,userId:uid,row:r,col:c})});
const apiGameState = (mid,uid) => api(`/api/game/state?matchId=${mid}&userId=${uid}`);
const apiResign = (mid,uid) => api('/api/game/resign',{method:'POST',body:JSON.stringify({matchId:mid,userId:uid})});
const apiLeaderboard = () => api('/api/leaderboard');
const apiSendEmoji = (mid,uid,e) => api('/api/game/emoji',{method:'POST',body:JSON.stringify({matchId:mid,userId:uid,emoji:e})});
const apiGetEmojis = (mid,since) => api(`/api/game/emojis?matchId=${mid}&since=${since}`);

function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

const ACHIEVEMENTS = [
  [100,'棋迹暖暖·咪咪嘛嘛'],[90,'夏司逆'],[80,'郝利亥'],[60,'甄琮明'],[40,'白下客'],[20,'朱逸枝']
];
function calcWinRate(u) { const g=(u.recentGames||[]).filter(x=>x); return g.length?Math.round(g.filter(r=>r==='win').length/g.length*100):0; }
function getAchievement(wr) { for(const[th,n]of ACHIEVEMENTS)if(wr>=th)return n; return ''; }

function showScreen(name) {
  ['loginScreen','lobbyScreen','gameScreen'].forEach(s => $(s).style.display = s===name ? 'flex' : 'none');
}

// ============ PATTERNS ============
function initPatternSelector() {
  const grid = $('patternGrid');
  grid.innerHTML = PATTERNS.map(p =>
    `<div class="pattern-opt${p.id==='default'?' active':''}" data-pattern="${p.id}" onclick="selectPattern('${p.id}')">
      <span class="po-emoji">${p.emoji}</span>${p.name}
    </div>`
  ).join('');
  renderPatternPreview('default');
}

function selectPattern(id) {
  state.selectedPattern = id;
  document.querySelectorAll('.pattern-opt').forEach(el => el.classList.toggle('active', el.dataset.pattern === id));
  renderPatternPreview(id);
}

function renderPatternPreview(patternId) {
  const c = $('patternPreviewCanvas'), cx = c.getContext('2d');
  cx.clearRect(0,0,80,40);
  cx.fillStyle = '#c8a26b'; cx.fillRect(0,0,80,40);
  drawPatternPiece(cx, 20, 20, 14, patternId, true);
  drawPatternPiece(cx, 60, 20, 14, patternId, false);
}

// ============ LOGIN ============
$('loginBtn').addEventListener('click', handleLogin);
$('loginPassword').addEventListener('keydown', e => { if (e.key==='Enter') handleLogin(); });

async function handleLogin() {
  const u=$('loginUsername').value.trim(), p=$('loginPassword').value.trim();
  if (!u||!p) { $('loginError').textContent='请输入账号和密码'; return; }
  $('loginError').textContent=''; $('loginBtn').disabled=true; $('loginBtn').textContent='登录中...';
  try {
    state.user = await apiLogin(u,p);
    enterLobby();
  } catch(e) { $('loginError').textContent=e.message; }
  $('loginBtn').disabled=false; $('loginBtn').textContent='登录 / 注册';
}

// ============ LOBBY ============
function enterLobby() {
  showScreen('lobbyScreen');
  initPatternSelector();
  refreshLobby();
  startChallengePolling();
  startPing();
}

function refreshLobby() {
  if (!state.user) return;
  const u=state.user, wr=calcWinRate(u);
  $('lobbyUsername').textContent = u.username;
  $('lobbyAchievement').textContent = getAchievement(wr);
  $('lobbyScore').textContent = u.score+'分';
  $('lobbyWinRate').textContent = '胜率 '+wr+'%';
  $('lobbyWins').textContent = u.wins;
  $('lobbyLosses').textContent = u.losses;
  $('lobbyDraws').textContent = u.draws;
  refreshFriends();
  refreshLeaderboardLobby();
}

// ============ PING ============
function startPing() {
  stopPing();
  pingTimer = setInterval(() => { if(state.user) apiPing(state.user.id).catch(()=>{}); }, 5000);
  apiPing(state.user.id).catch(()=>{});
  friendsTimer = setInterval(() => { if(state.user&&!state.isPlaying) refreshFriends(); }, 3000);
  refreshFriends();
}

function stopPing() { if(pingTimer) { clearInterval(pingTimer); pingTimer=null; } if(friendsTimer) { clearInterval(friendsTimer); friendsTimer=null; } }

// ============ MATCHMAKING ============
$('matchBtn').addEventListener('click', toggleMatch);

async function toggleMatch() {
  if (state.isMatching) {
    try { await apiLeaveMatch(state.user.id); } catch {}
    stopMatchPolling(); state.isMatching=false;
    $('matchBtn').textContent='🎮 匹配对战'; $('matchBtn').className='match-btn'; $('matchInfo').textContent='';
    return;
  }
  if (state.isPlaying) return;
  state.isMatching=true;
  $('matchBtn').textContent='⏳ 取消匹配'; $('matchBtn').className='match-btn matching'; $('matchInfo').textContent='正在寻找对手...';
  try {
    const r = await apiJoinMatch(state.user.id, state.selectedPattern);
    if (r.status==='matched') {
      state.isMatching=false; $('matchBtn').textContent='🎮 匹配对战'; $('matchBtn').className='match-btn'; $('matchInfo').textContent='';
      startGame(r.matchId, r.opponent, r.color, r.myOppPattern);
    } else startMatchPolling();
  } catch(e) {
    state.isMatching=false; $('matchBtn').textContent='🎮 匹配对战'; $('matchBtn').className='match-btn'; $('matchInfo').textContent='匹配失败: '+e.message;
  }
}

function startMatchPolling() {
  stopMatchPolling();
  matchPollTimer = setInterval(async () => {
    try {
      const r = await apiMatchStatus(state.user.id);
      if (r.status==='matched') {
        stopMatchPolling(); state.isMatching=false;
        $('matchBtn').textContent='🎮 匹配对战'; $('matchBtn').className='match-btn'; $('matchInfo').textContent='';
        startGame(r.matchId, r.opponent, r.color, r.myOppPattern);
      }
    } catch {}
  }, 2000);
}

function stopMatchPolling() { if(matchPollTimer){clearInterval(matchPollTimer);matchPollTimer=null;} }

// ============ SEARCH ============
$('searchBtn').addEventListener('click', handleSearch);
$('searchInput').addEventListener('keydown', e=>{if(e.key==='Enter')handleSearch();});

async function handleSearch() {
  const q=$('searchInput').value.trim(), c=$('searchResults');
  if (!q) { c.innerHTML=''; return; }
  try {
    const r=await apiSearch(q);
    const friends=await apiGetFriends(state.user.id);
    const friendIds=new Set((friends||[]).map(f=>f.id));
    c.innerHTML = r.filter(x=>x.id!==state.user.id).map(x=>
      `<div class="search-result-item">
        <span class="online-dot ${x.online?'on':'off'}"></span>
        <span class="sr-name">${esc(x.username)}</span>
        <span class="sr-score">${x.score}分</span>
        ${
          friendIds.has(x.id)
          ? '<span class="already-friend">已是好友</span>'
          : `<button class="small-btn btn-add" onclick="addFriend(${x.id})">＋好友</button>`
        }
        <button class="small-btn btn-challenge" onclick="sendChallenge(${x.id},'${esc(x.username)}')">挑战</button>
      </div>`
    ).join('')||'<p class="empty-hint">未找到玩家</p>';
  } catch { c.innerHTML='<p class="empty-hint">搜索失败</p>'; }
}

async function addFriend(fid) {
  try { await apiAddFriend(state.user.id,fid); refreshFriends(); $('searchResults').innerHTML=''; } catch(e) { alert(e.message); }
}

async function sendChallenge(tuid,tname) {
  try {
    const r = await apiSendChallenge(state.user.id, tuid, state.selectedPattern);
    state.waitingForChallenge=r.challengeId; state.waitingTargetName=tname||'对手';
    updateMatchAreaForChallenge(); startChallengeSentPolling(); $('searchResults').innerHTML='';
  } catch(e) { alert(e.message); }
}

function updateMatchAreaForChallenge() {
  if (state.waitingForChallenge) {
    $('matchBtn').disabled=true; $('matchBtn').textContent='⏳ 等待回应';
    $('matchBtn').className='match-btn matching';
    $('matchInfo').innerHTML=`等待 ${esc(state.waitingTargetName)} 接受挑战... <button class="small-btn btn-decline" onclick="cancelSentChallenge()">取消</button>`;
  }
}

function clearMatchAreaForChallenge() {
  state.waitingForChallenge=null; state.waitingTargetName='';
  $('matchBtn').disabled=false; $('matchBtn').textContent='🎮 匹配对战';
  $('matchBtn').className='match-btn'; $('matchInfo').innerHTML='';
}

async function cancelSentChallenge() {
  if(state.waitingForChallenge) try{await apiCancelChallenge(state.waitingForChallenge)}catch{}
  stopChallengeSentPolling(); clearMatchAreaForChallenge();
}

function startChallengeSentPolling() {
  stopChallengeSentPolling();
  challengeSentTimer=setInterval(pollSentChallenges,2000); pollSentChallenges();
}
function stopChallengeSentPolling() { if(challengeSentTimer){clearInterval(challengeSentTimer);challengeSentTimer=null;} }

async function pollSentChallenges() {
  if(!state.user||!state.waitingForChallenge) return;
  try {
    const [sl,ms]=await Promise.all([apiSentChallenges(state.user.id),apiMatchStatus(state.user.id)]);
    if(ms.status==='matched') { stopChallengeSentPolling();stopChallengePolling();clearMatchAreaForChallenge();startGame(ms.matchId,ms.opponent,ms.color,ms.myOppPattern); return; }
    if(!sl.some(c=>c.id===state.waitingForChallenge)) { stopChallengeSentPolling();clearMatchAreaForChallenge();$('matchInfo').textContent='挑战已被拒绝或已取消'; }
  } catch {}
}

// ============ FRIENDS ============
async function refreshFriends() {
  try {
    const f=await apiGetFriends(state.user.id);
    $('friendsList').innerHTML=f.length?f.map(x=>
      `<div class="friend-item">
        <span class="online-dot ${x.online?'on':'off'}"></span>
        <span class="fr-name">${esc(x.username)}</span>
        <span class="fr-score">${x.score}分</span>
        <button class="small-btn btn-invite" onclick="sendChallenge(${x.id},'${esc(x.username)}')">邀请</button>
        <button class="small-btn btn-remove" onclick="removeFriend(${x.id})">✕</button>
      </div>`
    ).join(''):'<p class="empty-hint">暂无好友</p>';
  } catch {}
}
async function removeFriend(fid) { try{await apiRemoveFriend(state.user.id,fid);refreshFriends()}catch{} }

// ============ CHALLENGES ============
function startChallengePolling() { stopChallengePolling(); challengePollTimer=setInterval(refreshChallenges,3000); refreshChallenges(); }
function stopChallengePolling() { if(challengePollTimer){clearInterval(challengePollTimer);challengePollTimer=null;} }

async function refreshChallenges() {
  if(!state.user||state.isPlaying) return;
  try {
    const l=await apiGetChallenges(state.user.id);
    $('challengesList').innerHTML=l.length?l.map(c=>
      `<div class="challenge-item"><span style="flex:1">${esc(c.fromUsername)} (${c.fromScore}分) 发起了挑战</span>
        <button class="small-btn btn-accept" onclick="acceptChallenge(${c.id})">接受</button>
        <button class="small-btn btn-decline" onclick="declineChallenge(${c.id})">拒绝</button></div>`
    ).join(''):'<p class="empty-hint">暂无挑战</p>';
  } catch {}
}

async function acceptChallenge(cid) {
  try {
    const r=await apiRespondChallenge(cid, true, state.selectedPattern);
    if(r.status==='matched') { stopChallengePolling(); startGame(r.matchId,r.opponent,r.color,r.myOppPattern); }
  } catch(e) { alert(e.message); }
}
async function declineChallenge(cid) { try{await apiRespondChallenge(cid,false);refreshChallenges()}catch{} }

// ============ GAME ============
function startGame(matchId, opponent, color, oppPattern) {
  state.matchId=matchId; state.opponent=opponent; state.myColor=color;
  state.isPlaying=true; state.gameState=null; state.gameOverShown=false; state.previewCell=null;
  state.waitingForChallenge=null; stopChallengeSentPolling(); clearMatchAreaForChallenge();
  initBoardLocal();
  showScreen('gameScreen');
  const myWr=calcWinRate(state.user); const oppWr=calcWinRate(opponent);
  $('gameMyName').textContent=state.user.username; $('gameMyAchievement').textContent=getAchievement(myWr);
  $('gameMyScore').textContent=state.user.score+'分';
  $('gameOpponentName').textContent=opponent.username; $('gameOpponentScore').textContent=opponent.score+'分';
  $('gameOpponentAchievement').textContent=getAchievement(oppWr);
  $('gameResultOverlay').style.display='none';
  lastEmojiTimestamp=Date.now();
  updateGameTurnUI(null); renderBoard(); startGamePolling(); startEmojiPolling();
}

function initBoardLocal() { state.board=Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(EMPTY)); }

function updateGameTurnUI(gs) {
  const el=$('gameTurnIndicator');
  if(!gs||gs.gameOver) {
    if(gs&&gs.gameOver) {
      if(gs.winner===state.user.id) el.textContent='🎉 你赢了！';
      else if(gs.winner===null) el.textContent='🤝 平局';
      else el.textContent='😞 你输了';
    } else el.textContent='等待中...';
    return;
  }
  const myTurn=(state.myColor==='black'&&gs.currentPlayer===1)||(state.myColor==='white'&&gs.currentPlayer===2);
  el.textContent=myTurn?'👆 轮到你了 (点击一次预览，再点确认)':'⏳ 等待对手落子...';
}

function startGamePolling() { stopGamePolling(); gamePollTimer=setInterval(pollGameState,1000); pollGameState(); }
function stopGamePolling() { if(gamePollTimer){clearInterval(gamePollTimer);gamePollTimer=null;} }

async function pollGameState() {
  if(!state.matchId||!state.user) return;
  try {
    const gs=await apiGameState(state.matchId,state.user.id);
    state.gameState=gs; state.board=gs.board.map(r=>[...r]);
    state.myPattern=gs.myPattern; state.opponentPattern=gs.opponentPattern;
    if(gs.opponent) $('gameOpponentAchievement').textContent=getAchievement(calcWinRate(gs.opponent));
    renderBoard(); updateGameTurnUI(gs);
    if(gs.gameOver&&!state.gameOverShown) { state.gameOverShown=true; showGameResult(gs); }
  } catch {
    if(!state.gameOverShown) { state.gameOverShown=true; $('gameResultOverlay').style.display='flex'; $('resultTitle').textContent='连接中断'; }
    stopGamePolling();
  }
}

async function showGameResult(gs) {
  $('gameResultOverlay').style.display='flex';
  if(gs.winner===state.user.id) $('resultTitle').textContent='🎉 你赢了！';
  else if(gs.winner===null) $('resultTitle').textContent='🤝 平局';
  else $('resultTitle').textContent='😞 你输了';
  try { const fresh=await api('/api/user/'+state.user.id); state.user=fresh; const wr=calcWinRate(fresh); $('gameMyScore').textContent=fresh.score+'分'; $('gameMyAchievement').textContent=getAchievement(wr); } catch {}
}

$('backToLobbyBtn').addEventListener('click',()=>{
  state.isPlaying=false; state.matchId=null; state.opponent=null;
  $('gameResultOverlay').style.display='none'; stopGamePolling(); stopEmojiPolling();
  enterLobby();
});

$('resignBtn').addEventListener('click',async()=>{
  if(!state.matchId||state.gameState?.gameOver) return;
  if(!confirm('确定认输吗？')) return;
  try{await apiResign(state.matchId,state.user.id)}catch{}
});

// ============ DOUBLE-CLICK BOARD ============
canvas.addEventListener('click', async (e) => {
  if(!state.isPlaying||!state.gameState||state.gameState.gameOver) return;
  const myTurn=(state.myColor==='black'&&state.gameState.currentPlayer===1)||(state.myColor==='white'&&state.gameState.currentPlayer===2);
  if(!myTurn) return;
  const rect=canvas.getBoundingClientRect();
  const sx=canvas.width/rect.width, sy=canvas.height/rect.height;
  const x=(e.clientX-rect.left)*sx, y=(e.clientY-rect.top)*sy;
  const col=Math.round((x-MARGIN)/CELL_SIZE), row=Math.round((y-MARGIN)/CELL_SIZE);
  if(row<0||row>=BOARD_SIZE||col<0||col>=BOARD_SIZE) return;
  if(state.board[row][col]!==EMPTY) { state.previewCell=null; renderBoard(); return; }

  if(state.previewCell && state.previewCell.row===row && state.previewCell.col===col) {
    state.previewCell=null;
    try {
      const result=await apiGameMove(state.matchId,state.user.id,row,col);
      const pv=state.myColor==='black'?1:2;
      state.board[row][col]=pv;
      state.gameState.currentPlayer=pv===1?2:1;
      if(result.gameOver) { state.gameState.gameOver=true; state.gameState.winner=result.winner; }
      renderBoard(); updateGameTurnUI(state.gameState);
      if(result.gameOver&&!state.gameOverShown) { state.gameOverShown=true; showGameResult(state.gameState); }
    } catch { renderBoard(); }
  } else {
    state.previewCell={row,col};
    renderBoard();
  }
});

// ============ EMOJI ============
function startEmojiPolling() { stopEmojiPolling(); emojiPollTimer=setInterval(pollEmojis,2000); pollEmojis(); }
function stopEmojiPolling() { if(emojiPollTimer){clearInterval(emojiPollTimer);emojiPollTimer=null;} }

async function pollEmojis() {
  if(!state.matchId) return;
  try {
    const list=await apiGetEmojis(state.matchId, lastEmojiTimestamp);
    if(list.length) {
      lastEmojiTimestamp=Math.max(...list.map(e=>e.timestamp));
      list.forEach(e => {
        if(e.userId!==state.user.id) showEmojiPopup(e.emoji);
      });
    }
  } catch {}
}

function showEmojiPopup(emoji) {
  const container=$('emojiNotification');
  const el=document.createElement('div');
  el.className='emoji-popup'; el.textContent=emoji;
  const offsetX=(Math.random()-0.5)*120;
  el.style.marginLeft=offsetX+'px';
  container.appendChild(el);
  setTimeout(()=>el.remove(), 2000);
}

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const e=btn.dataset.emoji;
    if(!state.matchId||!state.user) return;
    try { await apiSendEmoji(state.matchId,state.user.id,e); showEmojiPopup(e); } catch {}
  });
});

// ============ RENDER ============
function renderBoard() {
  ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.fillStyle='#c8a26b'; ctx.fillRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.strokeStyle='#5a3e2b'; ctx.lineWidth=1;
  for(let i=0;i<BOARD_SIZE;i++) {
    const p=MARGIN+i*CELL_SIZE;
    ctx.beginPath();ctx.moveTo(MARGIN,p);ctx.lineTo(MARGIN+(BOARD_SIZE-1)*CELL_SIZE,p);ctx.stroke();
    ctx.beginPath();ctx.moveTo(p,MARGIN);ctx.lineTo(p,MARGIN+(BOARD_SIZE-1)*CELL_SIZE);ctx.stroke();
  }
  ctx.fillStyle='#5a3e2b';
  [[3,3],[3,11],[7,7],[11,3],[11,11]].forEach(([r,c])=>{ctx.beginPath();ctx.arc(MARGIN+c*CELL_SIZE,MARGIN+r*CELL_SIZE,4,0,Math.PI*2);ctx.fill()});

  for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(state.board[r][c]!==EMPTY) drawStone(r,c,state.board[r][c]);

  const gs=state.gameState;
  if(gs&&gs.winLine) gs.winLine.forEach(cell=>{ctx.beginPath();ctx.arc(MARGIN+cell.col*CELL_SIZE,MARGIN+cell.row*CELL_SIZE,17,0,Math.PI*2);ctx.fillStyle='rgba(255,50,50,0.25)';ctx.fill()});

  if(gs&&gs.lastMove&&!gs.gameOver) {
    const {row,col}=gs.lastMove;
    ctx.fillStyle='#e74c3c'; ctx.beginPath();ctx.arc(MARGIN+col*CELL_SIZE,MARGIN+row*CELL_SIZE,4,0,Math.PI*2);ctx.fill();
  }

  if(state.previewCell) {
    const {row,col}=state.previewCell;
    ctx.beginPath();ctx.arc(MARGIN+col*CELL_SIZE,MARGIN+row*CELL_SIZE,CELL_SIZE/2-3,0,Math.PI*2);
    ctx.strokeStyle=state.myColor==='black'?'rgba(0,0,0,0.5)':'rgba(255,255,255,0.7)';
    ctx.lineWidth=3; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=state.myColor==='black'?'rgba(0,0,0,0.12)':'rgba(255,255,255,0.2)';
    ctx.fill();
  }
}

function drawStone(row,col,player) {
  const x=MARGIN+col*CELL_SIZE, y=MARGIN+row*CELL_SIZE, r=CELL_SIZE/2-3;
  const playerColor = player === BLACK ? 'black' : 'white';
  const isMyColor = playerColor === state.myColor;
  const pattern = isMyColor ? (state.myPattern || 'default') : (state.opponentPattern || 'default');
  drawPatternPiece(ctx,x,y,r,pattern,player===BLACK);
}

function drawPatternPiece(cx,x,y,r,pattern,isBlack) {
  if (pattern==='default') {
    cx.save();
    const g=cx.createRadialGradient(x-3,y-3,2,x,y,r);
    g.addColorStop(0,isBlack?'#555':'#fff'); g.addColorStop(1,isBlack?'#000':'#ddd');
    cx.beginPath(); cx.arc(x,y,r,0,Math.PI*2); cx.fillStyle=g; cx.fill();
    if(!isBlack) { cx.strokeStyle='#bbb'; cx.lineWidth=1; cx.stroke(); }
    cx.restore();
    return;
  }

  const img = patternImages[pattern];
  if (img && img.complete && img.naturalWidth) {
    cx.save();
    cx.beginPath(); cx.arc(x,y,r,0,Math.PI*2); cx.clip();
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2;
    const sy = (img.naturalHeight - s) / 2;
    cx.drawImage(img, sx, sy, s, s, x-r, y-r, r*2, r*2);
    cx.restore();
  }
}

// ============ LEADERBOARD LOBBY ============
async function refreshLeaderboardLobby() {
  try {
    const l=await apiLeaderboard();
    $('lobbyLeaderboard').innerHTML=l.map(p=>`<li><span class="lb-user">${esc(p.nickname||p.username)}</span><span class="lb-pts">${p.winRate}%</span></li>`).join('')||'<p class="empty-hint">暂无数据</p>';
  } catch {}
}

// ============ LOGOUT ============
$('lobbyLogoutBtn').addEventListener('click',()=>{
  stopMatchPolling(); stopGamePolling(); stopChallengePolling(); stopChallengeSentPolling(); stopPing(); stopEmojiPolling();
  state.user=null; state.isPlaying=false; state.isMatching=false; state.waitingForChallenge=null;
  showScreen('loginScreen'); $('loginUsername').value=''; $('loginPassword').value=''; $('loginError').textContent='';
});
