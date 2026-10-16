# Pulls the latest Road to Racing episodes and Shorts from YouTube's public RSS feeds (no API key needed)
# and writes data/youtube.json, which the site renders on load.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/update-youtube.ps1
# Runs on Windows PowerShell 5.1 and PowerShell 7 (the GitHub Action uses pwsh on Linux).
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
}

# durations from the last run, in case YouTube refuses the watch-page lookup (it sometimes does for cloud IPs)
$known = @{}
if (Test-Path $out) {
  try { (Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json).episodes | ForEach-Object { if ($_.duration) { $known[$_.id] = $_.duration } } } catch {}
}

# uploads split by type: UUSH = Shorts, UULF = long-form videos
function Get-Feed([string]$playlist) {
  [xml]$x = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.youtube.com/feeds/videos.xml?playlist_id=$playlist").Content
  Select-Xml -Xml $x -XPath '//a:entry' -Namespace $ns | ForEach-Object {
    $e = $_.Node
    [pscustomobject]@{
      id        = [string]$e.videoId
      raw       = [string]$e.title
      published = [datetime]::Parse($e.published).ToUniversalTime()
      views     = [int]$e.group.community.statistics.views
    }
  }
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

# Road to Racing episodes: numbered oldest-first, listed newest-first
$long = @(Get-Feed "UULF$tail" | Where-Object { $_.raw -match 'Road to Racing' } | Sort-Object published)
$episodes = @(for ($i = 0; $i -lt $long.Count; $i++) {
  $v = $long[$i]
  [ordered]@{
    id = $v.id; no = $i + 1; title = Get-CleanTitle $v; published = & $iso $v.published; views = $v.views
    duration = Get-Duration $v.id
    thumb = Get-Thumb $v.id "https://i.ytimg.com/vi/$($v.id)/maxresdefault.jpg"
  }
})
[array]::Reverse($episodes)

$shorts = Get-Feed "UUSH$tail" | Sort-Object published -Descending | Select-Object -First $MaxShorts | ForEach-Object {
  [ordered]@{
    id = $_.id; title = Get-CleanTitle $_; published = & $iso $_.published; views = $_.views
    thumb = Get-Thumb $_.id "https://i.ytimg.com/vi/$($_.id)/oardefault.jpg"
  }
}

if (-not $shorts -and -not $episodes) { throw 'Both feeds came back empty; keeping the existing data file.' }

$data = [ordered]@{
  updated  = & $iso (Get-Date).ToUniversalTime()
  episodes = @($episodes | Select-Object -First $MaxEpisodes)
  shorts   = @($shorts)
}
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
[IO.File]::WriteAllText($out, ($data | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote {0}: {1} episodes, {2} shorts" -f $out, $data.episodes.Count, $data.shorts.Count)
