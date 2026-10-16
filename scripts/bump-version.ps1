# Stamps the CSS/JS links in every page with a version tag (?v=xxxxxxxx) taken from the files' contents,
# so browsers fetch fresh copies right after an update instead of reusing a cached old one.
# Run before committing: powershell -ExecutionPolicy Bypass -File scripts/bump-version.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object Text.UTF8Encoding $false

$assets = 'css/style.css', 'js/main.js', 'js/speed3d.js'
$tags = @{}
foreach ($a in $assets) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $root $a))
  $hash = [BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($bytes)).Replace('-', '').ToLower()
  $tags[$a] = $hash.Substring(0, 8)
}

foreach ($page in Get-ChildItem $root -Filter *.html) {
  $html = [IO.File]::ReadAllText($page.FullName, $utf8)
  $before = $html
  foreach ($a in $assets) {
    $html = [regex]::Replace($html, '(["''])' + [regex]::Escape($a) + '(\?v=[0-9a-f]*)?(["''])', ('$1' + $a + '?v=' + $tags[$a] + '$3'))
  }
  if ($html -ne $before) { [IO.File]::WriteAllText($page.FullName, $html, $utf8); "updated $($page.Name)" } else { "unchanged $($page.Name)" }
}
$tags.GetEnumerator() | ForEach-Object { "{0} -> v={1}" -f $_.Key, $_.Value }
