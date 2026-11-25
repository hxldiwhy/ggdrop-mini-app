# Публичный HTTPS-адрес для мини-приложения.
#
#   tunnel.cmd                 — поднять быстрый туннель Cloudflare на порт 8080
#   tunnel.cmd 8080            — то же, порт из аргумента
#   tunnel.cmd -Url https://...— просто прописать свой адрес (домен + reverse proxy)
#
# Адрес автоматически попадает в data\tunnel-url.txt, сервер подхватывает его
# в течение 3 секунд и обновляет кнопку «Открыть казино» у всех пользователей.
param(
  [int]$Port = 8080,
  [string]$Url = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$toolsDir = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if ($Url) {
  $Url.TrimEnd('/') | Set-Content -Path (Join-Path $dataDir 'tunnel-url.txt') -NoNewline -Encoding UTF8
  Write-Host "Адрес записан: $Url" -ForegroundColor Green
  Write-Host 'Сервер применит его в течение нескольких секунд.'
  exit 0
}

$exe = Join-Path $toolsDir 'cloudflared.exe'
if (-not (Test-Path $exe)) {
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  Write-Host 'Скачиваю cloudflared (~35 МБ, один раз)…'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
  } catch {
    Write-Host ''
    Write-Host "Не удалось скачать cloudflared: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Варианты:'
    Write-Host '  1) Скачай вручную и положи в tools\cloudflared.exe:'
    Write-Host "     $url"
    Write-Host '  2) Пропиши свой HTTPS-адрес:  tunnel.cmd -Url https://твой-домен'
    exit 1
  }
}

$log = Join-Path $dataDir 'tunnel.log'
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }

function Test-Tunnel {
  param([string]$Base)
  try {
    $res = Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 5
    if ($res.StatusCode -ne 200) { return $false }
    return [bool](($res.Content | ConvertFrom-Json).ok)
  } catch {
    return $false
  }
}

# Не держим в конфиге адрес мертвого туннеля: сервер подхватит новый, когда он будет готов.
$urlFile = Join-Path $dataDir 'tunnel-url.txt'
if (Test-Path $urlFile) {
  $previous = (Get-Content $urlFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($previous -and -not (Test-Tunnel $previous)) {
    Write-Host 'Старый адрес туннеля недоступен — убираю его из конфигурации.' -ForegroundColor Yellow
    Remove-Item $urlFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Поднимаю туннель на http://127.0.0.1:$Port …"
$cliArgs = @('tunnel', '--no-autoupdate', '--no-prechecks', '--protocol', 'http2', '--edge-ip-version', '4', '--url', "http://127.0.0.1:$Port", '--logfile', $log)
$proc = Start-Process -FilePath $exe -ArgumentList $cliArgs -PassThru -WindowStyle Hidden

$found = ''
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $raw = Get-Content -Path $log -Raw -ErrorAction SilentlyContinue
    $match = [regex]::Match(
      $raw,
      'https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com',
      [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
      $found = $match.Value.TrimEnd('/')
      break
    }
  }
  Write-Host '.' -NoNewline
}
Write-Host ''

if (-not $found) {
  Write-Host 'Не удалось получить адрес туннеля. Смотри лог: ' -ForegroundColor Red
  Write-Host $log
  exit 1
}

Write-Host "Проверяю доступность $found …" -NoNewline
$ready = $false
for ($j = 0; $j -lt 20; $j++) {
  if (Test-Tunnel $found) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
Write-Host ''

if (-not $ready) {
  Write-Host 'Туннель поднялся, но сервер за ним не отвечает — адрес не записан, чтобы не залип мертвый URL.' -ForegroundColor Red
  exit 1
}

$found | Set-Content -Path $urlFile -NoNewline -Encoding UTF8
Write-Host ''
Write-Host '════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host " Публичный адрес: $found" -ForegroundColor Green
Write-Host " Мини-приложение: $found/app" -ForegroundColor Green
Write-Host '════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host 'Не закрывай это окно — туннель живёт, пока оно открыто.'
Write-Host 'Кнопка «Открыть казино» в боте обновится сама.'
Write-Host ''
Write-Host 'Остановить: Ctrl+C или закрой окно.'

try {
  Wait-Process -Id $proc.Id
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
