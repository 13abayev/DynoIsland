using System.Reflection;
using System.Runtime.InteropServices;

namespace Island;

// The brightness of your laptop's own screen, 0..100, as Windows reports it (WMI's WmiMonitorBrightness).
// Monitors on a cable do not report theirs this way, so on a desktop PC there is nothing to watch.
// Windows announces every change (the brightness keys, the slider, power saving): no polling.
static class Brightness
{
    /// <summary>The brightness now, or null when this PC has no screen that reports one.</summary>
    public static int? Now()
    {
        var wmi = Connect();
        if (wmi == null) return null;
        var found = Call(wmi, "ExecQuery", "SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active = TRUE");
        if ((int)Get(found, "Count") == 0) return null;
        return Convert.ToInt32(Get(Call(found, "ItemIndex", 0), "CurrentBrightness"));
    }

    /// <summary>Calls `changed` with the new brightness whenever it changes. Blocks: run it on a thread of its own.</summary>
    public static void Watch(Action<int> changed)
    {
        var wmi = Connect() ?? throw new Exception("no WMI");
        var events = Call(wmi, "ExecNotificationQuery", "SELECT * FROM WmiMonitorBrightnessEvent");
        while (true)
        {
            object e;
            try { e = Call(events, "NextEvent", 60000); }
            catch (TargetInvocationException x) when (x.InnerException is COMException c && (uint)c.ErrorCode == 0x80043001) { continue; } // timed out: wait on
            changed(Convert.ToInt32(Get(e, "Brightness")));
            Marshal.FinalReleaseComObject(e);
        }
    }

    static object? Connect()
    {
        var type = Type.GetTypeFromProgID("WbemScripting.SWbemLocator");
        if (type == null) return null;
        var locator = Activator.CreateInstance(type)!;
        return Call(locator, "ConnectServer", ".", "root\\wmi");
    }

    static object Get(object o, string name) => o.GetType().InvokeMember(name, BindingFlags.GetProperty, null, o, null)!;
    static object Call(object o, string name, params object[] args) => o.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, o, args)!;
}
