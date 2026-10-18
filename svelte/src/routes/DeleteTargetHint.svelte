<script lang="ts">
  // Owner: Sean
  export let file: any = null;
  export let x = 0;
  export let y = 0;
  export let onConfirm: () => void;
  export let onCancel: () => void;
</script>

{#if file}
  <aside
    class="pointer-events-auto fixed z-[1000] w-80 overflow-hidden rounded-lg border border-red-400 bg-slate-950/95 text-white shadow-[0_0_26px_6px_rgba(239,68,68,.55)] backdrop-blur"
    style={`left:${x}px;top:${y}px`}
    role="dialog"
    aria-modal="false"
    aria-label={`Confirm deletion of ${file.name}`}
    aria-live="polite"
  >
    {#if file.fileType === 'image'}
      <img class="h-28 w-full bg-black object-contain" src={file.previewUrl || file.url} alt="" />
    {:else if file.fileType === 'video'}
      <video class="h-28 w-full bg-black object-contain" src={file.previewUrl || file.url} muted autoplay loop playsinline></video>
    {/if}
    <div class="space-y-1 p-3 text-xs">
      <strong class="block break-all text-sm">{file.name}</strong>
      <div class="flex flex-wrap gap-x-3 text-white/75">
        <span>{file.fileType || file.type || 'file'}</span>
        {#if file.formattedSize}<span>{file.formattedSize}</span>{/if}
        {#if file.formattedDatetime}<span>{file.formattedDatetime}</span>{/if}
      </div>
      {#if file.folder_path}<p class="break-all text-white/60">{file.folder_path}</p>{/if}
      <p class="pt-1 font-semibold text-red-300">Delete this item?</p>
      <div class="flex justify-end gap-2 pt-2">
        <button class="btn btn-sm btn-ghost" type="button" on:click={onCancel}>Cancel</button>
        <button class="btn btn-sm btn-error" type="button" on:click={onConfirm}>Delete</button>
      </div>
    </div>
  </aside>
{/if}
