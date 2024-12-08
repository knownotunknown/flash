<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Step, Error, useQdl } from '@/utils/flash';
  import type { StepValue, ErrorValue } from '@/utils/flash';

  import bolt from '@/assets/bolt.svg';
  import cable from '@/assets/cable.svg';
  import cloud from '@/assets/cloud.svg';
  import cloudDownload from '@/assets/cloud_download.svg';
  import cloudError from '@/assets/cloud_error.svg';
  import deviceExclamation from '@/assets/device_exclamation_c3.svg';
  import deviceQuestion from '@/assets/device_question_c3.svg';
  import done from '@/assets/done.svg';
  import exclamation from '@/assets/exclamation.svg';
  import frameAlert from '@/assets/frame_alert.svg';
  import systemUpdate from '@/assets/system_update_c3.svg';

  type UiState = {
    status: string;
    bgColor: string;
    icon: string;
    iconStyle?: string;
    description?: string;
  }

  const steps: Record<StepValue, UiState> = {
    [Step.INITIALIZING]: {
      status: 'Initializing...',
      bgColor: 'bg-gray-400 dark:bg-gray-700',
      icon: cloud,
    },
    [Step.READY]: {
      status: 'Ready',
      description: 'Tap the button above to begin',
      bgColor: 'bg-[#51ff00]',
      icon: bolt,
      iconStyle: '',
    },
    [Step.CONNECTING]: {
      status: 'Waiting for connection',
      description: 'Follow the instructions to connect your device to your computer',
      bgColor: 'bg-yellow-500',
      icon: cable,
    },
    [Step.DOWNLOADING]: {
      status: 'Downloading...',
      bgColor: 'bg-blue-500',
      icon: cloudDownload,
    },
    [Step.UNPACKING]: {
      status: 'Unpacking...',
      bgColor: 'bg-blue-500',
      icon: cloudDownload,
    },
    [Step.FLASHING]: {
      status: 'Flashing device...',
      description: 'Do not unplug your device until the process is complete.',
      bgColor: 'bg-lime-400',
      icon: systemUpdate,
    },
    [Step.ERASING]: {
      status: 'Erasing device...',
      bgColor: 'bg-lime-400',
      icon: systemUpdate,
    },
    [Step.DONE]: {
      status: 'Done',
      description:
        'Your device has been updated successfully. You can now unplug the cables from your device. ' +
        'To complete the system reset, follow the instructions on your device.',
      bgColor: 'bg-green-500',
      icon: done,
    },
  };

  const errors: Record<ErrorValue, UiState> = {
    [Error.UNKNOWN]: {
      status: 'Unknown error',
      description:
        'An unknown error has occurred. Unplug your device and wait for 20s. Restart your browser and try again.',
      bgColor: 'bg-red-500',
      icon: exclamation,
    },
    [Error.UNRECOGNIZED_DEVICE]: {
      status: 'Unrecognized device',
      description: 'The device connected to your computer is not supported.',
      bgColor: 'bg-yellow-500',
      icon: deviceQuestion,
    },
    [Error.LOST_CONNECTION]: {
      status: 'Lost connection',
      description:
        'The connection to your device was lost. Check that your cables are connected properly and try again.',
      icon: cable,
    },
    [Error.DOWNLOAD_FAILED]: {
      status: 'Download failed',
      description:
        'The system image could not be downloaded. Unplug your device and wait for 20s. Check your internet connection and try again.',
      icon: cloudError,
    },
    [Error.CHECKSUM_MISMATCH]: {
      status: 'Download mismatch',
      description: 'The system image downloaded does not match the expected checksum. Try again.',
      icon: frameAlert,
    },
    [Error.FLASH_FAILED]: {
      status: 'Flash failed',
      description:
        'The system image could not be flashed to your device. Try using a different cable, USB port, or computer.',
      icon: deviceExclamation,
    },
    [Error.ERASE_FAILED]: {
      status: 'Erase failed',
      description:
        'The device could not be erased. Try using a different cable, USB port, or computer.',
      icon: deviceExclamation,
    },
    [Error.REQUIREMENTS_NOT_MET]: {
      status: 'Requirements not met',
      description:
        'Your system does not meet the requirements to flash your device. Make sure to use a browser which supports WebUSB and is up to date.',
    },
  };

  const detachScript: string[] = [
    "for d in /sys/bus/usb/drivers/qcserial/*-*; do [ -e \"$d\" ] && echo -n \"$(basename $d)\" | sudo tee /sys/bus/usb/drivers/qcserial/unbind > /dev/null; done"
  ];

  const isLinux: boolean = navigator.userAgent.toLowerCase().includes('linux');
  let copied: boolean = false;

  const qdl = useQdl();

  $: step = $qdl.step;
  $: message = $qdl.message;
  $: progress = $qdl.progress;
  $: error = $qdl.error;
  $: connected = $qdl.connected;
  $: serial = $qdl.serial;
  $: onContinue = $qdl.onContinue;
  $: onRetry = $qdl.onRetry;

  $: uiState = steps[step];
  $: if (error) {
    uiState = { ...steps[step], ...errors[Error.UNKNOWN], ...errors[error] };
  }
  $: ({ status, description, bgColor, icon, iconStyle = 'invert' } = uiState);

  $: title = message && !error
    ? `${message}...${progress >= 0 ? ` (${(progress * 100).toFixed(0)}%)` : ''}`
    : status;

  function handleContinue(): void {
    if (onContinue) onContinue();
  }

  function handleRetry(): void {
    if (onRetry) onRetry();
  }

  function handleCopy(): void {
    navigator.clipboard.writeText(detachScript.join('\n'));
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1000);
  }

  function beforeUnloadListener(event: BeforeUnloadEvent): string {
    event.preventDefault();
    return (event.returnValue = "Flash in progress. Are you sure you want to leave?");
  }

  $: if (Step.DOWNLOADING <= step && step <= Step.ERASING) {
    window.addEventListener("beforeunload", beforeUnloadListener, { capture: true });
  } else {
    window.removeEventListener("beforeunload", beforeUnloadListener, { capture: true });
  }

  onDestroy(() => {
    window.removeEventListener("beforeunload", beforeUnloadListener, { capture: true });
  });
