using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Island;

// Finding files and folders by name with Windows Search's own index (the one Explorer's search box uses): fast,
// but only where Windows indexes (your user folders, by default). Island searches the folders Windows leaves out
// itself (launcher.js).
static class Files
{
    const string Index = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';";

    /// <summary>Files and folders with every word of `query` at the start of a word in their name, newest first.</summary>
    public static JsonArray Find(string query, int limit)
    {
        var words = query.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.Replace("\"", "").Replace("'", "''").Replace("*", "")).Where(w => w.Length > 0).Take(6).ToList();
        var found = new JsonArray();
        if (words.Count == 0) return found;
        var match = string.Join(" AND ", words.Select(w => $"CONTAINS(System.FileName, '\"{w}*\"')"));
        var sql = $"SELECT TOP {Math.Clamp(limit, 1, 100)} System.ItemPathDisplay FROM SYSTEMINDEX " +
                  $"WHERE SCOPE='file:' AND {match} ORDER BY System.DateModified DESC";
        var type = Type.GetTypeFromProgID("ADODB.Connection") ?? throw new Exception("Windows Search is not available");
        var conn = Activator.CreateInstance(type)!;
        try
        {
            Call(conn, "Open", Index);
            var rows = Call(conn, "Execute", sql);
            while (!(bool)Get(rows, "EOF"))
            {
                var field = Call(Get(rows, "Fields"), "Item", "System.ItemPathDisplay");
                if (Get(field, "Value") is string path) found.Add(new JsonObject { ["path"] = path, ["dir"] = Directory.Exists(path) });
                Call(rows, "MoveNext");
            }
            Call(rows, "Close");
        }
        finally
        {
            try { Call(conn, "Close"); } catch { }
            Marshal.FinalReleaseComObject(conn);
        }
        return found;
    }

    static object Get(object o, string name) => o.GetType().InvokeMember(name, BindingFlags.GetProperty, null, o, null)!;
    static object Call(object o, string name, params object[] args) =>
        o.GetType().InvokeMember(name, BindingFlags.InvokeMethod | BindingFlags.GetProperty, null, o, args)!;
}
