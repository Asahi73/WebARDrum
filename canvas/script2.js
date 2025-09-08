const video = document.getElementById('camera');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const canvasSize = { width: window.innerWidth, height: window.innerHeight };
canvas.width = canvasSize.width;
canvas.height = canvasSize.height;

const targetColors = {
  kick: "rgba(255, 0, 0, 0.2)",
  snare: "rgba(0, 255, 0, 0.2)",
  hihat: "rgba(0, 0, 255, 0.2)"
};
const instructionColors = {
  kick: "rgba(255, 0, 0, 1)",
  snare: "rgba(0, 255, 0, 1)",
  hihat: "rgba(0, 0, 255, 1)"
};
const flashColors = {
  36: { color: "red", flashing: false, flashEnd: 0 },   // Kick
  37: { color: "rgb(226, 255, 226)", flashing: false, flashEnd: 0 },  // Snare
  42: { color: "blue", flashing: false, flashEnd: 0 }  // Hihat
};

// const markerPositions = JSON.parse(localStorage.getItem('markerPositions')) || {};
// 仮座標（本番ではlocalStorageから取得）
const markerPositions = {
  kick:   { x: -0.7, y: 0.2, z: 0 },
  snare:  { x:  0, y: 0.2, z: 0 },
  hihat:  { x:  0.7, y: 0.2, z: 0 }
};

const midiToName = {
  36: "kick",
  37: "snare",
  42: "hihat",
  43: "hihatOpen", // 電ドラは0
  39: "hihatFoot", // 電ドラは44
}
const nameToMidi = {
  kick: 36,
  snare: 37,
  hihat: 42,
  hihatOpen: 43,
  hihatFoot: 39,
}

let subdivision = 4;          // 一拍分割数
let pattern = [];             // 楽譜(step, note, consumed, time(sec))
let playbackStartTime = null; // 演奏開始時刻(audioContext.currentTime)
let isPlaying = false;        // 演奏中フラグ

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
  const scale = 200;
  return {
    x: center.x + pos3D.x * scale,
    y: center.y - pos3D.y * scale
  };
}

////////////////////////////////////////////////////////////////////////////////////////////
// 譜面ロード
////////////////////////////////////////////////////////////////////////////////////////////

async function loadPattern(jsonPath) {
  const res = await fetch(jsonPath);
  const data = await res.json();

  subdivision = data.subdivision || 4;
  
  // 楽譜に判定済フラグを付与
  pattern = (data.pattern || []).map(event => ({
    ...event, // 他のオブジェクトはそのままコピー
    consumed: false
  }));

  updatePatternTiming();
}

document.getElementById('loadPatternBtn').addEventListener('click', async () => {
  const select = document.getElementById('patternSelect');
  await loadPattern(select.value);
});

////////////////////////////////////////////////////////////////////////////////////////////
// BPM変更
////////////////////////////////////////////////////////////////////////////////////////////

document.getElementById("tempoSlider").addEventListener("input", (e) => {
  document.getElementById("tempoValue").textContent = e.target.value;
  updatePatternTiming();
});

function getTempo() {
  return parseInt(document.getElementById("tempoSlider").value, 10);
}

function updatePatternTiming() {
  const beatSec = 60 / getTempo();
  const stepSec = beatSec / subdivision;
  pattern.forEach(event => {
    event.time = event.step * stepSec;
  });
  console.log(pattern);
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
    ctx.arc(pos2D.x, pos2D.y, 20, 0, Math.PI * 2);
    ctx.strokeStyle = targetColors[id]; // 薄い色
    ctx.lineWidth = 25;
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
      ctx.arc(screen.x, screen.y, 80, 0, Math.PI * 2);
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
// メトロノーム
////////////////////////////////////////////////////////////////////////////////////////////

let countBuffer = null;
let countHeadBuffer = null;
let metronomeTimer = null;

async function loadMetronomeSounds() {
  const [countRes, headRes] = await Promise.all([
    fetch('../inst/count.mp3'),
    fetch('../inst/countHead.mp3')
  ]);
  countBuffer = await audioContext.decodeAudioData(await countRes.arrayBuffer());
  countHeadBuffer = await audioContext.decodeAudioData(await headRes.arrayBuffer());
}

function playClick(isHead, when) {
  const src = audioContext.createBufferSource();
  src.buffer = isHead ? countHeadBuffer : countBuffer;
  src.connect(audioContext.destination);
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
}

////////////////////////////////////////////////////////////////////////////////////////////
// 判定
////////////////////////////////////////////////////////////////////////////////////////////

// 判定猶予（sec）
const JUDGE_WINDOW = 0.12;    // good範囲
const PERFECT_WINDOW = 0.03;  // excellent範囲
const CLOSE_THRESHOLD = 0.02; // 過去イベント優先範囲
const HIT_OFFSET = 0.1;       // 処理によるヒットタイミングのズレを補正

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

  const duration = result === "PERFECT" ? 0.4 : 0.12; // sec
  state.flashing = true;
  state.flashEnd = audioContext.currentTime + duration;
}

// sidebar.jsとの連携
window.onMidiJudge = function(note) {
  judge(note);
};

////////////////////////////////////////////////////////////////////////////////////////////
// 演奏開始
////////////////////////////////////////////////////////////////////////////////////////////

function startPlayback() {
  isPlaying = true;
  playbackStartTime = audioContext.currentTime; // 演奏開始時の時刻(secなので注意！！！)
  startMetronome();
  pattern.forEach(event => { // 判定済フラグをリセット
    event.consumed = false;
  });
}

////////////////////////////////////////////////////////////////////////////////////////////
// 初期化
////////////////////////////////////////////////////////////////////////////////////////////
window.addEventListener('DOMContentLoaded', async () => {
  await loadMetronomeSounds();
  await loadPattern('../assets/pattern3.json');
  requestAnimationFrame(drawLoop);
});
