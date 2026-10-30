using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Island;

// Talking to the Island app: a tiny HTTP server on 127.0.0.1, protected by a token only this user can read.
static class IslandApp
{
    public const int Port = 47900;

    public static string DataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Island");

    public static string? Token()
    {
        try { return File.ReadAllText(Path.Combine(DataDir, "token")).Trim(); } catch { return null; }
    }

    /** Posts to Island and returns its answer ("" when Island is not running or does not answer in time). */
    public static string Post(string route, string body, Dictionary<string, string> headers, int timeoutMs = 1500)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{Port}{route}")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        try
        {
            using var res = http.Send(req);
            using var reader = new StreamReader(res.Content.ReadAsStream());
            return reader.ReadToEnd();
        }
        catch (Exception e)
        {
            // usually Island is simply not running: nothing to tell, unless you are debugging
            if (Environment.GetEnvironmentVariable("ISLAND_DEBUG") == "1") Console.Error.WriteLine(e);
            return "";
        }
    }

    public static string B64(string s) => Convert.ToBase64String(Encoding.UTF8.GetBytes(s));

    public static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
}

// "hook <agent> [wait]": Claude Code / Codex on Windows runs this for each event, with the event as JSON on stdin.
// With "wait" (a permission prompt) it waits for your answer in the island and prints it for Claude Code.
static class Hook
{
    public static int Run(string agent, bool wait = false)
    {
        var input = Console.In.ReadToEnd();
        var token = IslandApp.Token();
        if (token == null) return 0; // Island was never started on this PC
        JsonObject? ev = null;
        try { ev = JsonNode.Parse(input) as JsonObject; } catch { }
        var name = IslandApp.Str(ev?["hook_event_name"]);
        var cwd = IslandApp.Str(ev?["cwd"]);

        var headers = new Dictionary<string, string>
        {
            ["X-Island-Token"] = token,
            ["X-Island-Agent"] = agent,
            ["X-Island-Src"] = "win",
            ["X-Island-Host"] = Environment.MachineName,
            ["X-Island-Term"] = Environment.GetEnvironmentVariable("TERM_PROGRAM") ?? "",
            ["X-Island-Entry"] = Environment.GetEnvironmentVariable("CLAUDE_CODE_ENTRYPOINT") ?? "",
        };
        var branch = Git.Branch(cwd);
        if (branch != "") headers["X-Island-Branch"] = IslandApp.B64(branch);
        // the window this session runs in, so a click in Island can bring it back
        if (name is "SessionStart" or "UserPromptSubmit" or "Notification" or "Stop")
        {
            var win = Wnd.AncestorWindow(Environment.ProcessId);
            if (win != null)
            {
                headers["X-Island-Window"] = ((long)win.Hwnd).ToString();
                headers["X-Island-WinProc"] = win.Process;
            }
        }
        if (name == "Stop")
        {
            var reply = Transcript.LastReply(ev);
            if (reply != "") headers["X-Island-Summary"] = IslandApp.B64(reply);
        }
        if (!wait)
        {
            IslandApp.Post("/hook", input, headers);
            return 0;
        }
        var answer = IslandApp.Post("/hook?wait=1", input, headers, 30 * 60 * 1000);
        if (answer.Contains("hookSpecificOutput")) { Console.Out.WriteLine(answer); Console.Out.Flush(); }
        return 0;
    }
}

// "reply <agent>": a Claude Code Stop hook that runs in the background (asyncRewake) and waits until you type a
// reply to this session in the island. Exit code 2 wakes Claude with your reply; 0 means there is nothing to send.
static class Reply
{
    public static int Run(string agent)
    {
        var input = Console.In.ReadToEnd();
        var token = IslandApp.Token();
        if (token == null) return 0;
        var answer = IslandApp.Post("/reply-wait", input, new() { ["X-Island-Token"] = token, ["X-Island-Agent"] = agent, ["X-Island-Src"] = "win" },
            3 * 60 * 60 * 1000);
        string reply;
        try { reply = IslandApp.Str((JsonNode.Parse(answer) as JsonObject)?["reply"]); } catch { return 0; }
        if (reply == "") return 0;
        Console.Error.WriteLine("The user replied from Island (their Windows notch app) instead of the terminal: " + reply);
        return 2;
    }
}

