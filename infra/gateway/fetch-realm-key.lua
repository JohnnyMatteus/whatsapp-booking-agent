-- Imprime em PEM a chave pública RS256 ativa do realm, lida de GET <realm> (campo public_key).
-- Roda com o `resty` que acompanha o Kong; sai com erro se o realm não responder ou não trouxer a chave.
local http = require("resty.http")

local url = arg[1]
if not url or url == "" then error("informe a URL do realm") end

local client = http.new()
client:set_timeout(3000)
local res, err = client:request_uri(url, { method = "GET", headers = { Accept = "application/json" } })
if not res then error("realm inacessível: " .. tostring(err)) end
if res.status ~= 200 then error("realm respondeu " .. tostring(res.status)) end

local key = res.body:match('"public_key"%s*:%s*"([A-Za-z0-9+/=]+)"')
if not key or #key < 200 then error("o realm não devolveu public_key") end

local lines = {}
for i = 1, #key, 64 do lines[#lines + 1] = key:sub(i, i + 63) end
io.write("-----BEGIN PUBLIC KEY-----\n", table.concat(lines, "\n"), "\n-----END PUBLIC KEY-----\n")
