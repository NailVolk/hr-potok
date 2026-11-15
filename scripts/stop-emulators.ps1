$ErrorActionPreference = 'SilentlyContinue'

$ports = @(29099, 29001, 25001, 24000, 4400, 4500)
$listeners = Get-NetTCPConnection -State Listen |
  Where-Object { $ports -contains $_.LocalPort } |
  Select-Object -ExpandProperty OwningProcess -Unique

if (-not $listeners) {
  Write-Host 'Firebase-эмуляторы не занимают свои порты.' -ForegroundColor Green
  exit 0
}

foreach ($ownerPid in $listeners) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid"
  if (-not $processInfo) { continue }

  $isFirebaseEmulator = (
    ($processInfo.Name -match '^java(w)?\.exe$' -and $processInfo.CommandLine -match 'firebase-database-emulator') -or
    ($processInfo.Name -match '^node\.exe$' -and $processInfo.CommandLine -match 'firebase-tools.*emulators|firebase\.js.*emulators')
  )

  if (-not $isFirebaseEmulator) {
    Write-Host "Порт Firebase занят посторонним процессом $($processInfo.Name), PID $ownerPid. Не останавливаю его." -ForegroundColor Yellow
    continue
  }

  Write-Host "Останавливаю найденный Firebase-эмулятор (PID $ownerPid)…"
  Stop-Process -Id $ownerPid
  Start-Sleep -Seconds 2
  if (Get-Process -Id $ownerPid) {
    Stop-Process -Id $ownerPid -Force
  }
}

Start-Sleep -Seconds 1
$stillListening = Get-NetTCPConnection -State Listen |
  Where-Object { $ports -contains $_.LocalPort }
if ($stillListening) {
  Write-Host 'Некоторые порты всё ещё заняты. Пришлите вывод этой команды; посторонние процессы не остановлены.' -ForegroundColor Yellow
  $stillListening | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize
} else {
  Write-Host 'Порты Firebase-эмуляторов освобождены.' -ForegroundColor Green
}
