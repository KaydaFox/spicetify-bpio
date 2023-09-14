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
let shouldNotVibrate: boolean = true;

export default async function main() {
  addSettings();
  await sleep(5000); // We sleep here just to make sure that settings and spicetify were both fully loaded
  handleConnection(true);
}

function addSettings() {
  settings.addToggle("bpio.ws-enable", "Enable plugin", false);
  settings.addToggle(
    "bpio.autoconnect",
    "Autoconnect to intiface on spotify start",
    true
  );
  settings.addInput("bpio.ws-url", "The url of the intiface server", "");
  settings.addButton(
    "bpio.connect",
    "Connect to intiface",
    "Connect",
    handleConnection
  );
  settings.addButton(
    "bpio.disconnect",
    "Disconnect from intiface",
    "disconnect",
    handleDisconnection
  );
  settings.addButton(
    "bpio.test",
    "test vibration on all devices",
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
  settings.pushSettings();
}

async function handleConnection(isAutoConnect?: boolean) {
  if (client && client.connected)
    return Spicetify.showNotification(
      "You are already connected to intiface, please disconnect first",
      true
    );

  console.log("rawr");
  // if (!settings.getFieldValue("bpio-ws.enable")) return;
  // if (isAutoConnect && !settings.getFieldValue("bpio.autoconnect")) return;
  // I'll return back to those... they seem to break things rn lmaoo

  try {
    connecter = new ButtplugBrowserWebsocketClientConnector(
      "ws://localhost:4000"
    );
    if (!client) client = new ButtplugClient("Spicetify");

    client.addListener("deviceadded", async (device: ButtplugClientDevice) => {
      Spicetify.showNotification(
        `Device connected: ${device.name} ${
          device.hasBattery &&
          `with a battery level of ${(await device.battery()) * 100}%`
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
        console.log("Pause for me daddy");
        currentToyStrength = 0;
      } else {
        console.log("Play for me uwu");
        updateLoop();
      }
    });

    updateTrack();
  } catch (error) {
    console.error(error);
    Spicetify.showNotification("Failed to connect to intiface", true);
  }
}

async function handleDisconnection() {
  if (!client || !client.connected)
    return Spicetify.showNotification("You are not connected to intiface");

  await client.disconnect();
  client = null;

  Spicetify.showNotification("Disconnected from intiface");
}

setInterval(updateLoop, 50);

async function updateLoop() {
  if (!Spicetify.Player || shouldNotVibrate || !client || !client.devices)
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
    console.log(`${Math.floor(newToyStrength * 100)}%`);
    currentToyStrength = newToyStrength;
    await vibrateDevices(client?.devices, newToyStrength);
  }
}

async function updateTrack() {
  const track = await Spicetify.getAudioData();

  currentTrack = track;
}

async function vibrateDevices(
  devices: ButtplugClientDevice[],
  intensity: number
) {
  if (intensity > 1) intensity = 1;
  if (intensity < 0) intensity = 0;
  for (const device of devices) {
    await device.vibrate(intensity);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
