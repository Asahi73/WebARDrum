const video = document.getElementById('camera');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const canvasSize = { width: window.innerWidth, height: window.innerHeight };
canvas.width = canvasSize.width;
canvas.height = canvasSize.height;

const targetColors = {
  kick: "rgba(255, 0, 0, 0.4)",
  snare: "rgba(0, 255, 0, 0.4)",
  hihat: "rgba(0, 0, 255, 0.4)"
};
const instructionColors = {
  kick: "rgba(255, 0, 0, 1)",
  snare: "rgba(0, 255, 0, 1)",
  hihat: "rgba(0, 0, 255, 1)"
};
const flashColors = {
  36: { color: "rgb(255, 158, 158)", flashing: false, flashEnd: 0, maxRadius: 0 },   // Kick
  37: { color: "rgb(170, 253, 170)", flashing: false, flashEnd: 0, maxRadius: 0 },  // Snare
  38: { color: "rgb(133, 156, 249)", flashing: false, flashEnd: 0, maxRadius: 0 }  // Hihat
};

markerPositions = JSON.parse(localStorage.getItem('markerPositions'));
// null や空オブジェクトならデフォルトを使う
if (!markerPositions || Object.keys(markerPositions).length === 0) {
  resetPositions();
}

function resetPositions() {
  markerPositions = {
    kick:   { x:  3.0, y: 0, z: 0 },
    snare:  { x:  0,   y: 0, z: 0 },
    hihat:  { x:  -3.0, y: 0, z: 0 }
  };
}

console.log(markerPositions);

// 仮座標（本番ではlocalStorageから取得）

const midiToName = {
  36: "kick",
  37: "snare",
  38: "hihat",
  43: "hihatOpen", // 電ドラは0
  39: "hihatFoot", // 電ドラは44
  40: "crash",
  42: "ride"
}
const nameToMidi = {
  kick: 36,
  snare: 37,
  hihat: 38,
  hihatOpen: 43,
  hihatFoot: 39,
  crash: 40,
  ride: 42
}

let subdivision = 4;          // 一拍分割数
let pattern = [];             // 楽譜(step, note, consumed, time(sec))
let playbackStartTime = null; // 演奏開始時刻(audioContext.currentTime)
let isPlaying = false;        // 演奏中フラグ
let isFlipped = true;        // カメラ上下反転フラグ
let bgmBuffer = null;         // BGMオーディオバッファ
let bgmSource = null;         // BGM再生用ソース
let bgmGain = null;           // BGM音量制御用GainNode
let bgmStartOffset = 0.0;     // BGM開始オフセット

////////////////////////////////////////////////////////////////////////////////////////////
////////// カメラ出力
////////////////////////////////////////////////////////////////////////////////////////////

// 起動時にカメラ映像取得
navigator.mediaDevices.getUserMedia({ video: true })
.then(stream => {
  video.srcObject = stream;
})
.catch(err => {
  console.error('カメラの取得に失敗しました:', err);
});

const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
function projectPosition(pos3D) { // ３次元座標を２次元に変換
  const scale = 75; // カメラ位置に応じて要変更
  const y = center.y - pos3D.y * scale - 50;
  return {
    x: center.x + pos3D.x * scale,
    y: isFlipped ? (canvas.height - y) : y
  };
}

document.getElementById('flipBtn').addEventListener('click', () => {
  isFlipped = !isFlipped;
  video.style.transform = isFlipped ? "scaleX(-1) scaleY(-1)" : "scaleX(-1) scaleY(1)";
});

////////////////////////////////////////////////////////////////////////////////////////////
// 譜面ロード
////////////////////////////////////////////////////////////////////////////////////////////

