<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fetchFiles, onLoadWorkflow, onScroll } from './utils';
  import MediaShow from './MediaShow.svelte';
  import Toast from './Toast.svelte';
  import DeleteTargetHint from './DeleteTargetHint.svelte';
  import { playBrowserSound } from '../../../web/sounds.js';

  export let comfyUrl: string;

  const folderType = 'collections';

  let comfyApp: any;
  let files: Array<any> = [];
  let config: any = {};
  let configGitRepo = '';
  let showCursor = 20;
  let filteredFiles: Array<any> = [];
  let sortedFiles: Array<any> = [];
  let sortBy: 'time' | 'name' | 'size' = 'time';
  let sortDirection: 'asc' | 'desc' = 'desc';
  let toast: Toast;
  let hoveredFile: any = null;
  let deleteConfirmFile: any = null;
  let deleteHintX = 0;
  let deleteHintY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let folderPath: string;
  let loaded: boolean = false;
  let searchQuery = '';
  let searchRegex = new RegExp('');
  let folderHistory = [''];
  let folderHistoryIndex = 0;
  let mouseNavigationHandled = false;
  let canGoBack = false;
  let canGoForward = false;
  $: breadcrumbs = getBreadcrumbs(folderPath || '');

  $: if (folderPath != undefined) {
    refresh();
  }

  $: try {
    searchRegex = new RegExp(searchQuery.toLowerCase());
  } catch {
    searchRegex = new RegExp('');
  }

  $: tt = function(key: string) {
    return $t('collectionsTab.' + key);
  }

  $: filteredFiles = files.filter((file) => searchRegex.test(file.name.toLowerCase()) || searchRegex.test((file.notes || '').toLowerCase()));
  $: sortedFiles = sortFiles(filteredFiles, sortBy, sortDirection);

  function sortFiles(source: Array<any>, key: 'time' | 'name' | 'size', direction: 'asc' | 'desc') {
    const sign = direction === 'asc' ? 1 : -1;
    return [...source].sort((a, b) => {
      const directoryOrder = Number(a.type === 'file') - Number(b.type === 'file');
      if (directoryOrder) return directoryOrder;
      const result = key === 'name'
        ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' })
        : (Number(a[key === 'time' ? 'created_at' : 'bytes']) || 0) - (Number(b[key === 'time' ? 'created_at' : 'bytes']) || 0);
      return result === 0 ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }) : result * sign;
    });
  }

  function onSortChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'time' || value === 'name' || value === 'size') {
      sortBy = value;
      showCursor = 20;
      localStorage.setItem('comfyui-browser-sort-by', value);
    }
  }

  function toggleSortDirection() {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    showCursor = 20;
    localStorage.setItem('comfyui-browser-sort-direction', sortDirection);
  }

  async function refresh() {
    loaded = true;
    files = await fetchFiles(folderType, comfyUrl, folderPath);
    loaded = true;
  }

  onMount(async () => {
    //@ts-ignore
    comfyApp = window.top.app;

    //@ts-ignore
    window.top.addEventListener("comfyuiBrowserShow", () => {
      refresh();
    });

    folderPath = '';
    resetFolderHistory();
    config = (await fetchConfig()) || {};
    configGitRepo = config?.git_repo;

    window.addEventListener('scroll', () => {
      showCursor = onScroll(showCursor, files.length);
    });
    window.addEventListener('keydown', onFolderShortcut);
    window.addEventListener('keydown', onFileShortcut);
    window.addEventListener('pointerdown', onMouseNavigationCapture, true);
    window.addEventListener('pointerup', onMouseNavigationCapture, true);
    window.addEventListener('mousedown', onMouseNavigationCapture, true);
    window.addEventListener('mouseup', onMouseNavigationCapture, true);
    window.addEventListener('auxclick', onMouseNavigationCapture, true);
    window.addEventListener('pointermove', onGlobalPointerMove);
    const savedSortBy = localStorage.getItem('comfyui-browser-sort-by');
    if (savedSortBy === 'time' || savedSortBy === 'name' || savedSortBy === 'size') sortBy = savedSortBy;
    const savedSortDirection = localStorage.getItem('comfyui-browser-sort-direction');
    if (savedSortDirection === 'asc' || savedSortDirection === 'desc') sortDirection = savedSortDirection;
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onFolderShortcut);
      window.removeEventListener('keydown', onFileShortcut);
      window.removeEventListener('pointerdown', onMouseNavigationCapture, true);
      window.removeEventListener('pointerup', onMouseNavigationCapture, true);
      window.removeEventListener('mousedown', onMouseNavigationCapture, true);
      window.removeEventListener('mouseup', onMouseNavigationCapture, true);
      window.removeEventListener('auxclick', onMouseNavigationCapture, true);
      window.removeEventListener('pointermove', onGlobalPointerMove);
    }
  });

  function updateFolderHistoryButtons() {
    canGoBack = folderHistoryIndex > 0;
    canGoForward = folderHistoryIndex < folderHistory.length - 1;
  }

  function resetFolderHistory(path = '') {
    folderHistory = [path];
    folderHistoryIndex = 0;
    updateFolderHistoryButtons();
  }

  function navigateToFolder(path: string) {
    if (path === folderPath) return;
    playBrowserSound('navigate');
    folderHistory = folderHistory.slice(0, folderHistoryIndex + 1);
    folderHistory.push(path);
    folderHistoryIndex = folderHistory.length - 1;
    folderPath = path;
    updateFolderHistoryButtons();
  }

  function goBack() {
    if (!canGoBack) { toast?.invalid(); return; }
    playBrowserSound('navigate');
    folderHistoryIndex -= 1;
    folderPath = folderHistory[folderHistoryIndex];
    updateFolderHistoryButtons();
  }

  function goForward() {
    if (!canGoForward) { toast?.invalid(); return; }
    playBrowserSound('navigate');
    folderHistoryIndex += 1;
    folderPath = folderHistory[folderHistoryIndex];
    updateFolderHistoryButtons();
  }

  function onFolderShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();
    event.key === 'ArrowLeft' ? goBack() : goForward();
  }

  function onMouseNavigationCapture(event: MouseEvent | PointerEvent) {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' || event.type === 'mousedown') {
      mouseNavigationHandled = false;
      return;
    }
    if (event.type === 'pointerup' || event.type === 'mouseup') {
      if (mouseNavigationHandled) return;
      mouseNavigationHandled = true;
      handleMouseNavigation(event.button);
      return;
    }
    if (event.type === 'auxclick') {
      if (!mouseNavigationHandled) handleMouseNavigation(event.button);
      mouseNavigationHandled = false;
    }
  }

  function handleMouseNavigation(button: number) {
    button === 3 ? goBack() : goForward();
  }

  async function fetchConfig() {
    const res = await fetch(comfyUrl + '/browser/config');
    return await res.json();
  }

  async function onClickSyncCollections(e: Event) {
    const btn = e.target as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = tt('btn.syncing');
    const res = await fetch(comfyUrl + '/browser/collections/sync', {
      method: 'POST',
    });

    toast.show(
      res.ok,
      tt('toast.synced'),
      tt('toast.syncFailed'),
    );
    btn.disabled = false;
    btn.innerHTML = tt('btn.sync');

    folderPath = '';
    resetFolderHistory();
    files = await fetchFiles(folderType, comfyUrl);
  }

  async function onClickSaveConfig() {
    const res = await fetch(comfyUrl + '/browser/config', {
      method: 'PUT',
      body: JSON.stringify({
        git_repo: configGitRepo,
      }),
    });

    fetchConfig();
    toast.show(
      res.ok,
      tt('toast.configUpdated'),
      tt('toast.configUpdatedFailed'),
    );
  }

  function openDeleteConfirm(file: any) {
    if (!file) return;
    deleteConfirmFile = file;
    positionDeleteHint(pointerX, pointerY);
  }

  function positionDeleteHint(x: number, y: number) {
    deleteHintX = Math.max(8, Math.min(window.innerWidth - 336, x + 16));
    deleteHintY = Math.max(8, Math.min(window.innerHeight - 340, y + 16));
  }

  function onGlobalPointerMove(event: PointerEvent) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function trackFileHover(file: any, event: PointerEvent) {
    hoveredFile = file;
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function cancelDelete() {
    deleteConfirmFile = null;
  }

  async function removeFavorite(file: any) {
    if (!file.favorite_reference_root) return;
    const res = await fetch(comfyUrl + '/browser/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.source_filename || file.name,
        folder_path: file.source_folder_path || '',
        folder_type: file.source_folder_type,
        root_id: file.source_root_id,
        favorite: false,
      }),
    });
    if (res.ok) {
      playBrowserSound('action');
      await refresh();
    }
    toast.show(res.ok, `Removed from Saves: ${file.name}`, 'Failed to remove from Saves');
  }

  function onFileShortcut(event: KeyboardEvent) {
    if (deleteConfirmFile) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDelete();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!hoveredFile || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (hoveredFile.favorite_reference && !hoveredFile.favorite_reference_root) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'd') return;
    event.preventDefault();
    openDeleteConfirm(hoveredFile);
  }

  async function confirmDelete() {
    const file = deleteConfirmFile;
    if (!file) return;
    cancelDelete();
    if (file.favorite_reference_root) {
      const res = await fetch(comfyUrl + '/browser/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.source_filename || file.name,
          folder_path: file.source_folder_path || '',
          folder_type: file.source_folder_type,
          root_id: file.source_root_id,
          favorite: false,
        }),
      });
      await refresh();
      if (res.ok) playBrowserSound('action');
      toast.show(res.ok, tt('toast.deleteSuccess') + file.name, tt('toast.deleteFailed'));
      return;
    }
    if (file.favorite_reference) return;
    const res = await fetch(comfyUrl + '/browser/files', {
      method: 'DELETE',
      body: JSON.stringify({
        folder_type: folderType,
        filename: file.name,
        folder_path: file.folder_path,
      }),
    });

    refresh();
    if (res.ok) playBrowserSound('action');
    toast.show(
      res.ok,
      tt('toast.deleteSuccess') + file.name,
      tt('toast.deleteFailed'),
    );
  }

  async function updateFile(file: any, payload: any) {
    const res = await fetch(comfyUrl + '/browser/files', {
      method: 'PUT',
      body: JSON.stringify({
        folder_type: folderType,
        folder_path: file.folder_path,
        filename: file.name,
        new_data: payload,
      }),
    });

    refresh();

    return res.ok;
  }

  async function updateFilename(e: Event, file: any) {
    if (file.favorite_reference) return;
    const value = (e.target as HTMLInputElement).value;
    if (! isFilenameValid(value)) {
      toast.show(false, '', tt('toast.Invalid filename'));
      return;
    }
    if (value === file.name) {
      return;
    }

    const ret = await updateFile(file, {
      filename: value,
      notes: file.notes || '',
      folder_path: file.folder_path,
    });

    toast.show(
      ret,
      tt('toast.updated'),
      tt('toast.updatedFailed'),
    );
  }

  async function updateFileNotes(e: Event, file: any) {
    if (file.favorite_reference) return;
    //@ts-ignore
    const value = e.target.value;
    if (value == file.notes) {
      return;
    }

    const ret = await updateFile(file, {
      filename: file.name,
      notes: value,
      folder_path: file.folder_path,
    });

    toast.show(
      ret,
      tt('toast.updated'),
      tt('toast.updatedFailed'),
    );
  }

  async function onClickDir(dir: any) {
    if (dir.favorite_reference_root) {
      window.dispatchEvent(new CustomEvent('comfyuiBrowserNavigateToOutput', {
        detail: {
          rootId: dir.source_root_id || 'outputs',
          folderPath: dir.source_folder_path || '',
          folderName: dir.source_filename || dir.name,
        },
      }));
      return;
    }
    navigateToFolder(dir.path);
  }

  function getBreadcrumbs(path: string) {
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === '__favorite_refs__' && parts.length >= 2) {
      let folderName = parts[1];
      try {
        const token = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(token), (char) => char.charCodeAt(0));
        const key = JSON.parse(new TextDecoder().decode(bytes));
        folderName = key[key.length - 1] || folderName;
      } catch {
        // Keep the token visible if it cannot be decoded.
      }
      const favoritePath = parts.slice(0, 2).join('/');
      return [
        { label: folderName, path: favoritePath },
        ...parts.slice(2).map((part, index) => ({
          label: part,
          path: parts.slice(0, index + 3).join('/'),
        })),
      ];
    }
    return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') }));
  }

  function onClickPath(path: string) {
    navigateToFolder(path);
  }

  function isFilenameValid(filename: string) {
    // Regular expression to match valid filename patterns
    var validFilenameRegex = /^[a-zA-Z0-9-_|\u4E00-\u9FFF]+(\.[a-zA-Z0-9]+)?$/;

    return validFilenameRegex.test(filename);
  }
