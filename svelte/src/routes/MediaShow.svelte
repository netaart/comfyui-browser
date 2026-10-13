<script lang="ts">
  export let file: any;
  export let styleClass: string;
  export let onClickDir: Function;
  let previewFailed = false;
  $: if (file.previewUrl) previewFailed = false;
</script>


<div class={styleClass}>
  {#if file.type === 'dir'}
    <button
      class="w-full h-full flex items-center justify-center"
      on:click={() => onClickDir(file)}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-16 h-16">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    </button>
  {:else}
    <a
      href={file.originalUrl || file.url}
      target="_blank"
      rel="noopener noreferrer"
      style="height: inherit; width: inherit;"
    >
      {#if file.fileType === 'json'}
        <div class="w-full h-full flex items-center justify-center">
          <span class="font-bold text-xl">
            JSON
          </span>
        </div>
      {/if}
      {#if file.fileType === 'html'}
        <div class="w-full h-full flex items-center justify-center">
          <span class="font-bold text-xl">
            HTML
          </span>
        </div>
      {/if}
      {#if ['image', 'video'].includes(file.fileType) && !previewFailed}
        <img
          class="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          src={file.previewUrl}
          on:error={() => previewFailed = true}
          alt={file.name} />
      {/if}
      {#if previewFailed}
        <div class="w-full h-full flex items-center justify-center text-center p-2 text-sm">Preview unavailable · Open original</div>
      {:else if file.fileType === 'video'}
        <span class="text-xs">▶ Open video</span>
      {/if}
    </a>
  {/if}
</div>
