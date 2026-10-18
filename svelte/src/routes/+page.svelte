<script lang="ts">
  import Navbar from './Navbar.svelte';
  import FilesTab from './FilesTab.svelte';
  import CollectionsTab from './CollectionsTab.svelte';
  import SourcesTab from './SourcesTab.svelte';
  import ModelsTab from './ModelsTab.svelte';
  import { getLocalConfig, setLocalConfig } from './utils';
  import { onMount } from 'svelte';

  // @type {import('./$types').PageData}
  export let data: any;
  const { comfyUrl } = data;

  let activeTab = 'outputs';
  let outputNavigation: any = null;
  let navigationSequence = 0;

  function navigateToOutput(event: Event) {
    const detail = (event as CustomEvent).detail || {};
    outputNavigation = { ...detail, id: ++navigationSequence };
    activeTab = 'outputs';
    setLocalConfig('lastTab', 'outputs');
  }

  onMount(() => {
    const config = getLocalConfig();
    if (config.lastTab) {
      activeTab = config.lastTab;
    }
    window.addEventListener('comfyuiBrowserNavigateToOutput', navigateToOutput);
    return () => window.removeEventListener('comfyuiBrowserNavigateToOutput', navigateToOutput);
  });
</script>

<Navbar bind:activeTab />

{#if activeTab === 'collections'}
  <CollectionsTab {comfyUrl} />
{:else if activeTab === 'sources'}
  <SourcesTab {comfyUrl} />
{:else if activeTab === 'models'}
  <ModelsTab {comfyUrl} />
{:else}
  <FilesTab {comfyUrl} navigation={outputNavigation} />
{/if}
