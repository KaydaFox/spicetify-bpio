import {
  ButtplugClient,
  ButtplugClientDevice,
  ButtplugDeviceError,
} from "buttplug";
import { ButtplugBrowserWebsocketClientConnector } from "buttplug";
import { SettingsSection } from "spcr-settings";
import { decibelsToAmplitude, sampleAmplitudeMovingAverage } from "./utils";

const settings = new SettingsSection("Spicetify buttplugio", "bpio-settings");

let connecter: ButtplugBrowserWebsocketClientConnector;
let client: ButtplugClient | null;
let currentTrack: SpotifyAudioAnalysis | null = null;
let currentToyStrength: number = 0;
let shouldNotVibrate: boolean = false;
let updateIntervalId: NodeJS.Timeout | null = null;
let batteryCheckIntervalId: NodeJS.Timeout | null = null;

export default async function main() {
  addSettings();
  await sleep(5000); // We sleep here just to make sure that settings and spicetify were both fully loaded
  handleConnection(true);
}

function createInterval() {
  updateIntervalId = setInterval(
    updateLoop,
    settings.getFieldValue("bpio.update-interval")
  );
}

function addSettings() {
  settings.addToggle("bpio.enable", "Enable plugin", false, () => {
    if (client && client.connected) handleDisconnection;
  });
  settings.addToggle(
    "bpio.autoconnect",
    "Autoconnect to intiface on spotify start",
    true
  );
  settings.addInput(
    "bpio.ws-url",
    "The url of the intiface server",
    "ws://localhost:12345"
  );
  settings.addInput(
    "bpio.max-intensity",
    "Max intensity that the vibration can reach (applies to all devices) (default: 70; 0-100)",
    "70"
  );
  settings.addInput(
    "bpio.aplitudeDiff",
    "Difference needed to trigger toy update change. Can send a lot of unneeded events if too low (default: 0.4)",
    "0.4"
  );
  settings.addInput(
    "bpio.update-interval",
    "Update interval. WARNING: changing may cause issues or add high delay (default: 75), value is in milliseconds",
    "75",
    () => {
      if (updateIntervalId) {
        clearInterval(updateIntervalId);
        createInterval();
      }
    }
  );
  settings.addButton("bpio.connect", "Connect to intiface", "Connect", () => {
    handleConnection(false);
  });
  settings.addButton(
    "bpio.disconnect",
    "Disconnect from intiface",
    "Disconnect",
    handleDisconnection
  );
  settings.addButton(
    "bpio.test",
    "Test vibration on all devices",
    "test",
    async () => {
      if (!client || !client.connected)
        return Spicetify.showNotification(
          "You're not connected to intiface",
          true
        );

      client.devices.forEach(async (device) => {
        await device.vibrate(0.5);
        await sleep(1000);
        return device.stop();
      });
    }
  );
  settings.addToggle(
    "bpio.debug",
    "Enable debug logs (uses console.log which outputs to the dev console)",
    false
  );
  settings.pushSettings();
}

async function handleConnection(isAutoConnect?: boolean) {
  if (client && client.connected) await handleDisconnection();

  if (!settings.getFieldValue("bpio.enable")) return;
  if (isAutoConnect && !settings.getFieldValue("bpio.autoconnect")) return;

  try {
    connecter = new ButtplugBrowserWebsocketClientConnector(
      "ws://localhost:4000"
    );
    if (!client) client = new ButtplugClient("Spicetify");

    client.addListener("deviceadded", async (device: ButtplugClientDevice) => {
      Spicetify.showNotification(
        `Device connected: ${device.name} ${
          device.hasBattery &&
          `with a battery level of ${Math.floor(
            (await device.battery()) * 100
          )}%`
        }. Total devices: ${client?.devices.length}`
      );

      try {
        // give the device a little test vibration once it's connected
        await device.vibrate(0.1);
        await new Promise((r) => setTimeout(r, 500));
        await device.stop();
      } catch (error) {
        console.log(error);
        if (error instanceof ButtplugDeviceError) {
          console.log("got a device error!");
        }
      }
    });

    client.addListener(
      "deviceremoved",
      async (device: ButtplugClientDevice) => {
        console.log(device);
      }
    );

    await client
      .connect(connecter)
      .then(() => console.log("Buttplug.io connected"));

    Spicetify.showNotification("Connected to intiface");

    Spicetify.Player.addEventListener("songchange", updateTrack);
    Spicetify.Player.addEventListener("onplaypause", async () => {
      shouldNotVibrate = Spicetify.Player.data.isPaused;
      if (shouldNotVibrate) {
        await client?.devices[0].stop();
        currentToyStrength = 0;
      } else {
        updateLoop();
      }
    });

    updateTrack();
    createInterval();
    checkDeviceBattery();
  } catch (error) {
    console.error(error);
    Spicetify.showNotification("Failed to connect to intiface", true);
  }
}

function doDebugLog(message: any) {
  if (!settings.getFieldValue("bpio.debug")) return;
  console.info(message);
}

async function handleDisconnection() {
  if (!client || !client.connected)
    return Spicetify.showNotification("You are not connected to intiface");

  if (updateIntervalId) clearInterval(updateIntervalId);

  await client.disconnect();
  client = null;

  Spicetify.showNotification("Disconnected from intiface");
}

async function updateLoop() {
  if (
    !Spicetify.Player ||
    Spicetify.Player.data.isPaused ||
    shouldNotVibrate ||
    !client ||
    !client.connected
  )
    return;

  const trackDuration = Spicetify.Player.getProgress() / 1000;

  const amplitudeCurve: Point2D[] = currentTrack!.segments.flatMap(
    (segment) => [
      { x: segment.start, y: decibelsToAmplitude(segment.loudness_start) },
      {
        x: segment.start + segment.loudness_max_time,
        y: decibelsToAmplitude(segment.loudness_max),
      },
    ]
  );

  const amplitude = sampleAmplitudeMovingAverage(
    amplitudeCurve,
    trackDuration,
    0.15
  );

  let newToyStrength = amplitude > 1 ? 1 : amplitude;

  if (
    newToyStrength !== currentToyStrength &&
    Math.abs(currentToyStrength - newToyStrength) > 0.04
  ) {
    await vibrateDevices(client?.devices, newToyStrength);
  } else {
    doDebugLog(
      "Skipping updating device vibration, value is inside the difference"
    );
  }
}

async function updateTrack() {
  vibrateDevices(client!.devices, 0);
  const track = await Spicetify.getAudioData();

  currentTrack = track;
}

async function vibrateDevices(
  devices: ButtplugClientDevice[],
  intensity: number
) {
  intensity *= parseInt(settings.getFieldValue("bpio.max-intensity")) / 100;

  doDebugLog(`Vibration intensity: ${Math.floor(intensity * 100)}%`);

  if (intensity > 1) intensity = 1;
  if (intensity < 0) intensity = 0;
  currentToyStrength = intensity;
  for (const device of devices) {
    await device.vibrate(intensity);
  }
}

async function checkDeviceBattery() {
  if (!client) return;
  batteryCheckIntervalId = setInterval(async () => {
    client!.devices.forEach(async (device: ButtplugClientDevice) => {
      if (device.hasBattery && !device.warnedLowBattery) {
        const battery = await device.battery();
        if (battery < 0.83) {
          device.warnedLowBattery = true;
          Spicetify.showNotification(
            `The battery of ${device.name} is low (${Math.floor(
              battery * 100
            )}%)`
          );
        }
      }
    });
  }, 20000); // 1 minute
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

declare module "buttplug" {
  interface ButtplugClientDevice {
    warnedLowBattery: boolean;
  }
}
