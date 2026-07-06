Write-Host '--- Firewall node.exe rules ---'
try {
  $matches = Get-NetFirewallRule -Enabled True | Where-Object {
    ($_.DisplayName) -and (($_ | Get-NetFirewallApplicationFilter).Program -like '*node.exe*')
  } | Select-Object Name,DisplayName,@{Name='Program';Expression={($_ | Get-NetFirewallApplicationFilter).Program}}
  if ($matches -and $matches.Count -gt 0) { $matches | Format-Table -AutoSize } else { Write-Host 'No explicit firewall app rule for node.exe found.' }
} catch { Write-Host 'Firewall query failed:' $_.Exception.Message }

Write-Host '--- VPN/Proxy-like processes ---'
try {
  $vpn = Get-Process | Where-Object { $_.ProcessName -match 'vpn|openvpn|wireguard|anyconnect|nord|proton|globalprotect|forticlient|openvpnserv' } | Select-Object ProcessName,Id,Path
  if ($vpn -and $vpn.Count -gt 0) { $vpn | Format-Table -AutoSize } else { Write-Host 'No VPN-like processes found.' }
} catch { Write-Host 'Process query failed:' $_.Exception.Message }

Write-Host '--- Proxy env vars ---'
Write-Host ("HTTP_PROXY={0}" -f $env:HTTP_PROXY)
Write-Host ("HTTPS_PROXY={0}" -f $env:HTTPS_PROXY)
Write-Host ("http_proxy={0}" -f $env:http_proxy)
Write-Host ("https_proxy={0}" -f $env:https_proxy)

Write-Host '--- Curl checks ---'
for ($i=1; $i -le 5; $i++) {
  Write-Host "--- Attempt $i ---"
  try {
    curl.exe -I https://generativelanguage.googleapis.com/ -m 10
  } catch {
    Write-Host 'curl failed:' $_.Exception.Message
  }
  Start-Sleep -Seconds 3
}
