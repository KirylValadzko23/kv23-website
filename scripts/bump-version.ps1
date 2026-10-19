# Stamps the CSS/JS links in every page with a version tag (?v=xxxxxxxx) taken from the files' contents,
# so browsers fetch fresh copies right after an update instead of reusing a cached old one.
# Run before committing: powershell -ExecutionPolicy Bypass -File scripts/bump-version.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object Text.UTF8Encoding $false

$assets = 'css/style.css', 'js/main.js', 'js/i18n.js'
$tags = @{}
foreach ($a in $assets) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $root $a))
  $hash = [BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($bytes)).Replace('-', '').ToLower()
  $tags[$a] = $hash.Substring(0, 8)
}

# the footer's "build xxxxxxxx" shows which version a visitor is running: one code for the whole site,
# from the CSS, the JS and every page's own text (ignoring the version tags and build codes themselves)
$pages = Get-ChildItem $root -Filter *.html | Sort-Object Name
$sb = New-Object Text.StringBuilder
foreach ($a in $assets) { [void]$sb.Append($tags[$a]) }
foreach ($page in $pages) {
  $t = [IO.File]::ReadAllText($page.FullName, $utf8)
  $t = [regex]::Replace($t, '\?v=[0-9a-f]*|build [0-9a-f]{8}', '')
  [void]$sb.Append($page.Name).Append($t)
}
$siteHash = [BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($utf8.GetBytes($sb.ToString()))).Replace('-', '').ToLower().Substring(0, 8)

foreach ($page in $pages) {
  $html = [IO.File]::ReadAllText($page.FullName, $utf8)
  $before = $html
  foreach ($a in $assets) {
    $html = [regex]::Replace($html, '(["''])' + [regex]::Escape($a) + '(\?v=[0-9a-f]*)?(["''])', ('$1' + $a + '?v=' + $tags[$a] + '$3'))
  }
  $html = [regex]::Replace($html, 'build [0-9a-f]{8}', ('build ' + $siteHash))
  if ($html -ne $before) { [IO.File]::WriteAllText($page.FullName, $html, $utf8); "updated $($page.Name)" } else { "unchanged $($page.Name)" }
}
$tags.GetEnumerator() | ForEach-Object { "{0} -> v={1}" -f $_.Key, $_.Value }
"site build -> $siteHash"