</script>

<div id="flash" class="relative flex flex-col gap-8 justify-center items-center h-full">
  <div
    class="{bgColor} p-8 rounded-full"
    style="cursor: {onContinue ? 'pointer' : 'default'}"
    on:click={handleContinue}
  >
    <img
      src={icon}
      alt="cable"
      width={128}
      height={128}
      class="{iconStyle} {!error && step !== Step.DONE ? 'animate-pulse' : ''}"
    />
  </div>

  <div 
    class="w-full max-w-3xl px-8 transition-opacity duration-300" 
    style="opacity: {progress === -1 ? 0 : 1}"
  >
    <div class="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        class="absolute top-0 bottom-0 left-0 w-full transition-all {bgColor}"
        style="transform: translateX({(progress * 100 > 100 ? 100 : progress * 100) - 100}%)"
      />
    </div>
  </div>

  <span class="text-3xl dark:text-white font-mono font-light">{title}</span>
  <span class="text-xl dark:text-white px-8 max-w-xl">{description}</span>

  {#if (title === "Lost connection" || title === "Ready") && isLinux}
    <span class="text-l dark:text-white px-2 max-w-xl">
      It seems that you're on Linux, make sure to run the script below in your terminal after plugging in your device.
    </span>
    <div class="relative mt-2 max-w-3xl">
      <div class="bg-gray-200 dark:bg-gray-800 rounded-md overflow-x-auto">
        <div class="relative">
          <pre class="font-mono text-sm text-gray-800 dark:text-gray-200 bg-gray-300 dark:bg-gray-700 rounded-md p-6 flex-grow max-w-m text-wrap">
            {#each detachScript as line}
              <span class="block">{line}</span>
            {/each}
          </pre>
          <div class="absolute top-2 right-2">
            <button
              on:click={handleCopy}
              class="bg-{copied ? 'green' : 'blue'}-500 text-white px-1 py-1 rounded-md ml-2 text-sm"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <button
      class="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition-colors"
      on:click={handleRetry}
    >
      Retry
    </button>
  {/if}

  {#if connected}
    <div
      class="absolute bottom-0 m-0 lg:m-4 p-4 w-full sm:w-auto sm:min-w-[350px] sm:border sm:border-gray-200 dark:sm:border-gray-600 bg-white dark:bg-gray-700 text-black dark:text-white rounded-md flex flex-row gap-2"
      style="left: 50%; transform: translate(-50%, -50%)"
    >
      <div class="flex flex-row gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 96 960 960"
          class="text-green-500 dark:text-[#51ff00]"
          height="24"
          width="24"
        >
          <path
            fill="currentColor"
            d="M480 976q-32 0-52-20t-20-52q0-22 11-40t31-29V724H302q-24 0-42-18t-18-42V555q-20-9-31-26.609-11-17.608-11-40.108Q200 456 220 436t52-20q32 0 52 20t20 52.411Q344 511 333 528.5T302 555v109h148V324h-80l110-149 110 149h-80v340h148V560h-42V416h144v144h-42v104q0 24-18 42t-42 18H510v111q19.95 10.652 30.975 29.826Q552 884 552 904q0 32-20 52t-52 20Z"
          />
        </svg>
        Device connected
      </div>
      <span class="text-gray-400">|</span>
      <div class="flex flex-row gap-2">
        <span>
          Serial:
          <span class="ml-2 font-mono">{serial || 'unknown'}</span>
        </span>
      </div>
    </div>
  {/if}
</div>