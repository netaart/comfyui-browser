<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { formatFileSize } from './utils';
  export let comfyUrl: string;
  const dispatch = createEventDispatcher();
  let root = '';
  let thumbnailSize = 384;
  let cacheLimit = 512;
  let cache: any = null;
  let busy = false;
  let ready = false;
  let error = '';
  let message = '';

  async function refreshCache() {
    const response = await fetch(`${comfyUrl}/browser/cache`);
    if (!response.ok) throw new Error(await response.text());
    cache = await response.json();
  }
  onMount(async () => {
    try {
      const response = await fetch(`${comfyUrl}/browser/config`);
      if (!response.ok) throw new Error(await response.text());
      const config = await response.json();
      root = config.outputs;
      thumbnailSize = config.thumbnail_size;
      cacheLimit = config.thumbnail_cache_mb;
      ready = true;
      await refreshCache();
    } catch (err) { error = String(err); }
  });
  async function save() {
    busy = true; error = ''; message = '';
    try {
      const response = await fetch(`${comfyUrl}/browser/config`, {method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({outputs: root, thumbnail_size: thumbnailSize, thumbnail_cache_mb: cacheLimit})});
      if (!response.ok) throw new Error(await response.text());
      const config = await response.json();
      root = config.outputs;
      message = 'Settings saved. The output browser now uses this root.';
      dispatch('changed');
      await refreshCache();
    } catch (err) { error = String(err); }
    finally { busy = false; }
  }
  async function clearCache() {
    busy = true; error = ''; message = '';
    try {
      const response = await fetch(`${comfyUrl}/browser/cache`, {method: 'DELETE'});
      if (!response.ok) throw new Error(await response.text());
      cache = await response.json();
      message = 'Thumbnail cache cleared. Previews will be rebuilt as you browse.';
    } catch (err) { error = String(err); }
    finally { busy = false; }
  }
</script>

<details class="p-3 bg-base-200 my-2">
  <summary class="cursor-pointer font-bold">Browser settings</summary>
  <form class="flex flex-col gap-3 mt-3" on:submit|preventDefault={save}>
    <label class="flex flex-col gap-1">Output browser root
      <input class="input input-bordered w-full" bind:value={root} required disabled={!ready || busy} placeholder="/absolute/path/on/server" />
      <span class="text-xs">An existing directory on the ComfyUI server. This controls browsing; ComfyUI’s save destination stays in its own settings.</span>
    </label>
    <div class="flex flex-wrap gap-3">
      <label>Thumbnail size (px)<input class="input input-bordered input-sm w-24 ml-2" type="number" min="128" max="1024" step="1" bind:value={thumbnailSize} required /></label>
      <label>Cache limit (MiB)<input class="input input-bordered input-sm w-28 ml-2" type="number" min="16" max="16384" step="1" bind:value={cacheLimit} required /></label>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn btn-sm btn-accent" type="submit" disabled={!ready || busy}>Save settings</button>
      <button class="btn btn-sm" type="button" disabled={busy} on:click={clearCache}>Clear thumbnail cache</button>
      {#if cache}<span class="text-sm">{cache.files} thumbnails · {formatFileSize(cache.bytes)}</span>{/if}
    </div>
    {#if cache && !cache.video_previews}<p class="text-sm">Video thumbnails need FFmpeg installed on the server. Videos can still be opened and downloaded.</p>{/if}
  </form>
  {#if message}<p class="text-sm mt-2" role="status">{message}</p>{/if}
  {#if error}<p class="text-error mt-2" role="alert">{error}</p>{/if}
</details>
