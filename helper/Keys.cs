using System.Runtime.InteropServices;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;

namespace Island;

// Keys and the clipboard: pressing Ctrl+V / Ctrl+C for you (paste as plain text, translate what you selected),
// telling Island when the clipboard changed, and whether what you copied is private (password managers say so).
static class Keys
{
    const uint KeyUp = 2;
    const ushort Ctrl = 0x11;

    /// <summary>Waits until you let go of Ctrl, Alt, Shift and Win (you pressed a hotkey), then presses Ctrl+key.</summary>
    public static bool CtrlPlus(char key)
    {
        var until = DateTime.UtcNow.AddMilliseconds(1500);
        while (DateTime.UtcNow < until && new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }.Any(k => (Native.GetAsyncKeyState(k) & 0x8000) != 0))
            Thread.Sleep(15);
        Native.INPUT Key(ushort vk, bool up) => new() { type = 1, u = new Native.InputUnion { ki = new Native.KEYBDINPUT { wVk = vk, dwFlags = up ? KeyUp : 0 } } };
        var vkKey = (ushort)char.ToUpperInvariant(key);
        var inputs = new[] { Key(Ctrl, false), Key(vkKey, false), Key(vkKey, true), Key(Ctrl, true) };
        return Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.INPUT>()) == inputs.Length;
    }

    static readonly uint exclude = Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
    static readonly uint history = Native.RegisterClipboardFormat("CanIncludeInClipboardHistory");

    public static uint ClipboardSequence() => Native.GetClipboardSequenceNumber();

    /// <summary>
    /// True when the app that copied asked to keep it out of clipboard history and clipboard tools
    /// (password managers do): Island then does not keep it.
    /// </summary>
    public static bool ClipboardPrivate()
    {
        if (Native.IsClipboardFormatAvailable(exclude)) return true;
        if (!Native.IsClipboardFormatAvailable(history)) return false;
        for (var i = 0; i < 10; i++) // another app can hold the clipboard for a moment
        {
            if (Native.OpenClipboard(IntPtr.Zero))
            {
                try
                {
                    var h = Native.GetClipboardData(history);
                    if (h == IntPtr.Zero) return false;
                    var p = Native.GlobalLock(h);
                    try { return p != IntPtr.Zero && Marshal.ReadInt32(p) == 0; } finally { Native.GlobalUnlock(h); }
                }
                finally { Native.CloseClipboard(); }
            }
            Thread.Sleep(20);
        }
        return false;
    }

    const uint CF_HDROP = 15;
    static readonly uint dropEffect = Native.RegisterClipboardFormat("Preferred DropEffect");

    /// <summary>Opens the clipboard, waiting a moment when another app holds it.</summary>
    static T WithClipboard<T>(Func<T> use)
    {
        for (var i = 0; i < 20; i++)
        {
            if (Native.OpenClipboard(IntPtr.Zero))
            {
                try { return use(); } finally { Native.CloseClipboard(); }
            }
            Thread.Sleep(25);
        }
        throw new Exception("another app holds the clipboard");
    }

    /// <summary>The files you copied (in Explorer, …), or none.</summary>
    public static List<string> CopiedFiles()
    {
        if (!Native.IsClipboardFormatAvailable(CF_HDROP)) return new();
        return WithClipboard(() =>
        {
            var files = new List<string>();
            var drop = Native.GetClipboardData(CF_HDROP);
            if (drop == IntPtr.Zero) return files;
            var n = Native.DragQueryFile(drop, 0xFFFFFFFF, null, 0);
            for (uint i = 0; i < n; i++)
            {
                var name = new System.Text.StringBuilder((int)Native.DragQueryFile(drop, i, null, 0) + 1);
                Native.DragQueryFile(drop, i, name, (uint)name.Capacity);
                files.Add(name.ToString());
            }
            return files;
        });
    }

    /// <summary>Puts files on the clipboard, as Explorer does when you copy them: paste them into a folder, a chat, an email.</summary>
    public static bool CopyFiles(IReadOnlyList<string> paths)
    {
        // DROPFILES: where the names start (20), a point and a flag we do not use, and "the names are UTF-16";
        // then the names, each ending with a 0, and one more 0 at the end
        var names = System.Text.Encoding.Unicode.GetBytes(string.Join("\0", paths) + "\0\0");
        var drop = Native.GlobalAlloc(0x0042, (UIntPtr)(20 + names.Length)); // movable, zeroed
        var p = Native.GlobalLock(drop);
        Marshal.WriteInt32(p, 0, 20);
        Marshal.WriteInt32(p, 16, 1);
        Marshal.Copy(names, 0, p + 20, names.Length);
        Native.GlobalUnlock(drop);
        var effect = Native.GlobalAlloc(0x0042, (UIntPtr)4);
        Marshal.WriteInt32(Native.GlobalLock(effect), 1); // DROPEFFECT_COPY: pasting copies, it does not move
        Native.GlobalUnlock(effect);
        try
        {
            return WithClipboard(() =>
            {
                Native.EmptyClipboard();
                // once the clipboard has them, they belong to Windows: not freed here
                if (Native.SetClipboardData(CF_HDROP, drop) == IntPtr.Zero) return false;
                drop = IntPtr.Zero;
                if (Native.SetClipboardData(dropEffect, effect) != IntPtr.Zero) effect = IntPtr.Zero;
                return true;
            });
        }
        finally
        {
            if (drop != IntPtr.Zero) Native.GlobalFree(drop);
            if (effect != IntPtr.Zero) Native.GlobalFree(effect);
        }
    }

    /// <summary>The text in an image (Windows' own text recognition, offline, in the languages of your Windows).</summary>
    public static string Ocr(string path)
    {
        var engine = OcrEngine.TryCreateFromUserProfileLanguages() ?? throw new Exception("Windows has no text recognition for your languages");
        var file = StorageFile.GetFileFromPathAsync(path).AsTask().Result;
        using var stream = file.OpenAsync(FileAccessMode.Read).AsTask().Result;
        var decoder = BitmapDecoder.CreateAsync(stream).AsTask().Result;
        using var bitmap = decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied).AsTask().Result;
        var result = engine.RecognizeAsync(bitmap).AsTask().Result;
        return string.Join("\n", result.Lines.Select(l => l.Text));
    }
}
