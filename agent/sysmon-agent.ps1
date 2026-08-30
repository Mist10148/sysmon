<#
  The SysMon probe agent.

  SysMon itself is a web page, and a web page cannot send an ICMP echo request.
  There is no raw socket in a browser, so the static build has always simulated
  its check results and said so. This is the small program that lets it stop.

  Two jobs, and no more than two:

    1. Serve the SysMon folder over HTTP, so the page is same-origin with the
       API. That means no CORS preflight on every sweep, and a localStorage
       origin that stays put.
    2. Answer POST /api/probe with real measurements - ICMP through .NET, HTTP
       through HttpClient.

  Nothing is installed to run this. PowerShell 5.1 ships with Windows and
  System.Net.NetworkInformation.Ping is in the framework that comes with it,
  which is the whole reason the agent is written in PowerShell rather than in
  the Python the previous build needed.

  Everything else - the records, the statuses, the outages, the exports - stays
  in the browser where it already was. The agent has no database, keeps no
  state between requests, and writes no files.

  This window IS the agent. Closing it stops the agent, and SysMon carries on
  with simulated checks and says which is which.
#>

[CmdletBinding()]
param(
  [int]$Port = 8765,
  # Defaults to the folder above this script. Resolved in the body rather than
  # here: $PSScriptRoot is not reliably populated while parameters are being
  # bound, and a default that reads it there fails on a relative invocation.
  [string]$Root = '',
  # Serve on the LAN as well as on this PC, so a phone can reach it. Windows
  # will not allow that unelevated; see the message it prints if it cannot.
  [switch]$Lan,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 does not load System.Net.Http for you, and an HTTP check would
# otherwise fail with "cannot find type HttpClientHandler" - which looks like
# the site being down rather than the agent missing an assembly.
try { Add-Type -AssemblyName System.Net.Http -ErrorAction Stop } catch { }

<#
  Accept any TLS certificate.

  These are offices on a private network with self-signed certificates, and the
  question a monitor asks is "does the service answer", not "is its certificate
  any good". The previous build's http_probe.py passed verify=False for the same
  reason.

  It has to be a compiled delegate rather than the obvious `{ $true }`
  scriptblock. .NET invokes this callback on a worker thread, where a
  PowerShell scriptblock has no runspace to run in - so a scriptblock fails
  with "There is no Runspace available to run scripts in this thread", every
  HTTPS check times out, and it reads exactly like the site being down. This
  compiles once at startup with the C# compiler that ships with the framework;
  nothing is downloaded.
#>
try {
  if (-not ('SysMonTls' -as [type])) {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System.Net;
public static class SysMonTls {
  public static void TrustEverything() {
    ServicePointManager.ServerCertificateValidationCallback =
      delegate { return true; };
  }
}
'@
  }
  [SysMonTls]::TrustEverything()
} catch {
  Write-Host ('  Note: self-signed HTTPS sites will fail to verify (' +
              $_.Exception.Message + ')') -ForegroundColor DarkYellow
}

if (-not $Root) {
  $here = $PSScriptRoot
  if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
  $Root = Split-Path -Parent $here
}
$AgentName    = 'sysmon-agent'
$AgentVersion = '1.0'

# Guard rails on what one request may ask for. The agent is a ping proxy, and a
# ping proxy with no limits is a denial-of-service tool with a JSON interface.
$MAX_TARGETS  = 200
$MAX_PACKETS  = 20
$MIN_TIMEOUT  = 100
$MAX_TIMEOUT  = 20000
$MAX_BODY     = 256KB
# A host name or an IP literal, and nothing that could be read as anything
# else. Nothing here reaches a shell, but a target that is not a host is a bug
# somewhere upstream and should be refused rather than resolved.
$HOST_PATTERN = '^[A-Za-z0-9]([A-Za-z0-9\.\-:_]{0,253}[A-Za-z0-9\]])?$'

$MIME = @{
  '.html' = 'text/html; charset=utf-8'; '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'; '.md'  = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml';            '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg';               '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif';                '.ico'  = 'image/x-icon'
  '.webp' = 'image/webp';               '.woff2'= 'font/woff2'
  '.woff' = 'font/woff';                '.map'  = 'application/json; charset=utf-8'
}

function Write-Line {
  param([string]$Text, [string]$Colour = 'Gray')
  Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $Text) -ForegroundColor $Colour
}

