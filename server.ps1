param(
    [int]$Port = 5080,
    [switch]$NoBrowser,
    [switch]$Lan
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http | Out-Null
Add-Type -AssemblyName System.Web | Out-Null

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PublicDir = Join-Path $Root 'public'
$BaseUrl   = 'https://magnit.ru'
$Prefix    = if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }

# LAN address for the phone hint (first non-loopback IPv4, if any).
$LanAddress = $null
if ($Lan) {
    try {
        $LanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
            Sort-Object -Property @{ Expression = { if ($_.InterfaceAlias -like '*Wi-Fi*') { 0 } else { 1 } } } |
            Select-Object -First 1 -ExpandProperty IPAddress
    } catch {
        try {
            $LanAddress = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notlike '127.*' } |
                Select-Object -First 1).ToString()
        } catch { }
    }
}

# ---------------------------------------------------------------- http client

$Handler = New-Object System.Net.Http.HttpClientHandler
$Handler.AutomaticDecompression = ([System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate)

$Client = New-Object System.Net.Http.HttpClient($Handler)
$Client.Timeout = [TimeSpan]::FromSeconds(45)

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
[void]$Client.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', $UA)
[void]$Client.DefaultRequestHeaders.TryAddWithoutValidation('Accept', 'application/json, text/plain, */*')
[void]$Client.DefaultRequestHeaders.TryAddWithoutValidation('Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8')
[void]$Client.DefaultRequestHeaders.TryAddWithoutValidation('x-device-platform', 'Web')
[void]$Client.DefaultRequestHeaders.TryAddWithoutValidation('x-delivery-type', 'DELIVERY_TYPE_PICKUP')

# --------------------------------------------------------------------- cache

$script:Cache = @{}

function Get-CachedValue {
    param(
        [string]$Key,
        [int]$TtlSeconds,
        [scriptblock]$Factory
    )
    $now = [DateTime]::UtcNow
    $hit = $script:Cache[$Key]
    if ($null -ne $hit -and $hit.Expires -gt $now) {
        return $hit.Value
    }
    $value = & $Factory
    $script:Cache[$Key] = @{ Expires = $now.AddSeconds($TtlSeconds); Value = $value }
    return $value
}

# ------------------------------------------------------------------ upstream

function Invoke-Upstream {
    param(
        [string]$Method,
        [string]$Path,
        [string]$JsonBody
    )

    $request = New-Object System.Net.Http.HttpRequestMessage
    $request.Method = New-Object System.Net.Http.HttpMethod($Method)
    $request.RequestUri = New-Object System.Uri(($BaseUrl + $Path))

    if ($JsonBody) {
        $content = New-Object System.Net.Http.StringContent($JsonBody, [System.Text.Encoding]::UTF8, 'application/json')
        $request.Content = $content
    }

    $response = $Client.SendAsync($request).GetAwaiter().GetResult()
    try {
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $text  = [System.Text.Encoding]::UTF8.GetString($bytes)
        $json  = $null
        if ($text) {
            try { $json = $text | ConvertFrom-Json } catch { $json = $null }
        }
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Text   = $text
            Json   = $json
        }
    } finally {
        $response.Dispose()
        $request.Dispose()
    }
}

# --------------------------------------------------------------- data shaping

