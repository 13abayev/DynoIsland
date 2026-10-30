using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Island;

// Windows sound, through the Core Audio API: the volume and mute of your speakers, how loud they play right now
// (for the visualizer), the mute of your microphone, and which apps are using the microphone.
static class Audio
{
    const int Render = 0, Capture = 1, Console = 0, Communications = 2, ClsctxAll = 23;

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float levelDb, ref Guid context);
        int SetMasterVolumeLevelScalar(float level, ref Guid context);
        int GetMasterVolumeLevel(out float levelDb);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        int GetChannelVolumeLevel(uint channel, out float levelDb);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        int GetPeakValue(out float peak);
    }

    static readonly IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    static Guid none = Guid.Empty;

    static T? Endpoint<T>(int flow, int role) where T : class
    {
        if (enumerator.GetDefaultAudioEndpoint(flow, role, out var device) != 0 || device == null) return null;
        var iid = typeof(T).GUID;
        return device.Activate(ref iid, ClsctxAll, IntPtr.Zero, out var o) == 0 ? o as T : null;
    }

    /// <summary>Your speakers: volume 0..1 and whether they are muted.</summary>
    public static (float level, bool muted)? Volume()
    {
        var v = Endpoint<IAudioEndpointVolume>(Render, Console);
        if (v == null || v.GetMasterVolumeLevelScalar(out var level) != 0) return null;
        v.GetMute(out var muted);
        return (level, muted);
    }

    public static void SetVolume(float level)
    {
        var v = Endpoint<IAudioEndpointVolume>(Render, Console);
        if (v == null) return;
        level = Math.Clamp(level, 0, 1);
        v.SetMasterVolumeLevelScalar(level, ref none);
        if (level > 0) v.SetMute(false, ref none);
    }

    public static void SetSpeakerMute(bool mute) => Endpoint<IAudioEndpointVolume>(Render, Console)?.SetMute(mute, ref none);

    /// <summary>How loud your speakers play right now, 0..1 (for the visualizer).</summary>
    public static float Peak()
    {
        var m = Endpoint<IAudioMeterInformation>(Render, Console);
        return m != null && m.GetPeakValue(out var p) == 0 ? p : 0;
    }

    /// <summary>Whether your microphone is muted (the default one, and the one calls use).</summary>
    public static bool? MicMuted()
    {
        var v = Endpoint<IAudioEndpointVolume>(Capture, Communications) ?? Endpoint<IAudioEndpointVolume>(Capture, Console);
        if (v == null || v.GetMute(out var muted) != 0) return null;
        return muted;
    }

    public static void SetMicMute(bool mute)
    {
        Endpoint<IAudioEndpointVolume>(Capture, Console)?.SetMute(mute, ref none);
        Endpoint<IAudioEndpointVolume>(Capture, Communications)?.SetMute(mute, ref none);
    }

    /// <summary>
    /// The apps using your microphone right now. Windows notes this for its own microphone indicator:
    /// an app whose last use has a start but no stop yet is using it.
    /// </summary>
    public static List<string> MicUsers()
    {
        var apps = new List<string>();
        const string store = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        void Scan(RegistryKey? key, bool desktopApps)
        {
            if (key == null) return;
            foreach (var name in key.GetSubKeyNames())
            {
                if (name == "NonPackaged") continue;
                using var app = key.OpenSubKey(name);
                if (app?.GetValue("LastUsedTimeStop") is long stop && stop == 0 && app.GetValue("LastUsedTimeStart") is long start && start != 0)
                    apps.Add(desktopApps ? Path.GetFileNameWithoutExtension(name.Replace('#', '\\')) : name.Split('_')[0].Split('.').Last());
            }
        }
        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(store);
            Scan(root, false);
            using var desktop = Registry.CurrentUser.OpenSubKey(store + @"\NonPackaged");
            Scan(desktop, true);
        }
        catch { }
        return apps;
    }
}
