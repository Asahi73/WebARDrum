const video = document.getElementById('camera');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const canvasSize = { width: window.innerWidth, height: window.innerHeight };
canvas.width = canvasSize.width;
canvas.height = canvasSize.height;

const targetColors = {
  kick: "rgba(255, 0, 0, 0.2)",    // 赤
  snare: "rgba(0, 255, 0, 0.2)",   // 緑
  hihat: "rgba(0, 0, 255, 0.2)"    // 青
};
const instructionColors = {
  kick: "rgba(255, 0, 0, 1)",    // 赤
  snare: "rgba(0, 255, 0, 1)",   // 緑
  hihat: "rgba(0, 0, 255, 1)"    // 青
};

// const markerPositions = JSON.parse(localStorage.getItem('markerPositions')) || {};
// 仮座標（本番ではlocalStorageから取得）
const markerPositions = {
  kick:   { x: -0.5, y: 0.2, z: 0 },
  snare:  { x:  0, y: 0.2, z: 0 },
  hihat:  { x:  0.5, y: 0.2, z: 0 }
};

const midiToName = {
  36: "kick",
  37: "snare",
  42: "hihat",
  43: "hihatOpen", // 電ドラは0
  39: "hihatFoot", // 電ドラは44
}

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
function projectPosition(pos3D) {
  const scale = 200;
  return {
    x: center.x + pos3D.x * scale,
    y: center.y - pos3D.y * scale
  };
}

// ターゲットリング描画（演奏開始まで）
function drawTargetRings() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 各マーカ位置にリングを出す
  Object.entries(markerPositions).forEach(([id, pos3D]) => {
    const pos2D = projectPosition(pos3D);
    ctx.beginPath();
    ctx.arc(pos2D.x, pos2D.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = targetColors[id]; // 薄い色
    ctx.lineWidth = 10;
    ctx.stroke();
  });

  requestAnimationFrame(drawTargetRings);
}

////////////////////////////////////////////////////////////////////////////////////////////
// 譜面ロード
////////////////////////////////////////////////////////////////////////////////////////////

let subdivision = 4;
let pattern = [];

async function loadPattern(jsonPath) {
  const res = await fetch(jsonPath);
  const data = await res.json();

  subdivision = data.subdivision || 4;
  
  pattern = (data.pattern || []).map(ev => ({ // JSONのpatternに consumed を付与
    ...ev,          // 他のオブジェクトをそのままコピー
    consumed: false // 判定用フラグを追加
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
  const beatMs = 60000 / getTempo();
  const stepMs = beatMs / subdivision;
  pattern.forEach(event => {
    event.time = event.step * stepMs;
  });
  console.log(pattern);
}

////////////////////////////////////////////////////////////////////////////////////////////
// リングアニメーション
////////////////////////////////////////////////////////////////////////////////////////////

const appearOffset = 500; // 出現開始(ms)
let playbackStartTime = null; // 演奏開始時刻(audioContext.currentTime)
const noteToId = { 36: 'kick', 37: 'snare', 42: 'hihat' };

function drawLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!playbackStartTime) return;

  // ターゲットリング描画(演奏開始後)
  Object.entries(markerPositions).forEach(([id, pos3D]) => {
    const pos2D = projectPosition(pos3D);
    ctx.beginPath();
    ctx.arc(pos2D.x, pos2D.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = targetColors[id]; // 薄い色
    ctx.lineWidth = 10;
    ctx.stroke();
  });

  // インストラクションリング描画
  const elapsed = (audioContext.currentTime - playbackStartTime) * 1000; // s->msに変換(ctxの時刻は秒出力)
  pattern.forEach(event => {
    const appearTime = event.time - appearOffset;
    const disappearTime = event.time;

    if (elapsed >= appearTime && elapsed <= disappearTime) {
      const t = (elapsed - appearTime) / (disappearTime - appearTime);
      const id = noteToId[event.note];
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
  });

  animationID = requestAnimationFrame(drawLoop);
}

////////////////////////////////////////////////////////////////////////////////////////////
// メトロノーム       ミリ秒換算にしたら音出なくなったんだけど？？？
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
  const beatMs = 60000 / getTempo();
  let nextBeat = playbackStartTime * 1000; // audioContext.currentTime 基準（演奏開始ボタン押下時）
  let count = 0;

  function schedule() {
    while (nextBeat < (audioContext.currentTime * 1000) + 1000) { // 1秒先まで予約
      playClick(count % 4 === 0, nextBeat);
      nextBeat += beatMs;
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
    cancelAnimationFrame(animationID);
  }
}

////////////////////////////////////////////////////////////////////////////////////////////
// 判定
////////////////////////////////////////////////////////////////////////////////////////////

let isPlaying = false;

// 判定猶予（ms）
const JUDGE_WINDOW = 120;   // good範囲(ms)
const PERFECT_WINDOW = 30;  // excellent範囲(ms)
const CLOSE_THRESHOLD = 20; // 過去イベント優先範囲(ms)

// MIDI入力が来た時の判定処理
function judge(note) {
  if (!isPlaying) return;

  const hitTime = (audioContext.currentTime - playbackStartTime) * 1000; // ms変換

  // 判定候補イベントを収集
  const candidates = pattern.filter(ev =>
    !ev.consumed &&                             // まだ判定していない(false)
    ev.note === note &&                         // 叩いたパーツと一致
    Math.abs(hitTime - ev.time) <= JUDGE_WINDOW // 差がgood範囲内
  );

  if (candidates.length === 0) return null;

  let target = null; // 判定するイベント

  // 基準1：優先範囲内の過去イベントがあるなら過去を優先
  const closePast = candidates.find(ev =>
    ev.time <= hitTime && Math.abs(hitTime - ev.time) <= CLOSE_THRESHOLD
  );
  if (closePast) {
    target = closePast;
  } else {
    // 基準2：未来イベントを優先（早めに叩いた場合）
    target = candidates.find(ev => ev.time >= hitTime);

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
    //flashRing(target.midi, result);

    console.log(`判定: ${result}, diff=${diff.toFixed(1)}ms, note=${note}`);
    //return { result, diff, target };
  }
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
  playbackStartTime = audioContext.currentTime;
  startMetronome();
  requestAnimationFrame(drawLoop);
}

////////////////////////////////////////////////////////////////////////////////////////////
// 初期化
////////////////////////////////////////////////////////////////////////////////////////////
window.addEventListener('DOMContentLoaded', async () => {
  await loadMetronomeSounds();
  await loadPattern('../assets/pattern3.json');
  requestAnimationFrame(drawTargetRings);
});