// "statusline <agent>": Claude Code shows what this prints under the prompt, and passes your usage limits on stdin.
static class StatusLine
{
    public static int Run(string agent)
    {
        var input = Console.In.ReadToEnd();
        JsonObject ev;
        try { ev = JsonNode.Parse(input) as JsonObject ?? new JsonObject(); } catch { ev = new JsonObject(); }
        int? Pct(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? (int)Math.Round(d) : null;
        JsonObject? Limit(string key)
        {
            var l = ev["rate_limits"]?[key];
            return l == null ? null : new JsonObject { ["used"] = Pct(l["used_percentage"]), ["resets_at"] = l["resets_at"]?.DeepClone() };
        }
        var usage = new JsonObject
        {
            ["session_id"] = IslandApp.Str(ev["session_id"]),
            ["model"] = IslandApp.Str(ev["model"]?["display_name"]),
            ["context"] = Pct(ev["context_window"]?["used_percentage"]),
            ["five_hour"] = Limit("five_hour"),
            ["seven_day"] = Limit("seven_day"),
        };
        var parts = new List<string> { "Island" };
        if (usage["five_hour"]?["used"] is JsonNode f) parts.Add($"5h {f}%");
        if (usage["seven_day"]?["used"] is JsonNode s) parts.Add($"week {s}%");
        if (usage["context"] is JsonNode c) parts.Add($"context {c}%");
        Console.Out.WriteLine(string.Join(" · ", parts));
        Console.Out.Flush();
        var token = IslandApp.Token();
        if (token != null)
            IslandApp.Post("/status", usage.ToJsonString(), new() { ["X-Island-Token"] = token, ["X-Island-Agent"] = agent });
        return 0;
    }
}

static class Git
{
    /// <summary>The branch checked out in this folder (or a parent folder), read straight from .git/HEAD.</summary>
    public static string Branch(string dir)
    {
        try
        {
            for (var d = string.IsNullOrEmpty(dir) ? null : new DirectoryInfo(dir); d != null; d = d.Parent)
            {
                var git = Path.Combine(d.FullName, ".git");
                string? head = null;
                if (Directory.Exists(git)) head = Path.Combine(git, "HEAD");
                else if (File.Exists(git)) // a worktree: ".git" is a file pointing at the real folder
                {
                    var target = File.ReadAllText(git).Trim();
                    if (target.StartsWith("gitdir:")) head = Path.Combine(Path.GetFullPath(target[7..].Trim(), d.FullName), "HEAD");
                }
                if (head == null) continue;
                var text = File.ReadAllText(head).Trim();
                return text.StartsWith("ref: refs/heads/") ? text[16..] : text[..Math.Min(7, text.Length)];
            }
        }
        catch { }
        return "";
    }
}

static class Transcript
{
    /// <summary>The start of the agent's last answer, as a one-line summary for the notification.</summary>
    public static string LastReply(JsonObject? ev)
    {
        var direct = IslandApp.Str(ev?["last_assistant_message"]);
        if (direct != "") return Clean(direct);
        var path = IslandApp.Str(ev?["transcript_path"]);
        if (path == "" || !File.Exists(path)) return "";
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var size = Math.Min(fs.Length, 512 * 1024);
            fs.Seek(-size, SeekOrigin.End);
            var buf = new byte[size];
            fs.ReadExactly(buf);
            var lines = Encoding.UTF8.GetString(buf).Split('\n');
            for (var i = lines.Length - 1; i >= 0; i--)
            {
                if (!lines[i].Contains("\"assistant\"")) continue;
                try
                {
                    using var doc = JsonDocument.Parse(lines[i]);
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("type", out var t) || t.GetString() != "assistant") continue;
                    if (!root.TryGetProperty("message", out var m) || !m.TryGetProperty("content", out var content)) continue;
                    var text = new StringBuilder();
                    if (content.ValueKind == JsonValueKind.String) text.Append(content.GetString());
                    else if (content.ValueKind == JsonValueKind.Array)
                        foreach (var part in content.EnumerateArray())
                            if (part.TryGetProperty("type", out var pt) && pt.GetString() == "text" && part.TryGetProperty("text", out var tx))
                                text.Append(tx.GetString()).Append(' ');
                    if (text.Length > 0) return Clean(text.ToString());
                }
                catch (JsonException) { /* the first line of the tail can be cut in half */ }
            }
        }
        catch { }
        return "";
    }

    static string Clean(string s)
    {
        // markdown marks only: single _ and * stay, they are part of names like test_client.py
        s = Regex.Replace(s, @"(?m)`+|\*\*|__|^\s*(#+|>)\s*|\|", "");
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return s.Length > 220 ? s[..217].TrimEnd() + "…" : s;
    }
}
