param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -OutputAssembly $Output -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
public static class UpdateProbe {
  public static void Main(string[] args) {
    var marker = Environment.GetEnvironmentVariable("TORCHLIGHT_UPDATE_TEST_MARKER");
    if (String.IsNullOrEmpty(marker)) return;
    if (args.Length > 0 && args[0] == "hold") { File.WriteAllText(marker + ".holding", "ready"); Thread.Sleep(30000); return; }
    using(var sha = SHA256.Create()) {
      var digest = BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Assembly.GetExecutingAssembly().Location))).Replace("-", "").ToLowerInvariant();
      File.WriteAllText(marker, digest + "\n" + String.Join("|", args));
    }
  }
}
'@