function Get-LanAddress {
  try {
    $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -First 1
    if ($a) { return $a.IPAddress }
  } catch { }
  return $null
}

# --------------------------------------------------------------- the probes --

<#
  One round of ICMP across every ping target at once.

  Packets go out a round at a time: sequential within a host, because that is
  what ping does and what the latency figures mean, and parallel across hosts,
  because forty offices checked one after another is forty seconds nobody has.
  Worst case for a whole sweep is therefore packets x timeout, which is exactly
  what the Sweep options page already tells the operator to expect.
#>
function Invoke-PingBatch {
  param([array]$Targets, [int]$Packets, [int]$TimeoutMs)

  $buffer = New-Object byte[] 32
  $state = @{}
  foreach ($t in $Targets) { $state[[string]$t.id] = @{ replies = @() } }

  for ($round = 0; $round -lt $Packets; $round++) {
    $pending = @()
    foreach ($t in $Targets) {
      $ping = New-Object System.Net.NetworkInformation.Ping
      $entry = @{ id = [string]$t.id; ping = $ping; task = $null; error = $null }
      try {
        $entry.task = $ping.SendPingAsync([string]$t.host, $TimeoutMs, $buffer)
      } catch {
        # A host that cannot even be resolved never becomes a task.
        $entry.error = $_.Exception.GetBaseException().Message
      }
      $pending += $entry
    }

    # A ceiling, so one wedged task cannot hold the sweep open forever.
    $tasks = @($pending | Where-Object { $_.task } | ForEach-Object { $_.task })
    if ($tasks.Count) {
      try { [System.Threading.Tasks.Task]::WaitAll($tasks, $TimeoutMs + 2000) | Out-Null } catch { }
    }

    foreach ($entry in $pending) {
      $reply = @{ ok = $false; ms = $null; ttl = $null; status = 'Unknown'; address = $null }
      if (-not $entry.task) {
        $reply.status = 'DnsFailure'
      } elseif (-not $entry.task.IsCompleted) {
        $reply.status = 'TimedOut'
      } elseif ($entry.task.IsFaulted) {
        $reply.status = 'DnsFailure'
      } else {
        $r = $entry.task.Result
        $reply.status = [string]$r.Status
        if ($r.Address) { $reply.address = [string]$r.Address }
        if ($r.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
          $reply.ok = $true
          $reply.ms = [int]$r.RoundtripTime
          if ($r.Options) { $reply.ttl = [int]$r.Options.Ttl }
        }
      }
      $state[$entry.id].replies += $reply
      if ($entry.ping) { $entry.ping.Dispose() }
    }
  }
  return $state
}

<#
  Windows ping's own output, rebuilt from the replies that actually came back.

  The shape of this text is an interface, not decoration: SysMon's QM.txt export
  is read by things outside SysMon and has looked like this since the batch file
  this application is descended from. Hence "time<1ms" rather than a rounded-up
  1ms, and the summary lines in the order ping prints them.
