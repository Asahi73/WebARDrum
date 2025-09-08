# Web AR Drum Training System

このプロジェクトは、ARマーカーを用いてドラムパーツの位置を取得し、  
Canvas上に演奏ガイドリングを表示してリズム練習を行えるWebアプリケーションです。  

---

## 機能概要

### 1. ARマーカ座標取得ページ (`/ar`)
- システムは`AR.js`内蔵のカメラ映像を左右反転で表示する。
- ユーザはカメラを利用し、Kick / Snare / Hi-hat に対応するマーカーを欠けがないように映す。
- システムは`AR.js`を用いてマーカーの3D座標を取得し、`localStorage` に保存する。
- システムは`A-Frame`を用いて各マーカー位置に薄いリング（ターゲットリング）を常時表示する。ユーザによる認識ボタン押下で座標が固定される。

### 2. 演奏ページ (`/canvas`)
- 当ページではARの各種機能は用いず、Videoタグ（getUserMedia）によるカメラ映像の出力、そこにCanvasによるリング表示を重ね合わせている。
- システムはカメラ映像を左右反転で表示する。
- システムは`localStorage` に保存されたマーカー座標を2D座標へ変換してリングを表示する。
- システムはJSON形式の譜面ファイルを読み込み、現在のBPMに合わせガイドの出現時刻を計算し記憶しておく。
- ユーザはBPMをスライダーで設定でき、システムはそれに応じた出現時刻を更新する。
- 演奏開始ボタン押下:
  - メトロノーム音源を発声（1拍目は強拍音）。
  - 譜面のMIDI番号と時刻を元に、番号に対応した位置と時刻で収縮するリング（インストラクションリング）を表示する。
  - ユーザがMIDIデバイスを叩くと、正しいドラムパーツを叩けたか、正しい時刻で叩けたか（PERFECT / GOOD の2種）の判定がが行われる。
  - 判定成功時、固定リングがフラッシュしてユーザへフィードバックを促す。

### 3. サイドバー
- `WebAudioAPI`による各ドラム音源の音量・パン・リバーブを別個調整可能。
- ハイハットには Open / Foot / Close などバリエーションがあり、同時発音しないよう制御する。かつ調整は一つに統合されている。

---

## ディレクトリ構成
```
project-root/
├── ar/                # ARマーカ取得ページ
│   ├── index.html
│   ├── script.js
│   └── style.css
├── canvas/            # 演奏ページ
│   ├── index.html
│   ├── script.js
│   └── style.css
├── shared/            # サイドバー等の共通コンポーネント
│   ├── sidebar.html
│   ├── sidebar.js
│   └── sidebar.css
├── inst/              # 使用する音源ファイル
│   ├── kick.mp3
│   ├── snare.mp3
│   ├── hihatClosed.mp3
│   ├── hihatOpen.mp3
│   ├── hihatFoot.mp3
│   ├── count.mp3
│   └── countHead.mp3
├── markers/           # AR.js 用のマーカパターン
│   ├── kick.patt
│   ├── snare.patt
│   └── hihat.patt
└── assets/          # 譜面データ（JSON形式）
    ├── pattern1.json
    ├── pattern2.json
    └── pattern3.json
```

---

## 譜面ファイル仕様（例：pattern1.json）

```json
{
  "subdivision": 4,         // 1拍を分割する数（例: 4 = 16分音符単位）
  "pattern": [
    { "step": 17,  "note": 36 }, // Kick
    { "step": 21,  "note": 38 }, // Snare
    { "step": 25,  "note": 36 }, // Kick
    { "step": 29, "note": 38 }  // Snare
  ]
}
```

演奏開始時、カウントインとなる時間を考慮し、stepは17から開始することを推奨する（17からだとカウント4回分）。

---
