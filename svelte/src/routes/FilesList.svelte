<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { onLoadWorkflow, onScroll, fetchFiles, WHITE_EXTS, sortBrowserFiles } from './utils';
  import { t } from 'svelte-i18n';
  import type { FOLDER_TYPES } from './utils';
  import FileToolbar from './FileToolbar.svelte';
  import MediaShow from './MediaShow.svelte';
  import type Toast from './Toast.svelte';

  export let comfyUrl: string;
  export let folderType: FOLDER_TYPES;
  export let toast: Toast;
  export let folderPath = '';
  let mounted = false;
  let selected: string[] = [];
  let sortBy = 'name';
  let sortOrder = 'asc';
  let error = '';
  let requestNumber = 0;
  $: { searchQuery; selected = []; showCursor = 20; }
  $: displayedFiles = sortBrowserFiles(files.filter(f => searchRegex.test(f.name.toLowerCase())), sortBy, sortOrder);
  $: if (mounted && folderPath != undefined) {
    refresh();
  }

  $: try {
    searchRegex = new RegExp(searchQuery.toLowerCase());
  } catch {
    searchRegex = new RegExp('');
  }

  let comfyApp: any;
  let files: Array<any> = [];
  let loaded: boolean = true;
  let showCursor = 20;
  let searchQuery = '';
  let searchRegex = new RegExp('');
  let scrollTop = 0;

  $: tt = function(key: string) {
    return $t('filesList.' + key);
  }

  export async function refresh() {
    const current = ++requestNumber;
    selected = [];
    showCursor = 20;
    loaded = false;
    error = '';
    try {
      const next = await fetchFiles(folderType, comfyUrl, folderPath);
      if (current === requestNumber) files = next;
    } catch (err) {
      if (current === requestNumber) { error = String(err); files = []; }
    } finally {
      if (current === requestNumber) loaded = true;
    }
  }

  const onShow = () => refresh();
  const handleScroll = () => {
    showCursor = onScroll(showCursor, displayedFiles.length);
    scrollTop = window.scrollY;
  };
  onMount(() => {
    //@ts-ignore
    comfyApp = window.top.app;
    window.top?.addEventListener('comfyuiBrowserShow', onShow);
    window.addEventListener('scroll', handleScroll);
    mounted = true;
  });
  onDestroy(() => {
    if (!mounted) return;
    window.top?.removeEventListener('comfyuiBrowserShow', onShow);
    window.removeEventListener('scroll', handleScroll);
    requestNumber++;
  });

  async function onCollect(file: any) {
    const res = await fetch(comfyUrl + '/browser/collections', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        folder_path: file.folder_path,
        folder_type: folderType,
      }),
    });

    toast.show(
      res.ok,
      tt('fileList.Added to Saves'),
      tt('fileList.Failed to add to Saves'),
    );
  }

  async function scrollToTop() {
    window.scrollTo(0, 0);
  }


  async function onDelete(file: any) {
    const ret = confirm(tt('You want to delete this file?') + ' ' + file.name);
    if (!ret) {
      return;
    }

    const res = await fetch(comfyUrl + '/browser/files', {
      method: 'DELETE',
      body: JSON.stringify({
        folder_type: folderType,
        filename: file.name,
        folder_path: file.folder_path,
      }),
    });

    refresh();
    toast.show(
      res.ok,
      tt('Deleted the file') + file.name,
      tt('Failed to delete the file'),
    );
  }

  async function onClickDir(dir: any) {
    folderPath = dir.path;
  }

  async function onClickPath(index: number) {
    if (index === -1) {
      folderPath = '';
      return;
    }

    folderPath = folderPath
      .split('/')
      .slice(0, index + 1)
      .join('/');
  }
</script>

