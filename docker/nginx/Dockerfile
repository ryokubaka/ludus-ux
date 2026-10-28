FROM nginx:alpine@sha256:a3554c0d0b48177b1413c26e01f695334428020d9df01243fbae3e11cfd17417

RUN apk add --no-cache openssl

COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY default.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /docker-entrypoint.sh \
    && sed -i 's/\r$//' /docker-entrypoint.sh

EXPOSE 443

ENTRYPOINT ["/docker-entrypoint.sh"]
