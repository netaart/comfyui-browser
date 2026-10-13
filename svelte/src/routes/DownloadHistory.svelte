<script lang="ts">
  import dayjs from 'dayjs';
  import { onMount, onDestroy } from "svelte";
  import { formatFileSize } from './utils';
  import { t } from 'svelte-i18n';

  export let comfyUrl: string;

  let downloads: Array<any> = [];
  let autoRefresh = true;
  $: if (autoRefresh) {
    autoRefreshInterval = setInterval(refreshHistory, 1000);
  } else {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
  }
  let autoRefreshInterval: ReturnType<typeof setInterval>;

  async function refreshHistory() {
    const res = await fetch(comfyUrl + '/browser/downloads');
    const ret = await res.json();
    let newDownloads: Array<any> = [];
    ret.download_logs.forEach((dl: any) => {
      let newDl = dl;
      const timeFormat = 'YYYY-MM-DD HH:mm:ss';
      newDl['formattedCreatedAt'] = dayjs.unix(dl.created_at).format(timeFormat);
      newDl['formattedUpdatedAt'] = dayjs.unix(dl.updated_at).format(timeFormat);
      newDl['percentStr'] = `${Math.floor(dl.downloaded_size/dl.total_size * 100)}%`;
      newDl['formattedDownloadedSize'] = formatFileSize(dl.downloaded_size);
      newDl['formattedTotalSize'] = formatFileSize(dl.total_size);

      newDownloads.push(newDl);
    });
    downloads = newDownloads;
  }

  onMount(async () => {
    refreshHistory();
  });

  onDestroy(() => {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
  });
</script>

<div class="flex flex-row justify-between">
  <button
    class="btn btn-accent btn-outline"
    on:click={refreshHistory}
  >
    {$t('common.btn.refresh')}
  </button>

  <div class="flex items-center">
    <span class="label-text">{$t('downloadHistory.Auto Refresh')}</span>
    <input type="checkbox" bind:checked={autoRefresh} class="checkbox checkbox-secondary" />
  </div>
</div>
<ul class="space-y-2">
  {#each downloads as dl}
    <li class="bg-info-content">
      <p class="font-bold text-lg">{dl.filename ? dl.filename : dl.uuid}</p>
      <p class="text-gray-500 text-xs">
        <span>Created at: {dl.formattedCreatedAt}</span>
        <span>Updated at: {dl.formattedUpdatedAt}</span>
      </p>
      <p class="text-gray-500 text-xs">URL: {dl.download_url}</p>
      <p class="text-gray-500 text-xs">Save in: {dl.save_in}</p>
      {#if dl.total_size !== 0}
        <div>
          <span>{dl.formattedDownloadedSize}/{dl.formattedTotalSize}</span>
          <span>{dl.percentStr}</span>
          <progress
            class="progress progress-primary"
            value={dl.downloaded_size}
            max={dl.total_size} >
          </progress>
        </div>
      {:else}
        <p>Result: {dl.result}</p>
      {/if}
    </li>
  {/each}
</ul>
