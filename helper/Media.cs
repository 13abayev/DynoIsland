using System.Text.Json.Nodes;
using Windows.Graphics.Imaging;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Island;

// What is playing, through Windows' own media controls (the ones behind the volume flyout): any player that
// shows up there works, like Spotify, YouTube in the browser, or VLC.
static class Media
{
    static GlobalSystemMediaTransportControlsSessionManager? manager;
    static string coverFor = "", cover = "";

    static GlobalSystemMediaTransportControlsSession? Current()
    {
        manager ??= GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().Result;
        return manager.GetCurrentSession();
    }

    /// <summary>What plays now, or { has: false }. The cover is a small PNG (data URL), read again only for a new song.</summary>
    public static JsonObject Now()
    {
        var s = Current();
        if (s == null) return new JsonObject { ["has"] = false };
        var props = s.TryGetMediaPropertiesAsync().AsTask().Result;
        var info = s.GetPlaybackInfo();
        var line = s.GetTimelineProperties();
        var key = $"{s.SourceAppUserModelId}|{props.Title}|{props.Artist}";
        if (key != coverFor)
        {
            coverFor = key;
            cover = props.Thumbnail != null ? Cover(props.Thumbnail) : "";
        }
        return new JsonObject
        {
            ["has"] = !string.IsNullOrEmpty(props.Title),
            ["title"] = props.Title ?? "",
            ["artist"] = props.Artist ?? "",
            ["album"] = props.AlbumTitle ?? "",
            ["app"] = AppName(s.SourceAppUserModelId ?? ""),
            ["playing"] = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
            ["canNext"] = info.Controls.IsNextEnabled,
            ["canPrev"] = info.Controls.IsPreviousEnabled,
            ["position"] = line.Position.TotalSeconds,
            ["duration"] = (line.EndTime - line.StartTime).TotalSeconds,
            ["positionAt"] = line.LastUpdatedTime.ToUnixTimeMilliseconds(),
            ["cover"] = cover,
        };
    }

    public static bool Control(string action)
    {
        var s = Current();
        if (s == null) return false;
        return (action switch
        {
            "play" => s.TryPlayAsync(),
            "pause" => s.TryPauseAsync(),
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            _ => throw new Exception("unknown media action"),
        }).AsTask().Result;
    }

    static string AppName(string id)
    {
        var name = id.Split('!')[0].Split('\\').Last();
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var known = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["spotify"] = "Spotify", ["chrome"] = "Chrome", ["msedge"] = "Edge", ["firefox"] = "Firefox",
            ["vlc"] = "VLC", ["brave"] = "Brave", ["opera"] = "Opera",
        };
        foreach (var (k, v) in known) if (name.Contains(k, StringComparison.OrdinalIgnoreCase)) return v;
        return name.Split('.').Last();
    }

    /// <summary>The cover art, scaled to 96 px, as a PNG data URL.</summary>
    static string Cover(IRandomAccessStreamReference thumb)
    {
        try
        {
            using var stream = thumb.OpenReadAsync().AsTask().Result;
            var decoder = BitmapDecoder.CreateAsync(stream).AsTask().Result;
            var scale = 96.0 / Math.Max(decoder.PixelWidth, decoder.PixelHeight);
            var transform = new BitmapTransform
            {
                ScaledWidth = (uint)Math.Max(1, decoder.PixelWidth * scale),
                ScaledHeight = (uint)Math.Max(1, decoder.PixelHeight * scale),
                InterpolationMode = BitmapInterpolationMode.Fant,
            };
            var pixels = decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform,
                ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage).AsTask().Result;
            using var output = new InMemoryRandomAccessStream();
            var encoder = BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, output).AsTask().Result;
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform.ScaledWidth, transform.ScaledHeight, 96, 96, pixels.DetachPixelData());
            encoder.FlushAsync().AsTask().Wait();
            var bytes = new byte[output.Size];
            using var reader = new DataReader(output.GetInputStreamAt(0));
            reader.LoadAsync((uint)output.Size).AsTask().Wait();
            reader.ReadBytes(bytes);
            return "data:image/png;base64," + Convert.ToBase64String(bytes);
        }
        catch { return ""; }
    }
}
