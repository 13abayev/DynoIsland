using System.Text.Json.Nodes;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Storage.Streams;

namespace Island;

// AirPods (and Beats) battery. Windows does not know it, but AirPods tell nearby devices in a Bluetooth LE message:
// the one Apple uses for the pairing popup on an iPhone (manufacturer data of company 0x004C, type 0x07). It says
// the model, each earbud's battery and the case's, in steps of 10%, and which of them is charging.
// Island only listens while your own AirPods are connected to this PC, only for their model, and takes the
// strongest signal: your AirPods next to you, not a colleague's.
static class Pods
{
    const ushort Apple = 0x004C;
    static readonly object gate = new();
    static readonly List<(BluetoothDevice device, int model)> tracked = new();
    static BluetoothLEAdvertisementWatcher? watcher;
    static HashSet<int> listening = new();
    static Action<JsonObject> report = _ => { };
    // the strongest recent message per model, and what was last reported
    static readonly Dictionary<int, (JsonObject data, short rssi, DateTime at)> best = new();
    static readonly Dictionary<int, (string json, DateTime at)> sent = new();

    /// <summary>Your paired Apple headphones (Bluetooth address, model): Island follows whether they are connected.</summary>
    public static void Track(IEnumerable<(ulong address, int model)> devices, Action<JsonObject> send)
    {
        lock (gate)
        {
            report = send;
            foreach (var (device, _) in tracked) device.Dispose();
            tracked.Clear();
            foreach (var (address, model) in devices)
            {
                var device = BluetoothDevice.FromBluetoothAddressAsync(address).AsTask().Result;
                if (device == null) continue;
                device.ConnectionStatusChanged += (_, _) => Update();
                tracked.Add((device, model));
            }
        }
        Update();
    }

    /// <summary>Listens while at least one of them is connected, and says when one is not any more.</summary>
    static void Update()
    {
        lock (gate)
        {
            var connected = tracked.Where(t => t.device.ConnectionStatus == BluetoothConnectionStatus.Connected).Select(t => t.model).ToHashSet();
            foreach (var model in listening.Except(connected))
            {
                best.Remove(model);
                sent.Remove(model);
                report(new JsonObject { ["type"] = "pods", ["model"] = model, ["connected"] = false });
            }
            listening = connected;
            if (connected.Count > 0 && watcher == null)
            {
                watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Passive };
                watcher.Received += Received;
                watcher.Start();
            }
            else if (connected.Count == 0 && watcher != null)
            {
                watcher.Stop();
                watcher.Received -= Received;
                watcher = null;
            }
        }
    }

    static void Received(BluetoothLEAdvertisementWatcher _, BluetoothLEAdvertisementReceivedEventArgs e)
    {
        foreach (var m in e.Advertisement.GetManufacturerDataByCompanyId(Apple))
        {
            var b = new byte[m.Data.Length];
            DataReader.FromBuffer(m.Data).ReadBytes(b);
            var data = Parse(b);
            if (data == null) continue;
            if (Environment.GetEnvironmentVariable("ISLAND_DEBUG") == "1") Console.Error.WriteLine($"pods {e.RawSignalStrengthInDBm} dBm: {Convert.ToHexString(b)}");
            var model = (int)data["model"]!;
            lock (gate)
            {
                if (!listening.Contains(model)) continue;
                var now = DateTime.UtcNow;
                // the strongest message of the last 10 seconds wins: the AirPods closest to this PC
                if (best.TryGetValue(model, out var b0) && now - b0.at < TimeSpan.FromSeconds(10) && e.RawSignalStrengthInDBm < b0.rssi) continue;
                best[model] = (data, e.RawSignalStrengthInDBm, now);
                var json = data.ToJsonString();
                // news right away; the same news again once a minute (so Island knows they are still there)
                if (sent.TryGetValue(model, out var s) && s.json == json && now - s.at < TimeSpan.FromSeconds(60)) continue;
                sent[model] = (json, now);
                report(data);
            }
        }
    }

    /// <summary>The "proximity pairing" message: 07 19 01 [model, 2 bytes] [status] [earbuds] [charging | case] …</summary>
    public static JsonObject? Parse(byte[] b)
    {
        if (b.Length < 9 || b[0] != 0x07) return null;
        var model = b[3] | b[4] << 8;
        // which earbud sent it decides which half of the battery byte is the left one
        var leftFirst = (b[5] & 0x20) == 0;
        int? Level(int nibble) => nibble <= 10 ? nibble * 10 : null; // 15: not known (in its case, or out of reach)
        int left = leftFirst ? b[6] >> 4 : b[6] & 0x0F, right = leftFirst ? b[6] & 0x0F : b[6] >> 4;
        int charging = b[7] >> 4;
        return new JsonObject
        {
            ["type"] = "pods", ["model"] = model, ["connected"] = true,
            ["left"] = Level(left), ["right"] = Level(right), ["case"] = Level(b[7] & 0x0F),
            ["chargingLeft"] = (charging & (leftFirst ? 0x2 : 0x1)) != 0,
            ["chargingRight"] = (charging & (leftFirst ? 0x1 : 0x2)) != 0,
            ["chargingCase"] = (charging & 0x4) != 0,
        };
    }
}