function Convert-Product {
    param($Item)

    $price = 0.0
    if ($null -ne $Item.price) { $price = [math]::Round(([double]$Item.price) / 100, 2) }

    $oldPrice = $null
    $discount = $null
    if ($Item.promotion) {
        if ($Item.promotion.oldPrice) { $oldPrice = [math]::Round(([double]$Item.promotion.oldPrice) / 100, 2) }
        if ($Item.promotion.discountPercent) { $discount = [int]$Item.promotion.discountPercent }
    }

    $image = ''
    if ($Item.gallery) {
        foreach ($g in $Item.gallery) {
            if ($g.type -eq 'IMAGE' -and $g.url) { $image = [string]$g.url; break }
        }
    }

    $rating  = $null
    $reviews = 0
    if ($Item.ratings) {
        if ($null -ne $Item.ratings.rating) { $rating = [double]$Item.ratings.rating }
        if ($null -ne $Item.ratings.commentsCount) { $reviews = [int]$Item.ratings.commentsCount }
    }

    $isWeighted = $false
    $unitPrice  = $null
    $unitLabel  = $null
    if ($Item.weighted) {
        $isWeighted = [bool]$Item.weighted.isWeighted
        if ($null -ne $Item.weighted.unitPrice) { $unitPrice = [math]::Round(([double]$Item.weighted.unitPrice) / 100, 2) }
        if ($Item.weighted.unitLabel) { $unitLabel = [string]$Item.weighted.unitLabel }
        if ($Item.weighted.shelfLabel) { $unitLabel = [string]$Item.weighted.shelfLabel }
    }

    $badges = @()
    if ($Item.badges) {
        foreach ($b in $Item.badges) {
            if ($b.text) { $badges += [string]$b.text }
        }
    }

    $stock = 0
    if ($null -ne $Item.quantity) { $stock = [int]$Item.quantity }

    [pscustomobject]@{
        id        = [string]$Item.id
        productId = [string]$Item.productId
        name      = [string]$Item.name
        seoCode   = [string]$Item.seoCode
        price     = $price
        oldPrice  = $oldPrice
        discount  = $discount
        image     = $image
        rating    = $rating
        reviews   = $reviews
        stock     = $stock
        lowStock  = [bool]$Item.isLowStock
        weighted  = $isWeighted
        unitPrice = $unitPrice
        unitLabel = $unitLabel
        badges    = $badges
        storeCode = [string]$Item.storeCode
    }
}

function Convert-Category {
    param($Category, [int]$Depth)

    $children = @()
    if ($Depth -lt 3 -and $Category.children) {
        foreach ($child in $Category.children) {
            $children += Convert-Category -Category $child -Depth ($Depth + 1)
        }
    }
    [pscustomobject]@{
        id       = $Category.id
        name     = [string]$Category.name
        children = $children
    }
}

# ------------------------------------------------------------------ endpoints

function Get-Cities {
    param([string]$Query, [int]$Limit)

    if ($Limit -lt 1 -or $Limit -gt 50) { $Limit = 15 }
    $Query = if ($Query) { $Query.Trim() } else { '' }

    $key = "cities|$Query|$Limit"
    return Get-CachedValue -Key $key -TtlSeconds 3600 -Factory {
        $path = "/webgate/v1/cities?pagination.limit=$Limit"
        if ($Query) { $path += '&query=' + [System.Uri]::EscapeDataString($Query) }

        $resp = Invoke-Upstream -Method 'GET' -Path $path
        if ($resp.Status -ne 200 -or $null -eq $resp.Json) {
            throw ("Magnit cities API error: " + $resp.Status)
        }

        $items = @()
        if ($resp.Json.data) {
            foreach ($c in $resp.Json.data) {
                $items += [pscustomobject]@{
                    id     = [string]$c.id
                    city   = [string]$c.city
                    region = [string]$c.region
                    area   = [string]$c.area
                }
            }
        }
        [pscustomobject]@{
            total = [int]$resp.Json.total
            items = $items
        }
    }
}

function Get-Stores {
    param([string]$CityId)

    if (-not $CityId) { throw 'city is required' }

    return Get-CachedValue -Key "stores|$CityId" -TtlSeconds 900 -Factory {
        $all    = New-Object System.Collections.ArrayList
        $offset = 0
        $total  = 0

        for ($page = 0; $page -lt 4; $page++) {
            $body = [ordered]@{
                filters    = [ordered]@{
                    cityFIASID       = $CityId
                    deliveryTypeList = @('DELIVERY_TYPE_PICKUP')
                    storeTypeListV2  = @('MM', 'MM_MINI', 'GM', 'MC', 'ME', 'V1', 'MO')
                }
                pagination = [ordered]@{ offset = $offset; size = 500 }
                sorting    = [ordered]@{ sortBy = 'SORT_BY_CITY'; sortType = 'SORT_TYPE_ASC' }
            }
            $json = $body | ConvertTo-Json -Compress -Depth 10
            $resp = Invoke-Upstream -Method 'POST' -Path '/webgate/v1/stores-facade/search/detail' -JsonBody $json

            if ($resp.Status -ne 200 -or $null -eq $resp.Json) {
                throw ("Magnit stores API error: " + $resp.Status)
            }

            $total = [int]$resp.Json.totalCount
            $batch = 0
            if ($resp.Json.data) {
                foreach ($s in $resp.Json.data) {
                    $batch++
                    $lat = $null
                    $lng = $null
                    if ($s.coordinates) {
                        $lat = $s.coordinates.latitude
                        $lng = $s.coordinates.longitude
                    }
                    [void]$all.Add([pscustomobject]@{
                        code     = [string]$s.externalId.storeCode
                        address  = [string]$s.address
                        type     = [string]$s.storeTypeV2
                        lat      = $lat
                        lng      = $lng
                        delivery = @($s.deliveryTypeList)
                    })
                }
            }

            $offset += 500
            if ($all.Count -ge $total -or $batch -eq 0) { break }
        }

        [pscustomobject]@{
            total = $total
            items = @($all | Sort-Object address)
        }
    }
}