#>
function Format-PingTranscript {
  param([string]$Target, [array]$Replies)

  $lines = @("Pinging $Target with 32 bytes of data:")
  $times = @()
  foreach ($r in $Replies) {
    $address = $Target
    if ($r.address) { $address = $r.address }
    if ($r.ok) {
      $times += [int]$r.ms
      if ([int]$r.ms -lt 1) { $t = 'time<1ms' } else { $t = 'time=' + [int]$r.ms + 'ms' }
      $ttl = ''
      if ($null -ne $r.ttl) { $ttl = ' TTL=' + [int]$r.ttl }
      $lines += "Reply from ${address}: bytes=32 $t$ttl"
    } elseif ($r.status -eq 'DestinationHostUnreachable' -or
              $r.status -eq 'DestinationNetworkUnreachable') {
      $lines += "Reply from ${address}: Destination host unreachable."
    } elseif ($r.status -eq 'TtlExpired') {
      $lines += "Reply from ${address}: TTL expired in transit."
    } elseif ($r.status -eq 'DnsFailure') {
      $lines += "Ping request could not find host $Target. Please check the name and try again."
    } else {
      $lines += 'Request timed out.'
    }
  }

  $sent = $Replies.Count
  $received = $times.Count
  $lost = $sent - $received
  $pct = 0
  if ($sent -gt 0) { $pct = [int][Math]::Round(($lost / $sent) * 100) }

  $lines += ''
  $lines += "Ping statistics for ${Target}:"
  $lines += "    Packets: Sent = $sent, Received = $received, Lost = $lost ($pct% loss),"
  if ($received -gt 0) {
    $min = ($times | Measure-Object -Minimum).Minimum
    $max = ($times | Measure-Object -Maximum).Maximum
    $avg = [int][Math]::Round(($times | Measure-Object -Average).Average)
    $lines += 'Approximate round trip times in milli-seconds:'
    $lines += "    Minimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms"
  }
  return ($lines -join "`n")
}

function New-HttpClient {
  param([int]$TimeoutMs)
  # Certificate validation is dealt with once at startup; see SysMonTls above.
  try {
    [System.Net.ServicePointManager]::SecurityProtocol =
      [System.Net.SecurityProtocolType]::Tls12 -bor
      [System.Net.SecurityProtocolType]::Tls11 -bor
      [System.Net.SecurityProtocolType]::Tls
  } catch { }
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $true
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
  return $client
}

function Invoke-HttpProbe {
  param($Target, [int]$TimeoutMs)

  $scheme = 'http'
  if ($Target.scheme) { $scheme = [string]$Target.scheme }
  $path = '/'
  if ($Target.path) { $path = [string]$Target.path }
  if (-not $path.StartsWith('/')) { $path = '/' + $path }
  $port = ''
  if ($Target.port) { $port = ':' + [int]$Target.port }
  $expect = 200
  if ($Target.expect_status) { $expect = [int]$Target.expect_status }

  $url = $scheme + '://' + [string]$Target.host + $port + $path
  $lines = @("GET $url")
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $client = $null

  try {
    $client = New-HttpClient -TimeoutMs $TimeoutMs
    $response = $client.GetAsync($url).GetAwaiter().GetResult()
    $watch.Stop()
    $code = [int]$response.StatusCode
    $reason = [string]$response.ReasonPhrase
    $ms = [int]$watch.ElapsedMilliseconds

    $lines += "< HTTP/$($response.Version) $code $reason"
    foreach ($name in @('Server', 'Content-Type')) {
      $values = $null
      if ($response.Headers.TryGetValues($name, [ref]$values)) {
        $lines += '< ' + $name.ToLower() + ': ' + ($values -join ', ')
      } elseif ($response.Content -and
                $response.Content.Headers.TryGetValues($name, [ref]$values)) {
        $lines += '< ' + $name.ToLower() + ': ' + ($values -join ', ')
      }
    }
    $lines += ''
    $lines += 'time_total=' +
      ($ms / 1000).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture) + 's'

    $result = @{
      ok = ($code -eq $expect); method = 'http'
      packets_sent = 1; packets_lost = 0; loss_pct = 0
      avg_latency_ms = $ms; http_status = $code
      raw_output = ($lines -join "`n"); error = $null
    }
    if (-not $result.ok) {
      # It answered, and answered wrongly. That is a different fact from
      # silence, and the transcript keeps both.
      $result.packets_lost = 1
      $result.loss_pct = 100
      $result.avg_latency_ms = $null
      $result.error = "Answered HTTP $code instead of the expected status"
    }
    return $result
  } catch {
    $watch.Stop()
    $lines += ''
    # curl's own two codes for the two different failures, because they are
    # genuinely different facts and the transcript is read by people: 28 is
    # "waited and nothing came", 7 is "refused straight away". Saying "after
    # 8000 ms" about a connection refused in one millisecond is a small lie
    # that sends someone looking at the wrong thing.
    $failed = $_.Exception.GetBaseException()
    if ($_.Exception -is [System.Threading.Tasks.TaskCanceledException] -or
        $failed -is [System.Threading.Tasks.TaskCanceledException]) {
      $lines += "curl: (28) Connection timed out after $TimeoutMs ms"
    } else {
      $lines += 'curl: (7) ' + $failed.Message +
                ' after ' + [int]$watch.ElapsedMilliseconds + ' ms'
    }
    return @{
      ok = $false; method = 'http'
      packets_sent = 1; packets_lost = 1; loss_pct = 100
      avg_latency_ms = $null; http_status = $null
      raw_output = ($lines -join "`n")
      error = 'No response from the web service'
    }
  } finally {
    if ($client) { $client.Dispose() }
  }
}

