<script lang="ts">
  import { playBrowserSound } from '../../../web/sounds.js';
  export let showToast = false;
  export let toastSuccess = true;
  export let toastText = '';

  export function show(
    isSuccess: boolean,
    successText: string,
    failText: string,
    duration = 2000
  ) {
    toastSuccess = isSuccess;
    toastText = isSuccess ? successText : failText;
    showToast = true;
    if (!isSuccess) invalid();
    setTimeout(() => showToast = false, duration);
  }

  export function invalid() {
    playBrowserSound('invalid');
    if (window.top !== window) {
      window.top?.postMessage({ source: 'comfyui-browser', type: 'invalid-operation' }, '*');
      return;
    }
    const glow = document.createElement('div');
    Object.assign(glow.style, {
      position: 'fixed', inset: '0', zIndex: '999999', pointerEvents: 'none',
      boxShadow: 'inset 0 0 42px 10px rgba(255, 24, 24, .78)',
      outline: '2px solid rgba(255, 32, 32, .9)', outlineOffset: '-3px',
    });
    document.body.appendChild(glow);
    glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' })
      .onfinish = () => glow.remove();
  }
</script>

{#if showToast}
  <div class="toast toast-center" >
    <div class="alert {toastSuccess ? 'alert-success' : 'alert-error'}">
      <span>{toastText}</span>
    </div>
  </div>
{/if}
