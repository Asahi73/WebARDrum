let markerPositions = {}; // 座標保存用
const markerIds = ['kick', 'snare', 'hihat'];
const markerColors = {
  kick: 'red',
  snare: 'green',
  hihat: 'blue'
};

// Detectボタン：マーカを認識
document.getElementById('loadMarkers').addEventListener('click', () => {
  const ringContainer = document.getElementById('highlight-rings');
  ringContainer.innerHTML = ''; // 認識済リングを初期化
  markerPositions = {};         // 認識済座標を初期化

  markerIds.forEach(id => {
    const marker = document.querySelector(`#${id}`);
    if (marker && marker.object3D.visible) {
      const pos = marker.object3D.position;
      const newRing = document.createElement('a-ring');
      newRing.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
      // newRing.setAttribute('rotation', '0 0 0'); // ローテーション不要
      newRing.setAttribute('radius-inner', '0.3');
      newRing.setAttribute('radius-outer', '0.5');
      newRing.setAttribute('color', markerColors[id]);
      newRing.setAttribute('opacity', '1.0');
      ringContainer.appendChild(newRing);

      markerPositions[id] = {
        x: pos.x,
        y: pos.y,
        z: pos.z
      };
    }
  });

  console.log('マーカ座標:', markerPositions);
});

// Nextボタン：座標を保存し遷移
document.getElementById('nextPage').addEventListener('click', () => {
  localStorage.setItem('markerPositions', JSON.stringify(markerPositions));
  window.location.href = '../canvas/index.html';
});