let drumNodes = {};
const drumBuffers = {};
const reverbBufferUrl = '../IR/st_georges_medium.wav';
const audioContext = new AudioContext({ latencyHint: 'interactive' }); // デフォでインタラクティブ念の為
const drums = {
  kick: "inst/kick.mp3",
  snare: "inst/snare.mp3",
  hihat: "inst/hihat.mp3",
  hihatOpen: "inst/hihatOpen.mp3",
  hihatFoot: "inst/hihatFoot.mp3",
};
const midiMap = {
  36: "kick",
  37: "snare",
  42: "hihat",
  43: "hihatOpen", // 電ドラは0
  39: "hihatFoot", // 電ドラは44
};
let reverbBuffer = null;
let activeHihatSource = null;

async function loadAudio(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

async function setupDrums() {
  reverbBuffer = await loadAudio(reverbBufferUrl);
  for (let name in drums) {
    drumBuffers[name] = await loadAudio(`../${drums[name]}`);

    const gain = audioContext.createGain();
    const pan = audioContext.createStereoPanner();
    const dryGain = audioContext.createGain();
    const wetGain = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    convolver.buffer = reverbBuffer;

    dryGain.connect(pan);
    convolver.connect(wetGain);
    wetGain.connect(pan);
    pan.connect(gain);
    gain.connect(audioContext.destination);

    drumNodes[name] = { gain, pan, dryGain, wetGain, convolver };
  }
}

function playDrum(name) {
  const buffer = drumBuffers[name];
  if(!buffer) return;

  // const nodes = drumNodes[name];

  const source = audioContext.createBufferSource();
  source.buffer = buffer;

  const hihatVariants = ["hihat", "hihatOpen", "hihatFoot"];
  const isHihat = hihatVariants.includes(name);

  // ハイハットなら前のハイハットの音を停止
  if(isHihat && activeHihatSource) {
    try {
      activeHihatSource.stop();
    } catch (e) {
      activeHihatSource = null;
    }
  }

  const nodes = isHihat ? drumNodes.hihat : drumNodes[name]; // ハイハット３種の加工は一括で管理
  source.connect(nodes.dryGain);
  source.connect(nodes.convolver);
  source.start();

  // 鳴っているハイハットを記録
  if (isHihat) {
    activeHihatSource = source;
  }
}

// MIDIメッセージ
// POLY800 144
// LPD8 153 開放 137
// 電子ドラム 153

function onMidiMessage(event) {
  const [status, note, velocity] = event.data;
  if (status === 153 && velocity > 0) {
    // 発声処理
    console.log(event.data);
    const drum = midiMap[note];
    if (drum) playDrum(drum);

    // 判定処理（canvas/script.jsとの連携）
    if (window.onMidiJudge) {
      window.onMidiJudge(note);
    }
  }
}

function setupMidi() {
  navigator.requestMIDIAccess().then(midiAccess => {
    midiAccess.inputs.forEach(input => {
      input.onmidimessage = onMidiMessage;
    });
  });
}

function setupSliders() {
  Object.entries(drumNodes).forEach(([name, nodes]) => {
    if (name === "hihatOpen" || name === "hihatFoot") return; // オープンとフットのスライダーはないため除外

    const vol = document.getElementById(`${name}-volume`);
    const pan = document.getElementById(`${name}-pan`);
    const rev = document.getElementById(`${name}-reverb`);

    vol.addEventListener("input", e => {
      nodes.gain.gain.value = e.target.value / 100;
      saveValue(`${name}-volume`, e.target.value);
    });
    pan.addEventListener("input", e => {
      nodes.pan.pan.value = e.target.value / 100;
      saveValue(`${name}-pan`, e.target.value);
    });
    rev.addEventListener("input", e => {
      const wet = e.target.value / 100;
      nodes.wetGain.gain.value = wet;
      nodes.dryGain.gain.value = 1 - wet;
      saveValue(`${name}-reverb`, e.target.value);
    });

    // 過去の設定を読み込み
    vol.value = loadValue(`${name}-volume`, vol.value);
    pan.value = loadValue(`${name}-pan`, pan.value);
    rev.value = loadValue(`${name}-reverb`, rev.value);

    // 強制初期化
    vol.dispatchEvent(new Event("input"));
    pan.dispatchEvent(new Event("input"));
    rev.dispatchEvent(new Event("input"));
  });
}

function saveValue(key, val) {
  localStorage.setItem(key, val);
}

function loadValue(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

async function initSidebar() {
  const html = await fetch('../shared/sidebar.html').then(res => res.text());
  document.body.insertAdjacentHTML('beforeend', html);

  // トグル化
  document.getElementById('sidebarToggle').onclick = () =>
    document.getElementById('sidebar').classList.toggle('active');

  await setupDrums();
  setupMidi();
  setupSliders();
}

window.addEventListener('DOMContentLoaded', initSidebar);