function Get-Categories {
    param([string]$StoreCode)

    if (-not $StoreCode) { throw 'store is required' }

    return Get-CachedValue -Key "categories|$StoreCode" -TtlSeconds 3600 -Factory {
        $path = "/webgate/v3/categories/store/" + [System.Uri]::EscapeDataString($StoreCode) + '?storetype=1&catalogtype=1'
        $resp = Invoke-Upstream -Method 'GET' -Path $path
        if ($resp.Status -ne 200 -or $null -eq $resp.Json) {
            throw ("Magnit categories API error: " + $resp.Status)
        }

        $items = @()
        if ($resp.Json.items) {
            foreach ($c in $resp.Json.items) {
                $items += Convert-Category -Category $c -Depth 0
            }
        }
        [pscustomobject]@{ items = $items }
    }
}

function Get-Products {
    param(
        [string]$StoreCode,
        [string]$Query,
        [string]$CategoryId,
        [string]$Sort,
        [int]$Page,
        [int]$Limit
    )

    if (-not $StoreCode) { throw 'store is required' }

    if ($Limit -lt 1 -or $Limit -gt 50) { $Limit = 24 }
    if ($Page -lt 1) { $Page = 1 }

    $sortMap = @{
        'price_asc'  = @('asc', 'price')
        'price_desc' = @('desc', 'price')
        'discount'   = @('desc', 'discount')
        'popularity' = @('desc', 'popularity')
        'rating'     = @('desc', 'rating')
        'new'        = @('desc', 'date_added')
    }
    $pair = $sortMap[$Sort]
    if (-not $pair) { $pair = $sortMap['price_asc'] }

    $offset = ($Page - 1) * $Limit
    $key = "products|$StoreCode|$Query|$CategoryId|$Sort|$Page|$Limit"

    return Get-CachedValue -Key $key -TtlSeconds 180 -Factory {
        $body = [ordered]@{
            storeCode         = $StoreCode
            storeType         = '1'
            catalogType       = '1'
            sort              = [ordered]@{ order = $pair[0]; type = $pair[1] }
            pagination        = [ordered]@{ limit = $Limit; offset = $offset }
            includeAdultGoods = $true
        }
        if ($Query) { $body.term = $Query }
        if ($CategoryId) {
            $numericId = 0
            if ([int]::TryParse($CategoryId, [ref]$numericId)) {
                $body.categories = @($numericId)
            }
        }
        if (-not $Query -and -not $CategoryId) {
            # Empty query without a category: Magnit returns the whole store
            # assortment only when correctQuery is set.
            $body.correctQuery = $true
        }

        $json = $body | ConvertTo-Json -Compress -Depth 10
        $resp = Invoke-Upstream -Method 'POST' -Path '/webgate/v2/goods/search' -JsonBody $json

        if ($resp.Status -ne 200 -or $null -eq $resp.Json) {
            $details = ''
            if ($resp.Json -and $resp.Json.message) { $details = [string]$resp.Json.message }
            throw ("Magnit goods API error: " + $resp.Status + ' ' + $details)
        }

        $items = @()
        if ($resp.Json.items) {
            foreach ($it in $resp.Json.items) {
                $items += Convert-Product -Item $it
            }
        }

        $pagination = $resp.Json.pagination
        [pscustomobject]@{
            items   = $items
            total   = if ($pagination) { [int]$pagination.totalCount } else { $items.Count }
            limit   = $Limit
            page    = $Page
            offset  = $offset
            hasMore = if ($pagination) { [bool]$pagination.hasMore } else { $false }
        }
    }
}

