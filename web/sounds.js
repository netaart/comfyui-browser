// Owner: Sean
const SOUND_FILES = {
  action: "click1.wav",
  invalid: "click2.wav",
  navigate: "switch1.wav",
};

export function playBrowserSound(kind) {
  const file = SOUND_FILES[kind];
  if (!file || typeof Audio === "undefined") return;
  const audio = new Audio(`/browser/web/sounds/${file}`);
  audio.volume = 0.22;
  audio.play().catch(() => {});
}
