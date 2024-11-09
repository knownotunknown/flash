import { writable } from 'svelte/store';
import { concatUint8Array } from '@/QDL/utils';
import { qdlDevice } from '@/QDL/qdl';
import * as Comlink from 'comlink';

import config from '@/config';
import { download } from '@/utils/blob';
import { createManifest } from '@/utils/manifest';
import { withProgress } from '@/utils/progress';

export const Step = {
  INITIALIZING: 0,
  READY: 1,
  CONNECTING: 2,
  DOWNLOADING: 3,
  UNPACKING: 4,
  FLASHING: 6,
  ERASING: 7,
  DONE: 8,
};

export const Error = {
  UNKNOWN: -1,
  NONE: 0,
  UNRECOGNIZED_DEVICE: 1,
  LOST_CONNECTION: 2,
  DOWNLOAD_FAILED: 3,
  UNPACK_FAILED: 4,
  CHECKSUM_MISMATCH: 5,
  FLASH_FAILED: 6,
  ERASE_FAILED: 7,
  REQUIREMENTS_NOT_MET: 8,
};

function isRecognizedDevice(slotCount, partitions) {
  if (slotCount !== 2) {
    console.error('[QDL] Unrecognised device (slotCount)');
    return false;
  }

  const expectedPartitions = [
    "ALIGN_TO_128K_1", "ALIGN_TO_128K_2", "ImageFv", "abl", "aop", "apdp", "bluetooth", "boot", "cache",
    "cdt", "cmnlib", "cmnlib64", "ddr", "devcfg", "devinfo", "dip", "dsp", "fdemeta", "frp", "fsc", "fsg",
    "hyp", "keymaster", "keystore", "limits", "logdump", "logfs", "mdtp", "mdtpsecapp", "misc", "modem",
    "modemst1", "modemst2", "msadp", "persist", "qupfw", "rawdump", "sec", "splash", "spunvm", "ssd",
    "sti", "storsec", "system", "systemrw", "toolsfv", "tz", "userdata", "vm-linux", "vm-system", "xbl",
    "xbl_config"
  ];
  
  if (!partitions.every(partition => expectedPartitions.includes(partition))) {
    console.error('[QDL] Unrecognised device (partitions)', partitions);
    return false;
  }
  return true;
}

function createQdlStore() {
  const step = writable(Step.INITIALIZING);
  const message = writable('');
  const progress = writable(0);
  const error = writable(Error.NONE);
  const connected = writable(false);
  const serial = writable(null);
  const onContinue = writable(null);
  const onRetry = writable(null);

  const qdl = new qdlDevice();
  let manifest = null;
  let imageWorker = null;

  function setMessage(msg = '') {
    if (msg) console.info('[QDL]', msg);
    message.set(msg);
  }

  async function initialize(worker) {
    imageWorker = worker;
    
    if (typeof navigator.usb === 'undefined' || 
        typeof Worker === 'undefined' || 
        typeof Storage === 'undefined') {
      error.set(Error.REQUIREMENTS_NOT_MET);
      return;
    }

    try {
      await imageWorker.init();
      const blob = await download(config.manifests['release']);
      const text = await blob.text();
      manifest = createManifest(text);

      if (manifest.length === 0) {
        throw 'Manifest is empty';
      }

      console.debug('[QDL] Loaded manifest', manifest);
      step.set(Step.READY);
    } catch (err) {
      console.error('[QDL] Initialization error', err);
      error.set(Error.UNKNOWN);
    }
  }

  async function startFlashing() {
    step.set(Step.CONNECTING);
    try {
      await qdl.waitForConnect();
      console.info('[QDL] Connected');
      
      const [slotCount, partitions] = await qdl.getDevicePartitionsInfo();
      const recognized = isRecognizedDevice(slotCount, partitions);
      console.debug('[QDL] Device info', { recognized, partitions});

      if (!recognized) {
        error.set(Error.UNRECOGNIZED_DEVICE);
        return;
      }

      serial.set(qdl.sahara.serial || 'unknown');
      connected.set(true);
      step.set(Step.DOWNLOADING);
      
      await downloadImages();
      await unpackImages();
      await flashDevice();
      await eraseDevice();
      
      step.set(Step.DONE);
    } catch (err) {
      handleError(err);
    }
  }

  async function downloadImages() {
    progress.set(0);
    try {
      for await (const [image, onProgress] of withProgress(manifest, progress.set)) {
        setMessage(`Downloading ${image.name}`);
        await imageWorker.downloadImage(image, Comlink.proxy(onProgress));
      }
      console.debug('[QDL] Downloaded all images');
      step.set(Step.UNPACKING);
    } catch (err) {
      console.error('[QDL] Download error', err);
      throw Error.DOWNLOAD_FAILED;
    }
  }

  async function unpackImages() {
    progress.set(0);
    try {
      for await (const [image, onProgress] of withProgress(manifest, progress.set)) {
        setMessage(`Unpacking ${image.name}`);
        await imageWorker.unpackImage(image, Comlink.proxy(onProgress));
      }
      console.debug('[QDL] Unpacked all images');
      step.set(Step.FLASHING);
    } catch (err) {
      console.error('[QDL] Unpack error', err);
      throw err.startsWith('Checksum mismatch') ? Error.CHECKSUM_MISMATCH : Error.UNPACK_FAILED;
    }
  }

  async function flashDevice() {
    progress.set(0);
    try {
      const currentSlot = await qdl.getActiveSlot();
      if (!['a', 'b'].includes(currentSlot)) {
        throw `Unknown current slot ${currentSlot}`;
      }
      const otherSlot = currentSlot === 'a' ? 'b' : 'a';

      await qdl.erase("xbl"+`_${currentSlot}`);

      for await (const [image, onProgress] of withProgress(manifest, progress.set)) {
        const fileHandle = await imageWorker.getImage(image);
        const blob = await fileHandle.getFile();

        setMessage(`Flashing ${image.name}`);
        const partitionName = image.name + `_${otherSlot}`;
        await qdl.flashBlob(partitionName, blob, onProgress);
      }

      setMessage(`Changing slot to ${otherSlot}`);
      await qdl.setActiveSlot(otherSlot);
    } catch (err) {
      console.error('[QDL] Flashing error', err);
      throw Error.FLASH_FAILED;
    }
  }

  async function eraseDevice() {
    progress.set(0);
    try {
      setMessage('Erasing userdata');
      let wData = new TextEncoder().encode("COMMA_RESET");
      wData = new Blob([concatUint8Array([wData, new Uint8Array(28 - wData.length).fill(0)])]);
      await qdl.flashBlob("userdata", wData);
      progress.set(0.9);

      setMessage('Rebooting');
      await qdl.reset();
      progress.set(1);
      connected.set(false);
    } catch (err) {
      console.error('[QDL] Erase error', err);
      throw Error.ERASE_FAILED;
    }
  }

  function handleError(err) {
    const errorCode = err.code || err;
    error.set(errorCode);
    progress.set(-1);
    onContinue.set(null);
    onRetry.set(() => () => window.location.reload());
  }

  return {
    step: { subscribe: step.subscribe },
    message: { subscribe: message.subscribe },
    progress: { subscribe: progress.subscribe },
    error: { subscribe: error.subscribe },
    connected: { subscribe: connected.subscribe },
    serial: { subscribe: serial.subscribe },
    onContinue: { subscribe: onContinue.subscribe },
    onRetry: { subscribe: onRetry.subscribe },
    initialize,
    startFlashing
  };
}

export const qdlStore = createQdlStore();
export const useQdl = () => qdlStore;