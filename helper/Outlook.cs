using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Island;

// Your next meetings from classic Outlook, read on this PC. Only when Outlook is already running: Island never
// starts Outlook itself. (The New Outlook has no such connection; that would need your company's approval.)
static class Outlook
{
    static readonly Regex JoinLink = new(
        @"https://(teams\.microsoft\.com/l/meetup-join/[^\s""<>]+|[\w.-]*zoom\.us/j/[^\s""<>]+|meet\.google\.com/[a-z\-]+|teams\.live\.com/meet/[^\s""<>]+)",
        RegexOptions.IgnoreCase);

    /// <summary>Meetings that end after now and start within the next `hours`, earliest first. null when Outlook is not running.</summary>
    public static JsonArray? Next(int hours)
    {
        JsonArray? result = null;
        Exception? error = null;
        // Outlook's objects live in a single-threaded apartment: talk to them from one
        var thread = new Thread(() => { try { result = Read(hours); } catch (Exception e) { error = e; } });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(20000)) throw new Exception("Outlook did not answer");
        if (error != null) throw error;
        return result;
    }

    static JsonArray? Read(int hours)
    {
        if (Native.CLSIDFromProgID("Outlook.Application", out var clsid) != 0) return null;
        if (Native.GetActiveObject(ref clsid, IntPtr.Zero, out var app) != 0 || app == null) return null;
        var created = new List<object> { app };
        object Keep(object o) { created.Add(o); return o; }
        try
        {
            var ns = Keep(Get(app, "Session"));
            var calendar = Keep(Call(ns, "GetDefaultFolder", 9)); // olFolderCalendar
            var items = Keep(Get(calendar, "Items"));
            Call(items, "Sort", "[Start]");
            Set(items, "IncludeRecurrences", true);
            // Outlook wants the dates in your own regional format
            var now = DateTime.Now;
            var filter = $"[End] > '{now.ToString("g", CultureInfo.CurrentCulture)}' AND [Start] < '{now.AddHours(hours).ToString("g", CultureInfo.CurrentCulture)}'";
            var found = Keep(Call(items, "Restrict", filter));
            var list = new JsonArray();
            var item = Call(found, "GetFirst");
            for (var i = 0; item != null && i < 12; i++)
            {
                Keep(item);
                if (!(bool)Get(item, "AllDayEvent"))
                {
                    var start = (DateTime)Get(item, "Start");
                    var end = (DateTime)Get(item, "End");
                    var location = Get(item, "Location") as string ?? "";
                    string body = "";
                    try { body = Get(item, "Body") as string ?? ""; } catch { }
                    var join = JoinLink.Match(location + "\n" + body);
                    list.Add(new JsonObject
                    {
                        ["subject"] = Get(item, "Subject") as string ?? "",
                        ["start"] = new DateTimeOffset(start).ToString("o"),
                        ["end"] = new DateTimeOffset(end).ToString("o"),
                        ["location"] = location,
                        ["join"] = join.Success ? join.Value.TrimEnd('>', ')', '.', ',') : "",
                    });
                }
                item = Call(found, "GetNext");
            }
            return list;
        }
        finally
        {
            foreach (var o in created) try { Marshal.FinalReleaseComObject(o); } catch { }
        }
    }

    static object Get(object o, string name) => o.GetType().InvokeMember(name, BindingFlags.GetProperty, null, o, null)!;
    static void Set(object o, string name, object value) => o.GetType().InvokeMember(name, BindingFlags.SetProperty, null, o, new[] { value });
    static object Call(object o, string name, params object[] args) => o.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, o, args)!;
}
