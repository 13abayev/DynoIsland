using System.Text.Json.Nodes;

namespace Island;

// "serve": runs next to Island. Tells Island what changed, one JSON object per line on stdout:
//   foreground  the window in front (and whether it is fullscreen, and where)
//   clipboard   the clipboard changed (and whether what was copied is private)
//   media       what plays (title, artist, cover, playing, position …)
//   volume      your speakers' volume and mute (checked often, so the island's volume bar follows your keys)
//   brightness  your laptop screen's brightness, when it changes
//   mic         your microphone's mute, and the apps using it right now
//   level       how loud your speakers play (only while the visualizer asks for it)
//   pods        your AirPods' battery (earbuds and case), while they are connected (after a "pods" request)
// and answers requests on stdin, for example:
//   {"id":1,"cmd":"focus","hwnd":123}
//   {"id":2,"cmd":"focusMatch","process":["Code"],"title":["my-app","[WSL: Ubuntu]"]}
//   {"id":3,"cmd":"media","action":"toggle"}        play / pause / toggle / next / prev
//   {"id":4,"cmd":"volume","level":0.4}  {"cmd":"speakerMute","mute":true}  {"cmd":"micMute","mute":true}
//   {"id":5,"cmd":"meter","on":true}                 start / stop the "level" reports
//   {"id":6,"cmd":"keys","key":"v"}                  presses Ctrl+V once you let go of your hotkey
//   {"id":7,"cmd":"ocr","path":"C:\\…\\clip.png"}    the text in an image
//   {"id":8,"cmd":"meetings","hours":24}             your next meetings (classic Outlook, if it runs)
//   {"id":9,"cmd":"copiedFiles"}                     the files you copied in Explorer (paths)
//   {"id":10,"cmd":"copyFiles","paths":["C:\\…"]}   puts files on the clipboard, as Explorer's Copy does
//   {"id":11,"cmd":"pods","devices":[{"address":"A1B2C3D4E5F6","model":8206}]}   follow these AirPods' battery
static class Serve
{
    static readonly object writeLock = new();
    static volatile bool meterOn;

    public static int Run()
    {
        Wnd.DpiAware();
        Send(new JsonObject { ["type"] = "ready", ["pid"] = Environment.ProcessId });
        Loop("foreground", 500, WatchForeground);
        Loop("clipboard", 300, WatchClipboard);
        Loop("media", 1000, WatchMedia);
        Loop("volume", 100, WatchVolume);
        new Thread(WatchBrightness) { IsBackground = true, Name = "brightness" }.Start();
        Loop("mic", 1500, WatchMic);
        Loop("level", 60, () => { if (meterOn) Send(new JsonObject { ["type"] = "level", ["v"] = Math.Round(Audio.Peak(), 3) }); });
        string? line;
        while ((line = Console.In.ReadLine()) != null) // Island closed our stdin: time to stop
        {
            var text = line.TrimStart('﻿'); // some programs start their first line with a byte-order mark
            // requests can take a while (OCR, Outlook): answer each on its own, so the others do not wait
            ThreadPool.QueueUserWorkItem(_ =>
            {
                JsonObject? req = null;
                JsonNode result;
                try
                {
                    req = JsonNode.Parse(text) as JsonObject ?? throw new Exception("not a request");
                    result = Handle(req);
                }
                catch (Exception e) { result = new JsonObject { ["ok"] = false, ["error"] = (e.InnerException ?? e).Message }; }
                Send(new JsonObject { ["type"] = "reply", ["id"] = req?["id"]?.DeepClone(), ["result"] = result });
            });
        }
        return 0;
    }