async function loadPattern(jsonPath) {
  const res = await fetch(jsonPath);
  const data = await res.json();

  subdivision = data.subdivision || 4;
  bgmStartOffset = data.bgmStartOffset || 0.0;
  
  // BGMファイルを読み込み（存在する場合のみ）
  if (data.bgm) {
    try {
      const bgmRes = await fetch(data.bgm);
      bgmBuffer = await audioContext.decodeAudioData(await bgmRes.arrayBuffer());
      console.log('BGM loaded:', data.bgm);
    } catch (error) {
      console.warn('BGM loading failed:', error);
      bgmBuffer = null;
    }
  } else {
    bgmBuffer = null;
    console.log('No BGM specified in pattern');
  }
  
  // 楽譜に判定済フラグを付与
  pattern = (data.pattern || []).map(event => ({
    ...event, // 他のオブジェクトはそのままコピー
    consumed: false
  }));

  updatePatternTiming();

  console.log(pattern);
}

document.getElementById('loadPatternBtn').addEventListener('click', async () => {
  const select = document.getElementById('patternSelect');
  await loadPattern(select.value);
  
  // 楽譜が読み込まれたら演奏開始ボタンを有効化
  if (pattern && pattern.length > 0) {
    document.getElementById('startBtn').disabled = false;
  }
});

////////////////////////////////////////////////////////////////////////////////////////////
// BPM変更
////////////////////////////////////////////////////////////////////////////////////////////

document.getElementById("tempoSlider").addEventListener("input", (e) => {
  //document.getElementById("tempoValue").textContent = e.target.value;
  updatePatternTiming();
});

function getTempo() {
  //return parseInt(document.getElementById("tempoSlider").value, 10);
  return 120;
}

function updatePatternTiming() {
  const beatSec = 60 / getTempo();
  const stepSec = beatSec / subdivision;
  pattern.forEach(event => {
    event.time = event.step * stepSec;
  });
}

////////////////////////////////////////////////////////////////////////////////////////////
// リングアニメーション
////////////////////////////////////////////////////////////////////////////////////////////

const appearOffset = 0.5; // 出現開始(sec)

function drawTargetRings() {
  // 各マーカ位置に固定リングを出す
  Object.entries(markerPositions).forEach(([id, pos3D]) => {
    const pos2D = projectPosition(pos3D);
    ctx.beginPath();
    ctx.arc(pos2D.x, pos2D.y, 30, 0, Math.PI * 2);
    ctx.strokeStyle = targetColors[id]; // 薄い色
    ctx.lineWidth = 30;
    ctx.stroke();
  });
}

