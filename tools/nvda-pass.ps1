<#
.SYNOPSIS
  Captures what NVDA actually says while walking the six routes Ledger claims.

.DESCRIPTION
  The other half of tools/a11y-sweep.mjs. That one reads Chrome's accessibility
  tree, which is what a screen reader consumes; this one reads what NVDA
  produces from it, which is not the same thing and is where the last of the
  bugs live. NVDA applies its own browse mode, its own table navigation and its
  own rules about when a live region is announced, and none of that is visible
  in the tree.

  Ledger's version is scene-based rather than one long tab run, because the
  claims this build makes are about specific things: a disclosure that
  announces its state, a chart that announces its shape rather than its two
  hundred rectangles, a result count a reader can actually reach, a sorted
  column header, three captioned tables, and a download. Each scene loads a
  URL, sends a fixed key sequence, and writes what NVDA said to its own file.
  The transcript is the finding; a pass with no transcript is not a pass.

  Several scenes exist because of what an earlier run of this script found, and
  they are kept as regressions rather than deleted once fixed. The `read-main-*`
  scenes are the ones that earned their place: a whitespace-only text node
  between two elements renders correctly and is dropped from the accessibility
  text, which no automated checker can see -- every automated checker is
  reading the DOM, and the DOM is fine.

  NVDA is started against a scratch configuration with the `silence` synth, so
  it logs every utterance at DEBUG level without saying any of it out loud, and
  never touches the real NVDA profile. Keystrokes go through SendKeys so that
  NVDA's keyboard hook sees them -- CDP-synthesised keys bypass the OS hook
  entirely and browse mode never engages, which makes a CDP-driven "NVDA test"
  a test of something else.

  REQUIRES THE FOREGROUND. NVDA reads whatever window is focused, so Chrome has
  to be able to come to the front. Anything else holding the foreground will
  silently produce an empty transcript -- the script checks for this and stops
  rather than reporting a pass it did not perform.

.PARAMETER Only
  Run a subset of scenes by name. Default is all of them.

.EXAMPLE
  npm run build; npm start
  pwsh tools/nvda-pass.ps1
  pwsh tools/nvda-pass.ps1 -Only chart-figures,result-count
