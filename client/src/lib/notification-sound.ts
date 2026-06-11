const SOUND_URL = '/somvenda.mp3';

let _audio: HTMLAudioElement | null = null;
let _unlocked = false;
let _pendingSound = false;
let _pendingListenerActive = false;

function getAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio(SOUND_URL);
    _audio.preload = 'auto';
    _audio.volume = 1.0;
  }
  return _audio;
}

// Registra listener de toque para tocar o som pendente na próxima interação do usuário
// (iOS bloqueia áudio sem gesto — toca no primeiro toque após a notificação)
function _registerPendingListener(): void {
  if (_pendingListenerActive) return;
  _pendingListenerActive = true;

  const handler = () => {
    if (!_pendingSound) return;
    _pendingSound = false;
    // Dentro do handler de toque: iOS permite play()
    try {
      _audio = new Audio(SOUND_URL);
      _audio.volume = 1.0;
      _audio.play().catch(() => {});
    } catch {}
  };

  window.addEventListener('touchstart', handler, { passive: true });
  window.addEventListener('click', handler, { passive: true });
}

export function unlockAudio(): void {
  try {
    const audio = getAudio();
    audio.volume = 0;
    const p = audio.play();
    if (p) {
      p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1.0;
        _unlocked = true;
      }).catch(() => {
        _unlocked = false;
      });
    } else {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1.0;
      _unlocked = true;
    }
  } catch {
    _unlocked = false;
  }
}

export function playNotificationSound(): void {
  _registerPendingListener();

  try {
    const audio = getAudio();
    audio.currentTime = 0;
    const p = audio.play();
    if (p) {
      p.then(() => {
        _pendingSound = false;
      }).catch(() => {
        // iOS bloqueou sem gesto: vai tocar no próximo toque do usuário
        _pendingSound = true;
      });
    }
  } catch {
    _pendingSound = true;
  }
}
