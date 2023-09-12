import { ButtplugClient, ButtplugClientDevice } from "buttplug";
import { ButtplugBrowserWebsocketClientConnector } from "buttplug";
import { SettingsSection } from "spcr-settings";

const settings = new SettingsSection("Spicetify buttplugio", "bpio-settings");
let connecter: ButtplugBrowserWebsocketClientConnector;
let client: ButtplugClient | null;
let currentTrack: trackData | null = null;
let currentToyStrength: number = 0;

export default async function main() {
  console.log("loading...");
  addSettings();
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
      // Spicetify.showNotification(
      //   `Device connected: ${device.name} ${
      //     device.hasBattery &&
      //     `with a battery level of ${(await device.battery()) * 100}%`
      //   }. Total devices: ${client?.devices.length}`
      // );
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

    // Spicetify.showNotification("Connected to intiface");

    Spicetify.Player.addEventListener("songchange", handleVibration);

    handleVibration();
  } catch (error) {
    console.error(error);
    // Spicetify.showNotification("Failed to connect to intiface", true);
  }
}

async function handleDisconnection() {
  if (!client || !client.connected)
    return Spicetify.showNotification("You are not connected to intiface");

  await client.disconnect();
  client = null;

  Spicetify.showNotification("Disconnected from intiface");
}

setInterval(updateLoop, 100);

async function updateLoop() {
  let totalBeatDuration: number = 0;
  const trackDuration = Spicetify.Player.getProgress();

  for (let i = 0; i < (currentTrack?.beats.length || 0); i++) {
    const beat = currentTrack?.beats[i];

    totalBeatDuration += beat?.duration!;
    if (totalBeatDuration > trackDuration) {
      let newToyStrength = beat?.confidence!;
      if (newToyStrength !== currentToyStrength) {
        await client?.devices[0].vibrate(beat?.confidence as number);
      }
      break;
    }
  }
}

async function handleVibration() {
  const track = await Spicetify.getAudioData();
  console.log(track);

  currentTrack = track;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface trackData {
  beats: trackBeat[];
  bears: trackBars[];
}

interface trackBars {
  start: number;
  duration: number;
  confidence: number;
}

interface trackBeat {
  start: number;
  duration: number;
  confidence: number;
}