<div class="max-w-full text-sm breadcrumbs flex flex-row ml-4">
  <ul class="basis-3/4">
    <li>
      <button on:click={() => onClickPath(-1)}>{$t('common.rootDir')}</button>
    </li>
    {#each (folderPath || '').split('/') as path, index}
      <li><button on:click={() => onClickPath(index)}>{path}</button></li>
    {/each}
  </ul>

  <input
    type="text"
    placeholder={tt('searchInput.placeholder')}
    bind:value={searchQuery}
    class="input input-bordered w-full h-full rounded-none border-slate-600 text-sm basis-1/4"
  />
</div>

<FileToolbar files={displayedFiles} bind:selected bind:sortBy bind:sortOrder {folderType} {folderPath} {comfyUrl} />
{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
<div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
  {#each displayedFiles.slice(0, showCursor) as file (file.name)}
    {#if WHITE_EXTS.includes(file.fileType)}
      <div class="p-2 bg-info-content">
        {#if file.type !== 'dir'}
          <label class="flex items-center gap-2 text-xs mb-1"><input class="checkbox checkbox-sm" type="checkbox" bind:group={selected} value={file.name} aria-label={`Select ${file.name}`} />Select</label>
        {/if}
        <div class="flex items-center">
          <MediaShow {file} styleClass="w-full h-16 sm:h-36" {onClickDir} />
        </div>

        <p class="font-bold max-h-12 leading-6 overflow-auto mt-1">
          {file.name}
        </p>
        <p class="hidden sm:block text-gray-500 text-xs">
          {file.formattedDatetime}
        </p>
        <p class="hidden sm:block text-gray-500 text-xs">
          {file.formattedSize}
        </p>

        <div class="">
          {#if file.type !== 'dir'}<a class="btn btn-link btn-sm p-0 no-underline text-accent" href={file.downloadUrl} download>Download</a>{/if}
          {#if comfyApp && file.type != 'dir'}
            <button
              class="btn btn-link btn-sm p-0 no-underline text-accent"
              on:click={async () => await onLoadWorkflow(file, comfyApp, toast)}
              >{$t('common.btn.load')}</button
            >
          {/if}
          <button
            class="btn btn-link btn-sm p-0 no-underline text-accent"
            on:click={async () => await onCollect(file)}
            >{$t('common.btn.save')}</button
          >
          <button
            class="btn btn-link btn-sm p-0 no-underline text-error float-right"
            on:click={async () => await onDelete(file)}
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2v4h6v2h-2v14H4V8H2V6h6V2h8zm-2 2h-4v2h4V4zm0 4H6v12h12V8h-4zm-5 2h2v8H9v-8zm6 0h-2v8h2v-8z" fill="#f77"/>
            </svg>
            {$t('common.btn.delete')}
          </button>
        </div>
      </div>
    {/if}
  {/each}
</div>

<div class="flex justify-center">
  {#if displayedFiles.length > showCursor}
    <button on:click={() => showCursor += 10} class="btn btn-neutral btn-outline">Load more</button>
  {:else}
    <p class="text-neutral-content">No more content.</p>
  {/if}
</div>

{#if displayedFiles.length === 0 && !error}
  <div class="w-full h-full flex items-center justify-center">
    <span class="font-bold text-4xl">
      {#if loaded}
        {$t('common.emptyList')}
      {:else}
        {$t('common.loading')}
      {/if}
    </span>
  </div>
{/if}

{#if scrollTop >= 300}
<button class="fixed right-10 bottom-10 w-10 h-10 flex justify-center items-center	rounded-full bg-slate-50" on:click={scrollToTop}>
  <svg class="w-5 h-5 icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path fill="#333333" d="M572.235 205.282v600.365a30.118 30.118 0 11-60.235 0V205.282L292.382 438.633a28.913 28.913 0 01-42.646 0 33.43 33.43 0 010-45.236l271.058-288.045a28.913 28.913 0 0142.647 0L834.5 393.397a33.43 33.43 0 010 45.176 28.913 28.913 0 01-42.647 0l-219.618-233.23z"/>
  </svg>
</button>
{/if}
