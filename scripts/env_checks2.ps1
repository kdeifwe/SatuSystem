Write-Host '--- netsh firewall rules (node.exe) ---'
try {
  netsh advfirewall firewall show rule name=all | Select-String -Pattern 'node.exe' -SimpleMatch
} catch { Write-Host 'netsh query failed:' $_.Exception.Message }

Write-Host '--- reg firewall rules (node.exe) ---'
try {
  reg query 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules' /s 2>$null | Select-String -Pattern 'node.exe' -SimpleMatch
} catch { Write-Host 'reg query failed:' $_.Exception.Message }

Write-Host '--- processes vpn-like ---'
try { Get-Process | Where-Object { $_.ProcessName -match 'vpn|openvpn|wireguard|anyconnect|nord|proton|globalprotect|forticlient|openvpnserv' } | Select-Object ProcessName,Id,Path | Format-Table -AutoSize } catch { Write-Host 'Process query failed:' $_.Exception.Message }

Write-Host '--- proxy env vars ---'
Write-Host ("HTTP_PROXY={0}" -f $env:HTTP_PROXY)
Write-Host ("HTTPS_PROXY={0}" -f $env:HTTPS_PROXY)
Write-Host ("http_proxy={0}" -f $env:http_proxy)
Write-Host ("https_proxy={0}" -f $env:https_proxy)

Write-Host '--- curl checks ---'
for ($i=1; $i -le 5; $i++) {
  Write-Host "--- Attempt $i ---"
  try {
    curl.exe -I https://generativelanguage.googleapis.com/ -m 10
  } catch {
    Write-Host 'curl failed:' $_.Exception.Message
  }
  Start-Sleep -Seconds 3
}
