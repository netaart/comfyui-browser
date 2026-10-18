<script lang="ts">
  import Toast from './Toast.svelte';
  import FilesList from './FilesList.svelte';

  export let comfyUrl: string;
  export let navigation: any = null;

  let toast: Toast;
</script>

<FilesList folderType="outputs" {comfyUrl} {toast} {navigation} />

<Toast bind:this={toast} />
