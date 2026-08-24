param([int]$Port = 3000)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)

Write-Host "Servidor iniciando na porta $Port..." -ForegroundColor Green
try {
    $listener.Start()
    Write-Host "Servidor rodando em http://localhost:$Port/" -ForegroundColor Green
    Write-Host "Pressione Ctrl+C para parar o servidor" -ForegroundColor Yellow

    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $writer = New-Object System.IO.StreamWriter($stream)

        $requestLine = $reader.ReadLine()
        if ($requestLine) {
            $parts = $requestLine.Split(" ")
            $method = $parts[0]
            $path = $parts[1]

            # Ler headers
            while ($true) {
                $header = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($header)) { break }
            }

            if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }

            $filePath = Join-Path $projectRoot $path.TrimStart("/").Replace("/", "\")
            $filePath = [System.IO.Path]::GetFullPath($filePath)

            Write-Host "$method $path" -ForegroundColor Cyan

            if ($filePath.StartsWith($projectRoot) -and (Test-Path $filePath -PathType Leaf)) {
                $fileContent = [System.IO.File]::ReadAllBytes($filePath)
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()

                $contentType = "application/octet-stream"
                switch ($ext) {
                    ".html" { $contentType = "text/html; charset=utf-8" }
                    ".js" { $contentType = "application/javascript" }
                    ".css" { $contentType = "text/css" }
                    ".json" { $contentType = "application/json" }
                    ".png" { $contentType = "image/png" }
                    ".jpg" { $contentType = "image/jpeg" }
                    ".jpeg" { $contentType = "image/jpeg" }
                    ".gif" { $contentType = "image/gif" }
                    ".svg" { $contentType = "image/svg+xml" }
                    ".ico" { $contentType = "image/x-icon" }
                    ".woff" { $contentType = "font/woff" }
                    ".woff2" { $contentType = "font/woff2" }
                }

                $writer.WriteLine("HTTP/1.1 200 OK")
                $writer.WriteLine("Content-Type: $contentType")
                $writer.WriteLine("Content-Length: $($fileContent.Length)")
                $writer.WriteLine("Connection: close")
                $writer.WriteLine("Access-Control-Allow-Origin: *")
                $writer.WriteLine("")
                $writer.Flush()
                $stream.Write($fileContent, 0, $fileContent.Length)
                Write-Host "  -> 200 OK" -ForegroundColor Green
            } else {
                $notFoundMsg = "404 Not Found"
                $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes($notFoundMsg)

                $writer.WriteLine("HTTP/1.1 404 Not Found")
                $writer.WriteLine("Content-Type: text/plain")
                $writer.WriteLine("Content-Length: $($notFoundBytes.Length)")
                $writer.WriteLine("Connection: close")
                $writer.WriteLine("")
                $writer.Flush()
                $stream.Write($notFoundBytes, 0, $notFoundBytes.Length)
                Write-Host "  -> 404 Not Found" -ForegroundColor Yellow
            }
        }

        $stream.Close()
        $client.Close()
    }
} catch {
    Write-Host "Erro: $_" -ForegroundColor Red
} finally {
    $listener.Stop()
}
