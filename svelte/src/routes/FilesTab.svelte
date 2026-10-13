<script lang="ts">
  import Toast from './Toast.svelte';
  import FilesList from './FilesList.svelte';
  import BrowserSettings from './BrowserSettings.svelte';

  export let comfyUrl: string;

  let toast: Toast;
  let folderPath = '';
  let fileList: FilesList;
</script>

<BrowserSettings {comfyUrl} on:changed={() => { folderPath = ''; fileList.refresh(); }} />
<FilesList folderType="outputs" {comfyUrl} {toast} bind:folderPath bind:this={fileList} />

<Toast bind:this={toast} />