#>
param(
  [string]$BaseUrl = "http://localhost:3003",
  [string]$OutDir = "$env:TEMP\ledger-nvda",
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"

$nvda = "C:\Program Files\NVDA\nvda.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
foreach ($exe in @($nvda, $chrome)) {
  if (-not (Test-Path $exe)) { throw "Not found: $exe" }
}

<#
  The six routes from LEDGER-SIGNOFF.md, one scene each, plus a plain tab walk
  of the overview so the order a keyboard user meets things in is on the record
  too.

  `keys` are SendKeys strings. The single letters are NVDA browse-mode quick
  navigation: g = next graphic, t = next table, k = next link, x = next
  checkbox, f = next form field. ^%{RIGHT} and friends are NVDA's table
  navigation, which is the only way to move cell by cell and is the thing that
  has to work if "navigable by row and column" is going to be a true sentence.
#>
$scenes = @(
  @{
    <#
      Reached with `k` rather than with Tab, and that is not fussiness.

      Every way of *navigating* to it lands past it. Ctrl+Home leaves the
      browse cursor on the skip link, and both Tab and `k` move to the next
      thing after the cursor -- so the first link they find is the wordmark,
      and the scene reports the wrong stop while looking like it worked. Down
      then Up is the way to hear the line the cursor is already on: it steps
      off and steps back, and NVDA re-announces on arrival.

      The Tab at the end is the actual assertion. If activating the skip link
      moved focus into <main>, the next stop is the first chart's disclosure.
      If it only scrolled -- the classic failure, and one this build shipped
      once -- the next stop is the second item in the header instead.
    #>
    name = "skip-link"
    url  = "/"
    why  = "The first stop of all, and whether pressing it actually moves focus."
    keys = @("{DOWN}", "{UP}", "{ENTER}", "{TAB}")
  },
  @{
    name = "tab-order-overview"
    url  = "/"
    why  = "The order a keyboard user meets the overview in, and what each stop says."
    keys = @("{TAB}") * 8
  },
  @{
    name = "chart-figures"
    url  = "/"
    why  = "Claim 2: the figure announces its shape, and the SVG internals are silent."
    keys = @("g", "g", "g")
  },
  @{
    # Five tabs, not six. Six lands on the movement chart's disclosure; the
    # signoff route names the MRR one, "View the 24 monthly figures as a table".
    name = "chart-disclosure"
    url  = "/"
    why  = "Claim 1: the disclosure announces its expanded state and opens a real table."
    keys = @("{TAB}") * 5 + @("{ENTER}", "{DOWN}", "{DOWN}")
  },
  @{
    # The {DOWN} after `t` is not padding. NVDA's `t` leaves the browse cursor
    # on the caption, which is inside the table and not inside a cell, so table
    # navigation from there answers "not in a table cell" on any captioned
    # table anywhere. One arrow down is what a reader does next, and it is what
    # puts the cursor in the first cell.
    name = "chart-table-navigation"
    url  = "/"
    why  = "Claim 1: the table behind the disclosure is navigable by row and column."
    keys = @("{TAB}") * 5 + @("{ENTER}", "t") + @("{DOWN}") * 4 +
           @("^%{RIGHT}", "^%{RIGHT}", "^%{DOWN}", "^%{LEFT}", "^%{UP}")
  },
  @{
    <#
      x ticks the first plan checkbox in browse mode, then Ctrl+End and
      Shift+B walk *backwards* to the last button on the page, which is the
      form's own "Apply filters".

      Not forwards. Going forwards from the checkbox, the next two buttons are
      Chrome's own "Show date picker" on the two native date inputs, and Enter
      opens the calendar widget, which then eats the rest of the scene. The
      first attempt at this did exactly that and produced a transcript of a
      date picker.

      Nothing is pressed after Enter. The question this scene asks is what a
      reader hears when they have done nothing further, so the only thing after
      the submit is a wait.
    #>
    name = "result-count-on-filter"
    url  = "/customers"
    why  = "Claim 3: applying a filter announces the count without going looking for it."
    keys = @("x", " ", "^{END}", "+b", "{ENTER}", "{PAUSE:8000}")
  },
  @{
    <#
      The scene that changed the build.

      Sorting used to be a `next/link` client-side navigation. The document was
      never torn down, so there was no page-load announcement, and the live
      region did not fire either: four thousand rows re-sorted underneath the
      reader in complete silence. Sorting is a plain `<a>` now, and this scene
      is what holds it that way -- if the silence comes back, it comes back
      here first.
    #>
    name = "result-count-after-sort"
    url  = "/customers"
    why  = "Does sorting the table tell the reader anything happened?"
    # The `t` at the end is the control. If the caption it reads back has
    # changed, the sort really happened and the silence before it is the
    # finding. If it has not, the Enter did nothing and the scene proves
    # nothing -- which is a distinction worth being able to make.
    keys = @("t", "k", "{ENTER}", "{PAUSE:8000}", "^{HOME}", "t")
  },
  @{
    # Forty arrows, because the count sits below the whole filter panel and
    # the point of the scene is how far down it is.
    name = "result-count-arrived-at"
    url  = "/customers?country=GB&status=active"
    why  = "Claim 3, read directly: how far a reader travels to reach the count."
    keys = @("{DOWN}") * 40
  },
  @{
    # MRR is the seventh column and the one that carries aria-sort on this URL.
    # Table navigation across to it is how a reader compares columns, so it is
    # the reading that decides whether the sort state ever reaches them.
    name = "sort-header-by-table-nav"
    url  = "/customers?sort=mrr&dir=desc"
    why  = "Claim 4: does aria-sort reach the reader who navigates the header row?"
    keys = @("t") + @("{DOWN}") * 4 + @("^%{RIGHT}") * 6
  },
  @{
    # The same header, reached with Tab, which is the other way in. Tab lands
    # on the link inside the th rather than on the th itself, and whether the
    # cell's aria-sort comes with it is the whole question.
    name = "sort-header-by-tab"
    url  = "/customers?sort=mrr&dir=desc"
    why  = "Claim 4 by the other route: tabbing onto the sorted column's link."
    keys = @("t") + @("{DOWN}") * 4 + @("{TAB}") * 7
  },
  @{
    name = "customer-detail-tables"
    url  = "/customers/beacon-studio-plc"
    why  = "Claim 5: the three tables on the detail page announce their captions."
    keys = @("t", "t", "t", "t")
  },
  @{
    name = "csv-download"
    url  = "/customers?country=GB"
    why  = "Claim 6: the export link says what it will do before it is pressed."
    keys = @("k") * 9
  },
  @{
    name = "empty-state"
    url  = "/customers?mrrMin=9999999"
    why  = "The no-rows state has to name the filters, not just say no."
    keys = @("^{END}") + @("{UP}") * 12
  },
  <#
    Whole-page reads, one announcement each.

    Activating the skip link moves focus to <main>, and NVDA announces a newly
    focused landmark by reading the whole of it in one go. That is the only
    view in this file that shows the *joins* between text nodes rather than the
    lines they wrap onto -- and the joins are where the defect lives. Arrowing
    down these same pages line by line showed nothing wrong, because a visual
    line break supplies the space that the accessibility text had dropped.

    "MRR grew from £818,365 to£3,439,147" was found this way and nowhere else.
  #>
  @{
    name = "read-main-overview"
    url  = "/"
    why  = "The whole overview as one announcement, joins and all."
    keys = @("{DOWN}", "{UP}", "{ENTER}")
  },
  @{
    name = "read-main-cohorts"
    url  = "/cohorts"
    why  = "The whole cohorts page as one announcement."
    keys = @("{DOWN}", "{UP}", "{ENTER}")
  },
  @{
    name = "read-main-detail"
    url  = "/customers/beacon-studio-plc"
    why  = "The whole customer page as one announcement."
    keys = @("{DOWN}", "{UP}", "{ENTER}")
  },
  @{
    name = "read-main-not-found"
    url  = "/no-such-page"
    why  = "The 404 as one announcement."
    keys = @("{DOWN}", "{UP}", "{ENTER}")
  },
  @{
    name = "result-count-line"
    url  = "/customers?country=GB&status=active"
    why  = "The count is now the first thing after the heading. How does it read?"
    keys = @("{DOWN}") * 9
  },
  @{
    name = "pagination"
    url  = "/customers?page=2"
    why  = "The range and the page number are the only way to know where you are."
    keys = @("^{END}") + @("{UP}") * 10
  },
  @{
    name = "cohort-grid"
    url  = "/cohorts"
    why  = "The grid is a table outright. It has to read as one."
    keys = @("t") + @("{DOWN}") * 4 + @("^%{RIGHT}", "^%{RIGHT}", "^%{DOWN}", "^%{DOWN}")
  }
)

if ($Only.Count -gt 0) {
  $scenes = $scenes | Where-Object { $Only -contains $_.name }
  if (-not $scenes) { throw "No scene matched -Only" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cfg = Join-Path $OutDir "nvda-config"
$log = Join-Path $OutDir "nvda.log"
$prof = Join-Path $OutDir "chrome-profile"
<#
  Stop anything this script left behind last time before touching its files.

  A scene that throws skips the cleanup at the bottom, so NVDA stays running
  and keeps the log file open, and the next run dies on Remove-Item with an
  error about the log rather than about the thing that actually went wrong.
  The Finally block below is the real fix; this is the belt to its braces, and
  it also covers the case where the run was killed from outside.
#>
Get-Process nvda -ErrorAction SilentlyContinue | ForEach-Object {
  Start-Process $nvda -ArgumentList "-q" | Out-Null
}
Start-Sleep -Seconds 3
Get-Process nvda -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $cfg | Out-Null
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }

<#
  A fresh profile every run.

  The cleanup at the bottom of this script stops Chrome with Stop-Process,
  which Chrome cannot tell apart from a crash, so the next run opens with a
  "Restore pages?" bubble sitting in front of the page with focus inside it.
  Every keystroke the run then sends goes to that bubble, and the transcript is
  of a Chrome dialog rather than of Ledger. The crash-restore flags below cover
  it as well, because a profile can be left dirty by something other than this
  script.
#>
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }

# The silence synth logs speech without producing any. symbolLevel 100 (all)
# so punctuation in the announcements is visible in the transcript.
@'
schemaVersion = 13
[speech]
	synth = silence
	symbolLevel = 100
[braille]
	display = noBraille
[general]
	showWelcomeDialogAtStartup = False
	playStartAndExitSounds = False
	askToExit = False
	saveConfigurationOnExit = False
[update]
	autoCheck = False
'@ | Out-File -FilePath (Join-Path $cfg "nvda.ini") -Encoding utf8

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public static string TitleOf(IntPtr h) {
    var sb = new StringBuilder(300);
    GetWindowText(h, sb, 300);
    return sb.ToString();
  }
  public static string ForegroundTitle() { return TitleOf(GetForegroundWindow()); }

  /*
    Windows refuses SetForegroundWindow from a process that did not produce the
    last input, which is exactly this script's position: it is driven from a
    terminal and the user has not touched Chrome. The two documented ways round
    it are to tap a key first, so this process is the one that most recently
    produced input, and to attach to the foreground window's input queue so the
    two threads share focus state. Both are used, because either alone fails on
    some configurations, and it is retried because window activation is racy.

    Returns true only if Chrome's own handle is the foreground window at the
    end. A title comparison is not good enough -- Chrome rewrites its title as
    a page loads, so a run can be rejected for a difference that is not one.
  */
  public static bool Focus(IntPtr h) {
    for (int i = 0; i < 8; i++) {
      keybd_event(0x12, 0, 0, IntPtr.Zero);        // ALT down
      keybd_event(0x12, 0, 2, IntPtr.Zero);        // ALT up
      ShowWindow(h, 9);                            // SW_RESTORE
      uint me = GetCurrentThreadId();
      uint owner = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
      bool attached = owner != 0 && owner != me && AttachThreadInput(me, owner, true);
      SetForegroundWindow(h);
      if (attached) AttachThreadInput(me, owner, false);
      System.Threading.Thread.Sleep(600);
      if (GetForegroundWindow() == h) return true;
    }
    return false;
  }
}
'@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

