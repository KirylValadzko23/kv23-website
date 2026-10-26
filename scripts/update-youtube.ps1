# Pulls the latest long-form videos and Shorts from YouTube's public RSS feeds (no API key needed)
# and writes data/youtube.json, which the site renders on load.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/update-youtube.ps1
# Runs on Windows PowerShell 5.1 and PowerShell 7 (the GitHub Action uses pwsh on Linux).
#
# YouTube's feeds sometimes answer 404 for a while (often the long-form one, early in the morning UTC).
# A feed that still fails after a few tries keeps its part of the last good data file, and the run
# ends without an error: a missed update isn't worth a failed job, the next run catches up.
param(
  [string]$ChannelId = 'UCG50aSgRv2N9RkMl0kXY_2Q', # @KirylValadzko
  [int]$MaxShorts = 12,
  [int]$MaxEpisodes = 4
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'data/youtube.json'
$tail = $ChannelId.Substring(2)
$ns = @{ a = 'http://www.w3.org/2005/Atom'; yt = 'http://www.youtube.com/xml/schemas/2015'; media = 'http://search.yahoo.com/mrss/' }
$ell = [string][char]0x2026 # "..." (kept out of the source so 5.1 reads this file correctly)

# hand-picked titles for videos whose YouTube title is shouty or long
$titleOverrides = @{
  'JhWwEKcYf4E' = 'Is My Racing Dream Even Realistic?'
  '9CaiRlim-jY' = "This Started Worse Than I Expected$ell"
  '6NggvLsq8vk' = 'Does Studying Actually Make You Faster? (Rain Test)'
}

# the last good data: durations for when YouTube refuses the watch-page lookup (it sometimes does for
# cloud IPs), and whole lists for when a feed is down
$old = $null; $known = @{}
if (Test-Path $out) {
  try { $old = Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  if ($old) { @($old.episodes) | ForEach-Object { if ($_ -and $_.duration) { $known[$_.id] = $_.duration } } }
}

function Note([string]$msg) {
  if ($env:GITHUB_ACTIONS) { Write-Host "::warning::$msg" } else { Write-Warning $msg }
}

# uploads split by type: UUSH = Shorts, UULF = long-form videos. $null means the feed couldn't be read.
function Get-Feed([string]$playlist) {
  $waits = 0, 10, 30, 60
  foreach ($w in $waits) {
    if ($w) { Start-Sleep -Seconds $w }
    try {
      [xml]$x = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.youtube.com/feeds/videos.xml?playlist_id=$playlist").Content
      return @(Select-Xml -Xml $x -XPath '//a:entry' -Namespace $ns | ForEach-Object {
        $e = $_.Node
        [pscustomobject]@{
          id        = [string]$e.videoId
          raw       = [string]$e.title
          published = [datetime]::Parse($e.published).ToUniversalTime()
          views     = [int]$e.group.community.statistics.views
        }
      })
    } catch { $err = $_.Exception.Message }
  }
  Note "Feed $playlist unreadable after $($waits.Count) tries ($err); keeping its last good data."
  return $null
}

function Get-CleanTitle($v) {
  if ($titleOverrides.ContainsKey($v.id)) { return $titleOverrides[$v.id] }
  $t = $v.raw -replace '\s*\|\s*Road to Racing\s*$', '' # series suffix
  $t = $t -replace '#\S+', ''                            # hashtags
  $t = $t -replace '[\p{Cs}\p{So}\p{Mn}\p{Cf}]', '' # emoji, plus their variation selectors / joiners
  return ($t -replace '\s{2,}', ' ').Trim()
}

# use the hand-cropped local thumbnail when there is one, otherwise YouTube's
function Get-Thumb([string]$id, [string]$remote) {
  if (Test-Path (Join-Path $root "assets/content/$id.jpg")) { return "assets/content/$id.jpg" }
  return $remote
}

function Get-Duration([string]$id) {
  try {
    $html = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.youtube.com/watch?v=$id" -Headers @{ 'Accept-Language' = 'en-US' }).Content
    $m = [regex]::Match($html, '"lengthSeconds":"(\d+)"')
    if ($m.Success) {
      $s = [int]$m.Groups[1].Value
      $h = [math]::Floor($s / 3600); $mm = [math]::Floor(($s % 3600) / 60); $ss = $s % 60
      if ($h) { return '{0}:{1:00}:{2:00}' -f $h, $mm, $ss }
      return '{0}:{1:00}' -f $mm, $ss
    }
  } catch {}
  return $known[$id]
}

$iso = { param($d) $d.ToString('yyyy-MM-ddTHH:mm:ssZ') }

# long-form videos, newest first. Road to Racing ones keep their episode number (counted oldest-first
# within the series); every other long-form video has no: null and shows its date instead.
$longFeed = Get-Feed "UULF$tail"
if ($null -ne $longFeed) {
  $series = @($longFeed | Where-Object { $_.raw -match 'Road to Racing' } | Sort-Object published)
  $epNo = @{}; for ($i = 0; $i -lt $series.Count; $i++) { $epNo[$series[$i].id] = $i + 1 }
  $episodes = @($longFeed | Sort-Object published -Descending | Select-Object -First $MaxEpisodes | ForEach-Object {
    [ordered]@{
      id = $_.id; no = $epNo[$_.id]; title = Get-CleanTitle $_; published = & $iso $_.published; views = $_.views
      duration = Get-Duration $_.id
      thumb = Get-Thumb $_.id "https://i.ytimg.com/vi/$($_.id)/maxresdefault.jpg"
    }
  })
} else { $episodes = @(if ($old) { $old.episodes }) }

$shortFeed = Get-Feed "UUSH$tail"
if ($null -ne $shortFeed) {
  $shorts = @($shortFeed | Sort-Object published -Descending | Select-Object -First $MaxShorts | ForEach-Object {
    [ordered]@{
      id = $_.id; title = Get-CleanTitle $_; published = & $iso $_.published; views = $_.views
      thumb = Get-Thumb $_.id "https://i.ytimg.com/vi/$($_.id)/oardefault.jpg"
    }
  })
} else { $shorts = @(if ($old) { $old.shorts }) }

if (($null -eq $longFeed -and $null -eq $shortFeed) -or (-not $episodes.Count -and -not $shorts.Count)) {
  Note 'No fresh data this run; the site keeps the last good data file.'
  exit 0
}

# only touch the file (and its "updated" time) when the videos or their numbers changed
$body = { param($e, $s) (@{ episodes = @($e); shorts = @($s) } | ConvertTo-Json -Depth 5 -Compress) }
if ($old -and (& $body $episodes $shorts) -eq (& $body $old.episodes $old.shorts)) {
  Write-Host 'No change.'
  exit 0
}

$data = [ordered]@{
  updated  = & $iso (Get-Date).ToUniversalTime()
  episodes = @($episodes)
  shorts   = @($shorts)
}
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
[IO.File]::WriteAllText($out, ($data | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote {0}: {1} long-form videos, {2} shorts" -f $out, $data.episodes.Count, $data.shorts.Count)
