param([int]$Port = 3000)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

$mimeTypes = @{
    ".html"  = "text/html; charset=utf-8"
    ".js"    = "application/javascript"
    ".css"   = "text/css"
    ".json"  = "application/json"
    ".png"   = "image/png"
    ".jpg"   = "image/jpeg"
    ".jpeg"  = "image/jpeg"
    ".gif"   = "image/gif"
    ".svg"   = "image/svg+xml"
    ".ico"   = "image/x-icon"
    ".woff"  = "font/woff"
    ".woff2" = "font/woff2"
}

function Handle-Context($context) {
    $request = $context.Request
    $response = $context.Response
    try {
        $path = $request.Url.AbsolutePath
        if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }

        $filePath = Join-Path $projectRoot ([System.Uri]::UnescapeDataString($path).TrimStart("/").Replace("/", "\"))
        $filePath = [System.IO.Path]::GetFullPath($filePath)

        Write-Host "$($request.HttpMethod) $path" -ForegroundColor Cyan

        if ($filePath.StartsWith($projectRoot) -and (Test-Path $filePath -PathType Leaf)) {
            $fileContent = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $response.StatusCode = 200
            $response.ContentType = $contentType
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.ContentLength64 = $fileContent.Length
            $response.OutputStream.Write($fileContent, 0, $fileContent.Length)
            Write-Host "  -> 200 OK" -ForegroundColor Green
        } else {
            $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.StatusCode = 404
            $response.ContentType = "text/plain"
            $response.ContentLength64 = $notFoundBytes.Length
            $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            Write-Host "  -> 404 Not Found" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Erro na requisição: $_" -ForegroundColor Red
        try { $response.StatusCode = 500 } catch {}
    } finally {
        try { $response.OutputStream.Close() } catch {}
    }
}

Write-Host "Servidor iniciando na porta $Port..." -ForegroundColor Green
try {
    $listener.Start()
    Write-Host "Servidor rodando em http://localhost:$Port/" -ForegroundColor Green
    Write-Host "Pressione Ctrl+C para parar o servidor" -ForegroundColor Yellow

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        # HttpListener usa a fila HTTP.sys do Windows, que aceita muitas
        # conexões pendentes de uma vez (diferente do TcpListener manual
        # anterior) — o navegador pode abrir várias conexões em paralelo
        # para os <script>/<link> do index.html sem tomar CONNECTION_RESET.
        Handle-Context $context
    }
} catch {
    Write-Host "Erro: $_" -ForegroundColor Red
} finally {
    $listener.Stop()
}
