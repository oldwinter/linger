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
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfoEx {
    public StartupInfo StartupInfo;
    public IntPtr lpAttributeList;
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
    string directory, ref StartupInfoEx startup, out ProcessInformation process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value,
    IntPtr size, IntPtr previous, IntPtr returnSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out int code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static byte[] Binary(SecurityIdentifier sid) {
    byte[] bytes = new byte[sid.BinaryLength];
    sid.GetBinaryForm(bytes, 0);
    return bytes;
  }

  static IntPtr[] CollectStdHandles(IntPtr stdin, IntPtr stdout, IntPtr stderr) {
    IntPtr invalid = new IntPtr(-1);
    IntPtr[] raw = { stdin, stdout, stderr };
    IntPtr[] unique = new IntPtr[3];
    int count = 0;
    foreach (IntPtr handle in raw) {
      if (handle == IntPtr.Zero || handle == invalid) continue;
      bool duplicate = false;
      for (int i = 0; i < count; i++) if (unique[i] == handle) { duplicate = true; break; }
      if (duplicate) continue;
      uint flags;
      if (!GetHandleInformation(handle, out flags)) continue;
      if ((flags & 1u) == 0 && !SetHandleInformation(handle, 1u, 1u)) continue;
      unique[count++] = handle;
    }
    IntPtr[] result = new IntPtr[count];
    Array.Copy(unique, result, count);
    return result;
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
    IntPtr stdIn = GetStdHandle(-10);
    IntPtr stdOut = GetStdHandle(-11);
    IntPtr stdErr = GetStdHandle(-12);
    IntPtr[] inheritList = CollectStdHandles(stdIn, stdOut, stdErr);
    StartupInfoEx startup = new StartupInfoEx();
    startup.StartupInfo.cb = Marshal.SizeOf(typeof(StartupInfoEx));
    IntPtr attrList = IntPtr.Zero;
    bool attrListInitialized = false;
    GCHandle listPin = default(GCHandle);
    bool inheritHandles = inheritList.Length > 0;
    uint creationFlags = 0;
    ProcessInformation child = new ProcessInformation();
    bool started = false;
    int error = 0;
    try {
      if (inheritHandles) {
        startup.StartupInfo.dwFlags = 0x100;
        startup.StartupInfo.hStdInput = stdIn;
        startup.StartupInfo.hStdOutput = stdOut;
        startup.StartupInfo.hStdError = stdErr;
        IntPtr attrSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
        if (attrSize == IntPtr.Zero) throw new Win32Exception();
        attrList = Marshal.AllocHGlobal(attrSize);
        if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize)) throw new Win32Exception();
        attrListInitialized = true;
        listPin = GCHandle.Alloc(inheritList, GCHandleType.Pinned);
        // Restrict inheritance strictly to stdio handles via PROC_THREAD_ATTRIBUTE_HANDLE_LIST.
        if (!UpdateProcThreadAttribute(attrList, 0, (IntPtr)0x00020002, listPin.AddrOfPinnedObject(),
          (IntPtr)(inheritList.Length * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
          throw new Win32Exception();
        startup.lpAttributeList = attrList;
        creationFlags = 0x00080000;
      }
      started = CreateProcessAsUserW(restricted, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero,
        inheritHandles, creationFlags, IntPtr.Zero, null, ref startup, out child);
      error = Marshal.GetLastWin32Error();
    } finally {
      if (listPin.IsAllocated) listPin.Free();
      if (attrListInitialized) DeleteProcThreadAttributeList(attrList);
      if (attrList != IntPtr.Zero) Marshal.FreeHGlobal(attrList);
      CloseHandle(restricted);
    }
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
