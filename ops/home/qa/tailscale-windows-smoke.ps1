param(
  [Parameter(Mandatory = $true)]
  [Uri]$BaseUrl
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

if ($BaseUrl.Scheme -ne "https" -or $BaseUrl.AbsolutePath -ne "/") {
  throw "Expected a private HTTPS origin without a path."
}

$http = [System.Net.Http.HttpClient]::new()
try {
  $signupUri = [Uri]::new($BaseUrl, "/signup")
  $response = $http.GetAsync($signupUri).GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) {
    throw "Tailnet HTTPS returned a non-success status."
  }
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if ($body -notmatch "Cloudflare OS") {
    throw "Tailnet HTTPS did not return the expected application shell."
  }
} finally {
  $http.Dispose()
}

function Test-PrivateWebSocket {
  $builder = [System.UriBuilder]::new($BaseUrl)
  $builder.Scheme = "wss"
  $builder.Port = -1
  $builder.Path = "/api"
  $builder.Query = ""
  $builder.Fragment = ""

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $timeout = [System.Threading.CancellationTokenSource]::new(
    [System.TimeSpan]::FromSeconds(15)
  )
  try {
    [void]$socket.ConnectAsync($builder.Uri, $timeout.Token).GetAwaiter().GetResult()
    if ($socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
      throw "Tailnet WebSocket did not reach the open state."
    }
  } finally {
    $socket.Dispose()
    $timeout.Dispose()
  }
}

Test-PrivateWebSocket
Test-PrivateWebSocket

Write-Output "PASS Windows tailnet HTTPS and two independent WSS connections"
