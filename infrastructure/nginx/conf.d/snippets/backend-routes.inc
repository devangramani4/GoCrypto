# REST API — authentication endpoints get a much tighter budget against credential stuffing.
location ~ ^/api/v1/auth/(login|register|password|oauth|2fa|pin) {
  limit_req zone=auth burst=10 nodelay;
  include /etc/nginx/conf.d/snippets/proxy-api.inc;
}

location ~ ^/api/v1/wallet/(withdrawals|internal-transfer) {
  limit_req zone=wallet burst=10 nodelay;
  include /etc/nginx/conf.d/snippets/proxy-api.inc;
}

location /api/ {
  limit_req zone=api burst=100 nodelay;
  include /etc/nginx/conf.d/snippets/proxy-api.inc;
}

# Real-time gateway (Socket.IO over websockets).
location /socket.io/ {
  proxy_pass http://gc_ws;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}

# Internal endpoints are never exposed publicly (scrape metrics on the private network).
location ~ ^/(metrics|ready|docs) {
  return 404;
}
