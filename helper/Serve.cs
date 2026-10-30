using System.Text.Json.Nodes;

namespace Island;

// "serve": runs next to Island. Reports the window in front whenever it changes, and answers requests:
//   {"id":1,"cmd":"focus","hwnd":123}
//   {"id":2,"cmd":"find","process":["Code"],"title":["my-app","[WSL: Ubuntu]"]}     all title parts must match
//   {"id":3,"cmd":"focusMatch","process":["WindowsTerminal"],"title":[]}            focuses the front-most match
static class Serve
{
    static readonly object writeLock = new();

    public static int Run()
    {
        Windows.DpiAware();
        Send(new JsonObject { ["type"] = "ready", ["pid"] = Environment.ProcessId });
        new Thread(Watch) { IsBackground = true }.Start();
        string? line;
        while ((line = Console.In.ReadLine()) != null) // Island closed our stdin: time to stop
        {
            JsonObject? req = null;
            JsonNode result;
            try
            {
                req = JsonNode.Parse(line) as JsonObject ?? throw new Exception("not a request");
                result = Handle(req);
            }
            catch (Exception e) { result = new JsonObject { ["ok"] = false, ["error"] = e.Message }; }
            Send(new JsonObject { ["type"] = "reply", ["id"] = req?["id"]?.DeepClone(), ["result"] = result });
        }
        return 0;
    }

    static void Send(JsonObject o)
    {
        lock (writeLock) { Console.Out.WriteLine(o.ToJsonString()); Console.Out.Flush(); }
    }

    static void Watch()
    {
        var last = "";
        while (true)
        {
            try
            {
                var h = Native.GetForegroundWindow();
                if (h != IntPtr.Zero)
                {
                    var w = Windows.Describe(h);
                    var full = Windows.IsFullscreen(h);
                    Native.GetWindowRect(h, out var r);
                    var key = $"{h}|{w.Title}|{full}|{r.Left},{r.Top}";
                    if (key != last)
                    {
                        last = key;
                        Send(new JsonObject
                        {
                            ["type"] = "foreground", ["hwnd"] = (long)h, ["pid"] = w.Pid,
                            ["process"] = w.Process, ["title"] = w.Title, ["fullscreen"] = full,
                            // the window's middle in screen pixels: which display it is on
                            ["cx"] = (r.Left + r.Right) / 2, ["cy"] = (r.Top + r.Bottom) / 2,
                        });
                    }
                }
            }
            catch { /* a window can vanish while we look at it */ }
            Thread.Sleep(500);
        }
    }

    static JsonNode Handle(JsonObject req)
    {
        switch ((string?)req["cmd"])
        {
            case "focus":
                var hwnd = new IntPtr((long)req["hwnd"]!);
                return new JsonObject { ["ok"] = Windows.Focus(hwnd), ["exists"] = Native.IsWindow(hwnd) };
            case "find":
                return new JsonObject { ["ok"] = true, ["windows"] = new JsonArray(Match(req).Select(ToJson).ToArray()) };
            case "focusMatch":
                var w = Match(req).FirstOrDefault();
                if (w == null) return new JsonObject { ["ok"] = false, ["error"] = "no matching window" };
                return new JsonObject { ["ok"] = Windows.Focus(w.Hwnd), ["window"] = ToJson(w) };
            default:
                throw new Exception("unknown command");
        }
    }

    static IEnumerable<WinInfo> Match(JsonObject req)
    {
        var procs = Strings(req["process"]);
        var parts = Strings(req["title"]);
        return Windows.TopLevel().Where(w =>
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