# ---------------------------------------------------------------- /api/probe --

function Invoke-Probe {
  param($Request)

  $packets = 4
  if ($Request.packets) { $packets = [int]$Request.packets }
  $timeout = 1000
  if ($Request.timeout_ms) { $timeout = [int]$Request.timeout_ms }
  if ($packets -lt 1) { $packets = 1 }
  if ($packets -gt $MAX_PACKETS) { $packets = $MAX_PACKETS }
  if ($timeout -lt $MIN_TIMEOUT) { $timeout = $MIN_TIMEOUT }
  if ($timeout -gt $MAX_TIMEOUT) { $timeout = $MAX_TIMEOUT }

  $results = @()
  $pingTargets = @()
  $seen = @{}

  foreach ($t in @($Request.targets)) {
    if ($results.Count + $pingTargets.Count -ge $MAX_TARGETS) { break }
    if ($null -eq $t.id -or -not $t.host) { continue }
    $id = [string]$t.id
    if ($seen.ContainsKey($id)) { continue }   # one answer per location
    $seen[$id] = $true

    if ([string]$t.host -notmatch $HOST_PATTERN) {
      $results += @{ id = $t.id; ok = $false; method = 'ping'
                     packets_sent = 0; packets_lost = 0; loss_pct = 100
                     avg_latency_ms = $null; http_status = $null; raw_output = ''
                     error = 'That address is not a host name or an IP address' }
      continue
    }

    if ([string]$t.method -eq 'http') {
      # HTTP gets the whole packet budget as one request's worth of patience,
      # which is what the previous build did too.
      $probe = Invoke-HttpProbe -Target $t -TimeoutMs ($timeout * $packets)
      $probe.id = $t.id
      $results += $probe
    } else {
      $pingTargets += $t
    }
  }

  if ($pingTargets.Count) {
    $state = Invoke-PingBatch -Targets $pingTargets -Packets $packets -TimeoutMs $timeout
    foreach ($t in $pingTargets) {
      $replies = @($state[[string]$t.id].replies)
      $good = @($replies | Where-Object { $_.ok })
      $sent = $replies.Count
      $lost = $sent - $good.Count
      $lossPct = 0
      if ($sent -gt 0) { $lossPct = [Math]::Round((($lost / $sent) * 1000)) / 10 }
      $avg = $null
      if ($good.Count) {
        $avg = [int][Math]::Round(
          (($good | ForEach-Object { [int]$_.ms }) | Measure-Object -Average).Average)
      }

      # Any reply at all means something is answering. Total loss is down.
      $ok = ($good.Count -gt 0)
      $failure = $null
      if (-not $ok) {
        $first = $replies | Select-Object -First 1
        if ($first -and $first.status -eq 'DnsFailure') {
          $failure = 'That address could not be resolved'
        } elseif ($first -and ($first.status -eq 'DestinationHostUnreachable' -or
                               $first.status -eq 'DestinationNetworkUnreachable')) {
          $failure = 'Destination host unreachable'
        } else {
          $failure = 'Request timed out on every packet'
        }
      }

      $results += @{
        id = $t.id; ok = $ok; method = 'ping'
        packets_sent = $sent; packets_lost = $lost; loss_pct = $lossPct
        avg_latency_ms = $avg; http_status = $null
        raw_output = (Format-PingTranscript -Target ([string]$t.host) -Replies $replies)
        error = $failure
      }
    }
  }

  $up = @($results | Where-Object { $_.ok }).Count
  Write-Line ('probe  ' + $results.Count + ' target(s), ' + $up + ' up, ' +
              ($results.Count - $up) + ' down') 'DarkCyan'

  return @{
    agent = @{ name = $AgentName; version = $AgentVersion }
    at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    results = @($results)
  }
}

