// postgres.exe refuses a token in which Administrators is enabled. pg_ctl and
// initdb start it from a restricted copy of their own token with that group
// (and Power Users) disabled; this fixed program does the same for a service
// the supervisor runs, so the service stays its child and keeps its pipes.
// The command line arrives on stdin, never in argv.
export const WITHOUT_ADMINISTRATORS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# Progress records would reach the service log as CLIXML.
$ProgressPreference = 'SilentlyContinue'
try {
  # A caller's PowerShell 7 modules can prevent Add-Type from loading.
  $env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  $command = [string]([Console]::In.ReadToEnd() | ConvertFrom-Json)
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class LingerWithoutAdministrators {
  [StructLayout(LayoutKind.Sequential)]
  struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableCount, SidAndAttributes[] disable,
    uint deleteCount, IntPtr delete, uint restrictCount, IntPtr restrict, out IntPtr restricted);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int infoClass, ref IntPtr info, int length);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUserW(IntPtr token, string application, StringBuilder commandLine,
    IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
    string directory, ref StartupInfo startup, out ProcessInformation process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out int code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static byte[] Binary(SecurityIdentifier sid) {
    byte[] bytes = new byte[sid.BinaryLength];
    sid.GetBinaryForm(bytes, 0);
    return bytes;
  }

  public static int Run(string commandLine) {
    IntPtr token, restricted;
    if (!OpenProcessToken(GetCurrentProcess(), 0xF01FF, out token)) throw new Win32Exception();
    SecurityIdentifier[] disabled = {
      new SecurityIdentifier("S-1-5-32-544"), new SecurityIdentifier("S-1-5-32-547") };
    GCHandle[] pins = new GCHandle[disabled.Length];
    SidAndAttributes[] disable = new SidAndAttributes[disabled.Length];
    try {
      for (int i = 0; i < disabled.Length; i++) {
        pins[i] = GCHandle.Alloc(Binary(disabled[i]), GCHandleType.Pinned);
        disable[i].Sid = pins[i].AddrOfPinnedObject();
      }
      if (!CreateRestrictedToken(token, 0, (uint)disable.Length, disable, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted))
        throw new Win32Exception();
    } finally {
      foreach (GCHandle pin in pins) if (pin.IsAllocated) pin.Free();
      CloseHandle(token);
    }
    // An elevated token's default DACL grants Administrators, now deny-only,
    // and SYSTEM. PostgreSQL's processes must open each other's objects, so
    // the user is granted too, as pg_ctl does.
    RawAcl acl = new RawAcl(GenericAcl.AclRevision, 3);
    SecurityIdentifier[] granted = {
      WindowsIdentity.GetCurrent().User, new SecurityIdentifier("S-1-5-18"), new SecurityIdentifier("S-1-5-32-544") };
    for (int i = 0; i < granted.Length; i++)
      acl.InsertAce(i, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, granted[i], false, null));
    byte[] dacl = new byte[acl.BinaryLength];
    acl.GetBinaryForm(dacl, 0);
    GCHandle daclPin = GCHandle.Alloc(dacl, GCHandleType.Pinned);
    try {
      IntPtr defaultDacl = daclPin.AddrOfPinnedObject();
      if (!SetTokenInformation(restricted, 6, ref defaultDacl, IntPtr.Size)) throw new Win32Exception();
    } finally { daclPin.Free(); }
    StartupInfo startup = new StartupInfo();
    startup.cb = Marshal.SizeOf(typeof(StartupInfo));
    startup.dwFlags = 0x100;
    startup.hStdInput = GetStdHandle(-10);
    startup.hStdOutput = GetStdHandle(-11);
    startup.hStdError = GetStdHandle(-12);
    ProcessInformation child;
    bool started = CreateProcessAsUserW(restricted, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero,
      true, 0, IntPtr.Zero, null, ref startup, out child);
    int error = Marshal.GetLastWin32Error();
    CloseHandle(restricted);
    if (!started) throw new Win32Exception(error);
    CloseHandle(child.hThread);
    WaitForSingleObject(child.hProcess, 0xFFFFFFFF);
    int code;
    GetExitCodeProcess(child.hProcess, out code);
    CloseHandle(child.hProcess);
    return code;
  }
}
'@
  exit ([LingerWithoutAdministrators]::Run($command))
} catch {
  # Plain output: it reaches the service log even where PowerShell runs in
  # Constrained Language mode and refuses Add-Type.
  'Could not start the service with Administrators disabled: ' + $_.Exception.Message
  exit 1
}
`;

/**
 * The command line that the Microsoft C runtime, which PostgreSQL's tools use,
 * splits back into exactly `executable` and `args`.
 */
export function windowsCommandLine(executable: string, args: string[]) {
  return [executable, ...args]
    .map((value) =>
      value && !/[\s"]/.test(value)
        ? value
        : `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`,
    )
    .join(" ");
}
