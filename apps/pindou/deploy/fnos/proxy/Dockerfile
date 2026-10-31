ARG NGINX_IMAGE=nginx:1.28-alpine
FROM ${NGINX_IMAGE}
RUN apk add --no-cache curl
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /usr/local/bin/pindou-proxy
RUN chmod 755 /usr/local/bin/pindou-proxy
ENTRYPOINT ["/usr/local/bin/pindou-proxy"]