# ------------------------------------------------------------------ responses

$MimeTypes = @{
    '.html'  = 'text/html; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.js'    = 'application/javascript; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.svg'   = 'image/svg+xml'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.webp'  = 'image/webp'
    '.ico'   = 'image/x-icon'
    '.woff2' = 'font/woff2'
    '.xlsx'  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function Write-Bytes {
    param($Context, [int]$StatusCode, [byte[]]$Bytes, [string]$ContentType)

    $response = $Context.Response
    $response.StatusCode = $StatusCode
    $response.ContentType = $ContentType
    $response.Headers['Cache-Control'] = 'no-store'
    try { $response.Headers['Access-Control-Allow-Origin'] = '*' } catch { }
    $response.ContentLength64 = $Bytes.Length
    if ($Bytes.Length -gt 0) {
        $response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    }
    $response.OutputStream.Close()
}

function Write-Json {
    param($Context, [int]$StatusCode, $Data)

    $json  = $Data | ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Write-Bytes -Context $Context -StatusCode $StatusCode -Bytes $bytes -ContentType 'application/json; charset=utf-8'
}

function Get-MimeType {
    param([string]$Path)
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($MimeTypes.ContainsKey($ext)) { return $MimeTypes[$ext] }
    return 'application/octet-stream'
}

function Serve-Static {
    param($Context, [string]$Path)

    if ($Path -eq '/' -or $Path -eq '') { $Path = '/index.html' }

    $relative = $Path.TrimStart('/') -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $PublicDir $relative))

    $publicFull = [System.IO.Path]::GetFullPath($PublicDir)
    if (-not $full.StartsWith($publicFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Bytes -Context $Context -StatusCode 403 -Bytes ([System.Text.Encoding]::UTF8.GetBytes('Forbidden')) -ContentType 'text/plain; charset=utf-8'
        return 403
    }

    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Write-Bytes -Context $Context -StatusCode 404 -Bytes ([System.Text.Encoding]::UTF8.GetBytes('Not found')) -ContentType 'text/plain; charset=utf-8'
        return 404
    }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    Write-Bytes -Context $Context -StatusCode 200 -Bytes $bytes -ContentType (Get-MimeType -Path $full)
    return 200
}

function Get-QueryValue {
    param($Request, [string]$Name)

    $raw = $Request.Url.Query
    if (-not $raw) { return $null }

    $collection = [System.Web.HttpUtility]::ParseQueryString($raw, [System.Text.Encoding]::UTF8)
    return $collection[$Name]
}

# ------------------------------------------------------------------- dispatch

