<script>
  import { onMount } from 'svelte';
  let files = [];
  export let folder_path = '';    // pass in current folder path if applicable
  export let folder_type = 'outputs';
  let sortBy = 'name'; // 'name' or 'mtime'
  let order = 'asc';   // 'asc' or 'desc'
  let loading = false;
  let error = null;

  async function load() {
    loading = true;
    error = null;
    try {
      const params = new URLSearchParams({
        folder_path,
        folder_type,
        sort_by: sortBy,
        order
      });
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      // API returns { files: [...] }
      files = json.files || [];
    } catch (err) {
      console.error('Failed to load files', err);
      error = err.message;
      files = [];
    } finally {
      loading = false;
    }
  }

  function toggleOrder() {
    order = order === 'asc' ? 'desc' : 'asc';
    load();
  }

  function setSort(by) {
    if (sortBy === by) {
      toggleOrder();
    } else {
      sortBy = by;
      order = 'asc';
      load();
    }
  }

  // expose a refresh method for parent components
  export function refresh() {
    load();
  }

  onMount(load);
</script>

<style>
  .toolbar { display:flex; gap:8px; margin-bottom:8px; align-items:center; }
  .file-list { list-style:none; padding:0; margin:0; }
  .file-item { padding:6px 8px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; }
  .btn { cursor:pointer; padding:6px 8px; border:1px solid #ccc; background:#f9f9f9; }
  .active { font-weight:bold; background:#e9f5ff; }
  .meta { color:#666; font-size:0.9em; }
</style>

<div class="toolbar">
  <button class="btn {sortBy === 'name' ? 'active' : ''}" on:click={() => setSort('name')}>
    Sort by Name {sortBy === 'name' ? (order === 'asc' ? '▲' : '▼') : ''}
  </button>
  <button class="btn {sortBy === 'mtime' ? 'active' : ''}" on:click={() => setSort('mtime')}>
    Sort by Modified {sortBy === 'mtime' ? (order === 'asc' ? '▲' : '▼') : ''}
  </button>
  <button class="btn" on:click={load} disabled={loading}>
    {#if loading}Refreshing...{#else}Refresh{/if}
  </button>
  {#if error}
    <div class="meta" style="margin-left:12px;color:#b00;">{error}</div>
  {/if}
</div>

<ul class="file-list">
  {#if files.length === 0 && !loading}
    <li class="file-item">No files</li>
  {/if}
  {#each files as f (f.name)}
    <li class="file-item">
      <div>
        {#if f.is_dir}📁{/if} {f.name}
        {#if f.notes}<div class="meta">{f.notes}</div>{/if}
      </div>
      <div class="meta">{f.mtime ? new Date(f.mtime).toLocaleString() : ''}</div>
    </li>
  {/each}
</ul>
