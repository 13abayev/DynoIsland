using System.Text;

namespace Island;

// Island's Windows helper, run as "dotnet IslandHelper.dll <job>". One small program, these jobs:
//   serve               runs while Island runs: reports the window in front, finds and focuses windows
//                       (one JSON object per line on stdin/stdout)
//   hook <agent> [wait] a Claude Code / Codex hook on Windows: forwards the event to Island, plus the window it runs in;
//                       with "wait" (a permission prompt) it waits for your answer in the island and prints it
//   reply <agent>       a background Stop hook: waits for a reply you type in the island (exit code 2 passes it on)
//   statusline <agent>  Claude Code's status line on Windows: forwards your usage limits to Island, prints a short line
static class Program
{
    static int Main(string[] args)
    {
        var mode = args.Length > 0 ? args[0] : "";
        var agent = args.Length > 1 ? args[1] : "claude";
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            return mode switch
            {
                "serve" => Serve.Run(),
                "hook" => Hook.Run(agent, args.Length > 2 && args[2] == "wait"),
                "reply" => Reply.Run(agent),
                "statusline" => StatusLine.Run(agent),
                _ => 2,
            };
        }
        catch (Exception e) when (mode != "serve")
        {
            // a hook or status line must never break Claude Code: report and carry on
            Console.Error.WriteLine("Island: " + e.Message);
            return 0;
        }
    }
}