function drawInstructionRings() {
  const elapsed = audioContext.currentTime - playbackStartTime; 
  pattern.forEach(event => {
    const appearTime = event.time - appearOffset;
    const disappearTime = event.time;

    if (elapsed >= appearTime && elapsed <= disappearTime) {
      const t = (elapsed - appearTime) / (disappearTime - appearTime);
      const id = midiToName[event.note];
      const pos3D = markerPositions[id];
      if (!pos3D) return;
      const pos2D = projectPosition(pos3D);

      const maxRadius = 150;
      const minRadius = 5;
      const radius = maxRadius - (maxRadius - minRadius) * t;

      ctx.beginPath();
      ctx.arc(pos2D.x, pos2D.y, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = instructionColors[id]; // 濃い色
      ctx.lineWidth = 4;
      ctx.globalAlpha = 1 - t * 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  })
}

function drawFlashRings() {
  const now = audioContext.currentTime;

  Object.entries(markerPositions).forEach(([name, pos]) => {
    let note = nameToMidi[name];

    const state = flashColors[note];
    if (!state.flashing) return;

    const screen = projectPosition(pos);

    if (now < state.flashEnd) {
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, state.maxRadius, 0, Math.PI * 2);
      ctx.strokeStyle = state.color;
      ctx.globalAlpha = (state.flashEnd - now) / 0.2; // フェードアウト
      ctx.lineWidth = 4;
      ctx.stroke();
    } else {
      state.flashing = false; // 終了
    }
  });

  ctx.globalAlpha = 1.0;
}

function drawLoop() { // 常に回しっぱなし
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawTargetRings();
  if (isPlaying) {
    drawInstructionRings();
    drawFlashRings();
  }

  requestAnimationFrame(drawLoop);
}

////////////////////////////////////////////////////////////////////////////////////////////
// BGM再生
////////////////////////////////////////////////////////////////////////////////////////////

function startBGM() {
  if (!bgmBuffer) return; // BGMバッファが存在しない場合は何もしない
  
  // 既存のBGMを停止
  if (bgmSource) {
    bgmSource.stop();
  }
  
  bgmSource = audioContext.createBufferSource();
  bgmGain = audioContext.createGain(); // GainNode作成
  
  bgmSource.buffer = bgmBuffer;
  
  // 接続: source -> gain -> destination
  bgmSource.connect(bgmGain);
  bgmGain.connect(audioContext.destination);
  
  // 初期音量設定（50%）
  bgmGain.gain.value = 0.5;
  
  // グローバルに公開してsidebar.jsから制御可能に
  window.bgmGainNode = bgmGain;
  
  // BGM開始時刻を設定（演奏開始時刻 + オフセット）
  const startTime = playbackStartTime + bgmStartOffset;
  bgmSource.start(startTime);
  
  console.log('BGM started at:', startTime);
}

function stopBGM() {
  if (bgmSource) {
    bgmSource.stop();
    bgmSource = null;
  }
  if (bgmGain) {
    bgmGain = null;
  }
  window.bgmGainNode = null;
}

////////////////////////////////////////////////////////////////////////////////////////////
// メトロノーム
////////////////////////////////////////////////////////////////////////////////////////////

let countBuffer = null;
let countHeadBuffer = null;
let metronomeTimer = null;
let metronomeGain = null; // メトロノーム音量制御用GainNode

async function loadMetronomeSounds() {
  const [countRes, headRes] = await Promise.all([
    fetch('../inst/count/count.mp3'),
    fetch('../inst/count/countHead.mp3')
  ]);
  countBuffer = await audioContext.decodeAudioData(await countRes.arrayBuffer());
  countHeadBuffer = await audioContext.decodeAudioData(await headRes.arrayBuffer());
  
  // メトロノーム用のGainNodeを作成してグローバルに公開
  metronomeGain = audioContext.createGain();
  metronomeGain.gain.value = 0.7; // 初期音量70%
  window.metronomeGainNode = metronomeGain;
  console.log('Metronome GainNode initialized');
}

function playClick(isHead, when) {
  const src = audioContext.createBufferSource();
  src.buffer = isHead ? countHeadBuffer : countBuffer;
  
  // メトロノーム用のGainNodeがあれば経由、なければ直接接続
  if (metronomeGain) {
    src.connect(metronomeGain);
    metronomeGain.connect(audioContext.destination);
  } else {
    src.connect(audioContext.destination);
  }
  
  src.start(when);
}

function startMetronome() {
  const beatSec = 60 / getTempo();
  let nextBeat = playbackStartTime; // audioContext.currentTime 基準（演奏開始ボタン押下時）
  let count = 0;

  function schedule() {
    while (nextBeat < audioContext.currentTime + 1.0) { // 1秒先まで予約
      playClick(count % 4 === 0, nextBeat);
      nextBeat += beatSec;
      count++;
    }
    metronomeTimer = setTimeout(schedule, 100); // 1秒後にスケジュール
  }
  schedule();
}

function stopMetronome() {
  if (metronomeTimer) {
    clearTimeout(metronomeTimer);
    metronomeTimer = null;
    isPlaying = false;
  }
  stopBGM(); // BGMも停止
  
  // ボタン状態を更新
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
}

////////////////////////////////////////////////////////////////////////////////////////////
// 判定
////////////////////////////////////////////////////////////////////////////////////////////

// 判定猶予（sec）
const JUDGE_WINDOW = 0.12;    // good範囲
const PERFECT_WINDOW = 0.025;  // excellent範囲
const CLOSE_THRESHOLD = 0.025; // 過去イベント優先範囲
const HIT_OFFSET = 0.125;       // 処理によるヒットタイミングのズレを補正

// MIDI入力が来た時の判定処理
function judge(note) {
  if (!isPlaying) return;

  const hitTime = audioContext.currentTime - playbackStartTime + HIT_OFFSET;

  // 判定候補イベントを収集
  const candidates = pattern.filter(event =>
    !event.consumed &&                             // まだ判定していない(false)
    event.note === note &&                         // 叩いたパーツと一致
    Math.abs(hitTime - event.time) <= JUDGE_WINDOW // 差がgood範囲内
  );

  if (candidates.length === 0) return null;

  let target = null; // 判定するイベント

  // 基準1：優先範囲内の過去イベントがあるなら過去を優先
  const closePast = candidates.find(event =>
    event.time <= hitTime && Math.abs(hitTime - event.time) <= CLOSE_THRESHOLD
  );
  if (closePast) {
    target = closePast;
  } else {
    // 基準2：未来イベントを優先（早めに叩いた場合）
    target = candidates.find(event => event.time >= hitTime);

    // 基準3：未来イベントが無ければ直近の過去を選択
    if (!target) {
      target = candidates.reduce((prev, curr) =>
        Math.abs(curr.time - hitTime) < Math.abs(prev.time - hitTime) ? curr : prev
      );
    }
  }

  // 正誤判定
  if (target) {
    const diff = hitTime - target.time;
    const result = Math.abs(diff) <= PERFECT_WINDOW ? "PERFECT" : "GOOD";

    // イベントを消費済みに
    target.consumed = true;

    // 固定リングをフラッシュ演出
    flashRing(target.note, result);

    console.log(`判定: ${result}, diff=${diff.toFixed(4)}sec, note=${note}`);
  }
}

function flashRing(note, result) {
  const state = flashColors[note];
  if (!state) return;

  const duration = result === "PERFECT" ? 0.2 : 0.1; // 出現時間(sec)
  const radius = result === "PERFECT" ? 150: 100       // 最大半径
  state.flashing = true;
  state.flashEnd = audioContext.currentTime + duration;
  state.maxRadius = radius;
}

// sidebar.jsとの連携
window.onMidiJudge = function(note) {
  judge(note);
};

////////////////////////////////////////////////////////////////////////////////////////////
// 演奏開始
////////////////////////////////////////////////////////////////////////////////////////////

function startPlayback() {
  if (!pattern || pattern.length === 0) return; // 楽譜が読み込まれていない場合は何もしない
  
  isPlaying = true;
  playbackStartTime = audioContext.currentTime; // 演奏開始時の時刻(secなので注意！！！)
  startMetronome();
  startBGM(); // BGM再生開始
  pattern.forEach(event => { // 判定済フラグをリセット
    event.consumed = false;
  });
  
  // ボタン状態を更新
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
}

////////////////////////////////////////////////////////////////////////////////////////////
// 初期化
////////////////////////////////////////////////////////////////////////////////////////////
window.addEventListener('DOMContentLoaded', async () => {
  await loadMetronomeSounds();
  // await loadPattern('../assets/rock_easy.json');
  
  // 初期楽譜が読み込まれたら演奏開始ボタンを有効化
  if (pattern && pattern.length > 0) {
    document.getElementById('startBtn').disabled = false;
  }
  
  requestAnimationFrame(drawLoop);
});

////////////////////////////////////////////////////////////////////////////////////////////
// 　戻るボタン
////////////////////////////////////////////////////////////////////////////////////////////
// 戻るボタン：座標を保存し遷移
document.getElementById('prevPage').addEventListener('click', () => {
  localStorage.setItem('markerPositions', JSON.stringify(markerPositions));
  window.location.href = '../ar/index.html';
});

////////////////////////////////////////////////////////////////////////////////////////////
// 　座標リセットボタン
////////////////////////////////////////////////////////////////////////////////////////////
document.getElementById('resetPos').addEventListener('click', () => {
  resetPositions();
}) 