    static void Send(JsonObject o)
    {
        var json = o.ToJsonString();
        lock (writeLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    /// <summary>Runs `watch` every `ms` on its own thread; a watcher that fails just tries again next time.</summary>
    static void Loop(string name, int ms, Action watch)
    {
        new Thread(() =>
        {
            while (true)
            {
                try { watch(); }
                catch (Exception e)
                {
                    // a window can vanish while we look at it, a player can quit, …: try again next time
                    if (Environment.GetEnvironmentVariable("ISLAND_DEBUG") == "1") Console.Error.WriteLine($"{name}: {e}");
                }
                Thread.Sleep(ms);
            }
        }) { IsBackground = true, Name = name }.Start();
    }

    /// <summary>Sends an event only when it differs from the last one of its kind.</summary>
    static readonly Dictionary<string, string> last = new();
    static void SendIfChanged(JsonObject o)
    {
        var type = (string)o["type"]!;
        var json = o.ToJsonString();
        lock (last) { if (last.TryGetValue(type, out var before) && before == json) return; last[type] = json; }
        Send(o);
    }

    static void WatchForeground()
    {
        var h = Native.GetForegroundWindow();
        if (h == IntPtr.Zero) return;
        var w = Wnd.Describe(h);
        Native.GetWindowRect(h, out var r);
        SendIfChanged(new JsonObject
        {
            ["type"] = "foreground", ["hwnd"] = (long)h, ["pid"] = w.Pid, ["process"] = w.Process, ["title"] = w.Title,
            ["fullscreen"] = Wnd.IsFullscreen(h),
            // the window's middle in screen pixels: which display it is on
            ["cx"] = (r.Left + r.Right) / 2, ["cy"] = (r.Top + r.Bottom) / 2,
        });
    }

    static uint clipSeq;
    static void WatchClipboard()
    {
        var seq = Keys.ClipboardSequence();
        if (seq == clipSeq) return;
        var first = clipSeq == 0;
        clipSeq = seq;
        if (first) return; // what was copied before Island started is not news
        Send(new JsonObject { ["type"] = "clipboard", ["seq"] = seq, ["private"] = Keys.ClipboardPrivate() });
    }

    static void WatchMedia()
    {
        var now = Media.Now();
        now["type"] = "media";
        // the position moves all the time: only a jump of more than 3 seconds is news (Island counts on by itself)
        var key = now.DeepClone().AsObject();
        key.Remove("positionAt");
        key["position"] = Math.Round(((double?)now["position"] ?? 0) / 3);
        var json = key.ToJsonString();
        lock (last) { if (last.TryGetValue("media", out var before) && before == json) return; last["media"] = json; }
        Send(now);
    }

    static void WatchVolume()
    {
        var v = Audio.Volume();
        if (v == null) return;
        SendIfChanged(new JsonObject { ["type"] = "volume", ["level"] = Math.Round(v.Value.level, 2), ["muted"] = v.Value.muted });
    }

    static void WatchBrightness()
    {
        try
        {
            if (Brightness.Now() is not int now) return; // no screen here reports its brightness (a desktop PC)
            Send(new JsonObject { ["type"] = "brightness", ["level"] = now, ["first"] = true });
            Brightness.Watch(level => Send(new JsonObject { ["type"] = "brightness", ["level"] = level }));
        }
        catch (Exception e)
        {
            if (Environment.GetEnvironmentVariable("ISLAND_DEBUG") == "1") Console.Error.WriteLine($"brightness: {e}");
        }
    }

    static void WatchMic()
    {
        SendIfChanged(new JsonObject
        {
            ["type"] = "mic",
            ["muted"] = Audio.MicMuted(),
            ["apps"] = new JsonArray(Audio.MicUsers().Distinct().Select(a => (JsonNode)a).ToArray()),
        });
    }

    static JsonNode Handle(JsonObject req)
    {
        switch ((string?)req["cmd"])
        {
            case "focus":
                var hwnd = new IntPtr((long)req["hwnd"]!);
                return new JsonObject { ["ok"] = Wnd.Focus(hwnd), ["exists"] = Native.IsWindow(hwnd) };
            case "find":
                return new JsonObject { ["ok"] = true, ["windows"] = new JsonArray(Match(req).Select(ToJson).ToArray()) };
            case "focusMatch":
                var w = Match(req).FirstOrDefault();
                if (w == null) return new JsonObject { ["ok"] = false, ["error"] = "no matching window" };
                return new JsonObject { ["ok"] = Wnd.Focus(w.Hwnd), ["window"] = ToJson(w) };
            case "media":
                return new JsonObject { ["ok"] = Media.Control((string?)req["action"] ?? "toggle") };
            case "volume":
                Audio.SetVolume((float)(double)req["level"]!);
                return new JsonObject { ["ok"] = true };
            case "speakerMute":
                Audio.SetSpeakerMute((bool)req["mute"]!);
                return new JsonObject { ["ok"] = true };
            case "micMute":
                Audio.SetMicMute((bool)req["mute"]!);
                return new JsonObject { ["ok"] = true, ["muted"] = Audio.MicMuted() };
            case "clipseq": // for testing: the clipboard's change counter as the helper sees it
                return new JsonObject { ["ok"] = true, ["seq"] = Keys.ClipboardSequence(), ["watched"] = clipSeq };
            case "meter":
                meterOn = (bool?)req["on"] ?? false;
                return new JsonObject { ["ok"] = true };
            case "keys":
                return new JsonObject { ["ok"] = Keys.CtrlPlus(((string?)req["key"] ?? "v")[0]) };
            case "ocr":
                return new JsonObject { ["ok"] = true, ["text"] = Keys.Ocr((string)req["path"]!) };
            case "pods":
                var devices = (req["devices"] as JsonArray ?? new JsonArray())
                    .Select(d => (address: Convert.ToUInt64((string)d!["address"]!, 16), model: (int)d!["model"]!)).ToList();
                Pods.Track(devices, Send);
                return new JsonObject { ["ok"] = true };
            case "copiedFiles":
                return new JsonObject { ["ok"] = true, ["paths"] = new JsonArray(Keys.CopiedFiles().Select(f => (JsonNode)f).ToArray()) };
            case "copyFiles":
                var paths = Strings(req["paths"]).Where(File.Exists).ToList();
                return new JsonObject { ["ok"] = paths.Count > 0 && Keys.CopyFiles(paths) };
            case "meetings":
                var list = Outlook.Next((int?)req["hours"] ?? 24);
                return list == null ? new JsonObject { ["ok"] = false, ["error"] = "outlook not running" } : new JsonObject { ["ok"] = true, ["meetings"] = list };
            default:
                throw new Exception("unknown command");
        }
    }

    static IEnumerable<WinInfo> Match(JsonObject req)
    {
        var procs = Strings(req["process"]);
        var parts = Strings(req["title"]);
        return Wnd.TopLevel().Where(w =>
            (procs.Count == 0 || procs.Any(p => string.Equals(p, w.Process, StringComparison.OrdinalIgnoreCase))) &&
            parts.All(p => w.Title.Contains(p, StringComparison.OrdinalIgnoreCase)));
    }

    static List<string> Strings(JsonNode? n) =>
        n is JsonArray a ? a.Select(x => (string?)x).Where(x => !string.IsNullOrEmpty(x)).Select(x => x!).ToList() : new();

    static JsonNode ToJson(WinInfo w) => new JsonObject
    {
        ["hwnd"] = (long)w.Hwnd, ["pid"] = w.Pid, ["process"] = w.Process, ["title"] = w.Title,
    };
}