<#
  Chrome windows belonging to this run's scratch profile.

  Matched on the profile directory in the command line rather than on the
  window title, because the title is not ours to rely on: any tab whose title
  contains "Ledger" -- a Vercel dashboard, a GitHub page, this repository in an
  editor -- would otherwise be driven instead, and NVDA would faithfully
  transcribe it.
#>
function ProfileWindows([string]$ProfilePath) {
  $ids = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like ("*" + $ProfilePath + "*") } |
    Select-Object -ExpandProperty ProcessId
  if (-not $ids) { return @() }
  Get-Process -Id $ids -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle }
}

function Speech([int]$From) {
  Get-Content $log -Encoding UTF8 |
    Select-Object -Skip $From |
    Where-Object { $_ -like "Speaking*" } |
    ForEach-Object {
      $_ -replace "^Speaking \[", "" `
         -replace ", CancellableSpeech.*$", "" `
         -replace "LangChangeCommand \('[a-z_]+'\), ", "" `
         -replace "^'|'\]$", ""
    }
}

function LogLines { (Get-Content $log -Encoding UTF8 | Measure-Object -Line).Lines }

<#
  Is keyboard focus inside the page rather than in Chrome's own chrome?

  Asked through UI Automation, which reports the focused element for the whole
  desktop. Anything inside the rendered document has the "document" control
  type somewhere above it; the omnibox does not. Guessing this from a fixed
  number of F6 presses is what broke the first run.
#>
function InDocument {
  try {
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $el) { return $false }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 12 -and $el; $i++) {
      $ct = $el.Current.ControlType
      if ($ct -eq [System.Windows.Automation.ControlType]::Document) { return $true }
      if ($el.Current.ClassName -eq "Chrome_RenderWidgetHostHWND") { return $true }
      $el = $walker.GetParent($el)
    }
    return $false
  } catch { return $false }
}

Write-Host "Starting NVDA (silent) ..."
Start-Process $nvda -ArgumentList @("-c", "`"$cfg`"", "-f", "`"$log`"", "-l", "10", "-m", "--no-sr-flag")
Start-Sleep -Seconds 12
if (-not (Get-Process nvda -ErrorAction SilentlyContinue)) { throw "NVDA did not start" }

Write-Host "Opening Chrome ..."
Start-Process $chrome -ArgumentList @(
  "--user-data-dir=`"$prof`"", "--no-first-run", "--no-default-browser-check",
  "--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
  "--disable-features=Translate,MediaRouter", "--disable-notifications", "--no-default-browser-check",
  "--new-window", "--window-size=1400,1000", "$BaseUrl/"
) | Out-Null
Start-Sleep -Seconds 10

$win = $null
for ($try = 0; $try -lt 20; $try++) {
  $win = ProfileWindows $prof | Select-Object -First 1
  if ($win) { break }
  Start-Sleep -Seconds 1
}
if (-not $win) { throw "Chrome never opened a window under $prof" }
if ($win.MainWindowTitle -notlike "*Ledger*") {
  Start-Process $nvda -ArgumentList "-q" | Out-Null
  throw ("The scratch-profile window is '" + $win.MainWindowTitle + "', not Ledger. " +
         "The site did not load; a run from here would transcribe the wrong page.")
}

$hwnd = $win.MainWindowHandle
if (-not [Win]::Focus($hwnd)) {
  Start-Process $nvda -ArgumentList "-q" | Out-Null
  throw ("Chrome could not take the foreground -- '" + [Win]::ForegroundTitle() + "' is " +
         "holding it. NVDA reads the focused window, so this run would produce an empty " +
         "transcript and a false pass. Close or minimise that window and run again.")
}

$empty = @()
$polluted = @()
try {
foreach ($scene in $scenes) {
  $url = $BaseUrl + $scene.url
  Write-Host ""
  Write-Host ("=== " + $scene.name + " -- " + $url)
  Write-Host ("    " + $scene.why)

  if (-not [Win]::Focus($hwnd)) {
    Start-Process $nvda -ArgumentList "-q" | Out-Null
    throw ("Lost the foreground to '" + [Win]::ForegroundTitle() + "' before scene " +
           $scene.name + ". Stopping rather than transcribing another window.")
  }

  # Ctrl+L, type the URL, Enter. Going through the address bar rather than
  # opening a new window keeps NVDA's virtual buffer lifecycle the same as a
  # real reader's, which is the thing under test in the live-region scene.
  [System.Windows.Forms.SendKeys]::SendWait("^l")
  Start-Sleep -Milliseconds 600
  [System.Windows.Forms.SendKeys]::SendWait($url.Replace("&", "{&}") + "{ENTER}")
  Start-Sleep -Seconds 6

  <#
    Focus stays in the omnibox after Enter, so it has to be handed to the
    document explicitly. F6 cycles Chrome's focus rings and the number of stops
    depends on whether the bookmarks bar is showing, so it is pressed until the
    document has it rather than a fixed number of times -- a fixed count that is
    wrong by one types the scene's keys into the address bar, and browse-mode
    quick navigation then reads as somebody spelling "g" out loud. That is what
    the first run of this script did.

    Ctrl+Home then puts the browse cursor at the top of the document so every
    scene starts from the same place rather than wherever the last one left it.
  #>
  # Checked before the first F6 as well as after each one. Chrome sometimes
  # hands focus to the document on its own once the load settles, and an
  # unconditional F6 then takes it back out again -- which is what made this
  # fail intermittently rather than every time.
  $inDoc = InDocument
  for ($f = 0; $f -lt 10 -and -not $inDoc; $f++) {
    [System.Windows.Forms.SendKeys]::SendWait("{F6}")
    Start-Sleep -Milliseconds 700
    $inDoc = InDocument
  }
  if (-not $inDoc) {
    Start-Process $nvda -ArgumentList "-q" | Out-Null
    throw ("Could not move focus into the document for scene " + $scene.name +
           ". The keys would have gone to the browser chrome and the transcript " +
           "would be of Chrome, not of Ledger.")
  }
  if ($scene.home -ne $false) {
    [System.Windows.Forms.SendKeys]::SendWait("^{HOME}")
    Start-Sleep -Seconds 2
  }

  $mark = LogLines
  foreach ($key in $scene.keys) {
    # {PAUSE:n} is a wait, not a keystroke. A scene that asks "is anything
    # announced on its own?" cannot answer it by pressing a key, because the
    # key produces an announcement of its own and hides the answer.
    if ($key -match '^\{PAUSE:(\d+)\}$') {
      Start-Sleep -Milliseconds ([int]$Matches[1])
      continue
    }
    [System.Windows.Forms.SendKeys]::SendWait($key)
    Start-Sleep -Milliseconds 750
  }
  Start-Sleep -Seconds 2

  <#
    Was Chrome still the foreground window when the keys finished?

    Checked after the scene as well as before it, because the foreground can be
    taken part way through -- an editor rebuilding, a notification -- and NVDA
    then transcribes that window instead. A run of this script did exactly that
    and produced a transcript containing Visual Studio Code's file tree, which
    looks like a result until it is read. A scene that lost the foreground is
    marked and re-run rather than reported.
  #>
  if ([Win]::ForegroundTitle() -ne [Win]::TitleOf($hwnd)) {
    $polluted += $scene.name
    Write-Host ("  !! foreground was taken by '" + [Win]::ForegroundTitle() +
                "' during this scene -- transcript is not trustworthy")
  }

  $transcript = Speech $mark
  if ($transcript.Count -eq 0) {
    $empty += $scene.name
    Write-Host "  (nothing -- NVDA saw no focus or cursor changes, which is a failure)"
  } else {
    $transcript | ForEach-Object { Write-Host ("  " + $_) }
  }

  $header = @(
    "# " + $scene.name,
    "",
    $scene.why,
    "",
    "URL: " + $url,
    "Keys: " + ($scene.keys -join " "),
    "",
    "---",
    ""
  )
  ($header + $transcript) | Out-File -FilePath (Join-Path $OutDir ($scene.name + ".txt")) -Encoding utf8
}

Write-Host ""
Write-Host ("Transcripts: " + $OutDir)
if ($empty.Count -gt 0) {
  Write-Host ("EMPTY SCENES (not a pass): " + ($empty -join ", "))
}
if ($polluted.Count -gt 0) {
  Write-Host ("POLLUTED SCENES (re-run these): " + ($polluted -join ", "))
}
}
finally {
  # Runs whether the pass finished or a scene threw. Leaving NVDA running is
  # not a cosmetic problem: it holds the log open, so the next run fails on a
  # file lock and reports that instead of the real fault.
  Start-Process $nvda -ArgumentList "-q" -ErrorAction SilentlyContinue | Out-Null
  Start-Sleep -Seconds 2
  ProfileWindows $prof | Stop-Process -Force -ErrorAction SilentlyContinue
}
