<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getLocalConfig, setLocalConfig, formatFileSize } from './utils';
  import type { FOLDER_TYPES } from './utils';

  export let files: any[] = [];
  export let selected: string[] = [];
  export let sortBy = 'name';
  export let sortOrder = 'asc';
  export let folderType: FOLDER_TYPES;
  export let folderPath = '';
  export let comfyUrl: string;
  let includeWorkflows = true;
  let notice = '';
  $: selectable = files.filter(file => file.type === 'file');
  $: selectedBytes = files.filter(file => selected.includes(file.name)).reduce((sum, file) => sum + file.bytes, 0);
  $: if (folderPath !== undefined) notice = '';

  onMount(() => {
    const saved = getLocalConfig()[`sort-${folderType}`];
    if (saved && ['name', 'mtime', 'size', 'type'].includes(saved.field)) sortBy = saved.field;
    if (saved && ['asc', 'desc'].includes(saved.order)) sortOrder = saved.order;
  });

  async function rememberSort() {
    await tick();
    setLocalConfig(`sort-${folderType}`, {field: sortBy, order: sortOrder});
  }

  function downloadArchive(format: string) {
    // A native form download lets the browser stream to disk without a Blob in JS memory.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${comfyUrl}/browser/files/archive`;
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify({folder_type: folderType, folder_path: folderPath,
      files: selected, format, include_workflows: includeWorkflows});
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
    notice = 'Preparing archive. Your browser will start the download when it is ready; any error appears in the new tab.';
  }
</script>

<div class="flex flex-wrap items-center gap-2 p-2 bg-base-200 my-2" aria-label="File controls">
  <label class="flex items-center gap-2">Sort
    <select class="select select-bordered select-sm" bind:value={sortBy} on:change={rememberSort}>
      <option value="name">Filename</option>
      <option value="mtime">Date modified</option>
      <option value="size">File size</option>
      <option value="type">File extension</option>
    </select>
  </label>
  <label class="flex items-center gap-2">Order
    <select class="select select-bordered select-sm" bind:value={sortOrder} on:change={rememberSort}>
      <option value="asc">Ascending</option><option value="desc">Descending</option>
    </select>
  </label>
  <button class="btn btn-sm" disabled={!selectable.length} on:click={() => selected = selectable.map(file => file.name)}>Select all matching files</button>
  <button class="btn btn-sm" disabled={!selected.length} on:click={() => selected = []}>Clear selection</button>
  <span aria-live="polite">{selected.length} selected · {formatFileSize(selectedBytes)}</span>
  <button class="btn btn-sm btn-accent" disabled={!selected.length} on:click={() => downloadArchive('zip')}>Download ZIP</button>
  <button class="btn btn-sm btn-outline" disabled={!selected.length} on:click={() => downloadArchive('tar.gz')}>Download .tar.gz</button>
  <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox checkbox-sm" bind:checked={includeWorkflows} />Include matching workflow JSON</label>
</div>
{#if notice}<p class="text-sm p-2" role="status">{notice}</p>{/if}
