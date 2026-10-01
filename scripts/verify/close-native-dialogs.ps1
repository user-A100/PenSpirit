# Close native dialogs (Win32 class #32770: file pickers / message boxes) left open by the app process.
# The app's own dialogs are web-based, so any visible #32770 owned by bixian.exe is a leftover from verification.
# Prints the number closed. WM_CLOSE on a file dialog = Cancel (nothing is written).
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class VerifyDialogs {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int Close(uint pid) {
    int n = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() == "#32770") { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); n++; }
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
$total = 0
foreach ($p in Get-Process bixian -ErrorAction SilentlyContinue) { $total += [VerifyDialogs]::Close([uint32]$p.Id) }
Write-Output $total