function Handle-Request {
    param($Context)

    $request  = $Context.Request
    $path     = $request.Url.AbsolutePath
    $response = $Context.Response
    $status   = 200
    $watch    = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        switch ($path) {
            '/api/cities' {
                $q = Get-QueryValue -Request $request -Name 'q'
                $limit = 15
                if (Get-QueryValue -Request $request -Name 'limit') { $limit = [int](Get-QueryValue -Request $request -Name 'limit') }
                Write-Json -Context $Context -StatusCode 200 -Data (Get-Cities -Query $q -Limit $limit)
                $status = 200
            }
            '/api/stores' {
                $city = Get-QueryValue -Request $request -Name 'city'
                Write-Json -Context $Context -StatusCode 200 -Data (Get-Stores -CityId $city)
                $status = 200
            }
            '/api/categories' {
                $store = Get-QueryValue -Request $request -Name 'store'
                Write-Json -Context $Context -StatusCode 200 -Data (Get-Categories -StoreCode $store)
                $status = 200
            }
            '/api/products' {
                $store = Get-QueryValue -Request $request -Name 'store'
                $q     = Get-QueryValue -Request $request -Name 'q'
                $cat   = Get-QueryValue -Request $request -Name 'cat'
                $sort  = Get-QueryValue -Request $request -Name 'sort'
                $page  = 1
                $limit = 24
                if (Get-QueryValue -Request $request -Name 'page')  { $page  = [int](Get-QueryValue -Request $request -Name 'page') }
                if (Get-QueryValue -Request $request -Name 'limit') { $limit = [int](Get-QueryValue -Request $request -Name 'limit') }

                Write-Json -Context $Context -StatusCode 200 -Data (Get-Products -StoreCode $store -Query $q -CategoryId $cat -Sort $sort -Page $page -Limit $limit)
                $status = 200
            }
            '/api/health' {
                Write-Json -Context $Context -StatusCode 200 -Data @{ ok = $true; time = (Get-Date).ToString('s') }
                $status = 200
            }
            default {
                if ($path -eq '/favicon.ico') {
                    $response.StatusCode = 204
                    $response.Close()
                    $status = 204
                } else {
                    $status = Serve-Static -Context $Context -Path $path
                }
            }
        }
    } catch {
        $status = 500
        $message = $_.Exception.Message
        try {
            Write-Json -Context $Context -StatusCode 500 -Data @{ error = $message }
        } catch { }
    } finally {
        $watch.Stop()
        $line = '{0} {1} -> {2} ({3} ms)' -f $request.HttpMethod, $path, $status, $watch.ElapsedMilliseconds
        if ($status -ge 500) { Write-Host $line -ForegroundColor Red }
        elseif ($status -ge 400) { Write-Host $line -ForegroundColor DarkYellow }
        else { Write-Host $line -ForegroundColor DarkGray }
    }
}

# ----------------------------------------------------------------------- main

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)

try {
    $listener.Start()
} catch {
    Write-Host ''
    Write-Host '  Cannot start the server.' -ForegroundColor Red
    Write-Host ('  ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ''

    if ($_.Exception.Message -match 'Access is denied|Access denied|5\b') {
        Write-Host '  Binding to a LAN address needs a one-time URL reservation.' -ForegroundColor Yellow
        Write-Host '  Open PowerShell as Administrator and run:' -ForegroundColor Yellow
        Write-Host ''
        Write-Host ('    netsh http add urlacl url=http://+:' + $Port + '/ user=' + $env:USERNAME) -ForegroundColor White
        Write-Host ''
        Write-Host '  Then allow the port through Windows Firewall (also as Administrator):' -ForegroundColor Yellow
        Write-Host ''
        Write-Host ('    netsh advfirewall firewall add rule name="Magnit local" dir=in action=allow protocol=TCP localport=' + $Port) -ForegroundColor White
        Write-Host ''
        Write-Host '  After that start-lan.bat works without administrator rights.' -ForegroundColor DarkGray
    } else {
        Write-Host ('  Port ' + $Port + ' may be busy. Try:') -ForegroundColor Yellow
        Write-Host ('  powershell -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Port ' + ($Port + 1)) -ForegroundColor Yellow
    }

    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  Magnit cheap-price search' -ForegroundColor Red
if ($Lan) {
    Write-Host ('  Server:  http://localhost:' + $Port + '/') -ForegroundColor Green
    if ($LanAddress) {
        Write-Host ('  Phone:   http://' + $LanAddress + ':' + $Port + '/') -ForegroundColor Green
        Write-Host '           (phone must be on the same Wi-Fi / network)' -ForegroundColor DarkGray
    } else {
        Write-Host '  Phone:   LAN address not found - check the network connection.' -ForegroundColor Yellow
    }
} else {
    Write-Host ('  Server:  ' + $Prefix) -ForegroundColor Green
    Write-Host '  Phone:   use start-lan.bat to open it from a phone' -ForegroundColor DarkGray
}
Write-Host '  Stop:    Ctrl + C' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) {
    try { Start-Process ('http://localhost:' + $Port + '/') | Out-Null } catch { }
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        Handle-Request -Context $context
    }
} finally {
    try { $listener.Stop() } catch { }
    try { $listener.Close() } catch { }
    Write-Host ''
    Write-Host '  Server stopped.' -ForegroundColor DarkGray
}