# -------------------------------------------------------------- the listener --

function Send-Response {
  param($Context, [int]$Status, [string]$ContentType, [byte[]]$Body)
  $response = $Context.Response
  try {
    $response.StatusCode = $Status
    # The agent is reachable only from this PC unless -Lan was asked for, and it
    # holds nothing private, so a page opened from file:// - whose origin is the
    # string "null" - is allowed to talk to it. That is the difference between
    # the launcher being the recommended way in and the only way in.
    $response.Headers['Access-Control-Allow-Origin'] = '*'
    $response.Headers['Cache-Control'] = 'no-store'
    if ($ContentType) { $response.ContentType = $ContentType }
    if ($Body) {
      $response.ContentLength64 = $Body.Length
      $response.OutputStream.Write($Body, 0, $Body.Length)
    } else {
      $response.ContentLength64 = 0
    }
  } catch {
    # A browser that navigated away mid-response is not an error worth a stack
    # trace; it is the most ordinary thing that happens to a web server.
  } finally {
    try { $response.OutputStream.Close() } catch { }
    try { $response.Close() } catch { }
  }
}

function Send-Json {
  param($Context, [int]$Status, $Object)
  $json = ConvertTo-Json -InputObject $Object -Depth 8 -Compress
  Send-Response -Context $Context -Status $Status `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Send-Text {
  param($Context, [int]$Status, [string]$Text)
  Send-Response -Context $Context -Status $Status `
    -ContentType 'text/plain; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($Text))
}

function Resolve-StaticPath {
  param([string]$UrlPath, [string]$RootFull)

  $relative = [System.Uri]::UnescapeDataString($UrlPath).TrimStart('/')
  if ($relative -eq '') { $relative = 'index.html' }
  # A backslash is a path separator to Windows but not to a browser, so it is
  # normalised before the containment check rather than after it.
  $relative = $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)
  if ($relative.IndexOf([char]0) -ge 0) { return $null }

  $candidate = $null
  try { $candidate = [IO.Path]::GetFullPath((Join-Path $RootFull $relative)) } catch { return $null }

  # The one rule that matters: never serve anything outside the folder, whatever
  # combination of .. and encoding was used to ask for it. Compared with the
  # separator attached, or a sibling folder whose name merely starts the same
  # way - sysmon-static-backup next to sysmon-static - would pass.
  $fence = $RootFull + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($fence, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  return $candidate
}

$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath (Join-Path $rootFull 'index.html'))) {
  Write-Host ''
  Write-Host "  Cannot find index.html in $rootFull" -ForegroundColor Red
  Write-Host '  The agent expects to sit in the agent folder of the SysMon folder.' -ForegroundColor Red
  Write-Host ''
  exit 1
}

$prefixes = @("http://localhost:$Port/", "http://127.0.0.1:$Port/")
if ($Lan) { $prefixes = @("http://+:$Port/") }

$listener = New-Object System.Net.HttpListener
foreach ($p in $prefixes) { $listener.Prefixes.Add($p) }

try {
  $listener.Start()
} catch [System.Net.HttpListenerException] {
  Write-Host ''
  if ($_.Exception.ErrorCode -eq 5) {
    # Serving on the LAN is the one thing Windows will not let an ordinary user
    # do without being asked first. Say what to do about it rather than
    # printing "Access is denied" and stopping.
    Write-Host '  Windows will not let this window serve SysMon on the network.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Either start it without --lan, which serves this PC only and needs' -ForegroundColor Gray
    Write-Host '  no permission, or grant it once from an Administrator PowerShell:' -ForegroundColor Gray
    Write-Host ''
    Write-Host "      netsh http add urlacl url=http://+:$Port/ user=$env:USERDOMAIN\$env:USERNAME" -ForegroundColor White
    Write-Host ''
  } elseif ($_.Exception.ErrorCode -eq 183 -or $_.Exception.ErrorCode -eq 32) {
    Write-Host "  Port $Port is already in use - the agent may already be running." -ForegroundColor Yellow
    Write-Host '  Look for another SysMon agent window, or start this one on a' -ForegroundColor Gray
    Write-Host "  different port with:  SysMon.bat $($Port + 1)" -ForegroundColor Gray
    Write-Host ''
  } else {
    Write-Host "  Could not start the agent: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
  }
  exit 1
}

