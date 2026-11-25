# Самоподписанный сертификат для локального HTTPS (нужен только если нет туннеля/домена).
# Запуск:  cert.cmd            — создать сертификат
#          cert.cmd -Trust     — создать и добавить в доверенные (без предупреждений браузера)
param(
  [switch]$Trust,
  [string]$Password = 'wiftgram'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\certs'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host '[1/4] Собираю список адресов…'
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch {
  $ips = @()
}
$names = @('localhost') + $ips
$names | ForEach-Object { Write-Host "      $_" }

Write-Host '[2/4] Создаю самоподписанный сертификат…'
$cert = New-SelfSignedCertificate `
  -Subject 'CN=Wiftgram Casino Local' `
  -DnsName $names `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(5) `
  -FriendlyName 'Wiftgram Casino Local' `
  -KeyExportPolicy Exportable

$pwd = ConvertTo-SecureString -String $Password -AsPlainText -Force
$pfx = Join-Path $outDir 'casino.pfx'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null
Write-Host "      $pfx"

Write-Host '[3/4] Сохраняю открытый сертификат…'
$cer = Join-Path $outDir 'casino.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Write-Host "      $cer"

Write-Host '[4/4] Доверие…'
if ($Trust) {
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
  try {
    Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
    Write-Host '      Добавлен в доверенные (CurrentUser + LocalMachine).'
  } catch {
    Write-Host '      Добавлен только для текущего пользователя (нет прав администратора).'
  }
} else {
  Write-Host '      Пропущено. Чтобы браузер не ругался: cert.cmd -Trust'
}

Write-Host ''
Write-Host 'Готово. Пароль PFX хранится в .env (PFX_PASS), по умолчанию: wiftgram' -ForegroundColor Green
Write-Host 'Перезапусти сервер — HTTPS поднимется на порту 8443.'
