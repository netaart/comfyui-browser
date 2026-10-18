<script lang="ts">
  import { onDestroy } from 'svelte';
  import { renderMarkdown } from '../../../web/markdown.js';
  export let file: any;
  export let styleClass: string;
  export let onClickDir: Function;
  export let onSelectFile: Function | undefined = undefined;
  let aspectRatio = 1.53;
  let textContent = '';
  let textLoading = false;
  let textLoadError = '';
  let textRequest: AbortController | null = null;
  $: if (['text', 'markdown', 'json'].includes(file.fileType) && file.url) {
    void loadTextContent(file.url);
  }
  $: renderedTextContent = file.fileType === 'markdown' ? renderMarkdown(textContent, file.url) : '';

  async function loadTextContent(url: string) {
    textRequest?.abort();
    const request = new AbortController();
    textRequest = request;
    textContent = '';
    textLoadError = '';
    textLoading = true;
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      if (textRequest !== request) return;
      // Keep cards responsive when a folder contains large logs or documents.
      textContent = content.length > 12000 ? `${content.slice(0, 12000)}\n\n…` : content;
    } catch (error) {
      if (request.signal.aborted || textRequest !== request) return;
      textLoadError = `Could not load: ${error}`;
    } finally {
      if (textRequest === request) textLoading = false;
    }
  }

  onDestroy(() => textRequest?.abort());

  function updateAspectRatio(event: Event) {
    const media = event.currentTarget as HTMLImageElement | HTMLVideoElement;
    const width = 'naturalWidth' in media ? media.naturalWidth : media.videoWidth;
    const height = 'naturalHeight' in media ? media.naturalHeight : media.videoHeight;
    if (width > 0 && height > 0) aspectRatio = Math.max(0.5, Math.min(2.4, width / height));
  }

  function selectFile(event: MouseEvent) {
    if (file.fileType === 'html' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      window.open(file.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (onSelectFile) onSelectFile(file);
    else window.open(file.url, '_blank');
  }
</script>


<div class={`${styleClass} relative`} style={`aspect-ratio:${aspectRatio};`}>
  {#if file.type === 'dir'}
    <button
      class="absolute inset-0 grid h-full w-full gap-0.5 overflow-hidden bg-slate-950"
      style={`container-type:inline-size;grid-template-columns:repeat(${Math.max(1, file.preview_items?.length || 1)},minmax(0,1fr));`}
      title={file.children_count === 0 ? 'Empty folder' : `${file.children_count} items`}
      aria-label={file.children_count === 0 ? `Empty folder ${file.name}` : `${file.name}, ${file.children_count} items`}
      on:click={(event) => { event.stopPropagation(); onClickDir(file); }}
    >
      {#if file.preview_items?.length}
        {#each file.preview_items as item}
          <span class="relative flex h-full min-w-0 flex-col items-center justify-center overflow-hidden bg-slate-800/80">
            {#if item.fileType === 'image'}
              <img class="absolute inset-0 h-full w-full object-cover" loading="lazy" src={item.previewUrl} alt={item.name} />
            {:else}
              <span class="text-2xl font-semibold text-sky-200" aria-hidden="true">{item.fileType === 'video' ? '▶' : item.fileType === 'audio' ? '♫' : '▤'}</span>
              <span class="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1 py-1 text-[10px] leading-tight text-white">{item.name}</span>
            {/if}
          </span>
        {/each}
      {:else}
        <span class="col-span-full flex h-full items-center justify-center text-4xl font-bold text-white/80 drop-shadow">{file.children_count}</span>
      {/if}
    </button>
  {:else}
    <button
      type="button"
      data-file-preview-target
      class="absolute inset-0 flex items-center justify-center overflow-hidden"
      style="height: inherit; width: inherit;"
      title={file.fileType === 'html' ? `Preview ${file.name}; Ctrl/Cmd+click or double-click to open as a webpage` : `Preview ${file.name}`}
      aria-label={`Preview ${file.name}`}
      on:click={selectFile}
    >
      {#if ['text', 'markdown', 'json'].includes(file.fileType)}
        <div class="absolute inset-0 overflow-auto bg-slate-950 px-3 py-2 text-left text-[11px] leading-[1.45] text-slate-100">
          {#if textLoading}
            <span class="text-slate-400">Loading content…</span>
          {:else if textLoadError}
            <span class="text-red-300">{textLoadError}</span>
          {:else if file.fileType === 'markdown'}
            <div class="comfy-browser-markdown text-[11px] leading-[1.45]">{@html renderedTextContent}</div>
          {:else}
            <pre class="m-0 whitespace-pre-wrap break-words font-mono">{textContent}</pre>
          {/if}
        </div>
      {/if}
      {#if file.fileType === 'html'}
        <div class="flex h-full w-full items-center justify-center">
          <span class="flex h-14 w-14 items-center justify-center rounded-xl bg-black/25 text-accent">
            <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-12-4 14"/></svg>
          </span>
        </div>
      {/if}
      {#if file.fileType === 'audio'}
        <div class="flex h-full w-full items-center justify-center">
          <span class="flex h-14 w-14 items-center justify-center rounded-xl bg-black/25 text-accent">
            <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13M9 18c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-2c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zM9 9l12-2"/></svg>
          </span>
        </div>
      {/if}
      {#if file.fileType === 'image'}
        <img
          class="h-full w-full object-contain"
          loading="lazy"
          src={file.previewUrl}
          alt={file.name}
          on:load={updateAspectRatio} />
      {/if}
      {#if file.fileType === 'video'}
        <video
          class="h-full w-full object-contain pb-0.5 border-0.5 border-black"
          src={file.previewUrl}
          loop={true}
          autoplay={true}
          muted={true}
          on:loadedmetadata={updateAspectRatio}
        >
          <track kind="captions" />
        </video>
      {/if}
    </button>
  {/if}
</div>