$url = "http://localhost:$Port/"
$lanAddress = Get-LanAddress

Write-Host ''
Write-Host '  SysMon probe agent' -ForegroundColor Cyan
Write-Host '  ------------------' -ForegroundColor DarkGray
Write-Host "  Open          $url" -ForegroundColor White
if ($Lan -and $lanAddress) {
  Write-Host "  On the LAN    http://${lanAddress}:$Port/" -ForegroundColor White
} elseif ($lanAddress) {
  Write-Host '  On the LAN    not served - start with --lan for that' -ForegroundColor DarkGray
}
Write-Host "  Folder        $rootFull" -ForegroundColor Gray
Write-Host '  Checks        real ICMP and HTTP, from this PC' -ForegroundColor Gray
Write-Host ''
Write-Host '  Close this window to stop the agent. SysMon keeps working without it' -ForegroundColor DarkGray
Write-Host '  and says so, but its checks go back to being simulated.' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) { try { Start-Process $url | Out-Null } catch { } }

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod

    if ($method -eq 'OPTIONS') {
      $context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
      $context.Response.Headers['Access-Control-Allow-Headers'] = '*'
      $context.Response.Headers['Access-Control-Max-Age'] = '600'
      Send-Response -Context $context -Status 204 -ContentType $null -Body $null
      continue
    }

    if ($path -eq '/api/health') {
      Send-Json -Context $context -Status 200 -Object @{
        status = 'ok'; agent = $AgentName; version = $AgentVersion
        capabilities = @('ping', 'http'); host = [System.Environment]::MachineName
      }
      continue
    }

    if ($path -eq '/api/probe') {
      if ($method -ne 'POST') {
        Send-Json -Context $context -Status 405 -Object @{ error = 'POST only' }
        continue
      }
      if ($request.ContentLength64 -gt $MAX_BODY) {
        Send-Json -Context $context -Status 413 -Object @{ error = 'That request is too large' }
        continue
      }
      $parsed = $null
      try {
        $reader = New-Object System.IO.StreamReader(
          $request.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $parsed = ConvertFrom-Json $body
      } catch {
        Send-Json -Context $context -Status 400 -Object @{ error = 'That was not JSON' }
        continue
      }
      try {
        Send-Json -Context $context -Status 200 -Object (Invoke-Probe -Request $parsed)
      } catch {
        Write-Line ('probe failed: ' + $_.Exception.Message) 'Red'
        Send-Json -Context $context -Status 500 -Object @{ error = $_.Exception.Message }
      }
      continue
    }

    # Anything else under /api/ is a 404 as JSON, never the index page: a bad
    # API path that answers with HTML is a bug that takes an hour to find.
    if ($path.StartsWith('/api/')) {
      Send-Json -Context $context -Status 404 -Object @{ error = 'No such endpoint' }
      continue
    }

    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      Send-Text -Context $context -Status 405 -Text 'Method not allowed'
      continue
    }

    $file = Resolve-StaticPath -UrlPath $path -RootFull $rootFull
    if (-not $file) {
      Send-Text -Context $context -Status 404 -Text "Not found: $path"
      continue
    }
    $extension = [IO.Path]::GetExtension($file).ToLower()
    $type = $MIME[$extension]
    if (-not $type) { $type = 'application/octet-stream' }
    $bytes = $null
    if ($method -eq 'GET') { $bytes = [IO.File]::ReadAllBytes($file) }
    Send-Response -Context $context -Status 200 -ContentType $type -Body $bytes
  }
} finally {
  try { $listener.Stop() } catch { }
  try { $listener.Close() } catch { }
  Write-Host ''
  Write-Line 'agent stopped' 'DarkGray'
}
