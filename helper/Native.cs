using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Island;

record WinInfo(IntPtr Hwnd, int Pid, string Process, string Title);

static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public MOUSEINPUT mi; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32
    {
        public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    public delegate bool EnumProc(IntPtr h, IntPtr p);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
    [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
    [DllImport("kernel32.dll")] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}

static class Windows
{
    const uint GW_OWNER = 4;
    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14;
    static readonly Dictionary<int, string> names = new();

    public static void DpiAware() { try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }

    static string ProcessName(int pid)
    {
        lock (names)
        {
            if (names.TryGetValue(pid, out var n)) return n;
            try { n = Process.GetProcessById(pid).ProcessName; } catch { n = ""; }
            if (names.Count > 500) names.Clear();
            return names[pid] = n;
        }
    }

    public static string Title(IntPtr h)
    {
        var sb = new StringBuilder(512);
        Native.GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    static string ClassName(IntPtr h)
    {
        var sb = new StringBuilder(256);
        Native.GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static WinInfo Describe(IntPtr h)
    {
        Native.GetWindowThreadProcessId(h, out var pid);
        return new WinInfo(h, (int)pid, ProcessName((int)pid), Title(h));
    }

    /// <summary>The windows you can switch to (like Alt+Tab), front-most first.</summary>
    public static List<WinInfo> TopLevel()
    {
        var list = new List<IntPtr>();
        Native.EnumWindows((h, _) =>
        {
            if (!Native.IsWindowVisible(h) || Native.GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
            if ((Native.GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
            if (Native.DwmGetWindowAttribute(h, DWMWA_CLOAKED, out var cloaked, 4) == 0 && cloaked != 0) return true;
            list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list.Select(Describe).Where(w => w.Title.Length > 0).ToList();
    }

    /// <summary>True when the window covers its whole monitor (a video, a game, a presentation).</summary>
    public static bool IsFullscreen(IntPtr h)
    {
        var cls = ClassName(h);
        if (cls is "Progman" or "WorkerW" or "Shell_TrayWnd") return false;
        if (!Native.GetWindowRect(h, out var r)) return false;
        var mi = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
        if (!Native.GetMonitorInfo(Native.MonitorFromWindow(h, 2), ref mi)) return false;
        var m = mi.rcMonitor;
        return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
    }

    /// <summary>Brings a window to the front, also when Windows would normally refuse it to a background program.</summary>
    public static bool Focus(IntPtr h)
    {
        if (!Native.IsWindow(h)) return false;
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9); // SW_RESTORE
        // Windows only lets the program that got the last input take the foreground: an empty mouse
        // input makes that us for a moment (the same trick PowerToys uses).
        var input = new[] { new Native.INPUT { type = 0 } };
        Native.SendInput(1, input, Marshal.SizeOf<Native.INPUT>());
        Native.SetForegroundWindow(h);
        Native.BringWindowToTop(h);
        return Native.GetForegroundWindow() == h;
    }

    static Dictionary<int, int> ParentMap()
    {
        var map = new Dictionary<int, int>();
        var snap = Native.CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
        if (snap == new IntPtr(-1)) return map;
        try
        {
            var e = new Native.PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<Native.PROCESSENTRY32>() };
            for (var ok = Native.Process32FirstW(snap, ref e); ok; ok = Native.Process32NextW(snap, ref e))
                map[(int)e.th32ProcessID] = (int)e.th32ParentProcessID;
        }
        finally { Native.CloseHandle(snap); }
        return map;
    }

    /// <summary>
    /// The window this program was (indirectly) started from: walks up the parent processes
    /// (hook → shell → claude → terminal / VS Code / Claude app) until one owns a window.
    /// </summary>
    public static WinInfo? AncestorWindow(int startPid)
    {
        var parents = ParentMap();
        var windows = TopLevel();
        var pid = startPid;
        for (var i = 0; i < 16 && parents.TryGetValue(pid, out var parent) && parent > 4; i++)
        {
            pid = parent;
            var w = windows.FirstOrDefault(x => x.Pid == pid);
            if (w != null) return w;
        }
        return null;
    }
}