</script>

<div class="flex border-b border-base-content pb-2">
  <a
    class="btn pr-2"
    target="_blank"
    href="https://github.com/talesofai/comfyui-browser/wiki/How-to-use-Sync-in-the-Saves-tab"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      data-slot="icon"
      class="w-6 h-6"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
      />
    </svg>
  </a>
  <input
    type="text"
    placeholder={tt('syncInput.placeholder')}
    bind:value={configGitRepo}
    class="input input-bordered w-full max-w-lg"
  />
  {#if configGitRepo != config?.git_repo}
    <button class="btn btn-outline btn-accent" on:click={onClickSaveConfig}>
      {tt('btn.save')}
    </button>
  {/if}
  <button class="btn btn-outline btn-accent" on:click={onClickSyncCollections}>
    {tt('btn.sync')}
  </button>
</div>

<div class="max-w-full text-sm breadcrumbs flex flex-row ml-4">
  <div class="flex items-center gap-1 shrink-0">
    <button class="btn btn-ghost btn-sm px-1" aria-label="Back" title="Back (Alt+←)" aria-disabled={!canGoBack} on:click={goBack}>
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" /></svg>
    </button>
    <button class="btn btn-ghost btn-sm px-1" aria-label="Forward" title="Forward (Alt+→)" aria-disabled={!canGoForward} on:click={goForward}>
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" /></svg>
    </button>
  </div>
  <ul class="basis-2/3">
    <li>
      <button on:click={() => onClickPath('')}>{$t('common.rootDir')}</button>
    </li>
    {#each breadcrumbs as crumb}
      <li><button on:click={() => onClickPath(crumb.path)}>{crumb.label}</button></li>
    {/each}
  </ul>

  <input
    type="text"
    placeholder={tt('searchInput.placeholder')}
    bind:value={searchQuery}
    class="input input-bordered border-slate-600 w-full h-full rounded-none text-sm basis-1/3"
  />
  <div class="flex shrink-0 items-center gap-0.5" aria-label="File sorting">
    <select class="select select-bordered select-xs w-[4.5rem] px-1" aria-label="Sort files by" value={sortBy} on:change={onSortChange}>
      <option value="time">时间</option>
      <option value="name">名字</option>
      <option value="size">大小</option>
    </select>
    <button class="btn btn-ghost btn-xs btn-square h-7 min-h-0 w-7" aria-label={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'} title={sortDirection === 'desc' ? 'Descending' : 'Ascending'} on:click={toggleSortDirection}>{sortDirection === 'desc' ? '↓' : '↑'}</button>
  </div>
</div>

<ul class="space-y-2">
  {#each sortedFiles.slice(0, showCursor) as file}
    <li class="flex h-16 sm:h-28 border-0 space-x-4 p-2 bg-info-content rounded transition-shadow {deleteConfirmFile === file ? 'ring-2 ring-red-500 shadow-[0_0_26px_6px_rgba(239,68,68,.9)]' : ''}" on:pointerenter={(event) => trackFileHover(file, event)} on:pointermove={(event) => trackFileHover(file, event)} on:pointerleave={() => { if (hoveredFile === file) hoveredFile = null; }}>
      <div class="w-16 sm:w-28 shrink-0"><MediaShow {file} styleClass="w-full" {onClickDir} /></div>
      <div class="space-y-2 w-96 relative">
        <div class="flex min-w-0 items-center gap-2">
          <input
            type="text"
            class="input-bordered min-w-0 flex-1 font-bold bg-base-100"
            on:blur={(e) => updateFilename(e, file)}
            readonly={!!file.favorite_reference}
            value={file.name}
          />
          {#if file.favorite_reference_root}
            <button class="btn btn-warning btn-xs shrink-0" aria-label={`Remove ${file.name} from Saves`} title="Remove from Saves" on:click={() => removeFavorite(file)}>取消收藏</button>
          {/if}
        </div>
        <p class="text-gray-500 text-xs hidden sm:block">
          {file.formattedDatetime} | {file.formattedSize}
        </p>

        <div class="bottom-0 absolute">
          {#if comfyApp && file.type != 'dir'}
            <button
              class="btn btn-link btn-sm p-0 no-underline text-accent"
              on:click={async () => await onLoadWorkflow(file, comfyApp, toast)}
              >{$t('common.btn.load')}</button
            >
          {/if}
        </div>
      </div>

      <div>
        <textarea
          name="notes"
          placeholder={tt('collection.memoPlaceholder')}
          on:blur={(e) => updateFileNotes(e, file)}
          class="resize-none textarea hidden md:block md:w-72 max-w-72 h-14 sm:h-24"
          disabled={!!file.favorite_reference}
          value={file.notes}
        />
      </div>
    </li>
  {/each}
</ul>
<DeleteTargetHint file={deleteConfirmFile} x={deleteHintX} y={deleteHintY} onConfirm={confirmDelete} onCancel={cancelDelete} />

<div class="flex justify-center">
  {#if sortedFiles.length > showCursor}
    <button on:click={() => showCursor += 10} class="btn btn-neutral btn-outline">Load more</button>
  {:else}
    <p class="text-neutral-content">No more content.</p>
  {/if}
</div>

{#if files.length === 0}
  <div class="w-full h-full flex items-center justify-center">
    <span class="font-bold text-4xl">
      {#if loaded}
        {$t('common.emptyList')}
      {:else}
        {$t('common.rootDir')}
      {/if}
    </span>
  </div>
{/if}

<Toast bind:this={toast} />
