FROM nginx:alpine

RUN apk add --no-cache openssl

COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY default.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /docker-entrypoint.sh \
    && sed -i 's/\r$//' /docker-entrypoint.sh

EXPOSE 443

ENTRYPOINT ["/docker-entrypoint.sh"]
